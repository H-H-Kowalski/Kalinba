import { _decorator, Component, AudioClip, AudioSource, instantiate, Prefab, Vec3, Enum, UITransform, isValid } from 'cc';
import { ClickIndicator } from '../ClickIndicator';
import { SynthKalimbaEngine } from './SynthKalimbaEngine';
import { AudioSettingsStore, DEFAULT_APP_GAIN } from './AudioSettingsStore';
import { getWx } from './WeChatNative';
import { kalimbaAudioLog } from './KalimbaAudioDebug';
const { ccclass, property } = _decorator;

enum SynthStylePreset {
    BRIGHT = 0,   // 明亮
    POP = 1,      // 流行
    DEEP = 2,     // 深沉
    CRISP = 3,    // 清脆
    AMBIENT = 4,  // 空灵
}

@ccclass('AudioManager')
export class AudioManager extends Component {
    private static instance: AudioManager = null;
    private static readonly MAX_OUTPUT_GAIN = 1.35;
    
    @property([AudioClip])
    keySounds: AudioClip[] = [];
    
    @property(Prefab)
    clickIndicatorPrefab: Prefab = null;  // 须为专用涟漪/圆点预制体，勿拖整颗琴键

    @property({ tooltip: '默认关：微信端坐标易错会误把琴键拖到屏中央；需要时再开' })
    clickIndicatorEnabled: boolean = false;

    @property
    useSynth: boolean = true; // 固定使用 WebAudio 合成音（无需本地 mp3）

    @property({ type: Enum(SynthStylePreset), tooltip: '合成音色档位：明亮 / 流行 / 深沉 / 清脆 / 空灵' })
    synthStylePreset: SynthStylePreset = SynthStylePreset.POP;

    @property({ tooltip: '开启后才使用下面的手动参数；关闭时按音色档位自动套参数' })
    useManualSynthTuning: boolean = false;

    // ---- 合成器调音面板（Inspector可调）----
    @property({ tooltip: '起音时长(秒)，越小越脆' })
    synthAttackSec: number = 0.008;
    @property({ tooltip: '快衰时长(秒)' })
    synthFastDecaySec: number = 0.38;
    @property({ tooltip: '慢衰结束(秒)' })
    synthSlowDecaySec: number = 2.35;
    @property({ tooltip: '主体峰值音量(0~1)' })
    synthBasePeakGain: number = 0.74;
    @property({ tooltip: '快衰后电平(0~1)' })
    synthFastDecayLevel: number = 0.12;
    @property({ tooltip: '非整数泛音倍频，如 2.71' })
    synthOvertoneRatio: number = 2.76;
    @property({ tooltip: '泛音峰值(0~1)' })
    synthOvertonePeakGain: number = 0.12;
    @property({ tooltip: '泛音衰减时长(秒)' })
    synthOvertoneDecaySec: number = 0.26;
    @property({ tooltip: '瞬态频率倍数' })
    synthTransientFreqMul: number = 6.8;
    @property({ tooltip: '瞬态峰值(0~1)' })
    synthTransientPeakGain: number = 0.045;
    @property({ tooltip: '瞬态衰减时长(秒)' })
    synthTransientDecaySec: number = 0.022;
    @property({ tooltip: '高通频率(Hz)，越高越薄' })
    synthHpHz: number = 95;
    @property({ tooltip: '低通频率(Hz)，越低越不刺耳' })
    synthLpHz: number = 5800;
    
    private audioSource: AudioSource = null;
    private audioSources: AudioSource[] = [];  // 多个音频源用于合奏
    private activePlayCount: number = 0;  // 当前并发播放计数
    private warnedInvalidIndicatorPrefab = false;
    private warnedSynthUnsupported = false;
    private warnedFallbackClip = false;
    private synthEngine: SynthKalimbaEngine | null = null;
    private disposed = false;
    private playbackGeneration = 0;
    
    public static getInstance(): AudioManager {
        const instance = AudioManager.instance;
        return isValid(instance, true) && !instance.disposed ? instance : null;
    }
    
