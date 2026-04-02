import {
    _decorator,
    Component,
    Enum,
    Sprite,
    SpriteFrame,
    Button,
    assetManager,
    ImageAsset,
    Texture2D,
    sys,
    Label,
    Node,
    EventTouch,
    UITransform,
    Mask,
    Color,
    tween,
    Vec3,
} from 'cc';
import { chooseImagesUpTo, isWeChatMiniGame } from '../manager/ChooseImageHelper';
import { applySavedFontToSubtree } from '../manager/GlobalFontApplier';
import { SheetSettingsStore } from '../manager/SheetSettingsStore';
import { SheetRuntimeStore } from '../manager/SheetRuntimeStore';
const { ccclass, property } = _decorator;

const DISPLAY_NODE = 'SheetImage';
const MASK_ROOT = 'MaskRoot';
const DOT_ROW = 'DotRow';
const SLIDES_ROOT = 'SlidesRoot';

/** 指示器：当前页蓝色、其它浅灰（参考常见轮播点样式） */
const DOT_ACTIVE = new Color(59, 130, 221, 255);
const DOT_INACTIVE = new Color(200, 200, 200, 255);

enum PageTurnMode {
    HORIZONTAL = 0,
    VERTICAL = 1,
}

/**
 * 顶部琴谱区域：轮播图；固定尺寸拉伸；仅左下/右下圆角。
 * 浏览器：Canvas 生成蒙版 + Mask(SPRITE_STENCIL)，圆角可靠。
 * 其它环境：MaskRoot + GRAPHICS_STENCIL 手绘路径。
 */
@ccclass('SheetMusicBackground')
export class SheetMusicBackground extends Component {
    /** 默认轮播图（不选图时使用，支持配置 1~N 张） */
    @property([SpriteFrame])
    defaultSpriteFrames: SpriteFrame[] = [];

    @property(Button)
    selectImageButton: Button = null;

    /** 点击后打开相册/文件选择图片（可与 selectImageButton 同时绑定同一按钮） */
    @property(Button)
    chooseImageButton: Button = null;

    @property(Button)
    prevButton: Button = null;

    @property(Button)
    nextButton: Button = null;

    @property(Label)
    pageLabel: Label = null;

    @property
    maxImages: number = 5;

    @property
    swipeThresholdPx: number = 40;

    @property({
        type: Enum(PageTurnMode),
        tooltip: '默认翻页偏好（设置页可改）；单张长图仍会强制纵向滚动',
    })
    pageTurnMode: PageTurnMode = PageTurnMode.VERTICAL;

    @property({ tooltip: '单张长图自动纵向滚动（按宽度适配，不切图）' })
    enableTallImageAutoPaging: boolean = true;

    @property({ tooltip: '单图滚动触发倍数：宽度适配后高度 > 容器高度 * 该值 才启用滚动' })
    singleImageScrollThreshold: number = 1.25;

    @property
    displayWidth: number = 1120;

    @property
    displayHeight: number = 335;

    @property
    bottomCornerRadius: number = 20;

    /** 图片下方留给圆点指示器的高度（根节点总高 = displayHeight + dotBandHeight） */
    @property
    dotBandHeight: number = 44;

    private sprite: Sprite = null;
    private carouselTextures: Texture2D[] = [];
    private carouselIndex: number = 0;
    private blobRevoke: (() => void) | null = null;

    private _touchStartX = 0;
    private _touchStartY = 0;
    private _carouselFrames: SpriteFrame[] = [];
    /** 浏览器 SPRITE_STENCIL 用的蒙版纹理，销毁时释放 */
    private _maskStencilTexture: Texture2D | null = null;

    private _dotRowNode: Node | null = null;
    private _slidesRoot: Node | null = null;
    private _isPickingImages = false;
    private _forceVerticalPaging = false;
    private _singleTallScrollActive = false;
    private _singleTallMinY = 0;
    private _singleTallMaxY = 0;
    private _touchStartRootY = 0;
    private _touchDragging = false;
    private _dragDx = 0;
    private _dragDy = 0;

    onLoad() {
        this.setupSizeMaskAndSpriteHost();
    }

