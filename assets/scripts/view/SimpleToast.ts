import { Color, Label, Node, tween, UIOpacity, UITransform } from 'cc';

/** 在 Canvas 底部短暂提示文案 */
export function showToast(canvas: Node, message: string, duration = 2.2): void {
    if (!canvas?.isValid) return;
    const n = new Node('Toast');
    n.setParent(canvas);
    const ui = n.addComponent(UITransform);
    const pw = canvas.getComponent(UITransform)?.width ?? 800;
    ui.setContentSize(Math.min(720, pw * 0.9), 80);
    const lab = n.addComponent(Label);
    lab.string = message;
    lab.fontSize = 20;
    lab.lineHeight = 26;
    lab.color = Color.WHITE;
    lab.horizontalAlign = Label.HorizontalAlign.CENTER;
    lab.verticalAlign = Label.VerticalAlign.CENTER;
    lab.overflow = Label.Overflow.RESIZE_HEIGHT;
    lab.enableWrapText = true;
    lab.enableOutline = true;
    lab.outlineColor = new Color(0, 0, 0, 200);
    lab.outlineWidth = 2;
    const py = -(canvas.getComponent(UITransform)?.height ?? 720) * 0.5 + 110;
    n.setPosition(0, py, 0);
    const op = n.addComponent(UIOpacity);
    op.opacity = 0;
    tween(op)
        .to(0.12, { opacity: 255 })
        .delay(duration)
        .to(0.2, { opacity: 0 })
        .call(() => {
            if (n.isValid) n.destroy();
        })
        .start();
}
