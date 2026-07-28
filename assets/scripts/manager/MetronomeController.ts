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
        const interval = 60 / this.settings.bpm;
        const horizon = now + Math.max(0.05, this.lookAheadSec);
        while (this.nextBeatAt <= horizon) {
            const accented = this.settings.accentFirstBeat && this.beatInBar === 0;
            this.audioManager.scheduleMetronomeTick(this.nextBeatAt, accented);
            this.beatInBar = (this.beatInBar + 1) % this.settings.beatsPerBar;
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