    /** 须早于各琴键 start，避免 getInstance() 为空导致整局无声 */
    onLoad() {
        AudioManager.instance = this;

        this.audioSource = this.getComponent(AudioSource);
        if (!this.audioSource) {
            this.audioSource = this.addComponent(AudioSource);
        }

        this.audioSource.volume = DEFAULT_APP_GAIN;

        this.createAudioSources();

        this.synthEngine = new SynthKalimbaEngine();
        this.applySynthParams();
        AudioSettingsStore.applyToAudioManager(this);
        this.setUseSynth(true);
        const synthOk = this.synthEngine.isSupported();
        kalimbaAudioLog('AudioMgr', 'onLoad', { useSynth: this.useSynth, synthEngineSupported: synthOk, keySoundsCount: this.keySounds?.length ?? 0 });
        if (!synthOk) {
            console.warn('[AudioManager] 当前环境不支持 WebAudio 合成，将使用 keySounds 采样（若已配置）。');
        }
        const wx = getWx() as { setInnerAudioOption?: (o: { obeyMuteSwitch?: boolean; mixWithOther?: boolean }) => void } | undefined;
        if (wx?.setInnerAudioOption) {
            try {
                wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
                kalimbaAudioLog('AudioMgr', 'setInnerAudioOption', { ok: true, obeyMuteSwitch: false, mixWithOther: true });
            } catch (e) {
                kalimbaAudioLog('AudioMgr', 'setInnerAudioOption failed', e);
            }
        } else {
            kalimbaAudioLog('AudioMgr', 'setInnerAudioOption', { available: false });
        }
    }
    
    /**
     * 创建额外的音频源用于合奏
     */
    private createAudioSources() {
        // 创建5个额外的音频源，支持最多6个同时播放
        for (let i = 0; i < 5; i++) {
            const audioSource = this.addComponent(AudioSource);
            audioSource.volume = DEFAULT_APP_GAIN;
            this.audioSources.push(audioSource);
        }
    }
    
    /**
     * 在触摸回调内调用。真机需在 WebAudioContext.resume() 的 Promise 后再播（见 playKeyInUserGesture）。
     * @param fallbackClip 琴键节点上的采样，AudioManager.keySounds 未配时兜底
     */
    playKeySound(keyIndex: number, worldPos?: Vec3, fallbackClip?: AudioClip): void {
        if (this.disposed) return;
        const generation = this.playbackGeneration;
        this.applySynthParams();
        if (this.clickIndicatorEnabled && worldPos && this.clickIndicatorPrefab) {
            this.createClickIndicator(worldPos);
        }

        const tryFallbacks = (reason: string): boolean => {
            if (this.disposed || generation !== this.playbackGeneration) return false;
            let ok = this.playKeySoundFallbackClip(keyIndex);
            if (!ok && fallbackClip) {
                const src = this.getAvailableAudioSource();
                if (src) {
                    src.playOneShot(fallbackClip);
                    ok = true;
                    kalimbaAudioLog('AudioMgr', 'fallback playOneShot(fallbackClip)', { keyIndex, reason });
                }
            }
            kalimbaAudioLog('AudioMgr', 'tryFallbacks', { keyIndex, reason, ok, hadFallbackClip: !!fallbackClip });
            return ok;
        };

        if (!this.synthEngine) {
            kalimbaAudioLog('AudioMgr', 'playKeySound no synthEngine', { keyIndex });
            tryFallbacks('no_synth_engine');
            return;
        }
        if (!this.synthEngine.isSupported()) {
            if (!this.warnedSynthUnsupported) {
                this.warnedSynthUnsupported = true;
                console.warn('[AudioManager] WebAudio 不可用，将尝试 keySounds 采样（若已在 Inspector 配置）。');
            }
            tryFallbacks('synth_not_supported');
            return;
        }

        kalimbaAudioLog('AudioMgr', 'playKeySound → synth', { keyIndex, hasFallbackClip: !!fallbackClip });
        this.synthEngine.playKeyInUserGesture(keyIndex, 1, (ok) => {
            if (this.disposed || generation !== this.playbackGeneration) return;
            if (!ok) {
                kalimbaAudioLog('AudioMgr', 'synth callback not ok → tryFallbacks', { keyIndex });
                tryFallbacks('synth_play_failed');
            } else {
                kalimbaAudioLog('AudioMgr', 'synth ok', { keyIndex });
            }
        });
    }

