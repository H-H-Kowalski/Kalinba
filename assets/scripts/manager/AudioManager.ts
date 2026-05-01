import { _decorator, Component, AudioClip, AudioSource, instantiate, Prefab, Vec3, Enum, UITransform } from 'cc';
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
    private static readonly MAX_OUTPUT_GAIN = 3.75;
    
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
    synthAttackSec: number = 0.01;
    @property({ tooltip: '快衰时长(秒)' })
    synthFastDecaySec: number = 0.5;
    @property({ tooltip: '慢衰结束(秒)' })
    synthSlowDecaySec: number = 2.9;
    @property({ tooltip: '主体峰值音量(0~1)' })
    synthBasePeakGain: number = 0.88;
    @property({ tooltip: '快衰后电平(0~1)' })
    synthFastDecayLevel: number = 0.14;
    @property({ tooltip: '非整数泛音倍频，如 2.71' })
    synthOvertoneRatio: number = 2.71;
    @property({ tooltip: '泛音峰值(0~1)' })
    synthOvertonePeakGain: number = 0.2;
    @property({ tooltip: '泛音衰减时长(秒)' })
    synthOvertoneDecaySec: number = 0.42;
    @property({ tooltip: '瞬态频率倍数' })
    synthTransientFreqMul: number = 8.5;
    @property({ tooltip: '瞬态峰值(0~1)' })
    synthTransientPeakGain: number = 0.11;
    @property({ tooltip: '瞬态衰减时长(秒)' })
    synthTransientDecaySec: number = 0.05;
    @property({ tooltip: '高通频率(Hz)，越高越薄' })
    synthHpHz: number = 90;
    @property({ tooltip: '低通频率(Hz)，越低越不刺耳' })
    synthLpHz: number = 7200;
    
    private audioSource: AudioSource = null;
    private audioSources: AudioSource[] = [];  // 多个音频源用于合奏
    private activePlayCount: number = 0;  // 当前并发播放计数
    private warnedInvalidIndicatorPrefab = false;
    private warnedSynthUnsupported = false;
    private warnedFallbackClip = false;
    private synthEngine: SynthKalimbaEngine | null = null;
    
    public static getInstance(): AudioManager {
        return AudioManager.instance;
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
        this.applySynthParams();
        if (this.clickIndicatorEnabled && worldPos && this.clickIndicatorPrefab) {
            this.createClickIndicator(worldPos);
        }

        const tryFallbacks = (reason: string): boolean => {
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
        // 首先检查主音频源
        if (!this.audioSource.playing) {
            return this.audioSource;
        }
        
        // 检查额外的音频源
        for (const source of this.audioSources) {
            if (!source.playing) {
                return source;
            }
        }
        
        // 如果所有音频源都在使用，返回主音频源（会中断当前播放）
        return this.audioSource;
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
        this.audioSource.stop();
        for (const source of this.audioSources) {
            source.stop();
        }
        this.synthEngine?.stopAll();
        this.activePlayCount = 0;
    }
    
    /**
     * 设置音量
     * @param volume 音量 (0.0 - 2.5)
     */
    setVolume(volume: number) {
        const vol = Math.max(0, Math.min(AudioManager.MAX_OUTPUT_GAIN, volume));
        this.audioSource.volume = vol;
        for (const source of this.audioSources) {
            source.volume = vol;
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
                        attackSec: 0.005,
                        fastDecaySec: 0.30,
                        slowDecaySec: 1.55,
                        basePeakGain: 0.72,
                        fastDecayLevel: 0.12,
                        overtoneRatio: 3.08,
                        overtonePeakGain: 0.31,
                        overtoneDecaySec: 0.22,
                        transientFreqMul: 11.4,
                        transientPeakGain: 0.12,
                        transientDecaySec: 0.020,
                        hpHz: 170,
                        lpHz: 9200,
                        presetGain: 1.02,
                    };
                    break;
                case SynthStylePreset.DEEP:
                    p = {
                        attackSec: 0.014,
                        fastDecaySec: 0.82,
                        slowDecaySec: 4.60,
                        basePeakGain: 0.96,
                        fastDecayLevel: 0.26,
                        overtoneRatio: 2.36,
                        overtonePeakGain: 0.14,
                        overtoneDecaySec: 0.65,
                        transientFreqMul: 6.4,
                        transientPeakGain: 0.085,
                        transientDecaySec: 0.060,
                        hpHz: 45,
                        lpHz: 5800,
                        presetGain: 0.82,
                    };
                    break;
                case SynthStylePreset.CRISP:
                    p = {
                        attackSec: 0.0035,
                        fastDecaySec: 0.20,
                        slowDecaySec: 1.05,
                        basePeakGain: 0.80,
                        fastDecayLevel: 0.12,
                        overtoneRatio: 3.31,
                        overtonePeakGain: 0.32,
                        overtoneDecaySec: 0.16,
                        transientFreqMul: 13.2,
                        transientPeakGain: 0.13,
                        transientDecaySec: 0.014,
                        hpHz: 195,
                        lpHz: 10800,
                        presetGain: 0.88,
                    };
                    break;
                case SynthStylePreset.POP:
                default:
                    p = {
                        attackSec: 0.009,
                        fastDecaySec: 0.48,
                        slowDecaySec: 2.45,
                        basePeakGain: 0.86,
                        fastDecayLevel: 0.16,
                        overtoneRatio: 2.71,
                        overtonePeakGain: 0.20,
                        overtoneDecaySec: 0.36,
                        transientFreqMul: 8.6,
                        transientPeakGain: 0.09,
                        transientDecaySec: 0.032,
                        hpHz: 95,
                        lpHz: 6200,
                        presetGain: 1.00,
                    };
                    break;
                case SynthStylePreset.AMBIENT:
                    p = {
                        attackSec: 0.010,
                        fastDecaySec: 0.95,
                        slowDecaySec: 5.20,
                        basePeakGain: 0.76,
                        fastDecayLevel: 0.24,
                        overtoneRatio: 2.98,
                        overtonePeakGain: 0.14,
                        overtoneDecaySec: 1.20,
                        transientFreqMul: 7.1,
                        transientPeakGain: 0.022,
                        transientDecaySec: 0.075,
                        hpHz: 120,
                        lpHz: 7600,
                        presetGain: 1.20,
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
} 