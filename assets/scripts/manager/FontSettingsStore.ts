import { sys } from 'cc';
import { clampFontIndex } from './FontsCatalog';

const KEY = 'kalinba_font_settings_v1';

export interface FontSettingsSnapshot {
    /** 对应 FontsCatalog.FONTS_CATALOG 下标 */
    fontIndex: number;
}

export class FontSettingsStore {
    static defaultSnapshot(): FontSettingsSnapshot {
        return { fontIndex: 0 };
    }

    static load(): FontSettingsSnapshot {
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return this.defaultSnapshot();
            const o = JSON.parse(raw) as Partial<FontSettingsSnapshot>;
            const d = this.defaultSnapshot();
            return {
                fontIndex: clampFontIndex(typeof o.fontIndex === 'number' ? o.fontIndex : d.fontIndex),
            };
        } catch {
            return this.defaultSnapshot();
        }
    }

    static save(partial: Partial<FontSettingsSnapshot>): void {
        const cur = this.load();
        const next: FontSettingsSnapshot = { ...cur, ...partial };
        next.fontIndex = clampFontIndex(next.fontIndex);
        try {
            sys.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    }
}
