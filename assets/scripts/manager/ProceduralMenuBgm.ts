import { getWx } from './WeChatNative';
import { kalimbaAudioLog, kalimbaAudioWarn } from './KalimbaAudioDebug';

type WebAudioCtx = AudioContext;

/**
 * 仅首页使用的原创程序化 BGM。
 *
 * 不依赖音频文件；旋律、低音与和声全部由 WebAudio 振荡器实时生成。
 * 演奏页必须调用 stop()，避免背景音乐干扰弹琴、录制与挑战判定。
 */
export class ProceduralMenuBgm {
    private static context: WebAudioCtx | null = null;
    private static master: GainNode | null = null;
    private static filter: BiquadFilterNode | null = null;
    private static timer: ReturnType<typeof setInterval> | null = null;
    private static suspendTimer: ReturnType<typeof setTimeout> | null = null;
    private static sources = new Set<OscillatorNode>();
    private static desiredPlaying = false;
    private static playing = false;
    private static nextStepAt = 0;
    private static step = 0;

    private static readonly BPM = 112;
    private static readonly STEP_SEC = 60 / ProceduralMenuBgm.BPM / 2;
    // 原值 0.115 经单音包络后手机端峰值仅约 2%，外放很难听清。
    // 0.39 在旋律、低音及双音和声叠加时仍保留足够余量。
    private static readonly MASTER_GAIN = 0.39;
    private static readonly LOOK_AHEAD_SEC = 0.35;

    /** 可重复调用；在真机首次触摸时再次调用可解锁被系统挂起的 WebAudio。 */
    static async start(): Promise<void> {
        this.desiredPlaying = true;
        if (this.suspendTimer !== null) {
            clearTimeout(this.suspendTimer);
            this.suspendTimer = null;
        }
        if (!this.ensureContext() || !this.context || !this.master) {
            kalimbaAudioWarn('MenuBgm', 'start failed: WebAudio context unavailable');
            return;
        }
        const ctx = this.context;
        if (ctx.state === 'suspended') {
            try {
                const returned = ctx.resume() as Promise<void> | void;
                if (returned && typeof (returned as Promise<void>).then === 'function') {
                    await returned;
                }
            } catch (e) {
                kalimbaAudioWarn('MenuBgm', 'resume failed; waiting for next user gesture', e);
            }
        }
        if (!this.desiredPlaying || ctx.state === 'closed' || ctx.state === 'suspended') {
            kalimbaAudioLog('MenuBgm', 'start deferred', { state: ctx.state, desiredPlaying: this.desiredPlaying });
            return;
        }
        if (this.playing) {
            this.master.gain.cancelScheduledValues(ctx.currentTime);
            this.master.gain.setTargetAtTime(this.MASTER_GAIN, ctx.currentTime, 0.04);
            return;
        }

        this.playing = true;
        this.step = 0;
        this.nextStepAt = ctx.currentTime + 0.08;
        this.master.gain.cancelScheduledValues(ctx.currentTime);
        this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
        this.master.gain.exponentialRampToValueAtTime(this.MASTER_GAIN, ctx.currentTime + 0.28);
        this.scheduleAhead();
        this.timer = setInterval(() => this.scheduleAhead(), 100);
        kalimbaAudioLog('MenuBgm', 'started', { state: ctx.state, gain: this.MASTER_GAIN, bpm: this.BPM });
    }

