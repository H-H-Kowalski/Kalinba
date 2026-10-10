import { BlockInputEvents, Button, Color, Director, Graphics, Label, Node, UITransform, director, isValid } from 'cc';
import { getWx } from '../manager/WeChatNative';

type ConsentActions = { exposed: () => void; agree: () => void; disagree: () => void };

/** 小游戏自定义隐私告知。仅真实点击“同意并继续”才上报 agree。 */
export function showPrivacyConsentDialog(contractName: string, actions: ConsentActions): () => void {
    const canvas = director.getScene()?.getChildByName('Canvas');
    const size = canvas?.getComponent(UITransform);
    if (!canvas || !size) throw new Error('隐私弹窗暂时不可用');
    const root = new Node('PrivacyConsentDialog');
    root.setParent(canvas);
    root.setSiblingIndex(canvas.children.length - 1);
    root.addComponent(UITransform).setContentSize(size.width, size.height);
    root.addComponent(BlockInputEvents);
    const shade = root.addComponent(Graphics);
    shade.fillColor = new Color(35, 25, 16, 205);
    shade.rect(-size.width / 2, -size.height / 2, size.width, size.height);
    shade.fill();
    let closed = false;
    let reading = false;
    const onRendered = () => { if (!closed && isValid(root, true)) actions.exposed(); };
    const onDestroyed = () => {
        director.off(Director.EVENT_AFTER_DRAW, onRendered);
        if (!closed) { closed = true; actions.disagree(); }
    };
    root.on(Node.EventType.NODE_DESTROYED, onDestroyed);
    const close = () => {
        if (closed) return;
        closed = true;
        director.off(Director.EVENT_AFTER_DRAW, onRendered);
        if (isValid(root, true)) root.destroy();
    };
    try {
        const width = Math.min(780, size.width * 0.92);
        const height = Math.min(460, size.height * 0.92);
        const panel = new Node('Panel');
        panel.setParent(root);
        panel.addComponent(UITransform).setContentSize(width, height);
        const graphics = panel.addComponent(Graphics);
        graphics.fillColor = new Color(255, 243, 216, 255);
        graphics.roundRect(-width / 2, -height / 2, width, height, 22);
        graphics.fill();
        const label = (name: string, text: string, y: number, h: number, font: number) => {
            const n = new Node(name);
            n.setParent(panel); n.setPosition(0, y);
            n.addComponent(UITransform).setContentSize(width - 52, h);
            const l = n.addComponent(Label);
            l.string = text; l.fontSize = font; l.lineHeight = font + 8;
            l.color = new Color(91, 57, 31, 255);
            l.horizontalAlign = Label.HorizontalAlign.CENTER;
            l.verticalAlign = Label.VerticalAlign.CENTER;
            l.enableWrapText = true; l.overflow = Label.Overflow.SHRINK;
            return l;
        };
        const button = (name: string, text: string, x: number, y: number, w: number, onClick: () => void) => {
            const n = new Node(name); n.setParent(panel); n.setPosition(x, y);
            n.addComponent(UITransform).setContentSize(w, 54);
            const g = n.addComponent(Graphics);
            g.fillColor = new Color(224, 185, 117, 255);
            g.roundRect(-w / 2, -27, w, 54, 12); g.fill();
            const textNode = new Node('Text'); textNode.setParent(n);
            textNode.addComponent(UITransform).setContentSize(w - 12, 48);
            const l = textNode.addComponent(Label); l.string = text; l.fontSize = 21; l.lineHeight = 26;
            l.color = new Color(91, 57, 31, 255);
            l.horizontalAlign = Label.HorizontalAlign.CENTER; l.verticalAlign = Label.VerticalAlign.CENTER;
            l.overflow = Label.Overflow.SHRINK;
            const b = n.addComponent(Button); b.transition = Button.Transition.SCALE;
            n.on(Button.EventType.CLICK, () => { if (!closed) onClick(); });
            return b;
        };
        label('Title', '选图隐私保护提示', height * 0.37, 44, 28);
        label('Purpose', '为替换曲谱，需要访问你选择的相册或相机图片。\n所选图片将上传至微信云服务进行内容安全检测。\n不同意也可以继续使用弹奏等其他功能。', height * 0.12, height * 0.3, 21);
        label('ContractName', contractName, -height * 0.10, 38, 20);
        const notice = label('Notice', '请阅读隐私指引后决定是否同意。', -height * 0.305, 22, 17);
        let agreeButton: Button;
        button('ReadPrivacyContract', '查看隐私指引', 0, -height * 0.21, width - 100, () => {
            if (reading) return;
            reading = true;
            agreeButton.interactable = false;
            const done = (ok: boolean) => {
                if (closed || !isValid(root, true)) return;
                reading = false;
                agreeButton.interactable = ok;
                notice.string = ok ? '请阅读隐私指引后决定是否同意。' : '隐私指引暂时无法打开，请重试或选择不同意。';
            };
            try {
                const wx = getWx() as { openPrivacyContract?: (o: { success: () => void; fail: () => void }) => void };
                if (!wx?.openPrivacyContract) return done(false);
                wx.openPrivacyContract({ success: () => done(true), fail: () => done(false) });
            } catch { done(false); }
        });
        const buttonWidth = (width - 76) / 2;
        button('Disagree', '不同意', -(buttonWidth + 20) / 2, -height * 0.4, buttonWidth, actions.disagree);
        agreeButton = button('Agree', '同意并继续', (buttonWidth + 20) / 2, -height * 0.4, buttonWidth, actions.agree);
        // 等待实际绘制后再告知微信弹窗已展示，不在注册监听时假报展示/同意。
        director.once(Director.EVENT_AFTER_DRAW, onRendered);
        return close;
    } catch (error) { close(); throw error; }
}
