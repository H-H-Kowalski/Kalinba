import { sys } from 'cc';

const KEY = 'kalinba_sheet_settings_v1';

export interface SheetSettingsSnapshot {
    /** 0 横向 1 纵向；长图仍会强制纵向，见 SheetMusicBackground */
    pageTurnMode: number;
}

export class SheetSettingsStore {
    static defaultSnapshot(): SheetSettingsSnapshot {
        /** 默认曲谱为长图时，与 Inspector 一致默认纵向翻页/滚动 */
        return { pageTurnMode: 1 };
    }

    static load(): SheetSettingsSnapshot {
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return this.defaultSnapshot();
            const o = JSON.parse(raw) as Partial<SheetSettingsSnapshot>;
            const d = this.defaultSnapshot();
            const pm = o.pageTurnMode;
            return {
                /** 须区分「存了 0」与缺省，否则改 defaultSnapshot 会误伤老存档 */
                pageTurnMode: pm === 0 || pm === 1 ? Math.floor(pm) : d.pageTurnMode,
            };
        } catch {
            return this.defaultSnapshot();
        }
    }

    static save(partial: Partial<SheetSettingsSnapshot>): void {
        const cur = this.load();
        const next: SheetSettingsSnapshot = { ...cur, ...partial };
        next.pageTurnMode = next.pageTurnMode === 1 ? 1 : 0;
        try {
            sys.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    }
}
