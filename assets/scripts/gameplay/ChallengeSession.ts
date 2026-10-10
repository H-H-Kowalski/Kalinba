import { _decorator, Component, isValid } from 'cc';
import { KalimbaKey } from '../KalimbaKey';
import { AudioManager } from '../manager/AudioManager';
import { RhythmJudge } from './RhythmJudge';
import type { JudgeEvent, LevelDefinition, LevelResult } from './LevelTypes';
const { ccclass, property } = _decorator;

/**
 * 一局闯关的运行时控制器。它不负责界面，界面只需订阅事件即可，
 * 因此后续改成落键、数字谱或高亮琴键都不用修改判定逻辑。
 */
@ccclass('ChallengeSession')
export class ChallengeSession extends Component {
    @property(AudioManager)
    audioManager: AudioManager | null = null;

    private level: LevelDefinition | null = null;
    private judge: RhythmJudge | null = null;
    private active = false;
    private paused = false;
    private followMode = false;
    private pausedAtSec = 0;
    private startedAtSec = 0;
    private clockOriginMs = 0;
    private resultCallback: ((result: LevelResult) => void) | null = null;
    private judgeCallback: ((event: JudgeEvent) => void) | null = null;
    private debugInvalidClockLogged = false;
    private beginRequest = 0;
    private acceptingStarts = true;
    private disposed = false;

    start() {
        if (!this.audioManager) {
            this.audioManager = this.getComponent(AudioManager)
                ?? this.node.getComponentInChildren(AudioManager)
                ?? null;
        }
        KalimbaKey.addPlayListener(this.onUserKey);
    }

    async begin(
        level: LevelDefinition,
        onResult?: (result: LevelResult) => void,
        onJudge?: (event: JudgeEvent) => void,
        followMode = false,
    ): Promise<boolean> {
        const audio = this.audioManager;
        if (this.disposed || !this.acceptingStarts || !isValid(this, true) || !isValid(audio, true)) return false;
        this.stop();
        const request = this.beginRequest;
        let ready = false;
        try { ready = await audio.resumeWebAudio(); } catch { return false; }
        if (this.disposed || !this.acceptingStarts || request !== this.beginRequest
            || !isValid(this, true) || !isValid(audio, true) || this.audioManager !== audio) return false;
        const audioNow = audio.getAudioCurrentTime();
        console.log('[ChallengeDebug] session.begin ' + JSON.stringify({
            levelId: level.id,
            ready,
            audioNow,
            nowType: typeof audioNow,
            nowFinite: Number.isFinite(audioNow),
        }));
        if (!ready || audioNow === null) return false;
        if (!Number.isFinite(audioNow)) {
            console.error('[ChallengeDebug] session.begin invalid audio clock: ' + String(audioNow));
            return false;
        }

        this.clockOriginMs = ChallengeSession.monotonicNowMs();
        this.level = level;
        this.resultCallback = onResult ?? null;
        this.judgeCallback = onJudge ?? null;
        this.followMode = followMode;
        const beatSec = 60 / level.bpm;
        // 三拍预备：给第一次玩的用户看清落键方向，由 AudioContext 时间决定。
        audio.scheduleMetronomeTick(audioNow + 0.04, true);
        audio.scheduleMetronomeTick(audioNow + 0.04 + beatSec, false);
        audio.scheduleMetronomeTick(audioNow + 0.04 + beatSec * 2, false);
        // 判定与画面使用独立单调时钟，避开部分预览/小游戏环境中
        // WebAudioContext.currentTime 会瞬间返回 NaN 的兼容问题。
        this.startedAtSec = 0.04 + beatSec * 3;
        this.judge = new RhythmJudge(level, this.startedAtSec);
        this.active = true;
        this.paused = false;
        this.pausedAtSec = 0;
        this.debugInvalidClockLogged = false;
        console.log('[ChallengeDebug] session.timeline ' + JSON.stringify({
            startedAtSec: this.startedAtSec,
            beatSec,
            firstNotes: level.notes.slice(0, 4),
        }));
        return true;
    }

