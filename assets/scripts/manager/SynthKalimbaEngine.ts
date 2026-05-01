import { getWx } from './WeChatNative';
import { kalimbaAudioLog, kalimbaAudioWarn } from './KalimbaAudioDebug';

/**
 * WebAudio 卡林巴合成器（17 键）
 *
 * 微信小游戏：须使用 wx.createWebAudioContext() 返回的 WebAudioContext（与标准 AudioContext 接口一致），
 * 见 https://developers.weixin.qq.com/minigame/dev/api/media/audio/wx.createWebAudioContext.html
 * 与 https://developers.weixin.qq.com/minigame/dev/api/media/audio/WebAudioContext.html
 * （基础库 ≥2.19；state / onstatechange / resume 返回 Promise 等以微信文档为准）
 *
 * 真机注意：文档写明 resume() 返回 Promise；真机往往在 Promise 完成后 state 才为 running。
 * 若在仍为 suspended 时 start 振荡器，会无声；模拟器常较宽松，易误判。请用 playKeyInUserGesture() 从触摸回调发起。
 *
 * 设计目标：
 * 1) 不依赖任何外部采样文件（MP3/WAV）；
 * 2) 可迁移：核心是“频率 + 包络 + 泛音 + 瞬态”的数学模型；
 * 3) 声学拟真：强调拇指琴的木质箱体衰减与金属弹片泛音。
 */
type VoiceHandle = {
    fundamentalOsc: OscillatorNode;
    overtoneOsc: OscillatorNode;
    transientOsc: OscillatorNode;
    fundamentalGain: GainNode;
    overtoneGain: GainNode;
    transientGain: GainNode;
    hp: BiquadFilterNode;
    lp: BiquadFilterNode;
};

export interface KalimbaSynthParams {
    attackSec: number;          // 主体起音
    fastDecaySec: number;       // 第一段快衰
    slowDecaySec: number;       // 第二段慢衰结束时间
    basePeakGain: number;       // 主体峰值
    fastDecayLevel: number;     // 第一段结束电平
    overtoneRatio: number;      // 非整数泛音倍频
    overtonePeakGain: number;   // 泛音峰值
    overtoneDecaySec: number;   // 泛音衰减
    transientFreqMul: number;   // 瞬态频率倍数
    transientPeakGain: number;  // 瞬态峰值
    transientDecaySec: number;  // 瞬态衰减
    hpHz: number;               // 高通
    lpHz: number;               // 低通
    presetGain: number;         // 音色响度归一化系数（以 POP=1.0 为基准）
}

const DEFAULT_PARAMS: KalimbaSynthParams = {
    attackSec: 0.01,
    fastDecaySec: 0.5,
    slowDecaySec: 2.9,
    basePeakGain: 0.88,
    fastDecayLevel: 0.14,
    overtoneRatio: 2.71,
    overtonePeakGain: 0.2,
    overtoneDecaySec: 0.42,
    transientFreqMul: 8.5,
    transientPeakGain: 0.11,
    transientDecaySec: 0.05,
    hpHz: 90,
    lpHz: 7200,
    presetGain: 1.0,
};

/** 微信 WebAudioContext 与浏览器 AudioContext 在本引擎中用法一致 */
type WebAudioCtx = AudioContext;

export class SynthKalimbaEngine {
    private static readonly MAX_OUTPUT_GAIN = 3.75;
    private static loggedIsSupportedOnce = false;
    private audioContext: WebAudioCtx | null = null;
    private masterGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private softLimiter: WaveShaperNode | null = null;
    private activeVoices: Set<VoiceHandle> = new Set();
    private params: KalimbaSynthParams = { ...DEFAULT_PARAMS };
    /** 仅打一次：context 创建后挂 state 变化，便于真机对照「何时 running」 */
    private stateChangeHookInstalled = false;

    // 17 键顺序：D6 B5 G5 E5 C5 A4 F4 D4 C4 E4 G4 B4 D5 F5 A5 C6 E6
    private static readonly KEY_FREQ: number[] = [
        1174.66, 987.77, 783.99, 659.25, 523.25, 440.0, 349.23, 293.66, 261.63,
        329.63, 392.0, 493.88, 587.33, 698.46, 880.0, 1046.5, 1318.51,
    ];

    isSupported(): boolean {
        const w = getWx() as { createWebAudioContext?: () => WebAudioCtx } | undefined;
        const hasWx = !!(w && typeof w.createWebAudioContext === 'function');
        const g = globalThis as unknown as {
            AudioContext?: new () => AudioContext;
            webkitAudioContext?: new () => AudioContext;
        };
        const hasBrowser = !!(g.AudioContext || g.webkitAudioContext);
        const ok = hasWx || hasBrowser;
        if (!SynthKalimbaEngine.loggedIsSupportedOnce) {
            SynthKalimbaEngine.loggedIsSupportedOnce = true;
            kalimbaAudioLog('Synth', 'isSupported (once)', { ok, hasWxCreateWebAudio: hasWx, hasBrowserAudioContext: hasBrowser });
        }
        return ok;
    }

