import { sys } from 'cc';

const KEY = 'kalinba_metronome_settings_v1';

export interface MetronomeSettingsSnapshot {
    enabled: boolean;
    bpm: number;
    beatsPerBar: number;
    accentFirstBeat: boolean;
    countInBars: number;
    /** 节奏提示密度：四分、八分或十六分音符。 */
    subdivision: 4 | 8 | 16;
}

/** 节拍器设置与演奏设置分开存储，避免未来新增字段污染音色存档。 */
export class MetronomeSettingsStore {
    static defaultSnapshot(): MetronomeSettingsSnapshot {
        return {
            enabled: false,
            bpm: 80,
            beatsPerBar: 4,
            accentFirstBeat: true,
            countInBars: 1,
            subdivision: 4,
        };
    }

    static load(): MetronomeSettingsSnapshot {
        const d = this.defaultSnapshot();
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return d;
            const o = JSON.parse(raw) as Partial<MetronomeSettingsSnapshot>;
            const bpm = Number(o.bpm);
            const beats = Number(o.beatsPerBar);
            const countIn = Number(o.countInBars);
            const subdivision = Number(o.subdivision);
            return {
                enabled: typeof o.enabled === 'boolean' ? o.enabled : d.enabled,
                bpm: Number.isFinite(bpm) ? Math.max(40, Math.min(220, Math.round(bpm))) : d.bpm,
                beatsPerBar: beats === 2 || beats === 3 || beats === 4 ? beats : d.beatsPerBar,
                accentFirstBeat: typeof o.accentFirstBeat === 'boolean' ? o.accentFirstBeat : d.accentFirstBeat,
                countInBars: countIn === 0 || countIn === 1 || countIn === 2 ? countIn : d.countInBars,
                subdivision: subdivision === 4 || subdivision === 8 || subdivision === 16 ? subdivision : d.subdivision,
            };
        } catch {
            return d;
        }
    }

    static save(partial: Partial<MetronomeSettingsSnapshot>): MetronomeSettingsSnapshot {
        const current = this.load();
        const next = { ...current, ...partial };
        const normalized: MetronomeSettingsSnapshot = {
            ...next,
            bpm: Math.max(40, Math.min(220, Math.round(Number(next.bpm) || current.bpm))),
            beatsPerBar: next.beatsPerBar === 2 || next.beatsPerBar === 3 || next.beatsPerBar === 4
                ? next.beatsPerBar
                : current.beatsPerBar,
            countInBars: next.countInBars === 0 || next.countInBars === 1 || next.countInBars === 2
                ? next.countInBars
                : current.countInBars,
            subdivision: next.subdivision === 4 || next.subdivision === 8 || next.subdivision === 16
                ? next.subdivision
                : current.subdivision,
        };
        try {
            sys.localStorage.setItem(KEY, JSON.stringify(normalized));
        } catch {
            // 本地容量不足不应阻断演奏。
        }
        return normalized;
    }
}
