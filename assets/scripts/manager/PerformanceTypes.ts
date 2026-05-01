export const PERFORMANCE_MAX_DURATION_MS = 180000; // 3 minutes
export const PERFORMANCE_MAX_EVENTS = 6000;
export const PERFORMANCE_MAX_ENCODED_SIZE = 128 * 1024;

export interface PerformanceEvent {
    t: number; // ms from recording start
    k: number; // key index
}

export interface PerformanceRecord {
    title?: string;
    stylePreset: number;
    durationMs: number;
    events: PerformanceEvent[];
    appVersion: string;
}

export interface PerformanceSharePayload {
    recordId: string;
}
