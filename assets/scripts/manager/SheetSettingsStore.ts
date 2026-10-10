import { sys } from 'cc';

const KEY = 'kalinba_sheet_settings_v1';

export interface SheetSettingsSnapshot {
    /** 0 横向分页 1 纵向滚动；单张长图会按该偏好分页或连续滚动 */
    pageTurnMode: number;
    /** 自动滚动速度 1~100，默认 50 */
    autoScrollSpeed: number;
}

export class SheetSettingsStore {
    static defaultSnapshot(): SheetSettingsSnapshot {
        return {
            pageTurnMode: 1,
            autoScrollSpeed: 50,
        };
    }

    static load(): SheetSettingsSnapshot {
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return this.defaultSnapshot();
            const o = JSON.parse(raw) as Partial<SheetSettingsSnapshot>;
            const d = this.defaultSnapshot();
            const pm = o.pageTurnMode;
            const spd = typeof o.autoScrollSpeed === 'number'
                ? Math.floor(Math.max(0, Math.min(100, o.autoScrollSpeed)))
                : d.autoScrollSpeed;
            return {
                pageTurnMode: pm === 0 || pm === 1 ? Math.floor(pm) : d.pageTurnMode,
                autoScrollSpeed: spd,
            };
        } catch {
            return this.defaultSnapshot();
        }
    }

    static save(partial: Partial<SheetSettingsSnapshot>): void {
        const cur = this.load();
        const next: SheetSettingsSnapshot = { ...cur, ...partial };
        next.pageTurnMode = next.pageTurnMode === 1 ? 1 : 0;
        next.autoScrollSpeed = Math.floor(Math.max(0, Math.min(100, next.autoScrollSpeed)));
        try {
            sys.localStorage.setItem(KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    }
}
