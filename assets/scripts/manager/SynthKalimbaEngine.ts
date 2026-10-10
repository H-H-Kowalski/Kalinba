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
    startedAtSec: number;
    fundamentalOsc: OscillatorNode;
    overtoneOsc: OscillatorNode;
    transientOsc: OscillatorNode;
    fundamentalGain: GainNode;
    overtoneGain: GainNode;
    transientGain: GainNode;
    hp: BiquadFilterNode;
    lp: BiquadFilterNode;
    body: BiquadFilterNode;
    releaseGain: GainNode;
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
    // 与 AudioManager 的“流行”推荐档保持一致，避免设置存档加载前后音色跳变。
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
    presetGain: 1.0,
};

/** 微信 WebAudioContext 与浏览器 AudioContext 在本引擎中用法一致 */
type WebAudioCtx = AudioContext;

export class SynthKalimbaEngine {
    private static readonly MAX_OUTPUT_GAIN = 1.35;
    /** 手机上的多点连弹以清晰起音优先，超过上限时淘汰最早尾音。 */
    private static readonly MAX_ACTIVE_VOICES = 10;
    private static loggedIsSupportedOnce = false;
    private audioContext: WebAudioCtx | null = null;
    private masterGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private softLimiter: WaveShaperNode | null = null;
    private outputGain: GainNode | null = null;
    private limiterInput: GainNode | null = null;
    private activeVoices: Set<VoiceHandle> = new Set();
    /** 结算/成就提示音不计入琴键复音，但离开页面时仍可统一停止。 */
    private uiCueSources: Set<OscillatorNode> = new Set();
    private params: KalimbaSynthParams = { ...DEFAULT_PARAMS };
    /** 仅打一次：context 创建后挂 state 变化，便于真机对照「何时 running」 */
    private stateChangeHookInstalled = false;
    private disposed = false;
    private playbackGeneration = 0;

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
        if (this.disposed) return false;
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

        // 单音先经温和压缩，再补偿手机听感响度，最后由近似线性的软限幅兜底。
        // 这样低电平不会被染色，双音/快速连弹的峰值也不会直接削波。
        this.compressor = null;
        this.outputGain = this.audioContext.createGain();
        // 手机端提高听感响度；后面的压缩与 0.95 软限幅负责守住峰值。
        this.outputGain.gain.value = getWx() ? 1.42 : 1.15;
        this.softLimiter = this.audioContext.createWaveShaper();
        // WaveShaper 的输入域仅为 [-1, 1]。先缩小输入，再在曲线中还原，
        // 为双音/连弹预留 4 倍输入余量，避免 >1 的信号直接夹到曲线端点。
        this.limiterInput = this.audioContext.createGain();
        this.limiterInput.gain.value = 0.25;
        this.softLimiter.curve = this.buildCeilingLimiterCurve(8193, 0.76, 0.95);
        try {
            this.softLimiter.oversample = '2x';
        } catch {
            // 部分旧版小游戏基础库不开放 oversample，不影响限幅曲线本身工作。
        }
        const anyCtx = this.audioContext as unknown as {
            createDynamicsCompressor?: () => DynamicsCompressorNode;
        };
        if (typeof anyCtx.createDynamicsCompressor === 'function') {
            try {
                this.compressor = anyCtx.createDynamicsCompressor();
                // 温和兜底而不是长期“压扁”声音；真机外放在高增益+强压缩时最容易发怪。
                this.compressor.threshold.setValueAtTime(-6, this.audioContext.currentTime);
                this.compressor.knee.setValueAtTime(8, this.audioContext.currentTime);
                this.compressor.ratio.setValueAtTime(3, this.audioContext.currentTime);
                this.compressor.attack.setValueAtTime(0.003, this.audioContext.currentTime);
                this.compressor.release.setValueAtTime(0.16, this.audioContext.currentTime);
            } catch (e) {
                this.compressor = null;
                kalimbaAudioWarn('WebAudio', 'createDynamicsCompressor failed, fallback soft limiter', e);
            }
        } else {
            kalimbaAudioWarn('WebAudio', 'DynamicsCompressor not available, continue with output limiter only');
        }

