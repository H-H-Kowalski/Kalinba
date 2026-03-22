import {
    _decorator,
    Component,
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
} from 'cc';
import { chooseImagesUpTo, isWeChatMiniGame } from '../manager/ChooseImageHelper';
const { ccclass, property } = _decorator;

const DISPLAY_NODE = 'SheetImage';
const MASK_ROOT = 'MaskRoot';
const DOT_ROW = 'DotRow';

/** 指示器：当前页蓝色、其它浅灰（参考常见轮播点样式） */
const DOT_ACTIVE = new Color(59, 130, 221, 255);
const DOT_INACTIVE = new Color(200, 200, 200, 255);

/**
 * 顶部琴谱区域：轮播图；固定尺寸拉伸；仅左下/右下圆角。
 * 浏览器：Canvas 生成蒙版 + Mask(SPRITE_STENCIL)，圆角可靠。
 * 其它环境：MaskRoot + GRAPHICS_STENCIL 手绘路径。
 */
@ccclass('SheetMusicBackground')
export class SheetMusicBackground extends Component {
    @property(SpriteFrame)
    defaultSpriteFrame: SpriteFrame = null;

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
    private _carouselSpriteFrame: SpriteFrame | null = null;
    /** 浏览器 SPRITE_STENCIL 用的蒙版纹理，销毁时释放 */
    private _maskStencilTexture: Texture2D | null = null;

    private _dotRowNode: Node | null = null;

    onLoad() {
        this.setupSizeMaskAndSpriteHost();
    }