    /** 合成失败或环境无 WebAudio 时，用 Inspector 里 keySounds 采样兜底 */
    private playKeySoundFallbackClip(keyIndex: number): boolean {
        const clip = this.keySounds[keyIndex];
        if (!clip) {
            if (!this.warnedFallbackClip) {
                this.warnedFallbackClip = true;
                console.warn('[AudioManager] 无法播放：合成失败且 keySounds[' + keyIndex + '] 未配置。');
            }
            return false;
        }
        const src = this.getAvailableAudioSource();
        if (src) {
            src.playOneShot(clip);
            kalimbaAudioLog('AudioMgr', 'playKeySoundFallbackClip keySounds', { keyIndex, clipName: clip?.name ?? 'clip' });
            return true;
        }
        kalimbaAudioLog('AudioMgr', 'playKeySoundFallbackClip no AudioSource', { keyIndex });
        return false;
    }
    
    /**
     * 获取可用的音频源
     */
    private getAvailableAudioSource(): AudioSource | null {
        if (this.disposed) return null;
        // 首先检查主音频源
        const main = isValid(this.audioSource, true) ? this.audioSource : null;
        if (main && !main.playing) {
            return main;
        }
        
        // 检查额外的音频源
        for (const source of this.audioSources ?? []) {
            if (isValid(source, true) && !source.playing) {
                return source;
            }
        }
        
        // 如果所有音频源都在使用，返回主音频源（会中断当前播放）
        return main;
    }
    
    /**
     * 创建点击指示器
     * @param worldPos 世界坐标位置
     */
    private createClickIndicator(uiPos: Vec3) {
        if (!this.clickIndicatorPrefab) return;

        const indicator = instantiate(this.clickIndicatorPrefab);
        const clickIndicator =
            indicator.getComponent(ClickIndicator) ?? indicator.getComponentInChildren(ClickIndicator);
        if (!clickIndicator) {
            indicator.destroy();
            if (!this.warnedInvalidIndicatorPrefab) {
                this.warnedInvalidIndicatorPrefab = true;
                console.warn('[AudioManager] clickIndicatorPrefab 须自带 ClickIndicator（勿用琴键预制体 + 自动挂脚本，会错位）。');
            }
            return;
        }
        this.node.addChild(indicator);

        const ui = this.node.getComponent(UITransform);
        if (ui) {
            const local = ui.convertToNodeSpaceAR(uiPos);
            indicator.setPosition(local);
        } else {
            indicator.setPosition(uiPos);
        }

        clickIndicator.setSize(60);
    }
    
    /**
     * 停止所有播放
     */
    stopAllSounds() {
        // Cocos 在 onDestroy 后会把数组等引用置 null；旧场景可能仍持有此组件。
        if (this.disposed) return;
        this.playbackGeneration++;
        if (isValid(this.audioSource, true)) this.audioSource.stop();
        for (const source of this.audioSources ?? []) {
            if (isValid(source, true)) source.stop();
        }
        this.synthEngine?.stopAll();
        this.activePlayCount = 0;
    }

    /** 仅用于挑战结算 UI，不会写入演奏录制数据。 */
    playChallengeResultCue(stars: number): boolean {
        return this.synthEngine?.playChallengeResultCue(stars) ?? false;
    }

    /** 新成就提示音；与琴键播放、节拍器完全解耦。 */
    playAchievementCue(): boolean {
        return this.synthEngine?.playAchievementCue() ?? false;
    }
    
    /**
     * 设置音量
     * @param volume 音量（0.0 - 1.35，给移动设备保留防削波余量）
     */
    setVolume(volume: number) {
        if (this.disposed || !Number.isFinite(volume)) return;
        const vol = Math.max(0, Math.min(AudioManager.MAX_OUTPUT_GAIN, volume));
        if (isValid(this.audioSource, true)) this.audioSource.volume = vol;
        for (const source of this.audioSources ?? []) {
            if (isValid(source, true)) source.volume = vol;
        }
        this.synthEngine?.setVolume(vol);
    }

    /** 当前主通道音量 0~1（用于存档/UI 同步） */
    getVolume(): number {
        return this.audioSource ? this.audioSource.volume : 0;
    }
    
