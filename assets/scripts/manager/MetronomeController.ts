import { _decorator, Component, isValid } from 'cc';
import { AudioManager } from './AudioManager';
import { MetronomeSettingsStore, type MetronomeSettingsSnapshot } from './MetronomeSettingsStore';
const { ccclass, property } = _decorator;

/**
 * 使用 WebAudio 的 currentTime 做 look-ahead 排程的节拍器。
 * update 仅负责提前排入未来 120ms 的声音；实际发声由音频时钟完成，
 * 不会因为游戏帧率短暂波动而让节拍跟着漂移。
 */
@ccclass('MetronomeController')
export class MetronomeController extends Component {
    @property(AudioManager)
    audioManager: AudioManager | null = null;

    @property({ tooltip: '提前排入音频时钟的时长（秒），过短容易受帧率影响，过长则暂停反应变慢' })
    lookAheadSec = 0.12;

    private settings: MetronomeSettingsSnapshot = MetronomeSettingsStore.defaultSnapshot();
    private running = false;
    private nextBeatAt = 0;
    private beatInBar = 0;
    private startRequest = 0;
    private starting = false;
    private acceptingStarts = true;
    private disposed = false;

    start() {
        this.settings = MetronomeSettingsStore.load();
        if (!this.audioManager) {
            this.audioManager = this.getComponent(AudioManager)
                ?? this.node.getComponentInChildren(AudioManager)
                ?? null;
        }
    }

    update() {
        if (!this.running || !isValid(this.audioManager, true)) return;
        const now = this.audioManager.getAudioCurrentTime();
        if (!Number.isFinite(now)) return;
        const subdivisionFactor = this.settings.subdivision / 4;
        const interval = 60 / this.settings.bpm / subdivisionFactor;
        const ticksPerBar = this.settings.beatsPerBar * subdivisionFactor;
        if (!Number.isFinite(interval) || interval <= 0 || !Number.isFinite(ticksPerBar) || ticksPerBar <= 0) {
            this.stopMetronome(); return;
        }
        // 后台或帧卡顿后跳过错过的拍子，不能一次创建数千个音频节点补播。
        if (this.nextBeatAt < now) {
            const missed = Math.ceil((now - this.nextBeatAt) / interval);
            this.nextBeatAt += missed * interval;
            this.beatInBar = (this.beatInBar + missed) % ticksPerBar;
        }
        const lookAhead = Number.isFinite(this.lookAheadSec) ? Math.max(0.05, Math.min(0.5, this.lookAheadSec)) : 0.12;
        const horizon = now + lookAhead;
        for (let scheduled = 0; scheduled < 32 && this.nextBeatAt <= horizon; scheduled++) {
            const accented = this.settings.accentFirstBeat && this.beatInBar === 0;
            this.audioManager.scheduleMetronomeTick(this.nextBeatAt, accented);
            this.beatInBar = (this.beatInBar + 1) % ticksPerBar;
            this.nextBeatAt += interval;
        }
    }

    async startMetronome(): Promise<boolean> {
        if (this.running) return true;
        return this.startUsingAudio((now) => {
            this.beatInBar = 0;
            // 留一点点起拍余量，避免 start(now) 在部分真机丢首音。
            this.nextBeatAt = now + 0.045;
            this.running = true;
            MetronomeSettingsStore.save({ enabled: true });
        });
    }

    /** 挑战模式：从歌曲已进行的时间推算下一拍，并与下落谱面重新对齐。 */
    async startAligned(elapsedSec: number, bpm: number, beatsPerBar: number): Promise<boolean> {
        return this.startUsingAudio((audioNow) => {
            // 关卡 BPM 仅本局生效，不覆盖玩家在自由演奏中保存的速度。
            this.settings = {
                ...this.settings,
                bpm: Number.isFinite(bpm) ? Math.max(40, Math.min(220, Math.round(bpm))) : 80,
                beatsPerBar: beatsPerBar === 2 || beatsPerBar === 3 || beatsPerBar === 4 ? beatsPerBar : 4,
                enabled: true,
            };
            MetronomeSettingsStore.save({ enabled: true });
            const subdivisionFactor = this.settings.subdivision / 4;
            const interval = 60 / this.settings.bpm / subdivisionFactor;
            const safeElapsed = Number.isFinite(elapsedSec) ? elapsedSec : 0;
            let nextBeatNumber = Math.max(0, Math.ceil(safeElapsed / interval - 0.001));
            let delay = nextBeatNumber * interval - safeElapsed;
            if (delay < 0.025) {
                nextBeatNumber += 1;
                delay += interval;
            }
            this.beatInBar = nextBeatNumber % (this.settings.beatsPerBar * subdivisionFactor);
            this.nextBeatAt = audioNow + delay;
            this.running = true;
        });
    }

    private async startUsingAudio(onReady: (now: number) => void): Promise<boolean> {
        const audio = this.audioManager;
        if (this.disposed || !this.acceptingStarts || !isValid(this, true) || !isValid(audio, true)) return false;
        const request = ++this.startRequest;
        this.starting = true;
        try {
            const ready = await audio.resumeWebAudio();
            if (!ready || this.disposed || !this.acceptingStarts || request !== this.startRequest
                || !isValid(this, true) || !isValid(audio, true) || this.audioManager !== audio) return false;
            const now = audio.getAudioCurrentTime();
            if (now === null || !Number.isFinite(now)) return false;
            onReady(now);
            return true;
        } catch { return false; }
        finally { if (request === this.startRequest) this.starting = false; }
    }

    stopMetronome(): void {
        // 即使还未 running，也必须取消正在等待音频的启动请求。
        this.startRequest++;
        this.starting = false;
        if (!this.running) return;
        this.running = false;
        MetronomeSettingsStore.save({ enabled: false });
    }

    async toggle(): Promise<boolean> {
        if (this.running || this.starting) {
            this.stopMetronome();
            return false;
        }
        return this.startMetronome();
    }

    isRunning(): boolean {
        return this.running;
    }

    getSettings(): MetronomeSettingsSnapshot {
        return { ...this.settings };
    }

    setBpm(bpm: number): void {
        this.settings = MetronomeSettingsStore.save({ bpm });
        this.realignNextBeat();
    }

    setBeatsPerBar(beatsPerBar: number): void {
        this.settings = MetronomeSettingsStore.save({ beatsPerBar });
        this.beatInBar = 0;
    }

    setAccentFirstBeat(accentFirstBeat: boolean): void {
        this.settings = MetronomeSettingsStore.save({ accentFirstBeat });
    }

    setCountInBars(countInBars: number): void {
        this.settings = MetronomeSettingsStore.save({ countInBars });
    }

    /** 挑战模式可复用，返回开始前应等待的预备拍数量。 */
    getCountInBeatCount(): number {
        return this.settings.countInBars * this.settings.beatsPerBar;
    }

    private realignNextBeat(): void {
        if (!this.running || !this.audioManager) return;
        const now = this.audioManager.getAudioCurrentTime();
        if (Number.isFinite(now)) this.nextBeatAt = now + 0.045;
    }

    onEnable() { if (!this.disposed) this.acceptingStarts = true; }

    onDisable() {
        this.acceptingStarts = false;
        // 切场景/切后台时不要留下仍在排程的节拍状态。
        this.stopMetronome();
    }

    onDestroy() { this.disposed = true; this.onDisable(); this.audioManager = null; }
}
