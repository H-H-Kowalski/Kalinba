import { sys, Texture2D } from 'cc';

export type BuiltInBackground = 'birthday' | 'share';

/** 本次运行的已审核外观。跨场景保留，冷启动重新选择；不保存用户内容到磁盘。 */
export class PerformanceAppearanceStore {
    private static caption: string | null = null;
    private static background: BuiltInBackground = 'birthday';
    private static images: Texture2D[] = [];

    static removeLegacyStorage(captionKey = 'user_caption'): void {
        for (const key of [captionKey, 'kalinba_selected_images_v1', 'kalinba_sheet_runtime_v1']) {
            if (!key) continue;
            try { sys.localStorage.removeItem(key); } catch { /* Memory-only state still works. */ }
        }
    }

    static getCaption(fallback: string): string { return this.caption ?? fallback; }
    /** 仅接收已审核文案，或用户主动清空后的空字符串。 */
    static setCaption(value: string): void { this.caption = value; }
    static getBackground(): BuiltInBackground { return this.background; }
    static getImages(): Texture2D[] { return this.images.slice(); }

    /** 调用方已审核并解码全部图片；引用计数保证切设置场景时纹理仍可同步恢复。 */
    static setImages(textures: Texture2D[]): void {
        const previous = this.images;
        this.images = textures.map(texture => { texture.addRef(); return texture; });
        for (const texture of previous) texture.decRef();
    }

    static selectBuiltIn(background = this.background): void {
        this.background = background;
        this.setImages([]);
    }
}
