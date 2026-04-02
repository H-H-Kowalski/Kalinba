/**
 * 字体目录：当前不打包任何 TTF（assets/fonts 为空），仅提供「系统字体」。
 * 若日后恢复嵌入字体，需在此增加条目并使 uuid 与 .ttf.meta 一致。
 */
export interface FontCatalogEntry {
    /** 用于调试/扩展 */
    id: string;
    displayName: string;
    /** null 表示使用系统默认字体（不加载 TTF） */
    uuid: string | null;
}

export const FONTS_CATALOG: FontCatalogEntry[] = [{ id: 'system', displayName: '系统字体', uuid: null }];

export function getFontCount(): number {
    return FONTS_CATALOG.length;
}

export function clampFontIndex(i: number): number {
    const n = FONTS_CATALOG.length;
    if (n <= 0) return 0;
    return Math.max(0, Math.min(n - 1, Math.floor(i)));
}

export function getFontUuid(index: number): string | null {
    const e = FONTS_CATALOG[clampFontIndex(index)];
    return e?.uuid ?? null;
}

/** 当前项是否为「系统字体」（不加载资源） */
export function isSystemFontIndex(index: number): boolean {
    return FONTS_CATALOG[clampFontIndex(index)]?.id === 'system';
}
