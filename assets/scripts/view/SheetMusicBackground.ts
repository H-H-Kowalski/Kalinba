import { _decorator, Component, Sprite, SpriteFrame, Button, assetManager, ImageAsset, Texture2D, sys } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 琴谱/本地图片背景区域
 * 顶部区域显示背景图，支持用户选择本地图片替换，也有默认图
 */
@ccclass('SheetMusicBackground')
export class SheetMusicBackground extends Component {
    @property(SpriteFrame)
    defaultSpriteFrame: SpriteFrame = null;  // 默认背景图（琴谱或占位图）

    @property(Button)
    selectImageButton: Button = null;  // “选择图片”按钮，可选；不设则点击区域即可选择

    private sprite: Sprite = null;
    private customTexture: Texture2D = null;  // 用户选择的图片生成的纹理，用于释放

    start() {
        this.sprite = this.node.getComponent(Sprite);
        if (!this.sprite) {
            console.warn('[SheetMusicBackground] 节点上需要 Sprite 组件');
            return;
        }

        // 应用默认图
        if (this.defaultSpriteFrame && !this.sprite.spriteFrame) {
            this.sprite.spriteFrame = this.defaultSpriteFrame;
        }

        // 设置选择图片的触发方式（需要指定“选择图片”按钮）
        if (this.selectImageButton) {
            this.selectImageButton.node.on(Button.EventType.CLICK, this.openImagePicker, this);
        }
    }

    /**
     * 打开本地图片选择器（Web 平台）
     */
    openImagePicker() {
        if (!sys.isBrowser) {
            console.warn('[SheetMusicBackground] 本地选图当前仅支持 Web 平台');
            return;
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target?.files?.[0];
            if (!file) return;

            const url = URL.createObjectURL(file);
            const ext = file.name.toLowerCase().endsWith('.png') ? '.png' :
                file.name.toLowerCase().endsWith('.jpg') || file.name.toLowerCase().endsWith('.jpeg') ? '.jpg' : '.png';
            assetManager.loadRemote<ImageAsset>(url, { ext }, (err, imageAsset) => {
                URL.revokeObjectURL(url);
                if (err) {
                    console.error('[SheetMusicBackground] 加载图片失败:', err);
                    return;
                }
                this.applyImageAsset(imageAsset);
            });
        };
        input.click();
    }

    /**
     * 将 ImageAsset 应用到 Sprite
     */
    private applyImageAsset(imageAsset: ImageAsset) {
        if (!this.sprite) return;

        // 释放之前的自定义纹理
        if (this.customTexture) {
            this.customTexture.destroy();
            this.customTexture = null;
        }

        const texture = new Texture2D();
        texture.image = imageAsset;
        this.customTexture = texture;

        const spriteFrame = new SpriteFrame();
        spriteFrame.texture = texture;
        this.sprite.spriteFrame = spriteFrame;
    }

    /**
     * 恢复为默认图
     */
    resetToDefault() {
        if (this.sprite && this.defaultSpriteFrame) {
            if (this.customTexture) {
                this.customTexture.destroy();
                this.customTexture = null;
            }
            this.sprite.spriteFrame = this.defaultSpriteFrame;
        }
    }

    onDestroy() {
        if (this.selectImageButton) {
            this.selectImageButton.node.off(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.customTexture) {
            this.customTexture.destroy();
        }
    }
}
