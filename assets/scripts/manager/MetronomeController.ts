import { _decorator, Component } from 'cc';
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

    start() {
        this.settings = MetronomeSettingsStore.load();
        if (!this.audioManager) {
            this.audioManager = this.getComponent(AudioManager)
                ?? this.node.getComponentInChildren(AudioManager)
                ?? null;
        }
    }

    update() {
        if (!this.running || !this.audioManager) return;
        const now = this.audioManager.getAudioCurrentTime();
        if (!Number.isFinite(now)) return;
        const subdivisionFactor = this.settings.subdivision / 4;
        const interval = 60 / this.settings.bpm / subdivisionFactor;
        const ticksPerBar = this.settings.beatsPerBar * subdivisionFactor;
        const horizon = now + Math.max(0.05, this.lookAheadSec);
        while (this.nextBeatAt <= horizon) {
            const accented = this.settings.accentFirstBeat && this.beatInBar === 0;
            this.audioManager.scheduleMetronomeTick(this.nextBeatAt, accented);
            this.beatInBar = (this.beatInBar + 1) % ticksPerBar;
            this.nextBeatAt += interval;
        }
    }

    async startMetronome(): Promise<boolean> {
        if (this.running) return true;
        if (!this.audioManager) return false;
        const ready = await this.audioManager.resumeWebAudio();
        if (!ready) return false;
        const now = this.audioManager.getAudioCurrentTime();
        if (!Number.isFinite(now)) return false;
        this.beatInBar = 0;
        // 留一点点起拍余量，既能避免 start(now) 在部分真机丢首音，也不会感觉迟缓。
        this.nextBeatAt = now + 0.045;
        this.running = true;
        MetronomeSettingsStore.save({ enabled: true });
        return true;
    }

    /** 挑战模式：从歌曲已进行的时间推算下一拍，并与下落谱面重新对齐。 */
    async startAligned(elapsedSec: number, bpm: number, beatsPerBar: number): Promise<boolean> {
        if (!this.audioManager) return false;
        const ready = await this.audioManager.resumeWebAudio();
        if (!ready) return false;
        const audioNow = this.audioManager.getAudioCurrentTime();
        if (!Number.isFinite(audioNow)) return false;
        // 关卡 BPM 仅本局生效，不覆盖玩家在自由演奏中保存的速度。
        this.settings = {
            ...this.settings,
            bpm: Math.max(40, Math.min(220, Math.round(bpm))),
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
        return true;
    }

    stopMetronome(): void {
        if (!this.running) return;
        this.running = false;
        MetronomeSettingsStore.save({ enabled: false });
    }

    async toggle(): Promise<boolean> {
        if (this.running) {
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

    onDisable() {
        // 切场景/切后台时不要留下仍在排程的节拍状态。
        this.stopMetronome();
    }
}