        if (this.compressor) {
            this.masterGain.connect(this.compressor);
            this.compressor.connect(this.outputGain);
        } else {
            this.masterGain.connect(this.outputGain);
        }
        this.outputGain.connect(this.limiterInput);
        this.limiterInput.connect(this.softLimiter);
        this.softLimiter.connect(this.audioContext.destination);
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

    private buildCeilingLimiterCurve(samples: number, threshold: number, ceiling: number): Float32Array {
        const n = Math.max(256, Math.floor(samples));
        const edge = Math.max(0.5, Math.min(0.9, threshold));
        const cap = Math.max(edge + 0.02, Math.min(0.99, ceiling));
        const span = cap - edge;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const x = ((i * 2) / (n - 1) - 1) * 4;
            const sign = x < 0 ? -1 : 1;
            const abs = Math.abs(x);
            curve[i] = abs <= edge
                ? x
                : sign * (edge + span * Math.tanh((abs - edge) / span));
        }
        return curve;
    }

    /**
     * 在用户触摸回调内调用：先同步调用 resume()（满足「由用户手势发起解锁」），
     * 再在其返回的 Promise 完成后执行 playKey。真机必须在 running 后再建节点，见 WebAudioContext.resume。
     */
    playKeyInUserGesture(keyIndex: number, velocity = 1.0, onDone?: (played: boolean) => void): void {
        if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= SynthKalimbaEngine.KEY_FREQ.length) {
            onDone?.(false);
            return;
        }
        if (!this.ensureContext() || !this.audioContext) {
            onDone?.(false);
            return;
        }
        const ctx = this.audioContext;
        const generation = this.playbackGeneration;
        if (ctx.state === 'closed') {
            onDone?.(false);
            return;
        }

        const fireNow = () => {
            if (this.disposed || generation !== this.playbackGeneration || this.audioContext !== ctx) {
                onDone?.(false);
                return;
            }
            const ok = this.playKey(keyIndex, velocity);
            onDone?.(ok);
        };

        if (ctx.state === 'running') {
            fireNow();
            return;
        }

        try {
            const ret = ctx.resume() as Promise<void> | void;
            const isPromise = ret != null && typeof (ret as Promise<void>).then === 'function';
            if (isPromise) {
                Promise.resolve(ret)
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
            const isPromise = p != null && typeof (p as Promise<void>).then === 'function';
            kalimbaAudioLog('WebAudio', 'async resume() return', { resumeReturnsPromise: isPromise });
            if (isPromise) {
                await p;
            }
            kalimbaAudioLog('WebAudio', 'async resume() done', { state: ctx.state });
        } catch (e) {
            console.warn('[SynthKalimbaEngine] audioContext.resume failed', e);
        }
    }

    getCurrentTime(): number | null {
        if (!this.ensureContext() || !this.audioContext || this.audioContext.state === 'closed') return null;
        return Number.isFinite(this.audioContext.currentTime) ? this.audioContext.currentTime : null;
    }

    isRunning(): boolean {
        return this.audioContext?.state === 'running';
    }

    /**
     * 节拍器的点击音：同样经 master/limiter 输出，但不占用琴键发声数。
     * at 为 AudioContext 时间，调用方应使用 look-ahead 调度。
     */
    scheduleMetronomeTick(at: number, accented: boolean): boolean {
        if (!this.ensureContext() || !this.audioContext || !this.masterGain) return false;
        const ctx = this.audioContext;
        if (ctx.state === 'closed') return false;
        const now = ctx.currentTime;
        const when = Math.max(now + 0.003, at);
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(accented ? 1760 : 1240, when);
            filter.type = 'highpass';
            filter.frequency.setValueAtTime(650, when);
            gain.gain.setValueAtTime(0.0001, when);
            gain.gain.exponentialRampToValueAtTime(accented ? 0.22 : 0.13, when + 0.0015);
            gain.gain.exponentialRampToValueAtTime(0.0001, when + (accented ? 0.042 : 0.030));
            osc.connect(gain);
            gain.connect(filter);
            filter.connect(this.masterGain);
            this.uiCueSources.add(osc);
            osc.start(when);
            osc.stop(when + 0.055);
            osc.onended = () => {
                this.uiCueSources.delete(osc);
                try { osc.disconnect(); } catch {}
                try { gain.disconnect(); } catch {}
                try { filter.disconnect(); } catch {}
            };
            return true;
        } catch (e) {
            kalimbaAudioWarn('Metronome', 'schedule tick failed', e);
            return false;
        }
    }

    setVolume(volume: number) {
        if (!Number.isFinite(volume)) return;
        if (!this.ensureContext() || !this.masterGain) return;
        // 移动端的额外听感补偿统一放在 outputGain，避免多处增益相乘失控。
        this.masterGain.gain.value = Math.max(0, Math.min(SynthKalimbaEngine.MAX_OUTPUT_GAIN, volume));
    }

    setParams(params: Partial<KalimbaSynthParams>) {
        const next = { ...this.params };
        for (const key of Object.keys(DEFAULT_PARAMS) as (keyof KalimbaSynthParams)[]) {
            if (Number.isFinite(params[key])) next[key] = params[key];
        }
        next.attackSec = Math.max(0.002, Math.min(0.1, next.attackSec));
        next.fastDecaySec = Math.max(next.attackSec + 0.01, Math.min(1.5, next.fastDecaySec));
        next.slowDecaySec = Math.max(next.fastDecaySec + 0.05, Math.min(5, next.slowDecaySec));
        next.basePeakGain = Math.max(0.01, Math.min(0.85, next.basePeakGain));
        next.fastDecayLevel = Math.max(0.001, Math.min(next.basePeakGain, next.fastDecayLevel));
        next.overtonePeakGain = Math.max(0, Math.min(0.25, next.overtonePeakGain));
        next.transientPeakGain = Math.max(0, Math.min(0.1, next.transientPeakGain));
        next.overtoneRatio = Math.max(1, Math.min(8, next.overtoneRatio));
        next.transientFreqMul = Math.max(1, Math.min(12, next.transientFreqMul));
        next.overtoneDecaySec = Math.max(0.05, Math.min(1, next.overtoneDecaySec));
        next.transientDecaySec = Math.max(0.01, Math.min(0.08, next.transientDecaySec));
        next.hpHz = Math.max(20, Math.min(400, next.hpHz));
        next.lpHz = Math.max(1000, Math.min(12000, next.lpHz));
        next.presetGain = Math.max(0.1, Math.min(1.2, next.presetGain));
        this.params = next;
    }

    /**
     * 兼容你现有 AudioManager 调用的入口：按键索引播放
     */
    playKey(keyIndex: number, velocity = 1.0): boolean {
        if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex >= SynthKalimbaEngine.KEY_FREQ.length) return false;
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
        if (!Number.isFinite(frequency) || frequency <= 0 || !Number.isFinite(velocity) || velocity <= 0) return false;

        const ctx = this.audioContext;
        if (ctx.state === 'closed') return false;
        const stateBefore = ctx.state;
        if (ctx.state !== 'running') {
            try {
                void Promise.resolve(ctx.resume()).catch(() => {});
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
        // 发布编译会把 [...Set] 按数组展开为 [].concat(Set)，必须显式转换集合。
        const voices = Array.from(this.activeVoices);
        const recentVoices = voices.filter((voice) => now - voice.startedAtSec < 0.24).length;
        const lingeringVoices = voices.filter((voice) => now - voice.startedAtSec < Math.min(3.2, this.params.slowDecaySec * 0.72)).length;
        // 空灵/深沉的旧尾音数秒后仍在叠加；把“近期起音”和“残留尾音”都纳入收峰。
        const polyphonyScale = Math.max(0.66, 1 / (1 + recentVoices * 0.14 + lingeringVoices * 0.045));
        const vel = Math.max(0.1, Math.min(1.2, velocity)) * polyphonyScale;
        const pg = this.params.presetGain;
        const mobile = !!getWx();
        const freqScale = this.getFreqGainScale(frequency, mobile);

        // -----------------------------
        // 0) 频段整形（木质箱体 + 去浑浊）
        // -----------------------------
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(Math.max(mobile ? 105 : 20, this.params.hpHz), now);
        hp.Q.setValueAtTime(Math.SQRT1_2, now);

        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(Math.max(500, mobile ? Math.min(5600, this.params.lpHz) : this.params.lpHz), now);
        lp.Q.setValueAtTime(Math.SQRT1_2, now);

        const body = ctx.createBiquadFilter();
        body.type = 'peaking';
        // 温和补偿琴箱的中低频共鸣；避免加重低音浑浊。
        body.frequency.setValueAtTime(mobile ? 980 : 720, now);
        body.Q.setValueAtTime(mobile ? 0.82 : 0.72, now);
        body.gain.setValueAtTime(mobile ? 2.6 : 1.8, now);

        hp.connect(body);
        body.connect(lp);
        const releaseGain = ctx.createGain();
        releaseGain.gain.setValueAtTime(1, now);
        lp.connect(releaseGain);
        releaseGain.connect(this.masterGain);

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
        this.scheduleOvertoneEnvelope(overtoneGain.gain, now, vel * pg * (mobile ? 0.90 : 1));

        overtoneOsc.connect(overtoneGain);
        overtoneGain.connect(hp);

        // -----------------------------
        // 3) 瞬态噪声：高频三角波，<50ms 消失
        // -----------------------------
        const transientOsc = ctx.createOscillator();
        transientOsc.type = 'triangle';
        transientOsc.frequency.setValueAtTime(Math.min(8000, frequency * this.params.transientFreqMul), now);

        const transientGain = ctx.createGain();
        this.scheduleTransientEnvelope(transientGain.gain, now, vel * pg * (mobile ? 0.82 : 1));

        transientOsc.connect(transientGain);
        transientGain.connect(hp);

        const voice: VoiceHandle = {
            startedAtSec: now,
            fundamentalOsc,
            overtoneOsc,
            transientOsc,
            fundamentalGain,
            overtoneGain,
            transientGain,
            hp,
            lp,
            body,
            releaseGain,
        };
        while (this.activeVoices.size >= SynthKalimbaEngine.MAX_ACTIVE_VOICES) {
            const oldest = this.activeVoices.values().next().value as VoiceHandle | undefined;
            if (!oldest) break;
            this.stopVoice(oldest);
        }
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
            try { body.disconnect(); } catch {}
            try { releaseGain.disconnect(); } catch {}
            try { fundamentalOsc.disconnect(); } catch {}
            try { overtoneOsc.disconnect(); } catch {}
            try { transientOsc.disconnect(); } catch {}
        };
        fundamentalOsc.onended = cleanup;
        return true;
    }

    /** 挑战结算提示：失败下行，星级越高则上行乐句越完整。 */
    playChallengeResultCue(stars: number): boolean {
        if (!this.ensureContext() || !this.audioContext || !this.masterGain) return false;
        const ctx = this.audioContext;
        if (ctx.state === 'closed') return false;
        if (ctx.state === 'suspended') {
            try { void ctx.resume(); } catch {}
        }
        const now = ctx.currentTime + 0.055;
        const patterns: Array<Array<[number, number, number]>> = [
            [[392.00, 0.00, 0.07], [329.63, 0.19, 0.065], [261.63, 0.40, 0.06]],
            [[523.25, 0.00, 0.07], [659.25, 0.16, 0.072], [783.99, 0.34, 0.076]],
            [[523.25, 0.00, 0.068], [659.25, 0.13, 0.072], [783.99, 0.27, 0.076], [1046.50, 0.47, 0.08]],
            [[392.00, 0.00, 0.06], [523.25, 0.11, 0.066], [659.25, 0.22, 0.07], [783.99, 0.34, 0.074], [1046.50, 0.50, 0.08], [1318.51, 0.68, 0.07]],
        ];
        const safeStars = Number.isFinite(stars) ? stars : 0;
        const level = Math.max(0, Math.min(3, Math.floor(safeStars)));
        for (const [frequency, offset, peak] of patterns[level]) {
            this.scheduleUiTone(frequency, now + offset, level === 0 ? 0.38 : 0.46, peak, 'triangle');
        }
        if (level === 3) {
            [523.25, 659.25, 783.99].forEach((frequency) => {
                this.scheduleUiTone(frequency, now + 0.68, 0.62, 0.026, 'sine');
            });
        }
        return true;
    }

    /** 新成就的短促闪光音，安排在结算主音之后播放。 */
    playAchievementCue(): boolean {
        if (!this.ensureContext() || !this.audioContext || !this.masterGain) return false;
        const ctx = this.audioContext;
        if (ctx.state === 'closed') return false;
        const now = ctx.currentTime + 0.045;
        this.scheduleUiTone(1046.50, now, 0.34, 0.044, 'sine');
        this.scheduleUiTone(1318.51, now + 0.12, 0.40, 0.046, 'sine');
        this.scheduleUiTone(1567.98, now + 0.28, 0.58, 0.05, 'triangle');
        return true;
    }

    stopAll() {
        this.playbackGeneration++;
        for (const v of Array.from(this.activeVoices)) {
            this.stopVoice(v);
        }
        for (const source of Array.from(this.uiCueSources)) {
            try { source.stop(); } catch {}
            try { source.disconnect(); } catch {}
            this.uiCueSources.delete(source);
        }
    }

    /** 演奏场景销毁时释放上下文，避免反复进出场景累积 WebAudio 实例。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopAll();
        const context = this.audioContext;
        for (const node of [this.masterGain, this.compressor, this.outputGain, this.limiterInput, this.softLimiter]) {
            try { node?.disconnect(); } catch {}
        }
        this.audioContext = null;
        this.masterGain = null;
        this.compressor = null;
        this.outputGain = null;
        this.limiterInput = null;
        this.softLimiter = null;
        this.stateChangeHookInstalled = false;
        if (context) {
            try { context.onstatechange = null; } catch {}
            try { void Promise.resolve(context.close()).catch(() => {}); } catch {}
        }
    }

    private scheduleUiTone(
        frequency: number,
        at: number,
        duration: number,
        peak: number,
        type: OscillatorType,
    ): void {
        const ctx = this.audioContext;
        if (!ctx || !this.masterGain) return;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        oscillator.connect(gain);
        gain.connect(this.masterGain);
        this.uiCueSources.add(oscillator);
        oscillator.onended = () => {
            this.uiCueSources.delete(oscillator);
            try { oscillator.disconnect(); } catch {}
            try { gain.disconnect(); } catch {}
        };
        oscillator.start(at);
        oscillator.stop(at + duration + 0.03);
    }

    private stopVoice(v: VoiceHandle): void {
        // 独立的释放增益未被音色包络占用，可从 1 平滑淡出，避免硬断波形。
        // 节点在 fundamentalOsc.onended 中统一释放，不能在淡出前 disconnect。
        const now = this.audioContext?.currentTime ?? 0;
        try {
            v.releaseGain.gain.setValueAtTime(1, now);
            v.releaseGain.gain.linearRampToValueAtTime(0, now + 0.012);
        } catch { /* 已失效的节点仍需停止和释放，不能打断场景销毁队列。 */ }
        try { v.fundamentalOsc.stop(now + 0.015); } catch {}
        try { v.overtoneOsc.stop(now + 0.015); } catch {}
        try { v.transientOsc.stop(now + 0.015); } catch {}
        this.activeVoices.delete(v);
    }

    getActiveVoiceCount(): number {
        return this.activeVoices.size;
    }

    /**
     * 低频增益补偿：同等振幅下，低频更容易让手机小扬声器过载。
     * 手机端采用更强的保护曲线；A4（440Hz）及以上不衰减。
     */
    private getFreqGainScale(frequency: number, mobile = false): number {
        if (frequency >= 440) return 1.0;
        // 手机小扬声器无法有效还原低频能量；继续堆低音只会先削波。
        // 保留清晰的基频起音，同时比桌面端更积极地削减 C4~A4 的峰值。
        return Math.pow(frequency / 440, mobile ? 0.82 : 0.58);
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
        const peak = Math.max(0.001, this.params.overtonePeakGain) * velocity;
        // 尾部必须随击键力度同比例下降；固定尾部电平会让轻触时出现反向抬升和发颤感。
        const tail = Math.max(0.0002, peak * 0.14);
        param.exponentialRampToValueAtTime(peak, now + 0.004);
        param.exponentialRampToValueAtTime(tail, now + Math.max(0.03, this.params.overtoneDecaySec * 0.35));
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