    update() {
        if (!this.active || this.paused || !this.judge || !this.audioManager) return;
        const now = this.getCurrentTimeSec();
        if (now === null || !Number.isFinite(now)) {
            if (!this.debugInvalidClockLogged) {
                this.debugInvalidClockLogged = true;
                console.error('[ChallengeDebug] session.update invalid audio clock: ' + String(now));
            }
            return;
        }
        if (now < this.startedAtSec) return;
        if (this.followMode) {
            if (this.isFollowTimelineFinished(now)) this.finish();
            return;
        }
        this.emit(this.judge.advance(now));
        if (this.judge.isFinished(now)) this.finish();
    }

    isActive(): boolean {
        return this.active;
    }

    isPaused(): boolean {
        return this.paused;
    }

    getExpectedKeyIndex(): number | null {
        if (!this.active || !this.judge || this.followMode) return null;
        return this.judge.getNextExpectedKeyIndex();
    }

    getStartedAtSec(): number {
        return this.startedAtSec;
    }

    getCurrentTimeSec(): number | null {
        if (this.clockOriginMs <= 0) return null;
        return Math.max(0, (ChallengeSession.monotonicNowMs() - this.clockOriginMs) / 1000);
    }

    stop(): void {
        this.beginRequest++;
        this.active = false;
        this.paused = false;
        this.pausedAtSec = 0;
        this.clockOriginMs = 0;
        this.followMode = false;
        this.level = null;
        this.judge = null;
        this.resultCallback = null;
        this.judgeCallback = null;
    }

    pause(): boolean {
        if (!this.active || this.paused || !this.audioManager) return false;
        const now = this.getCurrentTimeSec();
        if (now === null || !Number.isFinite(now)) return false;
        this.paused = true;
        this.pausedAtSec = now;
        return true;
    }

    resume(): boolean {
        if (!this.active || !this.paused || !this.audioManager || !this.judge) return false;
        const now = this.getCurrentTimeSec();
        if (now === null || !Number.isFinite(now)) return false;
        const delta = Math.max(0, now - this.pausedAtSec);
        this.startedAtSec += delta;
        this.judge.shiftTimeline(delta);
        this.paused = false;
        this.pausedAtSec = 0;
        return true;
    }

    private onUserKey = (keyIndex: number) => {
        if (!this.active || this.paused || !this.judge || !this.audioManager) return;
        // 跟弹模式只提供滚动谱面；用户仍正常发声，但不产生任何判定和成绩。
        if (this.followMode) return;
        const now = this.getCurrentTimeSec();
        if (now === null || !Number.isFinite(now) || now < this.startedAtSec) return;
        this.emit(this.judge.input(keyIndex, now));
        if (this.judge.isFinished(now)) this.finish();
    };

    private emit(events: JudgeEvent[]): void {
        for (const event of events) {
            console.log('[ChallengeDebug] judge.event ' + JSON.stringify(event));
            this.judgeCallback?.(event);
        }
    }

    private finish(): void {
        if (!this.judge) return;
        const result = this.judge.result();
        this.active = false;
        this.resultCallback?.(result);
    }

    private isFollowTimelineFinished(nowSec: number): boolean {
        if (!this.level) return true;
        const beatSec = 60 / this.level.bpm;
        const lastBeat = this.level.notes[this.level.notes.length - 1]?.beat ?? 0;
        return nowSec - this.startedAtSec >= (lastBeat + 1) * beatSec;
    }

    private static monotonicNowMs(): number {
        const perf = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
        const value = perf?.now?.();
        return Number.isFinite(value) ? value! : Date.now();
    }

    onEnable() { if (!this.disposed) this.acceptingStarts = true; }

    onDisable() { this.acceptingStarts = false; this.stop(); }

    onDestroy() {
        this.disposed = true;
        this.onDisable();
        KalimbaKey.removePlayListener(this.onUserKey);
        this.audioManager = null;
    }
}