    /**
     * 运行时切换：当前版本固定仅合成音，false 会被忽略
     */
    setUseSynth(enabled: boolean) {
        const next = true;
        if (this.useSynth === next) return;
        // 切换前先停掉当前所有尾音，避免两套音源叠加
        this.stopAllSounds();
        this.useSynth = next;
        if (enabled === false) {
            console.warn('[AudioManager] 已禁用本地采样模式，当前固定使用合成音。');
        }
        if (this.synthEngine && !this.synthEngine.isSupported()) {
            console.warn('[AudioManager] 当前环境不支持 WebAudio 合成，将使用 keySounds 采样（若已配置）。');
        }
    }

    toggleUseSynth() {
        this.setUseSynth(true);
    }

    isUsingSynth(): boolean {
        return this.useSynth;
    }

    setUseManualSynthTuning(enabled: boolean) {
        this.useManualSynthTuning = !!enabled;
        this.applySynthParams();
    }

    setSynthStylePreset(preset: number) {
        if (!Number.isFinite(preset)) return;
        const p = Math.max(0, Math.min(4, Math.floor(preset)));
        this.synthStylePreset = p as SynthStylePreset;
        this.applySynthParams();
    }

    cycleSynthStylePreset() {
        const next = (this.synthStylePreset + 1) % 5;
        this.setSynthStylePreset(next);
    }

    getSynthStylePreset(): number {
        return this.synthStylePreset;
    }

    getUseManualSynthTuning(): boolean {
        return this.useManualSynthTuning;
    }

    /** 节拍器/闯关判定共用的音频时钟。 */
    getAudioCurrentTime(): number | null {
        return this.synthEngine?.getCurrentTime() ?? null;
    }