    ensureContext(): boolean {
        if (this.audioContext && this.masterGain) return true;
        let ctx: WebAudioCtx | null = null;
        let source: 'wx.createWebAudioContext' | 'new AudioContext' | null = null;
        const w = getWx() as { createWebAudioContext?: () => WebAudioCtx } | undefined;
        if (w && typeof w.createWebAudioContext === 'function') {
            try {
                ctx = w.createWebAudioContext();
                source = 'wx.createWebAudioContext';
            } catch (e) {
                console.warn('[SynthKalimbaEngine] wx.createWebAudioContext failed', e);
            }
        }
        if (!ctx) {
            const g = globalThis as unknown as {
                AudioContext?: new () => AudioContext;
                webkitAudioContext?: new () => AudioContext;
            };
            const Ctor = g.AudioContext || g.webkitAudioContext;
            if (!Ctor) {
                kalimbaAudioLog('WebAudio', 'ensureContext: no constructor');
                return false;
            }
            try {
                ctx = new Ctor();
                source = 'new AudioContext';
            } catch (e) {
                console.warn('[SynthKalimbaEngine] new AudioContext failed', e);
                return false;
            }
        }
        if (!ctx) return false;
        this.audioContext = ctx;
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = 1;

        // 优先使用压缩器做防削波；若环境不支持则回退到软限幅器，避免低音明显破音。
        this.compressor = null;
        this.softLimiter = null;
        const anyCtx = this.audioContext as unknown as {
            createDynamicsCompressor?: () => DynamicsCompressorNode;
        };
        if (typeof anyCtx.createDynamicsCompressor === 'function') {
            try {
                this.compressor = anyCtx.createDynamicsCompressor();
                this.compressor.threshold.setValueAtTime(-18, this.audioContext.currentTime);
                this.compressor.knee.setValueAtTime(12, this.audioContext.currentTime);
                this.compressor.ratio.setValueAtTime(16, this.audioContext.currentTime);
                this.compressor.attack.setValueAtTime(0.0005, this.audioContext.currentTime);
                this.compressor.release.setValueAtTime(0.08, this.audioContext.currentTime);
            } catch (e) {
                this.compressor = null;
                kalimbaAudioWarn('WebAudio', 'createDynamicsCompressor failed, fallback soft limiter', e);
            }
        } else {
            kalimbaAudioWarn('WebAudio', 'DynamicsCompressor not available, fallback soft limiter');
        }

        if (this.compressor) {
            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.audioContext.destination);
        } else {
            this.softLimiter = this.audioContext.createWaveShaper();
            this.softLimiter.curve = this.buildSoftLimiterCurve(2048, 2.2);
            this.softLimiter.oversample = '4x';
            this.masterGain.connect(this.softLimiter);
            this.softLimiter.connect(this.audioContext.destination);
        }
        const sr = (ctx as { sampleRate?: number }).sampleRate;
        kalimbaAudioLog('WebAudio', 'ensureContext created', {
            source,
            state: ctx.state,
            sampleRate: sr,
            masterGain: this.masterGain.gain.value,
        });
        if (!this.stateChangeHookInstalled) {
            this.stateChangeHookInstalled = true;
            ctx.onstatechange = () => {
                kalimbaAudioLog('WebAudio', 'onstatechange', { state: ctx.state });
            };
        }
        return true;
    }

    private buildSoftLimiterCurve(samples: number, drive: number): Float32Array {
        const n = Math.max(256, Math.floor(samples));
        const k = Math.max(1.2, drive);
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = (i * 2) / (n - 1) - 1;
            curve[i] = Math.tanh(k * x) / Math.tanh(k);
        }
        return curve;
    }

    /**
     * 在用户触摸回调内调用：先同步调用 resume()（满足「由用户手势发起解锁」），
     * 再在其返回的 Promise 完成后执行 playKey。真机必须在 running 后再建节点，见 WebAudioContext.resume。
     */
    playKeyInUserGesture(keyIndex: number, velocity = 1.0, onDone?: (played: boolean) => void): void {
        if (keyIndex < 0 || keyIndex >= SynthKalimbaEngine.KEY_FREQ.length) {
            onDone?.(false);
            return;
        }
        if (!this.ensureContext() || !this.audioContext) {
            onDone?.(false);
            return;
        }
        const ctx = this.audioContext;

        if (ctx.state === 'closed') {
            onDone?.(false);
            return;
        }

        const fireNow = () => {
            const ok = this.playKey(keyIndex, velocity);
            onDone?.(ok);
        };

        if (ctx.state === 'running') {
            fireNow();
            return;
        }

        try {
            const ret = ctx.resume() as Promise<void> | void;
            const isPromise = ret !== undefined && typeof (ret as Promise<void>).then === 'function';
            if (isPromise) {
                (ret as Promise<void>)
                    .then(() => fireNow())
                    .catch(() => onDone?.(false));
            } else {
                fireNow();
            }
        } catch {
            onDone?.(false);
        }
    }

    /** 文档：WebAudioContext.resume() 返回 Promise（设置页等非手势场景可 await） */
    async resume(): Promise<void> {
        if (!this.ensureContext() || !this.audioContext) return;
        const ctx = this.audioContext;
        if (ctx.state === 'closed') return;
        if (ctx.state === 'running') return;
        kalimbaAudioLog('WebAudio', 'async resume() start', { state: ctx.state });
        try {
            const p = ctx.resume();
            const isPromise = p !== undefined && typeof (p as Promise<void>).then === 'function';
            kalimbaAudioLog('WebAudio', 'async resume() return', { resumeReturnsPromise: isPromise });
            if (isPromise) {
                await p;
            }
            kalimbaAudioLog('WebAudio', 'async resume() done', { state: ctx.state });
        } catch (e) {
            console.warn('[SynthKalimbaEngine] audioContext.resume failed', e);
        }
    }

    setVolume(volume: number) {
        if (!this.ensureContext() || !this.masterGain) return;
        /** 微信小游戏 WebAudio 在真机外放上往往偏轻，主增益放宽到 250%（按需求：较原始 100% 增加 150%） */
        const wxBoost = getWx() ? 1.28 : 1;
        this.masterGain.gain.value = Math.max(0, Math.min(SynthKalimbaEngine.MAX_OUTPUT_GAIN, volume * wxBoost));
    }

    setParams(params: Partial<KalimbaSynthParams>) {
        this.params = {
            ...this.params,
            ...params,
        };
    }

    /**
     * 兼容你现有 AudioManager 调用的入口：按键索引播放
     */
    playKey(keyIndex: number, velocity = 1.0): boolean {
        if (keyIndex < 0 || keyIndex >= SynthKalimbaEngine.KEY_FREQ.length) return false;
        return this.playKalimbaNote(SynthKalimbaEngine.KEY_FREQ[keyIndex], velocity);
    }

    /**
     * 核心封装函数：播放一颗卡林巴音符（可并发）
     *
     * 声学建模说明：
     * - 主体：正弦基频（弹片主模态） + 双段指数衰减（快衰+慢尾）
     * - 泛音：非整数倍频（2.71x）模拟金属弹片“非谐性”
     * - 瞬态：极短高频三角波，模拟手指/指甲触发瞬间摩擦与撞击
     */
    playKalimbaNote(frequency: number, velocity = 1.0): boolean {
        if (!this.ensureContext() || !this.audioContext || !this.masterGain) return false;
        if (!Number.isFinite(frequency) || frequency <= 0) return false;

        const ctx = this.audioContext;
        const stateBefore = ctx.state;
        if (ctx.state !== 'closed' && ctx.state !== 'running') {
            try {
                void ctx.resume();
            } catch {
                // ignore
            }
        }
        kalimbaAudioLog('Synth', 'playKalimbaNote', {
            freqHz: Math.round(frequency * 100) / 100,
            stateBefore,
            stateAfterResumeAttempt: ctx.state,
            masterGain: this.masterGain.gain.value,
        });
        const now = ctx.currentTime;
        const vel = Math.max(0.1, Math.min(1.2, velocity));
        const pg = this.params.presetGain;
        const freqScale = this.getFreqGainScale(frequency);

        // -----------------------------
        // 0) 频段整形（木质箱体 + 去浑浊）
        // -----------------------------
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(Math.max(20, this.params.hpHz), now);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.max(500, this.params.lpHz), now);

        hp.connect(lp);
        lp.connect(this.masterGain);

        // -----------------------------
        // 1) 主体音：正弦基频 + 双段衰减
        // -----------------------------
        const fundamentalOsc = ctx.createOscillator();
        fundamentalOsc.type = 'sine';
        fundamentalOsc.frequency.setValueAtTime(frequency, now);

        const fundamentalGain = ctx.createGain();
        this.scheduleDualStageEnvelope(fundamentalGain.gain, now, vel * pg * freqScale);

        fundamentalOsc.connect(fundamentalGain);
        fundamentalGain.connect(hp);

        // -----------------------------
        // 2) 金属泛音：非整数倍频 + 快衰
        // -----------------------------
        const overtoneOsc = ctx.createOscillator();
        overtoneOsc.type = 'sine';
        overtoneOsc.frequency.setValueAtTime(frequency * this.params.overtoneRatio, now);

        const overtoneGain = ctx.createGain();
        this.scheduleOvertoneEnvelope(overtoneGain.gain, now, vel * pg);

        overtoneOsc.connect(overtoneGain);
        overtoneGain.connect(hp);

        // -----------------------------
        // 3) 瞬态噪声：高频三角波，<50ms 消失
        // -----------------------------
        const transientOsc = ctx.createOscillator();
        transientOsc.type = 'triangle';
        transientOsc.frequency.setValueAtTime(Math.min(8000, frequency * this.params.transientFreqMul), now);

        const transientGain = ctx.createGain();
        this.scheduleTransientEnvelope(transientGain.gain, now, vel * pg);

        transientOsc.connect(transientGain);
        transientGain.connect(hp);

        const voice: VoiceHandle = {
            fundamentalOsc,
            overtoneOsc,
            transientOsc,
            fundamentalGain,
            overtoneGain,
            transientGain,
            hp,
            lp,
        };
        this.activeVoices.add(voice);

        // 启停时间：主体尾音长，泛音/瞬态更短
        fundamentalOsc.start(now);
        overtoneOsc.start(now);
        transientOsc.start(now);

        transientOsc.stop(now + Math.max(0.01, this.params.transientDecaySec));
        overtoneOsc.stop(now + Math.max(0.05, this.params.overtoneDecaySec));
        fundamentalOsc.stop(now + Math.max(0.4, this.params.slowDecaySec + 0.2));

        const cleanup = () => {
            this.activeVoices.delete(voice);
            try { fundamentalGain.disconnect(); } catch {}
            try { overtoneGain.disconnect(); } catch {}
            try { transientGain.disconnect(); } catch {}
            try { hp.disconnect(); } catch {}
            try { lp.disconnect(); } catch {}
        };
        fundamentalOsc.onended = cleanup;
        return true;
    }

    stopAll() {
        for (const v of [...this.activeVoices]) {
            try { v.fundamentalOsc.stop(); } catch {}
            try { v.overtoneOsc.stop(); } catch {}
            try { v.transientOsc.stop(); } catch {}
            try { v.fundamentalGain.disconnect(); } catch {}
            try { v.overtoneGain.disconnect(); } catch {}
            try { v.transientGain.disconnect(); } catch {}
            try { v.hp.disconnect(); } catch {}
            try { v.lp.disconnect(); } catch {}
            this.activeVoices.delete(v);
        }
    }

    getActiveVoiceCount(): number {
        return this.activeVoices.size;
    }

    /**
     * 低频增益补偿：低音区基频能量集中易过载，按频率平滑衰减。
     * A4(440Hz)及以上 → 1.0；C4(261Hz) → ~0.77；D4(294Hz) → ~0.82
     */
    private getFreqGainScale(frequency: number): number {
        if (frequency >= 440) return 1.0;
        return Math.sqrt(frequency / 440);
    }

    /**
     * 主体包络：10ms 快速起音 + 双段指数衰减
     *
     * 物理意义：
     * - 第一段（~0.5s）快速掉落：弹片初始能量迅速释放；
     * - 第二段（~2~3s）慢速消散：木箱/结构残振尾音。
     */
    private scheduleDualStageEnvelope(param: AudioParam, now: number, velocity: number) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, now);
        // Attack：约 10ms 内到峰值
        param.exponentialRampToValueAtTime(Math.max(0.01, this.params.basePeakGain) * velocity, now + Math.max(0.001, this.params.attackSec));
        // Decay-1：0.5s 内快速衰减到中低电平
        param.exponentialRampToValueAtTime(Math.max(0.001, this.params.fastDecayLevel) * velocity, now + Math.max(0.01, this.params.fastDecaySec));
        // Decay-2：2~3s 慢速衰减到近静音
        param.exponentialRampToValueAtTime(0.0001, now + Math.max(this.params.fastDecaySec + 0.05, this.params.slowDecaySec));
    }

    /**
     * 泛音包络：更小、更快、更“脆”
     */
    private scheduleOvertoneEnvelope(param: AudioParam, now: number, velocity: number) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, now);
        param.exponentialRampToValueAtTime(Math.max(0.001, this.params.overtonePeakGain) * velocity, now + 0.004);
        param.exponentialRampToValueAtTime(0.018, now + Math.max(0.03, this.params.overtoneDecaySec * 0.35));
        param.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, this.params.overtoneDecaySec));
    }

    /**
     * 瞬态包络：高频触觉反馈，50ms 内衰减完
     */
    private scheduleTransientEnvelope(param: AudioParam, now: number, velocity: number) {
        param.cancelScheduledValues(now);
        param.setValueAtTime(0.0001, now);
        param.exponentialRampToValueAtTime(Math.max(0.001, this.params.transientPeakGain) * velocity, now + 0.001);
        param.exponentialRampToValueAtTime(0.0001, now + Math.max(0.01, this.params.transientDecaySec));
    }
}

