import { sys } from 'cc';

const KEY = 'kalinba_sheet_runtime_v1';

/** 跨场景记录当前是否为「单张长图纵向滚动」模式（由 SheetMusicBackground 写入，设置页读取） */
export class SheetRuntimeStore {
    static setLongImageActive(active: boolean): void {
        try {
            sys.localStorage.setItem(KEY, JSON.stringify({ longImageActive: active }));
        } catch {
            // ignore
        }
    }

    static isLongImageActive(): boolean {
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return false;
            const o = JSON.parse(raw) as { longImageActive?: boolean };
            return o.longImageActive === true;
        } catch {
            return false;
        }
    }
}
