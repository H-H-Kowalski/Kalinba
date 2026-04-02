import {
    BlockInputEvents,
    Button,
    Color,
    Event,
    Graphics,
    Label,
    Node,
    UITransform,
    Widget,
} from 'cc';
import { copyTextToClipboard } from '../manager/ClipboardHelper';
import { showToast } from './SimpleToast';

export interface AboutContactInfo {
    wechat: string;
    email: string;
}

const DEFAULT_INFO: AboutContactInfo = {
    wechat: 'hhkowalski',
    email: '1617105836@qq.com',
};

/** 在 Canvas 上显示关于 / 联系方式弹层，支持分项复制 */
export function showAboutContactPanel(canvas: Node, info: AboutContactInfo = DEFAULT_INFO): void {
    if (!canvas?.isValid) return;

    const canvasUi = canvas.getComponent(UITransform);
    const cw = canvasUi?.width ?? 1280;
    const ch = canvasUi?.height ?? 720;

    const existing = canvas.getChildByName('AboutContactRoot');
    if (existing?.isValid) existing.destroy();

    const root = new Node('AboutContactRoot');
    root.setParent(canvas);
    root.setSiblingIndex(99999);
    const rootUi = root.addComponent(UITransform);
    rootUi.setContentSize(cw, ch);

    const mask = new Node('Mask');
    mask.setParent(root);
    const maskUi = mask.addComponent(UITransform);
    maskUi.setContentSize(cw, ch);
    const maskG = mask.addComponent(Graphics);
    maskG.fillColor = new Color(0, 0, 0, 170);
    maskG.rect(-cw * 0.5, -ch * 0.5, cw, ch);
    maskG.fill();
    const maskBtn = mask.addComponent(Button);
    maskBtn.transition = Button.Transition.NONE;

    const panel = new Node('Panel');
    panel.setParent(root);
    const panelUi = panel.addComponent(UITransform);
    const panelW = Math.min(560, cw * 0.85);
    const panelH = 320;
    panelUi.setContentSize(panelW, panelH);
    panel.addComponent(BlockInputEvents);

    const panelBg = panel.addComponent(Graphics);
    panelBg.fillColor = new Color(32, 36, 44, 250);
    const hw = panelW * 0.5;
    const hh = panelH * 0.5;
    panelBg.roundRect(-hw, -hh, panelW, panelH, 12);
    panelBg.fill();

    const closeRoot = () => {
        if (root.isValid) root.destroy();
    };

    maskBtn.node.on(Button.EventType.CLICK, closeRoot);

    const title = new Node('Title');
    title.setParent(panel);
    const titleLab = title.addComponent(Label);
    titleLab.string = '关于作者';
    titleLab.fontSize = 26;
    titleLab.color = Color.WHITE;
    titleLab.horizontalAlign = Label.HorizontalAlign.CENTER;
    title.addComponent(UITransform).setContentSize(panelW - 40, 40);
    title.setPosition(0, hh - 36, 0);

    const makeRow = (y: number, lineText: string, copyValue: string) => {
        const row = new Node('Row');
        row.setParent(panel);
        row.addComponent(UITransform).setContentSize(panelW - 40, 52);
        row.setPosition(0, y, 0);

        const textNode = new Node('Text');
        textNode.setParent(row);
        textNode.setPosition(-hw + 24, 0, 0);
        const textUi = textNode.addComponent(UITransform);
        textUi.setContentSize(Math.max(120, panelW - 148), 48);
        textUi.anchorX = 0;
        textUi.anchorY = 0.5;
        const lab = textNode.addComponent(Label);
        lab.string = lineText;
        lab.fontSize = 20;
        lab.lineHeight = 26;
        lab.color = new Color(220, 224, 230, 255);
        lab.horizontalAlign = Label.HorizontalAlign.LEFT;
        lab.verticalAlign = Label.VerticalAlign.CENTER;
        lab.overflow = Label.Overflow.SHRINK;

        const btnNode = new Node('CopyBtn');
        btnNode.setParent(row);
        btnNode.setPosition(panelW * 0.5 - 24 - 44, 0, 0);
        btnNode.addComponent(UITransform).setContentSize(88, 44);
        const btnBg = btnNode.addComponent(Graphics);
        btnBg.fillColor = new Color(70, 130, 200, 255);
        btnBg.roundRect(-44, -22, 88, 44, 8);
        btnBg.fill();
        const btn = btnNode.addComponent(Button);
        btn.transition = Button.Transition.NONE;
        const btnLabN = new Node('Lbl');
        btnLabN.setParent(btnNode);
        const bl = btnLabN.addComponent(Label);
        bl.string = '复制';
        bl.fontSize = 20;
        bl.color = Color.WHITE;
        btnLabN.addComponent(UITransform).setContentSize(80, 40);

        btn.node.on(Button.EventType.CLICK, async (e: Event) => {
            e.propagationStopped = true;
            const ok = await copyTextToClipboard(copyValue);
            showToast(canvas, ok ? '已复制到剪贴板' : '复制失败，请长按文字手动复制', ok ? 1.8 : 2.4);
        });
    };

    makeRow(hh - 110, `作者微信：${info.wechat}`, info.wechat);
    makeRow(hh - 190, `邮箱：${info.email}`, info.email);

    const closeBtnNode = new Node('CloseBtn');
    closeBtnNode.setParent(panel);
    const closeUi = closeBtnNode.addComponent(UITransform);
    closeUi.setContentSize(120, 44);
    closeBtnNode.setPosition(0, -hh + 52, 0);
    const cg = closeBtnNode.addComponent(Graphics);
    cg.fillColor = new Color(90, 95, 105, 255);
    cg.roundRect(-60, -22, 120, 44, 8);
    cg.fill();
    const cbtn = closeBtnNode.addComponent(Button);
    cbtn.transition = Button.Transition.NONE;
    const closeLabN = new Node('CL');
    closeLabN.setParent(closeBtnNode);
    const closeLab = closeLabN.addComponent(Label);
    closeLab.string = '关闭';
    closeLab.fontSize = 22;
    closeLab.color = Color.WHITE;
    closeLabN.addComponent(UITransform).setContentSize(100, 40);
    cbtn.node.on(Button.EventType.CLICK, (e: Event) => {
        e.propagationStopped = true;
        closeRoot();
    });

    const w = panel.addComponent(Widget);
    w.isAlignHorizontalCenter = true;
    w.isAlignVerticalCenter = true;
    w.horizontalCenter = 0;
    w.verticalCenter = 0;
    w.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
}