    start() {
        const sheet = SheetSettingsStore.load();
        this.pageTurnMode =
            sheet.pageTurnMode === 1 ? PageTurnMode.VERTICAL : PageTurnMode.HORIZONTAL;

        this.sprite = this.findDisplaySprite();
        if (!this.sprite) {
            console.warn('[SheetMusicBackground] 需要 Sprite：应在 MaskRoot/SheetImage 子节点上');
            return;
        }

        const defaults = this.getDefaultFramesForUI();
        if (defaults.length > 0 && !this.sprite.spriteFrame) {
            this.sprite.spriteFrame = defaults[0];
        }

        this.applySpriteStretch();
        this.ensureSlidesRoot();
        this.rebuildSlides(true);
        this.applyTallScrollForSingleBuiltInImageIfNeeded();
        if (this.sprite?.node) {
            this.sprite.node.active = false;
        }

        if (this.selectImageButton) {
            this.selectImageButton.node.on(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.chooseImageButton && this.chooseImageButton.node !== this.selectImageButton?.node) {
            this.chooseImageButton.node.on(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.prevButton) {
            this.prevButton.node.on(Button.EventType.CLICK, this.goPrev, this);
        }
        if (this.nextButton) {
            this.nextButton.node.on(Button.EventType.CLICK, this.goNext, this);
        }

        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        this.updateNavAndPageLabel();
        this.syncSheetRuntimeToStore();
        this.scheduleOnce(() => this.refreshDotRowLayout(), 0);
    }

    /** 根节点增高后，刷新指示条位置 */
    private refreshDotRowLayout() {
        if (this._dotRowNode && this._dotRowNode.isValid) {
            this.positionDotRow();
        }
        const mr = this.getMaskRoot();
        if (mr) {
            mr.setPosition(0, this.dotBandHeight / 2, 0);
        }
    }

    /**
     * UI 用「页数」：无用户选图时若仍有默认图/当前 Sprite 有帧，计为 1 页，便于显示圆点与 1/1。
     */
    private getSlideCountForUI(): number {
        if (this._singleTallScrollActive) {
            return this.getTallVirtualPageCount();
        }
        const n = this.getActiveFrames().length;
        if (n > 0) return n;
        if (this.sprite?.spriteFrame) return 1;
        return 0;
    }

    private getDefaultFramesForUI(): SpriteFrame[] {
        return (this.defaultSpriteFrames || []).filter((f) => !!f);
    }

    private getActiveFrames(): SpriteFrame[] {
        if (this._carouselFrames.length > 0) return this._carouselFrames;
        return this.getDefaultFramesForUI();
    }

    /** 当前仅一张主图时的纹理：用户选图一条，或内置 defaultSpriteFrames 一条（与 carouselTextures[0] 二选一） */
    private getPrimarySlideTexture(): Texture2D | null {
        if (this.carouselTextures.length === 1) {
            return this.carouselTextures[0];
        }
        const frames = this.getActiveFrames();
        if (frames.length === 1 && frames[0]?.texture) {
            return frames[0].texture as Texture2D;
        }
        return null;
    }

    /**
     * 内置 defaultSpriteFrames 仅一张且为长图时：与 URL 选单张长图一致，启用纵向滚动（不写入 carouselTextures）
     */
    private applyTallScrollForSingleBuiltInImageIfNeeded(): void {
        if (this.carouselTextures.length > 0) {
            return;
        }
        this._singleTallScrollActive = false;
        this._forceVerticalPaging = false;
        if (!this.enableTallImageAutoPaging) {
            this.updateSingleTallScrollBounds();
            return;
        }
        const tex = this.getPrimarySlideTexture();
        if (!tex) {
            this.updateSingleTallScrollBounds();
            return;
        }
        const { w, h } = this.getTextureSize(tex);
        const contentH = (w > 0 && h > 0) ? (this.displayWidth * h / w) : 0;
        const threshold = Math.max(1.01, this.singleImageScrollThreshold);
        if (contentH > this.displayHeight * threshold) {
            this._singleTallScrollActive = true;
            this._forceVerticalPaging = true;
            SheetSettingsStore.save({ pageTurnMode: 1 });
        }
        this.updateSingleTallScrollBounds();
        this.rebuildSlides(false);
        this.applyCurrentSlideInternal(false);
    }

    private getCurrentPageTurnMode(): PageTurnMode {
        return this._forceVerticalPaging ? PageTurnMode.VERTICAL : this.pageTurnMode;
    }

    private syncSheetRuntimeToStore() {
        const long = this._singleTallScrollActive && this.getPrimarySlideTexture() !== null;
        SheetRuntimeStore.setLongImageActive(long);
    }

    private getTextureSize(tex: Texture2D): { w: number; h: number } {
        const anyTex = tex as unknown as {
            __srcW?: number;
            __srcH?: number;
            width?: number;
            height?: number;
            image?: {
                width?: number;
                height?: number;
                _nativeAsset?: {
                    width?: number;
                    height?: number;
                    naturalWidth?: number;
                    naturalHeight?: number;
                    videoWidth?: number;
                    videoHeight?: number;
                };
            };
        };
        const native = anyTex.image?._nativeAsset;
        const w = Math.floor(
            anyTex.__srcW
            ?? anyTex.width
            ?? anyTex.image?.width
            ?? native?.naturalWidth
            ?? native?.videoWidth
            ?? native?.width
            ?? 0,
        );
        const h = Math.floor(
            anyTex.__srcH
            ?? anyTex.height
            ?? anyTex.image?.height
            ?? native?.naturalHeight
            ?? native?.videoHeight
            ?? native?.height
            ?? 0,
        );
        return { w: Math.max(0, w), h: Math.max(0, h) };
    }

    private updateSingleTallScrollBounds() {
        const primary = this.getPrimarySlideTexture();
        if (!this._singleTallScrollActive || !primary) {
            this._singleTallMinY = 0;
            this._singleTallMaxY = 0;
            this.syncSheetRuntimeToStore();
            return;
        }
        const { w, h } = this.getTextureSize(primary);
        if (w <= 0 || h <= 0) {
            this._singleTallScrollActive = false;
            this._forceVerticalPaging = false;
            this._singleTallMinY = 0;
            this._singleTallMaxY = 0;
            this.syncSheetRuntimeToStore();
            return;
        }
        const contentH = this.displayWidth * h / w;
        const threshold = Math.max(1.01, this.singleImageScrollThreshold);
        if (contentH <= this.displayHeight * threshold) {
            this._singleTallScrollActive = false;
            this._forceVerticalPaging = false;
            this._singleTallMinY = 0;
            this._singleTallMaxY = 0;
            this.syncSheetRuntimeToStore();
            return;
        }
        this._singleTallMinY = (this.displayHeight - contentH) * 0.5;
        this._singleTallMaxY = (contentH - this.displayHeight) * 0.5;
        this.syncSheetRuntimeToStore();
    }

    private getTallVirtualPageCount(): number {
        const primary = this.getPrimarySlideTexture();
        if (!this._singleTallScrollActive || !primary) return 1;
        const { w, h } = this.getTextureSize(primary);
        if (w <= 0 || h <= 0) return 1;
        const contentH = this.displayWidth * h / w;
        return Math.max(1, Math.ceil(contentH / Math.max(1, this.displayHeight)));
    }

    private getTallPageIndexByY(y: number): number {
        const pageCount = this.getTallVirtualPageCount();
        if (pageCount <= 1) return 0;
        const range = this._singleTallMaxY - this._singleTallMinY;
        if (range <= 1e-6) return 0;
        const t = (y - this._singleTallMinY) / range;
        const idx = Math.round(t * (pageCount - 1));
        return Math.max(0, Math.min(pageCount - 1, idx));
    }

    private getTallYByPageIndex(index: number): number {
        const pageCount = this.getTallVirtualPageCount();
        if (pageCount <= 1) return this._singleTallMinY;
        const i = Math.max(0, Math.min(pageCount - 1, index));
        const t = i / (pageCount - 1);
        return this._singleTallMinY + (this._singleTallMaxY - this._singleTallMinY) * t;
    }

    /** 点击圆点跳转到对应张 */
    goToSlide(index: number) {
        const n = this.getSlideCountForUI();
        if (n === 0 || index < 0 || index >= n) return;
        this.carouselIndex = index;
        if (this._singleTallScrollActive && this._slidesRoot) {
            const y = this.getTallYByPageIndex(index);
            tween(this._slidesRoot)
                .to(0.12, { position: new Vec3(0, y, 0) })
                .start();
        } else {
            this.applyCurrentSlide();
        }
        this.updateNavAndPageLabel();
    }

    private ensureDotRow(): Node {
        if (this._dotRowNode && this._dotRowNode.isValid) {
            this.positionDotRow();
            return this._dotRowNode;
        }
        let row = this.node.getChildByName(DOT_ROW);
        if (!row) {
            row = new Node(DOT_ROW);
            const ui = row.addComponent(UITransform);
            ui.setContentSize(this.displayWidth, this.dotBandHeight);
            ui.setAnchorPoint(0.5, 0.5);
            row.setParent(this.node);
        } else {
            const ui = row.getComponent(UITransform) || row.addComponent(UITransform);
            ui.setContentSize(this.displayWidth, this.dotBandHeight);
        }
        this._dotRowNode = row;
        this.positionDotRow();
        row.setSiblingIndex(this.node.children.length - 1);
        return row;
    }

    /** 圆点放在「图片区域」正下方：根节点总高 = 图高 + dotBand，圆点条在底部条带正中 */
    private positionDotRow() {
        if (!this._dotRowNode) return;
        const imgH = this.displayHeight;
        const band = this.dotBandHeight;
        const totalH = imgH + band;
        this._dotRowNode.setPosition(0, -totalH / 2 + band / 2, 0);
    }

    private updateDotIndicators() {
        const n = this.getSlideCountForUI();
        if (n === 0) {
            if (this._dotRowNode) this._dotRowNode.active = false;
            return;
        }
        const row = this.ensureDotRow();
        row.active = true;

        const gap = 28;
        // 不能用 while + destroy：destroy 是延迟生效，children.length 本帧不变会导致死循环卡死
        for (let i = row.children.length - 1; i >= n; i--) {
            const child = row.children[i];
            if (!child) continue;
            child.removeFromParent();
            child.destroy();
        }
        for (let i = row.children.length; i < n; i++) {
            const idx = i;
            const dot = new Node(`Dot${i}`);
            const ui = dot.addComponent(UITransform);
            ui.setContentSize(32, 32);
            const lab = dot.addComponent(Label);
            lab.string = '●';
            lab.fontSize = 18;
            lab.lineHeight = 22;
            lab.horizontalAlign = Label.HorizontalAlign.CENTER;
            lab.verticalAlign = Label.VerticalAlign.CENTER;
            lab.overflow = Label.Overflow.NONE;
            dot.setParent(row);
            dot.on(Node.EventType.TOUCH_END, (e: EventTouch) => {
                e.propagationStopped = true;
                this.goToSlide(idx);
            }, this);
        }
        for (let i = 0; i < n; i++) {
            const dot = row.children[i];
            const x = (i - (n - 1) / 2) * gap;
            dot.setPosition(x, 0, 0);
            const lab = dot.getComponent(Label);
            if (lab) {
                lab.color = i === this.carouselIndex ? DOT_ACTIVE : DOT_INACTIVE;
            }
        }
        void applySavedFontToSubtree(row);
    }

    private getMaskRoot(): Node | null {
        return this.node.getChildByName(MASK_ROOT);
    }

    /** 蒙版只挂在 MaskRoot 上，谱图 Sprite 仅在其子节点，才能被正确裁剪 */
    private setupSizeMaskAndSpriteHost() {
        const w = this.displayWidth;
        const h = this.displayHeight;
        const band = this.dotBandHeight;
        const totalH = h + band;
        const r = Math.min(this.bottomCornerRadius, Math.min(w, h) * 0.5 - 0.01);

        const rootUi = this.node.getComponent(UITransform) || this.node.addComponent(UITransform);
        rootUi.setContentSize(w, totalH);
        rootUi.setAnchorPoint(0.5, 0.5);

        const oldMask = this.node.getComponent(Mask);
        if (oldMask) {
            oldMask.destroy();
        }

        let maskRoot = this.getMaskRoot();
        if (!maskRoot) {
            maskRoot = new Node(MASK_ROOT);
            const mui = maskRoot.addComponent(UITransform);
            mui.setContentSize(w, h);
            mui.setAnchorPoint(0.5, 0.5);
            maskRoot.setParent(this.node);
            maskRoot.setPosition(0, band / 2, 0);
        } else {
            const mui = maskRoot.getComponent(UITransform) || maskRoot.addComponent(UITransform);
            mui.setContentSize(w, h);
            mui.setAnchorPoint(0.5, 0.5);
            maskRoot.setPosition(0, band / 2, 0);
        }

        let imgNode = maskRoot.getChildByName(DISPLAY_NODE);
        if (!imgNode) {
            const sprOnRoot = this.node.getComponent(Sprite);
            imgNode = new Node(DISPLAY_NODE);
            const uiChild = imgNode.addComponent(UITransform);
            uiChild.setContentSize(w, h);
            uiChild.setAnchorPoint(0.5, 0.5);
            imgNode.setParent(maskRoot);
            imgNode.setPosition(0, 0, 0);

            if (sprOnRoot) {
                const frame = sprOnRoot.spriteFrame;
                const col = sprOnRoot.color.clone();
                sprOnRoot.destroy();
                const newSpr = imgNode.addComponent(Sprite);
                newSpr.spriteFrame = frame;
                newSpr.color = col;
            } else {
                imgNode.addComponent(Sprite);
            }
        } else {
            const uiChild = imgNode.getComponent(UITransform) || imgNode.addComponent(UITransform);
            uiChild.setContentSize(w, h);
            uiChild.setAnchorPoint(0.5, 0.5);
            if (imgNode.parent !== maskRoot) {
                imgNode.setParent(maskRoot);
            }
        }

        const spr = imgNode.getComponent(Sprite);
        if (spr) {
            spr.sizeMode = Sprite.SizeMode.CUSTOM;
        }

        const mask = maskRoot.getComponent(Mask) || maskRoot.addComponent(Mask);
        mask.enabled = true;

        // 微信小游戏：圆角蒙版走 Graphics；浏览器 Canvas 蒙版见文件内注释块
        this.applyGraphicsStencilMask(mask, w, h, r);
        /* 仅 Web 预览/非微信真机时可恢复 Canvas 蒙版
        if (sys.isBrowser && typeof document !== 'undefined') {
            this.applyBrowserSpriteStencilMask(maskRoot, mask, w, h, r);
        } else {
            this.applyGraphicsStencilMask(mask, w, h, r);
        }
        */

        if (this._dotRowNode && this._dotRowNode.isValid) {
            const ui = this._dotRowNode.getComponent(UITransform);
            if (ui) ui.setContentSize(w, band);
            this.positionDotRow();
            this._dotRowNode.setSiblingIndex(this.node.children.length - 1);
        }
    }

    /* 微信小游戏发布：下列为浏览器 Canvas 蒙版，真机用 applyGraphicsStencilMask 即可
    private applyBrowserSpriteStencilMask(maskRoot: Node, mask: Mask, w: number, h: number, r: number) {
        if (this._maskStencilTexture) {
            this._maskStencilTexture.destroy();
            this._maskStencilTexture = null;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(w));
        canvas.height = Math.max(1, Math.floor(h));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            this.applyGraphicsStencilMask(mask, w, h, r);
            return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(canvas.width, 0);
        ctx.lineTo(canvas.width, canvas.height - r);
        ctx.arcTo(canvas.width, canvas.height, canvas.width - r, canvas.height, r);
        ctx.lineTo(r, canvas.height);
        ctx.arcTo(0, canvas.height, 0, canvas.height - r, r);
        ctx.lineTo(0, 0);
        ctx.closePath();
        ctx.fill();

        this.binarizeMaskAlphaOnCanvas(ctx, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/png');
        assetManager.loadRemote<ImageAsset>(dataUrl, { ext: '.png' }, (err, img) => {
            if (err || !img) {
                this.applyGraphicsStencilMask(mask, w, h, r);
                return;
            }
            const tex = new Texture2D();
            tex.image = img;
            this._maskStencilTexture = tex;
            const sf = new SpriteFrame();
            sf.texture = tex;
            mask.type = Mask.Type.SPRITE_STENCIL;
            mask.spriteFrame = sf;
            mask.alphaThreshold = 0.01;
        });
    }

    private binarizeMaskAlphaOnCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;
        const threshold = 128;
        for (let i = 0; i < d.length; i += 4) {
            const a = d[i + 3];
            if (a > threshold) {
                d[i] = 255;
                d[i + 1] = 255;
                d[i + 2] = 255;
                d[i + 3] = 255;
            } else {
                d[i] = 0;
                d[i + 1] = 0;
                d[i + 2] = 0;
                d[i + 3] = 0;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }
    */

    private applyGraphicsStencilMask(mask: Mask, w: number, h: number, r: number) {
        // 勿写 mask.spriteFrame = null：Cocos 3.8+ 在 type≠SPRITE_STENCIL 时无内部 Sprite，对 spriteFrame 赋值（含 null）会 error 16307
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        mask.alphaThreshold = 0.1;
        const g = mask.graphics;
        if (!g) {
            return;
        }
        this.drawBottomRoundedMask(g, w, h, r);
        this.scheduleOnce(() => {
            this.drawBottomRoundedMask(mask.graphics, w, h, r);
        }, 0);
    }

    private drawBottomRoundedMask(g: import('cc').Graphics, w: number, h: number, r: number) {
        const hw = w * 0.5;
        const hh = h * 0.5;
        g.clear();
        g.fillColor = Color.WHITE;
        const segs = 12;
        g.moveTo(-hw, hh);
        g.lineTo(hw, hh);
        g.lineTo(hw, -hh + r);
        this.appendQuarterArc(g, hw - r, -hh + r, r, 0, -Math.PI * 0.5, segs);
        g.lineTo(-hw + r, -hh);
        this.appendQuarterArc(g, -hw + r, -hh + r, r, -Math.PI * 0.5, -Math.PI * 0.5, segs);
        g.lineTo(-hw, hh);
        g.close();
        g.fill();
    }

    private appendQuarterArc(
        g: import('cc').Graphics,
        cx: number,
        cy: number,
        rad: number,
        startAng: number,
        deltaAng: number,
        segments: number,
    ) {
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const ang = startAng + deltaAng * t;
            g.lineTo(cx + rad * Math.cos(ang), cy + rad * Math.sin(ang));
        }
    }

    private findDisplaySprite(): Sprite | null {
        const mr = this.getMaskRoot();
        if (mr) {
            const img = mr.getChildByName(DISPLAY_NODE);
            if (img) return img.getComponent(Sprite);
        }
        const child = this.node.getChildByName(DISPLAY_NODE);
        if (child) return child.getComponent(Sprite);
        return this.node.getComponent(Sprite);
    }

    private applySpriteStretch() {
        if (!this.sprite) return;
        this.sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const n = this.sprite.node.getComponent(UITransform);
        if (n) {
            n.setContentSize(this.displayWidth, this.displayHeight);
        }
    }

    private ensureSlidesRoot() {
        const mr = this.getMaskRoot();
        if (!mr) return;
        let root = mr.getChildByName(SLIDES_ROOT);
        if (!root) {
            root = new Node(SLIDES_ROOT);
            const ui = root.addComponent(UITransform);
            ui.setContentSize(this.displayWidth, this.displayHeight);
            ui.setAnchorPoint(0.5, 0.5);
            root.setParent(mr);
            root.setPosition(0, 0, 0);
        }
        this._slidesRoot = root;
    }

    private rebuildSlides(force: boolean) {
        this.ensureSlidesRoot();
        if (!this._slidesRoot) return;
        const root = this._slidesRoot;
        const frames = this.getActiveFrames();
        if (force || root.children.length !== frames.length) {
            for (const c of [...root.children]) {
                c.removeFromParent();
                c.destroy();
            }
            for (let i = 0; i < frames.length; i++) {
                const n = new Node(`Slide_${i}`);
                const ui = n.addComponent(UITransform);
                ui.setContentSize(this.displayWidth, this.displayHeight);
                ui.setAnchorPoint(0.5, 0.5);
                const s = n.addComponent(Sprite);
                s.sizeMode = Sprite.SizeMode.CUSTOM;
                s.spriteFrame = frames[i];
                n.setParent(root);
            }
        }
        const count = Math.min(frames.length, root.children.length);
        for (let i = 0; i < count; i++) {
            const ch = root.children[i];
            const s = ch.getComponent(Sprite);
            if (s) s.spriteFrame = frames[i] ?? null;
            const ui = ch.getComponent(UITransform);
            if (ui) {
                const primaryTex = i === 0 ? this.getPrimarySlideTexture() : null;
                if (primaryTex) {
                    // 单图始终按原图宽高比显示（宽度贴合容器），避免被容器比例强拉伸
                    const { w, h } = this.getTextureSize(primaryTex);
                    const contentH = (w > 0 && h > 0) ? (this.displayWidth * h / w) : this.displayHeight;
                    if (this._singleTallScrollActive) {
                        ui.setContentSize(this.displayWidth, Math.max(this.displayHeight, contentH));
                    } else {
                        ui.setContentSize(this.displayWidth, contentH);
                    }
                } else {
                    ui.setContentSize(this.displayWidth, this.displayHeight);
                }
            }
            if (this.getCurrentPageTurnMode() !== PageTurnMode.VERTICAL) {
                ch.setPosition(i * this.displayWidth, 0, 0);
            } else {
                ch.setPosition(0, -i * this.displayHeight, 0);
            }
        }
    }

    private getRootBasePos(index: number): Vec3 {
        if (this.getCurrentPageTurnMode() !== PageTurnMode.VERTICAL) {
            return new Vec3(-index * this.displayWidth, 0, 0);
        }
        return new Vec3(0, index * this.displayHeight, 0);
    }

    private changeToIndex(targetIndex: number, animated: boolean) {
        const n = this.getSlideCountForUI();
        if (n <= 0) return;
        this.carouselIndex = Math.max(0, Math.min(targetIndex, n - 1));
        this.applyCurrentSlideInternal(animated);
        this.updateNavAndPageLabel();
    }

    private onTouchStart(e: EventTouch) {
        if (this._isPickingImages) return;
        const p = e.getUILocation();
        this._touchStartX = p.x;
        this._touchStartY = p.y;
        this._touchStartRootY = this._slidesRoot ? this._slidesRoot.position.y : 0;
        this._dragDx = 0;
        this._dragDy = 0;
        this._touchDragging = true;
    }

    private onTouchMove(e: EventTouch) {
        if (!this._touchDragging || this._isPickingImages || !this._slidesRoot) return;
        const n = this.getSlideCountForUI();
        if (n <= 1 && !this._singleTallScrollActive) return;
        const p = e.getUILocation();
        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        if (this._singleTallScrollActive) {
            if (Math.abs(dy) < Math.abs(dx)) return;
            // 长图模式：手指上划(dy<0)时，内容也应向上滚动
            let y = this._touchStartRootY + dy;
            y = Math.max(this._singleTallMinY, Math.min(this._singleTallMaxY, y));
            this._slidesRoot.setPosition(0, y, 0);
            const idx = this.getTallPageIndexByY(y);
            if (idx !== this.carouselIndex) {
                this.carouselIndex = idx;
                this.updateNavAndPageLabel();
            }
            return;
        }
        const isVertical = this.getCurrentPageTurnMode() === PageTurnMode.VERTICAL;
        if (!isVertical && Math.abs(dx) < Math.abs(dy)) return;
        if (isVertical && Math.abs(dy) < Math.abs(dx)) return;

        const atFirst = this.carouselIndex <= 0;
        const atLast = this.carouselIndex >= n - 1;
        const overEdge = !isVertical
            ? ((atFirst && dx > 0) || (atLast && dx < 0))
            : ((atFirst && dy > 0) || (atLast && dy < 0));
        const damp = overEdge ? 0.45 : 1.0;

        this._dragDx = dx * damp;
        this._dragDy = dy * damp;
        const base = this.getRootBasePos(this.carouselIndex);
        const x = base.x + (isVertical ? 0 : this._dragDx);
        const y = base.y + (isVertical ? -this._dragDy : 0);
        this._slidesRoot.setPosition(x, y, base.z);
    }

    private onTouchEnd(e: EventTouch) {
        if (!this._touchDragging) return;
        this._touchDragging = false;
        if (this._isPickingImages) return;
        const n = this.getSlideCountForUI();
        if (n <= 1 && !this._singleTallScrollActive) return;
        if (this._singleTallScrollActive) {
            // 不做段落吸附，停在用户松手位置
            if (this._slidesRoot) {
                const idx = this.getTallPageIndexByY(this._slidesRoot.position.y);
                this.carouselIndex = idx;
            }
            this.updateNavAndPageLabel();
            return;
        }
        const p = e.getUILocation();
        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        const isVertical = this.getCurrentPageTurnMode() === PageTurnMode.VERTICAL;
        const main = isVertical ? dy : dx;
        const side = isVertical ? dx : dy;
        if (Math.abs(main) < this.swipeThresholdPx || Math.abs(main) < Math.abs(side)) {
            this.resetDragVisual();
            return;
        }
        const target = main < 0 ? this.carouselIndex + 1 : this.carouselIndex - 1;
        if (target < 0 || target >= n) {
            this.resetDragVisual();
            return;
        }
        this.changeToIndex(target, true);
    }

    private resetDragVisual() {
        if (!this._slidesRoot) return;
        const base = this.getRootBasePos(this.carouselIndex);
        tween(this._slidesRoot)
            .to(0.12, { position: base })
            .start();
        this._dragDx = 0;
        this._dragDy = 0;
    }

    goPrev() {
        if (this._isPickingImages) return;
        if (this._singleTallScrollActive) return;
        if (this.carouselIndex <= 0) return;
        this.changeToIndex(this.carouselIndex - 1, true);
    }

    goNext() {
        if (this._isPickingImages) return;
        if (this._singleTallScrollActive) return;
        const n = this.getSlideCountForUI();
        if (this.carouselIndex >= n - 1) return;
        this.changeToIndex(this.carouselIndex + 1, true);
    }

    private updateNavAndPageLabel() {
        const n = this.getSlideCountForUI();
        const nCarousel = n;
        if (this.pageLabel) {
            if (n === 0) {
                this.pageLabel.string = '';
            } else {
                this.pageLabel.string = `${this.carouselIndex + 1}/${n}`;
            }
        }
        if (this.prevButton) {
            this.prevButton.interactable = !this._singleTallScrollActive && nCarousel > 1 && this.carouselIndex > 0;
        }
        if (this.nextButton) {
            this.nextButton.interactable = !this._singleTallScrollActive && nCarousel > 1 && this.carouselIndex < nCarousel - 1;
        }
        this.updateDotIndicators();
    }

    async openImagePicker() {
        if (this._isPickingImages) {
            return;
        }
        // 微信真机：wx 可能在 GameGlobal；须同时认 WECHAT_GAME
        const isWxGame =
            isWeChatMiniGame() ||
            (typeof sys.Platform !== 'undefined' && sys.platform === sys.Platform.WECHAT_GAME);
        // 若需 Creator 浏览器预览选图，可改为：if (!isWxGame && !sys.isBrowser) return;
        if (!isWxGame) {
            console.warn('[SheetMusicBackground] 当前平台不支持选择本地图片');
            return;
        }

        this._isPickingImages = true;
        if (this.prevButton) this.prevButton.interactable = false;
        if (this.nextButton) this.nextButton.interactable = false;
        try {
            const res = await chooseImagesUpTo(this.maxImages);
            if (!res.ok || res.urls.length === 0) {
                if (res.errMsg && !String(res.errMsg).includes('未选择')) {
                    console.warn('[SheetMusicBackground] 选图失败:', res.errMsg);
                }
                return;
            }

            const oldRevoke = this.blobRevoke;
            this.blobRevoke = res.revokeAll ?? null;
            await this.loadCarouselFromUrls(res.urls);
            if (oldRevoke) {
                oldRevoke();
            }
        } finally {
            this._isPickingImages = false;
            this.updateNavAndPageLabel();
        }
    }

    private toTexture2D(asset: unknown): Texture2D | null {
        if (!asset) return null;
        const maybeTexture = asset as Partial<Texture2D>;
        if (typeof maybeTexture.getGFXTexture === 'function') {
            return asset as Texture2D;
        }
        const maybeSpriteFrame = asset as Partial<SpriteFrame> & { texture?: unknown };
        if (maybeSpriteFrame.texture) {
            return maybeSpriteFrame.texture as Texture2D;
        }
        const maybeImage = asset as Partial<ImageAsset> & { width?: number; height?: number };
        if (typeof maybeImage.width === 'number' && typeof maybeImage.height === 'number') {
            const tex = new Texture2D();
            tex.image = asset as ImageAsset;
            return tex;
        }
        return null;
    }

    /* 微信小游戏发布：blob URL 等用 loadRemote；以下为浏览器 Image 加载，仅 Web 预览用
    private createTextureFromNativeImage(nativeImage: unknown): Texture2D | null {
        try {
            const native = nativeImage as {
                width?: number;
                height?: number;
                naturalWidth?: number;
                naturalHeight?: number;
                videoWidth?: number;
                videoHeight?: number;
            };
            const srcW = Math.floor(native.naturalWidth ?? native.videoWidth ?? native.width ?? 0);
            const srcH = Math.floor(native.naturalHeight ?? native.videoHeight ?? native.height ?? 0);
            const imageAsset = new ImageAsset();
            const mutable = imageAsset as unknown as { reset?: (native: unknown) => void; _nativeAsset?: unknown };
            if (typeof mutable.reset === 'function') {
                mutable.reset(nativeImage);
            } else {
                mutable._nativeAsset = nativeImage;
            }
            const tex = new Texture2D();
            tex.image = imageAsset;
            (tex as unknown as { __srcW?: number; __srcH?: number }).__srcW = srcW;
            (tex as unknown as { __srcW?: number; __srcH?: number }).__srcH = srcH;
            return tex;
        } catch {
            return null;
        }
    }

    private loadTextureFromBrowserUrl(url: string): Promise<Texture2D | null> {
        return new Promise((resolve) => {
            if (!sys.isBrowser || typeof Image === 'undefined') {
                resolve(null);
                return;
            }
            const img = new Image();
            let settled = false;
            const finish = (tex: Texture2D | null) => {
                if (settled) return;
                settled = true;
                resolve(tex);
            };
            const timer = setTimeout(() => finish(null), 6000);
            img.onload = () => {
                clearTimeout(timer);
                finish(this.createTextureFromNativeImage(img));
            };
            img.onerror = () => {
                clearTimeout(timer);
                finish(null);
            };
            img.src = url;
        });
    }
    */

    private loadImageFromUrl(url: string): Promise<Texture2D | null> {
        const exts = ['', '.png', '.jpg', '.jpeg', '.webp'];
        const tryLoadOnce = (ext: string): Promise<Texture2D | null> => {
            return new Promise((resolve) => {
                let settled = false;
                const finish = (asset: Texture2D | null) => {
                    if (settled) return;
                    settled = true;
                    resolve(asset);
                };
                const timer = setTimeout(() => finish(null), 6000);
                const done = (err: Error | null, asset?: unknown) => {
                    clearTimeout(timer);
                    if (err || !asset) {
                        finish(null);
                        return;
                    }
                    const tex = this.toTexture2D(asset);
                    finish(tex);
                };
                if (ext) {
                    assetManager.loadRemote(url, { ext }, done);
                } else {
                    assetManager.loadRemote(url, done);
                }
            });
        };

        return (async () => {
            for (const ext of exts) {
                const asset = await tryLoadOnce(ext);
                if (asset) return asset;
            }
            /* 微信小游戏发布：不走浏览器 Image 回退
            if (sys.isBrowser) {
                const texFromImg = await this.loadTextureFromBrowserUrl(url);
                if (texFromImg) return texFromImg;
            }
            */
            return null;
        })();
    }

    private async loadCarouselFromUrls(urls: string[]) {
        const loaded: Texture2D[] = [];
        for (const url of urls) {
            const tex = await this.loadImageFromUrl(url);
            if (tex) {
                loaded.push(tex);
            }
        }

        if (loaded.length === 0) {
            console.warn('[SheetMusicBackground] 未能加载任何图片');
            return;
        }

        const oldTextures = this.carouselTextures;
        const oldFrames = this._carouselFrames;
        this.carouselTextures = loaded;
        this._singleTallScrollActive = false;
        this._forceVerticalPaging = false;
        if (loaded.length === 1) {
            const { w, h } = this.getTextureSize(loaded[0]);
            const contentH = (w > 0 && h > 0) ? (this.displayWidth * h / w) : 0;
            // 以“宽度适配后是否超过可视高度”为准，避免仅用 h/w 阈值误判导致单图不能滚动
            const threshold = Math.max(1.01, this.singleImageScrollThreshold);
            if (this.enableTallImageAutoPaging && contentH > this.displayHeight * threshold) {
                this._singleTallScrollActive = true;
                this._forceVerticalPaging = true;
                SheetSettingsStore.save({ pageTurnMode: 1 });
            }
        }
        this._carouselFrames = loaded.map((tex) => {
            const sf = new SpriteFrame();
            sf.texture = tex;
            return sf;
        });
        this.updateSingleTallScrollBounds();
        this.carouselIndex = 0;
        this.rebuildSlides(true);
        this.applyCurrentSlideInternal(false);
        this.updateNavAndPageLabel();
        this.scheduleOnce(() => {
            const using = new Set(this.carouselTextures);
            for (const t of oldTextures) {
                if (!t || !t.isValid) continue;
                if (using.has(t)) continue;
                t.destroy();
            }
            for (const sf of oldFrames) {
                if (sf && sf.isValid) sf.destroy();
            }
        }, 0);
    }

    private applyCurrentSlideInternal(animated: boolean) {
        if (!this._slidesRoot) return;
        const n = this.getSlideCountForUI();
        if (n <= 0) return;
        if (this._singleTallScrollActive) {
            this.carouselIndex = Math.max(0, Math.min(this.carouselIndex, this.getTallVirtualPageCount() - 1));
            this.rebuildSlides(false);
            const to = new Vec3(0, this.getTallYByPageIndex(this.carouselIndex), 0);
            if (animated) {
                tween(this._slidesRoot).to(0.16, { position: to }).start();
            } else {
                this._slidesRoot.setPosition(to);
            }
            return;
        }
        this.carouselIndex = Math.max(0, Math.min(this.carouselIndex, n - 1));
        this.rebuildSlides(false);
        const base = this.getRootBasePos(this.carouselIndex);
        if (animated) {
            tween(this._slidesRoot).to(0.16, { position: base }).start();
        } else {
            this._slidesRoot.setPosition(base);
        }
    }

    private applyCurrentSlide() {
        this.applyCurrentSlideInternal(false);
    }

    private clearCarouselTexturesOnly() {
        this._singleTallScrollActive = false;
        this._forceVerticalPaging = false;
        this._singleTallMinY = 0;
        this._singleTallMaxY = 0;
        for (const sf of this._carouselFrames) {
            if (sf && sf.isValid) sf.destroy();
        }
        this._carouselFrames = [];
        for (const t of this.carouselTextures) {
            if (t && t.isValid) {
                t.destroy();
            }
        }
        this.carouselTextures = [];
        this.carouselIndex = 0;
        this.syncSheetRuntimeToStore();
    }

    resetToDefault() {
        if (this.blobRevoke) {
            this.blobRevoke();
            this.blobRevoke = null;
        }
        this.clearCarouselTexturesOnly();
        this.carouselIndex = 0;
        this.rebuildSlides(true);
        this.applyTallScrollForSingleBuiltInImageIfNeeded();
        this.updateNavAndPageLabel();
        this.syncSheetRuntimeToStore();
    }

    onDestroy() {
        const offBtn = (btn: Button | null, handler: () => void) => {
            const n = btn?.node;
            if (n && n.isValid) {
                n.off(Button.EventType.CLICK, handler, this);
            }
        };
        offBtn(this.selectImageButton, this.openImagePicker);
        if (this.chooseImageButton?.node !== this.selectImageButton?.node) {
            offBtn(this.chooseImageButton, this.openImagePicker);
        }
        offBtn(this.prevButton, this.goPrev);
        offBtn(this.nextButton, this.goNext);

        if (this.node && this.node.isValid) {
            this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
            this.node.off(Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
            this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
            this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        }

        if (this.blobRevoke) {
            this.blobRevoke();
            this.blobRevoke = null;
        }
        if (this._maskStencilTexture) {
            this._maskStencilTexture.destroy();
            this._maskStencilTexture = null;
        }
        this.clearCarouselTexturesOnly();
    }
}
