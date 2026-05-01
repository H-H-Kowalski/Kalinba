import { PERFORMANCE_MAX_DURATION_MS, PERFORMANCE_MAX_ENCODED_SIZE, PERFORMANCE_MAX_EVENTS, PerformanceEvent, PerformanceRecord } from './PerformanceTypes';

type RecordingState = {
    startedAtMs: number;
    stylePreset: number;
    title?: string;
    events: PerformanceEvent[];
};

export class PerformanceRecorder {
    private static state: RecordingState | null = null;
    private static lastRecord: PerformanceRecord | null = null;
    private static replaying = false;

    private static nowMs(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }

    static setReplaying(replaying: boolean): void {
        this.replaying = replaying;
    }

    static isRecording(): boolean {
        return this.state !== null;
    }

    static start(stylePreset: number, title?: string): void {
        this.state = {
            startedAtMs: this.nowMs(),
            stylePreset,
            title,
            events: [],
        };
    }

    static recordKey(keyIndex: number): void {
        const s = this.state;
        if (!s || this.replaying) return;
        if (s.events.length >= PERFORMANCE_MAX_EVENTS) return;
        const t = Math.max(0, Math.floor(this.nowMs() - s.startedAtMs));
        if (t > PERFORMANCE_MAX_DURATION_MS) return;
        s.events.push({ t, k: Math.max(0, Math.floor(keyIndex)) });
    }

    static stop(): PerformanceRecord | null {
        const s = this.state;
        this.state = null;
        if (!s) return null;
        const durationMs = Math.min(PERFORMANCE_MAX_DURATION_MS, Math.max(0, Math.floor(this.nowMs() - s.startedAtMs)));
        const rec: PerformanceRecord = {
            title: s.title,
            stylePreset: s.stylePreset,
            durationMs,
            events: s.events.slice(),
            appVersion: '1.0.0',
        };
        this.lastRecord = rec;
        return rec;
    }

    static getLastRecord(): PerformanceRecord | null {
        return this.lastRecord;
    }

    static validate(rec: PerformanceRecord): string | null {
        if (!rec) return 'record is empty';
        if (!Array.isArray(rec.events) || rec.events.length === 0) return 'events is empty';
        if (rec.events.length > PERFORMANCE_MAX_EVENTS) return 'event count exceeds limit';
        if (!Number.isFinite(rec.durationMs) || rec.durationMs < 0 || rec.durationMs > PERFORMANCE_MAX_DURATION_MS) return 'duration out of range';
        return null;
    }

    static encode(rec: PerformanceRecord): string {
        const raw = JSON.stringify(rec);
        const size = raw.length;
        if (size > PERFORMANCE_MAX_ENCODED_SIZE) {
            throw new Error('encoded payload too large');
        }
        return raw;
    }

    static decode(raw: string): PerformanceRecord {
        const obj = JSON.parse(raw) as PerformanceRecord;
        const err = this.validate(obj);
        if (err) {
            throw new Error(err);
        }
        return obj;
    }
}
