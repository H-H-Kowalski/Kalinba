import { BlockInputEvents, Button, Color, Graphics, Label, Node, Tween, UITransform, Sprite, SpriteFrame, Texture2D, ImageAsset, assetManager, isValid, tween } from 'cc';
import type { BuiltInBackground } from '../manager/PerformanceAppearanceStore';
import { getWx } from '../manager/WeChatNative';
import { ImageExportError } from '../manager/PerformanceImageExport';
import { SHARE_POSTER_COLORS, SHARE_POSTER_ART, type SharePosterStyle } from '../manager/PerformanceSharePoster';
import type { ShareCodeEnvironment } from '../manager/PerformanceCloudService';

function canvasFor(owner: Node): Node {
    return owner.scene?.getChildByName('Canvas') ?? owner;
}

function label(parent: Node, text: string, y: number, width = 520, fontSize = 22): Label {
    const node = new Node('Label'); node.layer = parent.layer; node.setParent(parent); node.setPosition(0, y);
    node.addComponent(UITransform).setContentSize(width, 44);
    const value = node.addComponent(Label);
    value.string = text; value.fontSize = fontSize; value.lineHeight = fontSize + 6;
    value.color = new Color(92, 54, 29, 255);
    value.horizontalAlign = Label.HorizontalAlign.CENTER; value.verticalAlign = Label.VerticalAlign.CENTER;
    value.overflow = Label.Overflow.SHRINK;
    return value;
}

function panel(parent: Node, name: string, width: number, height: number): Node {
    const node = new Node(name); node.layer = parent.layer; node.setParent(parent);
    node.addComponent(UITransform).setContentSize(width, height);
    const g = node.addComponent(Graphics); g.fillColor = new Color(255, 246, 217, 255);
    g.roundRect(-width / 2, -height / 2, width, height, 18); g.fill();
    node.addComponent(BlockInputEvents);
    return node;
}

/** 持续至请求结束的局部 loading；不会用全屏遮罩锁住弹奏或返回。 */
export function showBusyIndicator(owner: Node, message: string): { update(text: string): void; close(): void } {
    const canvas = canvasFor(owner);
    const root = panel(canvas, 'AppearanceLoading', 460, 68);
    root.setPosition(0, -(canvas.getComponent(UITransform)?.height ?? 720) / 2 + 90);
    const text = label(root, message, 0, 370, 20); text.node.setPosition(20, 0);
    const spinner = new Node('Spinner'); spinner.layer = root.layer; spinner.setParent(root); spinner.setPosition(-198, 0);
    const g = spinner.addComponent(Graphics); g.strokeColor = new Color(139, 68, 31, 255); g.lineWidth = 3;
    g.arc(0, 0, 12, 0, Math.PI * 1.5, false); g.stroke();
    tween(spinner).by(0.8, { angle: -360 }).repeatForever().start();
    const close = () => {
        owner.off(Node.EventType.NODE_DESTROYED, close);
        Tween.stopAllByTarget(spinner);
        if (isValid(root, true)) { root.active = false; root.destroy(); }
    };
    owner.once(Node.EventType.NODE_DESTROYED, close);
    return { update: message => { if (isValid(text, true)) text.string = message; }, close };
}

export function showBackgroundChoices(owner: Node, current: BuiltInBackground, hasImages: boolean,
    actions: { pick(): void; select(value: BuiltInBackground): void; clear(): void }): () => void {
    const canvas = canvasFor(owner);
    const root = new Node('BackgroundChoices'); root.layer = canvas.layer; root.setParent(canvas);
    const size = canvas.getComponent(UITransform);
    root.addComponent(UITransform).setContentSize(size?.width ?? 1280, size?.height ?? 720);
    root.addComponent(BlockInputEvents);
    const shade = root.addComponent(Graphics); shade.fillColor = new Color(35, 25, 16, 175);
    shade.rect(-(size?.width ?? 1280) / 2, -(size?.height ?? 720) / 2, size?.width ?? 1280, size?.height ?? 720); shade.fill();
    const card = panel(root, 'Panel', 650, 440);
    const close = () => { if (isValid(root, true)) { root.active = false; root.destroy(); } };
    label(card, '琴谱图片', 173, 580, 30);
    label(card, '图片和文案仅在本次游戏中保留', 125, 580, 18);
    const button = (name: string, text: string, x: number, y: number, action: () => void) => {
        const node = panel(card, name, 270, 62); node.setPosition(x, y);
        const g = node.getComponent(Graphics)!; g.fillColor = new Color(233, 207, 157, 255);
        g.roundRect(-135, -31, 270, 62, 14); g.fill();
        label(node, text, 0, 250);
        node.addComponent(Button).transition = Button.Transition.SCALE;
        node.on(Button.EventType.CLICK, () => { close(); action(); });
    };
    button('Birthday', `${!hasImages && current === 'birthday' ? '✓ ' : ''}生日快乐`, -145, 55, () => actions.select('birthday'));
    button('Share', `${!hasImages && current === 'share' ? '✓ ' : ''}分享歌曲背景`, 145, 55, () => actions.select('share'));
    button('ChooseImages', '从相册选择', -145, -32, actions.pick);
    button('ClearImages', '清除自选图片', 145, -32, actions.clear);
    label(card, '清除后恢复当前默认底图', -94, 580, 17);
    button('Close', '取消', 0, -163, () => {});
    return close;
}

