import { BlockInputEvents, Button, Color, Graphics, Label, Node, Tween, UITransform, isValid, tween } from 'cc';
import type { BuiltInBackground } from '../manager/PerformanceAppearanceStore';

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