    async resumeWebAudio(): Promise<boolean> {
        const engine = this.synthEngine;
        if (this.disposed || !engine || !engine.isSupported()) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const ready = await Promise.race([
                Promise.resolve(engine.resume()).then(() => true, () => false),
                new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 3000); }),
            ]);
            return ready && !this.disposed && this.synthEngine === engine && engine.isRunning();
        } finally { if (timer !== undefined) clearTimeout(timer); }
    }

    scheduleMetronomeTick(at: number, accented: boolean): boolean {
        return this.synthEngine?.scheduleMetronomeTick(at, accented) ?? false;
    }

    getSynthStyleName(): string {
        switch (this.synthStylePreset) {
            case SynthStylePreset.BRIGHT:
                return '明亮';
            case SynthStylePreset.DEEP:
                return '深沉';
            case SynthStylePreset.CRISP:
                return '清脆';
            case SynthStylePreset.AMBIENT:
                return '空灵';
            case SynthStylePreset.POP:
            default:
                return '流行';
        }
    }

    /** 将 Inspector 参数同步到合成器 */
    applySynthParams() {
        if (!this.synthEngine) return;
        let p = {
            attackSec: this.synthAttackSec,
            fastDecaySec: this.synthFastDecaySec,
            slowDecaySec: this.synthSlowDecaySec,
            basePeakGain: this.synthBasePeakGain,
            fastDecayLevel: this.synthFastDecayLevel,
            overtoneRatio: this.synthOvertoneRatio,
            overtonePeakGain: this.synthOvertonePeakGain,
            overtoneDecaySec: this.synthOvertoneDecaySec,
            transientFreqMul: this.synthTransientFreqMul,
            transientPeakGain: this.synthTransientPeakGain,
            transientDecaySec: this.synthTransientDecaySec,
            hpHz: this.synthHpHz,
            lpHz: this.synthLpHz,
            presetGain: 1.0,
        };

        if (!this.useManualSynthTuning) {
            // 档位预设（优先推荐）
            switch (this.synthStylePreset) {
                case SynthStylePreset.BRIGHT:
                    p = {
                        // 通透但不尖：保留金属泛音，收住手机最容易刺耳的瞬态。
                        attackSec: 0.006,
                        fastDecaySec: 0.32,
                        slowDecaySec: 1.75,
                        basePeakGain: 0.68,
                        fastDecayLevel: 0.105,
                        overtoneRatio: 2.92,
                        overtonePeakGain: 0.16,
                        overtoneDecaySec: 0.20,
                        transientFreqMul: 7.8,
                        transientPeakGain: 0.055,
                        transientDecaySec: 0.018,
                        hpHz: 125,
                        lpHz: 6800,
                        presetGain: 0.98,
                    };
                    break;
                case SynthStylePreset.DEEP:
                    p = {
                        // 温厚但不轰：主体更饱满，短一些的尾音避免低音连续叠加。
                        attackSec: 0.012,
                        fastDecaySec: 0.55,
                        slowDecaySec: 3.10,
                        basePeakGain: 0.78,
                        fastDecayLevel: 0.12,
                        overtoneRatio: 2.28,
                        overtonePeakGain: 0.08,
                        overtoneDecaySec: 0.34,
                        transientFreqMul: 5.3,
                        transientPeakGain: 0.035,
                        transientDecaySec: 0.028,
                        hpHz: 75,
                        lpHz: 4800,
                        presetGain: 0.96,
                    };
                    break;
                case SynthStylePreset.CRISP:
                    p = {
                        // 清晰短促：适合闯关跟弹，减少高倍频带来的刺耳和设备差异。
                        attackSec: 0.004,
                        fastDecaySec: 0.24,
                        slowDecaySec: 1.35,
                        basePeakGain: 0.66,
                        fastDecayLevel: 0.08,
                        overtoneRatio: 3.05,
                        overtonePeakGain: 0.17,
                        overtoneDecaySec: 0.13,
                        transientFreqMul: 9.0,
                        transientPeakGain: 0.065,
                        transientDecaySec: 0.012,
                        hpHz: 145,
                        lpHz: 7200,
                        presetGain: 0.96,
                    };
                    break;
                case SynthStylePreset.POP:
                default:
                    p = {
                        // 默认推荐：起音、木质主体和金属泛音最均衡，优先保证手机外放稳定。
                        attackSec: 0.008,
                        fastDecaySec: 0.38,
                        slowDecaySec: 2.35,
                        basePeakGain: 0.74,
                        fastDecayLevel: 0.12,
                        overtoneRatio: 2.76,
                        overtonePeakGain: 0.12,
                        overtoneDecaySec: 0.26,
                        transientFreqMul: 6.8,
                        transientPeakGain: 0.045,
                        transientDecaySec: 0.022,
                        hpHz: 95,
                        lpHz: 5800,
                        presetGain: 1.00,
                    };
                    break;
                case SynthStylePreset.AMBIENT:
                    p = {
                        // 柔和延展：用较慢主体而非高能量泛音制造空间感，避免低音破裂。
                        attackSec: 0.018,
                        fastDecaySec: 0.62,
                        slowDecaySec: 3.60,
                        basePeakGain: 0.72,
                        fastDecayLevel: 0.09,
                        overtoneRatio: 2.62,
                        overtonePeakGain: 0.075,
                        overtoneDecaySec: 0.52,
                        transientFreqMul: 5.8,
                        transientPeakGain: 0.018,
                        transientDecaySec: 0.030,
                        hpHz: 115,
                        lpHz: 5600,
                        presetGain: 0.98,
                    };
                    break;
            }
        }

        this.synthEngine.setParams({
            attackSec: p.attackSec,
            fastDecaySec: p.fastDecaySec,
            slowDecaySec: p.slowDecaySec,
            basePeakGain: p.basePeakGain,
            fastDecayLevel: p.fastDecayLevel,
            overtoneRatio: p.overtoneRatio,
            overtonePeakGain: p.overtonePeakGain,
            overtoneDecaySec: p.overtoneDecaySec,
            transientFreqMul: p.transientFreqMul,
            transientPeakGain: p.transientPeakGain,
            transientDecaySec: p.transientDecaySec,
            hpHz: p.hpHz,
            lpHz: p.lpHz,
            presetGain: p.presetGain,
        });
    }
    
    /**
     * 获取当前播放的琴键数量
     */
    getPlayingKeyCount(): number {
        if (this.synthEngine && this.synthEngine.isSupported()) {
            return this.synthEngine.getActiveVoiceCount();
        }
        return 0;
    }

    onDestroy() {
        if (this.disposed) return;
        this.disposed = true;
        if (AudioManager.instance === this) AudioManager.instance = null;
        const engine = this.synthEngine;
        this.synthEngine = null;
        this.audioSource = null;
        this.audioSources.length = 0;
        engine?.dispose();
    }
}
