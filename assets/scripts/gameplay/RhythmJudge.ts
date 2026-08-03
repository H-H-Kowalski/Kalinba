import type { JudgeEvent, LevelDefinition, LevelResult } from './LevelTypes';

/**
 * 纯逻辑判定器：UI、音频和云同步都不依赖它的内部状态。
 * 判定窗口故意比传统硬核音游宽，目标是鼓励新手练琴，而不是制造失败感。
 */
export class RhythmJudge {
    // 面向触屏拇指琴新手：需要在落键提示和实体琴键之间移动视线，
    // 判定窗口比传统音游更宽，优先保证“跟得上并愿意继续玩”。
    private static readonly PERFECT_WINDOW_MS = 110;
    private static readonly GOOD_WINDOW_MS = 220;
    private static readonly BAD_WINDOW_MS = 340;

    private cursor = 0;
    private score = 0;
    private combo = 0;
    private maxCombo = 0;
    private perfectCount = 0;
    private goodCount = 0;
    private badCount = 0;
    private missCount = 0;
    private wrongCount = 0;
    private playedNoteCount = 0;

    constructor(private readonly level: LevelDefinition, private startedAtSec: number) {}

    /** 暂停恢复时整体平移判定时间轴，分数与游标保持不变。 */
    shiftTimeline(deltaSec: number): void {
        if (!Number.isFinite(deltaSec) || deltaSec <= 0) return;
        this.startedAtSec += deltaSec;
    }

    /** 每帧或按键前调用，结算已经错过的目标音。 */
    advance(nowSec: number): JudgeEvent[] {
        const events: JudgeEvent[] = [];
        const elapsedMs = Math.max(0, (nowSec - this.startedAtSec) * 1000);
        while (this.cursor < this.level.notes.length) {
            const targetMs = this.beatToMs(this.level.notes[this.cursor].beat);
            if (elapsedMs <= targetMs + RhythmJudge.BAD_WINDOW_MS) break;
            events.push(this.registerMiss(this.level.notes[this.cursor].keyIndex, this.cursor));
            this.cursor += 1;
        }
        return events;
    }

    input(keyIndex: number, nowSec: number): JudgeEvent[] {
        const events = this.advance(nowSec);
        this.playedNoteCount += 1;
        const target = this.level.notes[this.cursor];
        const targetIndex = this.cursor;
        if (!target) {
            events.push(this.registerBad(keyIndex));
            return events;
        }
        const elapsedMs = Math.max(0, (nowSec - this.startedAtSec) * 1000);
        const offsetMs = elapsedMs - this.beatToMs(target.beat);
        if (keyIndex !== target.keyIndex || Math.abs(offsetMs) > RhythmJudge.BAD_WINDOW_MS) {
            events.push(this.registerBad(keyIndex, target.keyIndex, offsetMs));
            return events;
        }
        this.cursor += 1;
        if (Math.abs(offsetMs) <= RhythmJudge.PERFECT_WINDOW_MS) {
            this.combo += 1;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.perfectCount += 1;
            const scoreDelta = Math.round(100 * this.comboMultiplier());
            this.score += scoreDelta;
            events.push({ grade: 'perfect', noteIndex: targetIndex, keyIndex, expectedKeyIndex: target.keyIndex, offsetMs, combo: this.combo, scoreDelta });
        } else if (Math.abs(offsetMs) <= RhythmJudge.GOOD_WINDOW_MS) {
            this.combo += 1;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            this.goodCount += 1;
            const scoreDelta = Math.round(65 * this.comboMultiplier());
            this.score += scoreDelta;
            events.push({ grade: 'good', noteIndex: targetIndex, keyIndex, expectedKeyIndex: target.keyIndex, offsetMs, combo: this.combo, scoreDelta });
        } else {
            this.combo = 0;
            this.badCount += 1;
            this.wrongCount += 1;
            const scoreDelta = 20;
            this.score += scoreDelta;
            events.push({ grade: 'bad', noteIndex: targetIndex, keyIndex, expectedKeyIndex: target.keyIndex, offsetMs, combo: 0, scoreDelta });
        }
        return events;
    }

    isFinished(nowSec: number): boolean {
        this.advance(nowSec);
        return this.cursor >= this.level.notes.length;
    }

    getNextExpectedKeyIndex(): number | null {
        return this.level.notes[this.cursor]?.keyIndex ?? null;
    }

    result(): LevelResult {
        const stars: 0 | 1 | 2 | 3 = this.score >= this.level.threeStarScore
            ? 3 : this.score >= this.level.twoStarScore
                ? 2 : this.score >= this.level.passScore ? 1 : 0;
        return {
            levelId: this.level.id,
            score: this.score,
            stars,
            maxCombo: this.maxCombo,
            perfectCount: this.perfectCount,
            goodCount: this.goodCount,
            badCount: this.badCount,
            missCount: this.missCount,
            wrongCount: this.wrongCount,
            playedNoteCount: this.playedNoteCount,
        };
    }

    private beatToMs(beat: number): number {
        return beat * (60_000 / this.level.bpm);
    }

    private comboMultiplier(): number {
        // 20 连击达到封顶 1.5 倍，不制造过大的分差。
        return 1 + Math.min(0.5, this.combo * 0.025);
    }

    private registerMiss(expectedKeyIndex: number, noteIndex: number): JudgeEvent {
        this.combo = 0;
        this.missCount += 1;
        return { grade: 'miss', noteIndex, keyIndex: -1, expectedKeyIndex, combo: 0, scoreDelta: 0 };
    }

    private registerBad(keyIndex: number, expectedKeyIndex?: number, offsetMs?: number): JudgeEvent {
        this.combo = 0;
        this.badCount += 1;
        this.wrongCount += 1;
        return { grade: 'bad', keyIndex, expectedKeyIndex, offsetMs, combo: 0, scoreDelta: 0 };
    }
}
