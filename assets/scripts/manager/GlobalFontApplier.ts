import { assetManager, EditBox, Font, Label, Node } from 'cc';
import { FontSettingsStore } from './FontSettingsStore';
import { getFontUuid, isSystemFontIndex } from './FontsCatalog';

let cachedIndex = -1;
let cachedFont: Font | null = null;

export function invalidateFontCache(): void {
    cachedIndex = -1;
    cachedFont = null;
}

export function loadFontForCurrentSettings(): Promise<Font | null> {
    const idx = FontSettingsStore.load().fontIndex;
    return loadFontForIndex(idx);
}

export function loadFontForIndex(index: number): Promise<Font | null> {
    if (isSystemFontIndex(index)) {
        cachedIndex = index;
        cachedFont = null;
        return Promise.resolve(null);
    }
    if (cachedIndex === index && cachedFont?.isValid) {
        return Promise.resolve(cachedFont);
    }
    const uuid = getFontUuid(index);
    if (!uuid) return Promise.resolve(null);
    return new Promise((resolve) => {
        assetManager.loadAny({ uuid }, (err, asset) => {
            if (err || !asset) {
                console.warn('[GlobalFontApplier] 字体加载失败', index, err);
                resolve(null);
                return;
            }
            const f = asset as Font;
            cachedFont = f;
            cachedIndex = index;
            resolve(f);
        });
    });
}

function applyToLabel(lab: Label, font: Font) {
    if (!lab?.isValid || !font?.isValid) return;
    lab.useSystemFont = false;
    lab.font = font;
}

function applySystemToLabel(lab: Label) {
    if (!lab?.isValid) return;
    lab.useSystemFont = true;
    lab.font = null;
}

/** 子树内全部 Label / EditBox 内嵌字用系统默认字体 */
export function applySystemFontToSubtree(root: Node): void {
    if (!root?.isValid) return;
    const stack: Node[] = [root];
    while (stack.length) {
        const n = stack.pop()!;
        const labels = n.getComponents(Label);
        for (const lab of labels) {
            applySystemToLabel(lab);
        }
        const eb = n.getComponent(EditBox);
        if (eb) {
            if (eb.textLabel) applySystemToLabel(eb.textLabel);
            if (eb.placeholderLabel) applySystemToLabel(eb.placeholderLabel);
        }
        for (let i = n.children.length - 1; i >= 0; i--) {
            stack.push(n.children[i]);
        }
    }
}

/** 将 TTF 字体应用到子树内所有 Label，以及 EditBox 内嵌 Label */
export function applyFontToSubtree(root: Node, font: Font): void {
    if (!root?.isValid || !font?.isValid) return;
    const stack: Node[] = [root];
    while (stack.length) {
        const n = stack.pop()!;
        const labels = n.getComponents(Label);
        for (const lab of labels) {
            applyToLabel(lab, font);
        }
        const eb = n.getComponent(EditBox);
        if (eb) {
            if (eb.textLabel) applyToLabel(eb.textLabel, font);
            if (eb.placeholderLabel) applyToLabel(eb.placeholderLabel, font);
        }
        for (let i = n.children.length - 1; i >= 0; i--) {
            stack.push(n.children[i]);
        }
    }
}

/** 按当前存档字体应用到整棵 UI 子树（异步加载字体资源） */
export async function applySavedFontToSubtree(root: Node): Promise<void> {
    if (!root?.isValid) return;
    const idx = FontSettingsStore.load().fontIndex;
    if (isSystemFontIndex(idx)) {
        invalidateFontCache();
        cachedIndex = idx;
        cachedFont = null;
        applySystemFontToSubtree(root);
        return;
    }
    const font = await loadFontForIndex(idx);
    if (!font) return;
    applyFontToSubtree(root, font);
}