    start() {
        this.sprite = this.findDisplaySprite();
        if (!this.sprite) {
            console.warn('[SheetMusicBackground] 需要 Sprite：应在 MaskRoot/SheetImage 子节点上');
            return;
        }

        if (this.defaultSpriteFrame && !this.sprite.spriteFrame) {
            this.sprite.spriteFrame = this.defaultSpriteFrame;
        }

        this.applySpriteStretch();

        if (this.selectImageButton) {
            this.selectImageButton.node.on(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.chooseImageButton) {
            this.chooseImageButton.node.on(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.prevButton) {
            this.prevButton.node.on(Button.EventType.CLICK, this.goPrev, this);
        }
        if (this.nextButton) {
            this.nextButton.node.on(Button.EventType.CLICK, this.goNext, this);
        }

        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

        this.updateNavAndPageLabel();
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
        const n = this.carouselTextures.length;
        if (n > 0) return n;
        if (this.defaultSpriteFrame) return 1;
        if (this.sprite?.spriteFrame) return 1;
        return 0;
    }

    /** 点击圆点跳转到对应张 */
    goToSlide(index: number) {
        const n = this.getSlideCountForUI();
        if (n === 0 || index < 0 || index >= n) return;
        this.carouselIndex = index;
        this.applyCurrentSlide();
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
        while (row.children.length > n) {
            row.children[row.children.length - 1].destroy();
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

        if (sys.isBrowser && typeof document !== 'undefined') {
            this.applyBrowserSpriteStencilMask(maskRoot, mask, w, h, r);
        } else {
            this.applyGraphicsStencilMask(mask, w, h, r);
        }

        if (this._dotRowNode && this._dotRowNode.isValid) {
            const ui = this._dotRowNode.getComponent(UITransform);
            if (ui) ui.setContentSize(w, band);
            this.positionDotRow();
            this._dotRowNode.setSiblingIndex(this.node.children.length - 1);
        }
    }

    /** 浏览器：Canvas 画白底圆角梯形蒙版，SPRITE_STENCIL 按 alpha 裁剪子节点（最稳） */
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

        // 去掉 arc 抗锯齿产生的半透明白边（底部易看成一条白线）
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

    /** 蒙版 alpha 二值化：消除边缘半透明与引擎混合后的白边 */
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

    private applyGraphicsStencilMask(mask: Mask, w: number, h: number, r: number) {
        mask.alphaThreshold = 0.1;
        mask.type = Mask.Type.GRAPHICS_STENCIL;
        mask.spriteFrame = null;
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

    private onTouchStart(e: EventTouch) {
        const p = e.getUILocation();
        this._touchStartX = p.x;
        this._touchStartY = p.y;
    }

    private onTouchEnd(e: EventTouch) {
        if (this.carouselTextures.length <= 1) return;
        const p = e.getUILocation();
        const dx = p.x - this._touchStartX;
        const dy = p.y - this._touchStartY;
        if (Math.abs(dx) < this.swipeThresholdPx || Math.abs(dx) < Math.abs(dy)) return;
        if (dx < 0) this.goNext();
        else this.goPrev();
    }

    goPrev() {
        if (this.carouselIndex <= 0) return;
        this.carouselIndex--;
        this.applyCurrentSlide();
        this.updateNavAndPageLabel();
    }

    goNext() {
        if (this.carouselIndex >= this.carouselTextures.length - 1) return;
        this.carouselIndex++;
        this.applyCurrentSlide();
        this.updateNavAndPageLabel();
    }

    private updateNavAndPageLabel() {
        const n = this.getSlideCountForUI();
        const nCarousel = this.carouselTextures.length;
        if (this.pageLabel) {
            if (n === 0) {
                this.pageLabel.string = '';
            } else {
                this.pageLabel.string = `${this.carouselIndex + 1}/${n}`;
            }
        }
        if (this.prevButton) {
            this.prevButton.interactable = nCarousel > 1 && this.carouselIndex > 0;
        }
        if (this.nextButton) {
            this.nextButton.interactable = nCarousel > 1 && this.carouselIndex < nCarousel - 1;
        }
        this.updateDotIndicators();
    }

    async openImagePicker() {
        if (!isWeChatMiniGame() && !sys.isBrowser) {
            console.warn('[SheetMusicBackground] 当前平台不支持选择本地图片');
            return;
        }

        const res = await chooseImagesUpTo(this.maxImages);
        if (!res.ok || res.urls.length === 0) {
            if (res.errMsg && !String(res.errMsg).includes('未选择')) {
                console.warn('[SheetMusicBackground] 选图失败:', res.errMsg);
            }
            return;
        }

        if (this.blobRevoke) {
            this.blobRevoke();
            this.blobRevoke = null;
        }
        this.blobRevoke = res.revokeAll ?? null;

        await this.loadCarouselFromUrls(res.urls);
    }

    private loadImageFromUrl(url: string): Promise<ImageAsset | null> {
        return new Promise((resolve) => {
            assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (err, asset) => {
                if (!err && asset) {
                    resolve(asset);
                    return;
                }
                assetManager.loadRemote<ImageAsset>(url, { ext: '.jpg' }, (err2, asset2) => {
                    resolve(err2 ? null : asset2!);
                });
            });
        });
    }

    private async loadCarouselFromUrls(urls: string[]) {
        this.clearCarouselTexturesOnly();

        const loaded: Texture2D[] = [];
        for (const url of urls) {
            const img = await this.loadImageFromUrl(url);
            if (img) {
                const tex = new Texture2D();
                tex.image = img;
                loaded.push(tex);
            }
        }

        if (loaded.length === 0) {
            console.warn('[SheetMusicBackground] 未能加载任何图片');
            return;
        }

        this.carouselTextures = loaded;
        this.carouselIndex = 0;
        this.applyCurrentSlide();
        this.updateNavAndPageLabel();
    }

    private applyCurrentSlide() {
        if (!this.sprite || this.carouselTextures.length === 0) return;
        const tex = this.carouselTextures[this.carouselIndex];
        if (!this._carouselSpriteFrame) {
            this._carouselSpriteFrame = new SpriteFrame();
        }
        this._carouselSpriteFrame.texture = tex;
        this.sprite.spriteFrame = this._carouselSpriteFrame;
        this.applySpriteStretch();
    }

    private clearCarouselTexturesOnly() {
        // 必须先解除 Sprite 对轮播纹理的引用，再 destroy，否则下一帧 batcher 读 texture.hash 会报错
        if (this.sprite && this.sprite.spriteFrame === this._carouselSpriteFrame) {
            if (this.defaultSpriteFrame) {
                this.sprite.spriteFrame = this.defaultSpriteFrame;
            } else {
                this.sprite.spriteFrame = null;
            }
        }
        if (this._carouselSpriteFrame) {
            this._carouselSpriteFrame.texture = null;
        }
        for (const t of this.carouselTextures) {
            if (t && t.isValid) {
                t.destroy();
            }
        }
        this.carouselTextures = [];
        this.carouselIndex = 0;
    }

    resetToDefault() {
        if (this.blobRevoke) {
            this.blobRevoke();
            this.blobRevoke = null;
        }
        this.clearCarouselTexturesOnly();
        this._carouselSpriteFrame = null;
        if (this.sprite && this.defaultSpriteFrame) {
            this.sprite.spriteFrame = this.defaultSpriteFrame;
            this.applySpriteStretch();
        }
        this.updateNavAndPageLabel();
    }

    onDestroy() {
        if (this.selectImageButton) {
            this.selectImageButton.node.off(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.chooseImageButton) {
            this.chooseImageButton.node.off(Button.EventType.CLICK, this.openImagePicker, this);
        }
        if (this.prevButton) {
            this.prevButton.node.off(Button.EventType.CLICK, this.goPrev, this);
        }
        if (this.nextButton) {
            this.nextButton.node.off(Button.EventType.CLICK, this.goNext, this);
        }
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);

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
