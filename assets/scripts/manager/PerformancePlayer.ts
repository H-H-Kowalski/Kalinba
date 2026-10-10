import { AudioManager } from './AudioManager';
import { PerformanceRecorder } from './PerformanceRecorder';
import type { PerformanceRecord } from './PerformanceTypes';
import { KalimbaKey } from '../KalimbaKey';

export class PerformancePlayer {
    private static timers: number[] = [];
    private static playing = false;
    private static generation = 0;
    private static deadline = 0;
    private static complete: (() => void) | null = null;

    /** 帧循环兜底，避免系统切后台后尾定时器延迟导致按钮一直处于试听状态。 */
    static update(): void {
        if (this.playing && Date.now() >= this.deadline) this.complete?.();
    }

    static isPlaying(): boolean {
        return this.playing;
    }

    static stop(): void {
        this.generation++;
        this.complete = null;
        for (const id of this.timers) {
            clearTimeout(id);
        }
        this.timers = [];
        this.playing = false;
        PerformanceRecorder.setReplaying(false);
    }

    static play(record: PerformanceRecord, onDone?: () => void, onError?: (error: unknown) => void): boolean {
        if (PerformanceRecorder.validate(record)) return false;
        const am = AudioManager.getInstance();
        if (!am) return false;
        this.stop();
        this.playing = true;
        PerformanceRecorder.setReplaying(true);
        const generation = this.generation;
        // 录制结束前的长时间空白不应继续锁住听众；保留最后一个音的自然尾音。
        const lastNoteMs = record.events.reduce((last, event) => Math.max(last, event.t), 0);
        const playbackMs = Math.min(record.durationMs + 80, lastNoteMs + 1500);
        this.deadline = Date.now() + playbackMs;
        this.complete = () => {
            if (!this.playing || generation !== this.generation) return;
            this.stop();
            onDone?.();
        };

        for (const e of record.events) {
            const t = Math.max(0, Math.floor(e.t));
            const id = setTimeout(() => {
                if (!this.playing || generation !== this.generation) return;
                const mgr = AudioManager.getInstance();
                try {
                    if (!mgr) throw new Error('音频未就绪');
                    mgr.playKeySound(e.k);
                    KalimbaKey.getByIndex(e.k)?.playReplayPress();
                } catch (error) {
                    this.stop();
                    console.error('[SharePlayback:v2] note failed', { key: e.k, timeMs: e.t }, error);
                    if (onError) onError(error);
                    else onDone?.();
                }
            }, t) as unknown as number;
            this.timers.push(id);
        }

        const tail = setTimeout(() => {
            if (generation === this.generation) this.complete?.();
        }, playbackMs) as unknown as number;
        this.timers.push(tail);
        return true;
    }
}