    /**
     * 离开首页时停止并撤销已排程音符。
     * @param immediate 分享回放/演奏页使用硬停止，禁止任何淡出尾音混入演奏。
     */
    static stop(immediate = false): void {
        this.desiredPlaying = false;
        this.playing = false;
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.suspendTimer !== null) {
            clearTimeout(this.suspendTimer);
            this.suspendTimer = null;
        }
        const ctx = this.context;
        if (ctx && this.master) {
            const now = ctx.currentTime;
            if (immediate) {
                try {
                    this.master.gain.cancelScheduledValues(now);
                    this.master.gain.setValueAtTime(0.0001, now);
                } catch {}
                for (const source of Array.from(this.sources)) {
                    try { source.onended = null; } catch {}
                    try { source.stop(); } catch {}
                    try { source.disconnect(); } catch {}
                }
                this.sources.clear();
                // 保持静音 context 为 running，返回首页时可直接恢复，无需玩家再点一次屏幕。
                kalimbaAudioLog('MenuBgm', 'stopped immediately', { state: ctx.state });
                return;
            }
            try {
                this.master.gain.cancelScheduledValues(now);
                this.master.gain.setTargetAtTime(0.0001, now, 0.018);
            } catch {}
            for (const source of Array.from(this.sources)) {
                try { source.stop(now + 0.055); } catch {}
            }
            // 淡出后挂起菜单专用 context，避免与演奏页合成器同时占用音频设备。
            this.suspendTimer = setTimeout(() => {
                this.suspendTimer = null;
                if (!this.desiredPlaying && ctx.state === 'running') {
                    try { void ctx.suspend(); } catch {}
                }
            }, 90);
        } else {
            this.sources.clear();
        }
    }

    private static ensureContext(): boolean {
        if (this.context && this.master && this.filter && this.context.state !== 'closed') return true;
        let ctx: WebAudioCtx | null = null;
        const wxApi = getWx() as {
            createWebAudioContext?: () => WebAudioCtx;
            setInnerAudioOption?: (options: { obeyMuteSwitch?: boolean; mixWithOther?: boolean }) => void;
        } | undefined;
        if (wxApi?.setInnerAudioOption) {
            try {
                wxApi.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true });
            } catch (e) {
                kalimbaAudioWarn('MenuBgm', 'setInnerAudioOption failed', e);
            }
        }
        let source = 'none';
        if (wxApi?.createWebAudioContext) {
            try {
                ctx = wxApi.createWebAudioContext();
                source = 'wx.createWebAudioContext';
            } catch (e) {
                kalimbaAudioWarn('MenuBgm', 'wx.createWebAudioContext failed', e);
            }
        }
        if (!ctx) {
            const g = globalThis as unknown as {
                AudioContext?: new () => AudioContext;
                webkitAudioContext?: new () => AudioContext;
            };
            const Ctor = g.AudioContext || g.webkitAudioContext;
            if (!Ctor) return false;
            try {
                ctx = new Ctor();
                source = 'browser AudioContext';
            } catch (e) {
                kalimbaAudioWarn('MenuBgm', 'browser AudioContext failed', e);
                return false;
            }
        }

        const master = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 4600;
        filter.Q.value = 0.45;
        master.gain.value = 0.0001;
        master.connect(filter);
        filter.connect(ctx.destination);
        this.context = ctx;
        this.master = master;
        this.filter = filter;
        ctx.onstatechange = () => kalimbaAudioLog('MenuBgm', 'context state changed', { state: ctx?.state });
        kalimbaAudioLog('MenuBgm', 'context created', { source, state: ctx.state });
        return true;
    }

    private static scheduleAhead(): void {
        const ctx = this.context;
        if (!this.playing || !ctx || ctx.state === 'closed') return;
        const horizon = ctx.currentTime + this.LOOK_AHEAD_SEC;
        let guard = 0;
        while (this.nextStepAt <= horizon && guard++ < 12) {
            this.scheduleStep(this.step, this.nextStepAt);
            this.step = (this.step + 1) % 32;
            this.nextStepAt += this.STEP_SEC;
        }
    }

    private static scheduleStep(step: number, at: number): void {
        // 32 个八分音符组成四小节；五声音阶避免旋律拥挤，也不引用任何现成游戏主题。
        const melody: Record<number, number> = {
            0: 392.00, 2: 523.25, 5: 659.25, 7: 587.33,
            9: 440.00, 11: 587.33, 14: 783.99,
            16: 659.25, 18: 523.25, 21: 440.00, 23: 392.00,
            25: 523.25, 27: 659.25, 29: 587.33, 31: 392.00,
        };
        const note = melody[step];
        if (note) this.tone(note, at, this.STEP_SEC * 0.72, 0.19, 'triangle');

        if (step % 4 === 0) {
            const bassRoots = [130.81, 110.00, 174.61, 196.00, 130.81, 164.81, 146.83, 196.00];
            this.tone(bassRoots[step / 4], at, this.STEP_SEC * 1.45, 0.15, 'sine');
        }

        // 每小节后半拍的一点和声光泽，音量刻意低于主旋律。
        if (step === 6 || step === 14 || step === 22 || step === 30) {
            const chord = step === 14 ? [587.33, 783.99] : step === 22 ? [440.00, 659.25] : [523.25, 659.25];
            chord.forEach((frequency) => this.tone(frequency, at, this.STEP_SEC * 0.58, 0.055, 'sine'));
        }
    }

    private static tone(
        frequency: number,
        at: number,
        duration: number,
        peak: number,
        type: OscillatorType,
    ): void {
        const ctx = this.context;
        if (!ctx || !this.master) return;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, peak), at + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.05, duration));
        oscillator.connect(gain);
        gain.connect(this.master);
        this.sources.add(oscillator);
        oscillator.onended = () => {
            this.sources.delete(oscillator);
            try { oscillator.disconnect(); } catch {}
            try { gain.disconnect(); } catch {}
        };
        oscillator.start(at);
        oscillator.stop(at + Math.max(0.06, duration) + 0.025);
    }
}