/** 好友试听始终提供主动退出入口，不依赖尾定时器才可继续操作。 */
export function showPlaybackNotice(owner: Node, stop: () => void): () => void {
    const canvas = canvasFor(owner);
    const root = panel(canvas, 'SharedPlaybackNotice', 520, 68);
    root.setPosition(0, -(canvas.getComponent(UITransform)?.height ?? 720) / 2 + 90);
    const text = label(root, '正在播放好友演奏', 0, 320, 20); text.node.setPosition(-80, 0);
    const button = panel(root, 'StopPlayback', 138, 50); button.setPosition(175, 0);
    label(button, '停止试听', 0, 128, 20);
    button.addComponent(Button).transition = Button.Transition.SCALE;
    button.on(Button.EventType.CLICK, stop);
    return () => { if (isValid(root, true)) { root.active = false; root.destroy(); } };
}

/** 预览和换样式都不会写入相册，只有用户明确点保存才交回最终图片。 */
export function confirmShareImageSave(owner: Node, initialPath: string, initialStyle: SharePosterStyle,
    render: (style: SharePosterStyle) => Promise<string | undefined>, isCurrent: () => boolean, environment: ShareCodeEnvironment = 'release'): {
        promise: Promise<{ filePath: string; style: SharePosterStyle } | null>; cancel(): void
    } {
    let cancel = () => {};
    const promise = new Promise<{ filePath: string; style: SharePosterStyle } | null>((resolve, reject) => {
        const canvas = canvasFor(owner);
        const size = canvas.getComponent(UITransform);
        const root = new Node('ShareImageConfirmation'); root.layer = canvas.layer; root.setParent(canvas);
        root.addComponent(UITransform).setContentSize(size?.width ?? 1280, size?.height ?? 720);
        root.addComponent(BlockInputEvents);
        const shade = root.addComponent(Graphics); shade.fillColor = new Color(35, 25, 16, 175);
        shade.rect(-(size?.width ?? 1280) / 2, -(size?.height ?? 720) / 2, size?.width ?? 1280, size?.height ?? 720); shade.fill();
        const card = panel(root, 'Panel', 960, 600);
        const title = label(card, '分享图片', 255, 880, 30);
        title.color = new Color(75, 48, 36, 255); title.isBold = true;
        const imageNode = new Node('PosterPreview'); imageNode.layer = card.layer; imageNode.setParent(card);
        imageNode.setPosition(-270, -5); imageNode.addComponent(UITransform).setContentSize(330, 440);
        const sprite = imageNode.addComponent(Sprite); sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        const status = label(card, '正在加载预览…', -255, 390, 18); status.node.setPosition(-270, -255);
        status.color = new Color(143, 122, 101, 255);
        const heading = (text: string, y: number) => {
            const value = label(card, text, y, 390, 22); value.node.setPosition(200, y);
            value.color = new Color(78, 50, 33, 255); value.isBold = true;
        };
        heading('背景色', 182); heading('拇指琴图案', 3);
        const hint = label(card, environment === 'release' ? '样式仅在本次游戏中保留'
            : `${environment === 'develop' ? '开发版' : '体验版'}测试码，需有测试权限`, -101, 390, 16);
        hint.node.setPosition(200, -101); hint.color = new Color(150, 127, 103, 255);
        let done = false, revision = 0, busy = true;
        let filePath = initialPath, style = { ...initialStyle };
        let texture: Texture2D | undefined, frame: SpriteFrame | undefined, image: ImageAsset | undefined;
        let loadTimer: ReturnType<typeof setTimeout> | undefined;
        let previewTimer: ReturnType<typeof setTimeout> | undefined;
        const controls: Button[] = [];
        const selectedLabels: Array<{ value: Label; text: string; matches(): boolean }> = [];
        const release = () => {
            sprite.spriteFrame = null;
            frame?.destroy(); texture?.destroy();
            if (image) assetManager.releaseAsset(image);
            frame = undefined; texture = undefined; image = undefined;
        };
        const finish = (save: boolean, error?: Error) => {
            if (done) return;
            done = true; revision++;
            clearTimeout(timer); clearTimeout(loadTimer); clearTimeout(previewTimer);
            owner.off(Node.EventType.NODE_DESTROYED, cancel);
            release();
            if (isValid(root, true)) { root.active = false; root.destroy(); }
            if (error) reject(error); else resolve(save ? { filePath, style: { ...style } } : null);
        };
        cancel = () => finish(false);
        const timer = setTimeout(cancel, 300000);
        owner.once(Node.EventType.NODE_DESTROYED, cancel);
        const current = () => { if (done) return false; if (!isCurrent()) { cancel(); return false; } return true; };
        const updateControls = () => {
            controls.forEach(control => control.interactable = !busy);
            selectedLabels.forEach(item => {
                const selected = item.matches(); item.value.string = `${selected ? '✓ ' : ''}${item.text}`;
                item.value.isBold = selected;
            });
        };
        const button = (name: string, text: string, x: number, y: number, action: () => void, width = 180, tracked = true) => {
            const node = panel(card, name, width, 56); node.setPosition(x, y);
            const value = label(node, text, 0, width - 12, 20);
            value.color = new Color(123, 85, 56, 255);
            const control = node.addComponent(Button); control.transition = Button.Transition.SCALE;
            if (tracked) controls.push(control);
            node.on(Button.EventType.CLICK, () => { if (current() && control.interactable) action(); });
            return { control, value };
        };
        const display = (path: string, nextStyle: SharePosterStyle, token: number) => {
            clearTimeout(loadTimer);
            loadTimer = setTimeout(() => { if (current() && token === revision) finish(false, new ImageExportError('图片预览加载超时，请稍后重试')); }, 10000);
            try { assetManager.loadRemote<ImageAsset>(path, { ext: '.jpg' }, (error, loaded) => {
                if (!current() || token !== revision) { if (loaded) assetManager.releaseAsset(loaded); return; }
                clearTimeout(loadTimer);
                if (error || !loaded) { finish(false, new ImageExportError('图片预览加载失败，请稍后重试')); return; }
                release(); image = loaded; texture = new Texture2D(); texture.image = loaded;
                frame = new SpriteFrame(); frame.texture = texture; sprite.spriteFrame = frame;
                filePath = path; style = { ...nextStyle }; busy = false;
                status.string = '可点击放大查看'; updateControls();
            }); } catch { finish(false, new ImageExportError('图片预览加载失败，请稍后重试')); }
        };
        const change = async (nextStyle: SharePosterStyle) => {
            if (!current() || busy) return;
            busy = true; updateControls(); status.string = '正在生成新预览…';
            const token = ++revision;
            try {
                const path = await render(nextStyle);
                if (!current() || token !== revision) return;
                if (!path) throw new ImageExportError('图片生成失败，请重试');
                display(path, nextStyle, token);
            } catch {
                if (!current() || token !== revision) return;
                busy = false; status.string = '更换失败，保留原图，请重试'; updateControls();
            }
        };
        SHARE_POSTER_COLORS.forEach((choice, index) => {
            const control = button(`Color-${choice.id}`, choice.name, index % 2 === 0 ? 100 : 300, index < 2 ? 130 : 64,
                () => { void change({ ...style, color: choice.id }); });
            const swatch = control.control.node.getComponent(Graphics)!;
            swatch.fillColor = new Color(choice.background); swatch.roundRect(-90, -28, 180, 56, 18); swatch.fill();
            control.value.color = new Color(choice.ink);
            selectedLabels.push({ value: control.value, text: choice.name, matches: () => style.color === choice.id });
        });
        SHARE_POSTER_ART.forEach((choice, index) => {
            const control = button(`Art-${choice.id}`, choice.name, index === 0 ? 100 : 300, -44,
                () => { void change({ ...style, art: choice.id }); });
            selectedLabels.push({ value: control.value, text: choice.name, matches: () => style.art === choice.id });
        });
        const preview = () => {
            if (!current() || busy) return;
            const api = getWx() as any;
            if (!api?.previewImage) { status.string = '当前微信不支持放大预览'; return; }
            busy = true; updateControls();
            const token = revision;
            previewTimer = setTimeout(() => { if (current() && token === revision) { busy = false; status.string = '放大预览超时，可重试'; updateControls(); } }, 10000);
            const finishPreview = (failed: boolean) => {
                if (!current() || token !== revision) return;
                clearTimeout(previewTimer); busy = false; status.string = failed ? '放大预览失败，可重试' : '可点击放大查看'; updateControls();
            };
            try { api.previewImage({ current: filePath, urls: [filePath], showmenu: false,
                success: () => finishPreview(false), fail: () => finishPreview(true) }); }
            catch { finishPreview(true); }
        };
        button('PreviewImage', '放大预览', 100, -166, preview);
        const save = button('SaveImage', '保存到相册', 300, -166, () => finish(true));
        const saveBackground = save.control.node.getComponent(Graphics)!;
        saveBackground.fillColor = new Color(174, 91, 40, 255);
        saveBackground.roundRect(-90, -28, 180, 56, 18); saveBackground.fill();
        save.value.color = new Color(255, 249, 235, 255); save.value.isBold = true;
        const dismiss = button('Cancel', '取消', 200, -235, cancel, 380, false);
        dismiss.value.fontSize = 18; dismiss.value.color = new Color(147, 129, 111, 255);
        imageNode.on(Node.EventType.TOUCH_END, preview);
        updateControls(); display(initialPath, style, ++revision);
    });
    return { promise, cancel: () => cancel() };
}
