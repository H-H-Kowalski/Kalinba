import { _decorator, Component } from 'cc';
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
    private pausedAtSec = 0;
    private startedAtSec = 0;
    private resultCallback: ((result: LevelResult) => void) | null = null;
    private judgeCallback: ((event: JudgeEvent) => void) | null = null;

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
    ): Promise<boolean> {
        if (!this.audioManager) return false;
        const ready = await this.audioManager.resumeWebAudio();
        const now = this.audioManager.getAudioCurrentTime();
        if (!ready || now === null) return false;

        this.stop();
        this.level = level;
        this.resultCallback = onResult ?? null;
        this.judgeCallback = onJudge ?? null;
        const beatSec = 60 / level.bpm;
        // 三拍预备：给第一次玩的用户看清落键方向，由 AudioContext 时间决定。
        this.audioManager.scheduleMetronomeTick(now + 0.04, true);
        this.audioManager.scheduleMetronomeTick(now + 0.04 + beatSec, false);
        this.audioManager.scheduleMetronomeTick(now + 0.04 + beatSec * 2, false);
        this.startedAtSec = now + 0.04 + beatSec * 3;
        this.judge = new RhythmJudge(level, this.startedAtSec);
        this.active = true;
        this.paused = false;
        this.pausedAtSec = 0;
        return true;
    }

    update() {
        if (!this.active || this.paused || !this.judge || !this.audioManager) return;
        const now = this.audioManager.getAudioCurrentTime();
        if (now === null || now < this.startedAtSec) return;
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
        if (!this.active || !this.judge) return null;
        return this.judge.getNextExpectedKeyIndex();
    }

    getStartedAtSec(): number {
        return this.startedAtSec;
    }

    stop(): void {
        this.active = false;
        this.paused = false;
        this.pausedAtSec = 0;
        this.level = null;
        this.judge = null;
    }

    pause(): boolean {
        if (!this.active || this.paused || !this.audioManager) return false;
        const now = this.audioManager.getAudioCurrentTime();
        if (now === null) return false;
        this.paused = true;
        this.pausedAtSec = now;
        return true;
    }

    resume(): boolean {
        if (!this.active || !this.paused || !this.audioManager || !this.judge) return false;
        const now = this.audioManager.getAudioCurrentTime();
        if (now === null) return false;
        const delta = Math.max(0, now - this.pausedAtSec);
        this.startedAtSec += delta;
        this.judge.shiftTimeline(delta);
        this.paused = false;
        this.pausedAtSec = 0;
        return true;
    }

    private onUserKey = (keyIndex: number) => {
        if (!this.active || this.paused || !this.judge || !this.audioManager) return;
        const now = this.audioManager.getAudioCurrentTime();
        if (now === null || now < this.startedAtSec) return;
        this.emit(this.judge.input(keyIndex, now));
        if (this.judge.isFinished(now)) this.finish();
    };

    private emit(events: JudgeEvent[]): void {
        for (const event of events) this.judgeCallback?.(event);
    }

    private finish(): void {
        if (!this.judge) return;
        const result = this.judge.result();
        this.active = false;
        this.resultCallback?.(result);
    }

    onDestroy() {
        KalimbaKey.removePlayListener(this.onUserKey);
    }
}
