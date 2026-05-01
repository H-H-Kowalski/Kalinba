import { AudioManager } from './AudioManager';
import { PerformanceRecorder } from './PerformanceRecorder';
import type { PerformanceRecord } from './PerformanceTypes';
import { KalimbaKey } from '../KalimbaKey';

export class PerformancePlayer {
    private static timers: number[] = [];
    private static playing = false;

    static isPlaying(): boolean {
        return this.playing;
    }

    static stop(): void {
        for (const id of this.timers) {
            clearTimeout(id);
        }
        this.timers = [];
        this.playing = false;
        PerformanceRecorder.setReplaying(false);
    }

    static play(record: PerformanceRecord, onDone?: () => void): boolean {
        if (!record?.events?.length) return false;
        const am = AudioManager.getInstance();
        if (!am) return false;
        this.stop();
        this.playing = true;
        PerformanceRecorder.setReplaying(true);

        for (const e of record.events) {
            const t = Math.max(0, Math.floor(e.t));
            const id = setTimeout(() => {
                const mgr = AudioManager.getInstance();
                if (!mgr) return;
                mgr.playKeySound(e.k);
                KalimbaKey.getByIndex(e.k)?.playReplayPress();
            }, t) as unknown as number;
            this.timers.push(id);
        }

        const tail = setTimeout(() => {
            this.stop();
            onDone?.();
        }, Math.max(0, Math.floor(record.durationMs)) + 80) as unknown as number;
        this.timers.push(tail);
        return true;
    }
}
