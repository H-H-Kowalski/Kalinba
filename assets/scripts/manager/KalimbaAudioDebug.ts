/**
 * 弹琴 / WebAudio 排查日志总开关。发布前可改为 false 或删掉相关 import。
 */
export const KALIMBA_AUDIO_DEBUG = true;

export function kalimbaAudioLog(scope: string, ...args: unknown[]) {
    if (!KALIMBA_AUDIO_DEBUG) return;
    console.log(`[KalimbaAudio:${scope}]`, ...args);
}

export function kalimbaAudioWarn(scope: string, ...args: unknown[]) {
    if (!KALIMBA_AUDIO_DEBUG) return;
    console.warn(`[KalimbaAudio:${scope}]`, ...args);
}
