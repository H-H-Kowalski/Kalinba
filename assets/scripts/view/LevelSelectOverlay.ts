import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, UITransform, Widget } from 'cc';
import { LEVEL_CATALOG } from '../gameplay/LevelCatalog';
import { LevelProgressStore } from '../manager/LevelProgressStore';
const { ccclass } = _decorator;

const PAPER = new Color(255, 243, 207, 255);
const WOOD = new Color(126, 62, 28, 255);
const WOOD_SOFT = new Color(177, 90, 38, 255);
const INK = new Color(91, 57, 31, 255);
const MUTED = new Color(142, 119, 86, 255);
const GOLD = new Color(229, 155, 56, 255);

/** 首页挑战关卡选择页：三章九关，展示本地最佳成绩与真实解锁状态。 */
@ccclass('LevelSelectOverlay')
export class LevelSelectOverlay extends Component {
    private root: Node | null = null;
    private panel: Node | null = null;
    private onSelect: ((levelId: string) => void) | null = null;

    onLoad() {
        const parentUi = this.node.getComponent(UITransform);
        const width = parentUi?.width ?? 1280;
        const height = parentUi?.height ?? 720;
        this.root = new Node('LevelSelectOverlay');
        this.root.setParent(this.node);
        this.root.setSiblingIndex(this.node.children.length - 1);
        this.root.addComponent(UITransform).setContentSize(width, height);
        this.root.addComponent(BlockInputEvents);
        this.root.active = false;
    }

    open(unlockedLevelIds: string[], onSelect: (levelId: string) => void) {
        this.onSelect = onSelect;
        if (!this.root) return;
        this.root.active = true;
        this.root.setSiblingIndex(this.node.children.length - 1);
        this.rebuild(new Set(unlockedLevelIds));
    }

    close() {
        if (this.root) this.root.active = false;
    }

    isOpen(): boolean {
        return !!this.root?.isValid && this.root.active;
    }

    private rebuild(unlocked: Set<string>) {
        if (!this.root) return;
        for (const child of [...this.root.children]) child.destroy();
        this.panel = null;
        const rootUi = this.root.getComponent(UITransform);
        const cw = rootUi?.width ?? 1280;
        const ch = rootUi?.height ?? 720;

        const mask = this.makeShape(this.root, 'Mask', cw, ch, new Color(52, 37, 22, 185), 0);
        mask.addComponent(Button).transition = Button.Transition.NONE;
        mask.on(Button.EventType.CLICK, this.close, this);

        const panelW = Math.min(1120, cw * 0.94);
        const panelH = Math.min(650, ch * 0.92);
        const panel = this.makeShape(this.root, 'LevelSelectPanel', panelW, panelH, PAPER, 28, WOOD_SOFT, 3);
        panel.addComponent(BlockInputEvents);
        this.panel = panel;
        const widget = panel.addComponent(Widget);
        widget.isAlignHorizontalCenter = true;
        widget.isAlignVerticalCenter = true;
        widget.horizontalCenter = 0;
        widget.verticalCenter = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        this.makeLabel(panel, '挑战之路', 38, WOOD, 0, panelH / 2 - 46, panelW - 260, 52);
        this.makeLabel(panel, '跟随落下的数字弹奏 · 获得星星后解锁下一关', 16, MUTED, 0, panelH / 2 - 82, panelW - 260, 28);
        this.makeButton(panel, 'Close', '返回', 94, 48, panelW / 2 - 66, panelH / 2 - 48, () => this.close());

        const gridTop = panelH / 2 - 118;
        const gridBottom = -panelH / 2 + 28;
        const gapX = 16;
        const gapY = 13;
        const cardW = (panelW - 72 - gapX * 2) / 3;
        const cardH = (gridTop - gridBottom - gapY * 2) / 3;
        const startX = -cardW - gapX;

        LEVEL_CATALOG.forEach((level, index) => {
            const col = index % 3;
            const row = Math.floor(index / 3);
            const progress = LevelProgressStore.getLevelProgress(level.id);
            const card = this.makeLevelCard(
                panel,
                level.chapter,
                level.order,
                level.title,
                level.subtitle,
                level.bpm,
                progress?.score ?? 0,
                progress?.stars ?? 0,
                unlocked.has(level.id),
                cardW,
                cardH,
            );
            card.setPosition(startX + col * (cardW + gapX), gridTop - cardH / 2 - row * (cardH + gapY), 0);
            if (unlocked.has(level.id)) {
                const button = card.addComponent(Button);
                button.transition = Button.Transition.SCALE;
                button.zoomScale = 0.97;
                card.on(Button.EventType.CLICK, () => this.onSelect?.(level.id), this);
            }
        });
    }

    private makeLevelCard(
        parent: Node,
        chapter: number,
        order: number,
        title: string,
        subtitle: string,
        bpm: number,
        score: number,
        stars: number,
        unlocked: boolean,
        width: number,
        height: number,
    ): Node {
        const card = this.makeShape(
            parent,
            `Level_${chapter}_${order}`,
            width,
            height,
            unlocked ? new Color(255, 250, 228, 255) : new Color(230, 216, 184, 255),
            20,
            unlocked ? new Color(210, 143, 58, 230) : new Color(174, 153, 116, 190),
            unlocked ? 2.5 : 1.5,
        );

        const tag = this.makeShape(
            card,
            'ChapterTag',
            82,
            30,
            unlocked ? WOOD_SOFT : new Color(160, 143, 111, 255),
            12,
        );
        tag.setPosition(-width / 2 + 54, height / 2 - 26, 0);
        this.makeLabel(tag, `第 ${chapter} 章`, 14, new Color(255, 246, 219, 255), 0, 0, 74, 30);

        this.makeLabel(
            card,
            unlocked ? `${chapter}-${order}` : '未解锁',
            14,
            unlocked ? WOOD_SOFT : MUTED,
            width / 2 - 48,
            height / 2 - 26,
            76,
            28,
        );
        this.makeLabel(card, unlocked ? title : '等待解锁', 24, unlocked ? WOOD : new Color(111, 97, 73, 255), 0, 18, width - 34, 34);
        this.makeLabel(card, unlocked ? subtitle : '先完成上一关并获得星星', 14, unlocked ? INK : MUTED, 0, -13, width - 34, 26);

        const starText = stars > 0 ? `${'★'.repeat(Math.min(3, stars))}${'☆'.repeat(Math.max(0, 3 - stars))}` : '☆☆☆';
        this.makeLabel(card, starText, 19, unlocked ? GOLD : new Color(166, 148, 116, 255), -width / 2 + 58, -height / 2 + 22, 92, 30);
        this.makeLabel(
            card,
            unlocked ? `${bpm} BPM${score > 0 ? `  ·  最高 ${score}` : '  ·  尚未挑战'}` : '♪',
            13,
            unlocked ? MUTED : new Color(165, 146, 112, 255),
            44,
            -height / 2 + 22,
            width - 132,
            28,
            Label.HorizontalAlign.RIGHT,
        );
        return card;
    }

    private makeButton(parent: Node, name: string, text: string, width: number, height: number, x: number, y: number, onClick: () => void) {
        const button = this.makeShape(parent, name, width, height, WOOD, 16, new Color(255, 218, 137, 150), 1.5);
        button.setPosition(x, y, 0);
        this.makeLabel(button, text, 20, new Color(255, 246, 219, 255), 0, 0, width - 10, height);
        const component = button.addComponent(Button);
        component.transition = Button.Transition.SCALE;
        component.zoomScale = 0.94;
        button.on(Button.EventType.CLICK, onClick, this);
        return button;
    }

    private makeShape(parent: Node, name: string, width: number, height: number, fill: Color, radius: number, stroke?: Color, lineWidth = 0): Node {
        const node = new Node(name);
        node.setParent(parent);
        node.addComponent(UITransform).setContentSize(width, height);
        const background = new Node('Background');
        background.setParent(node);
        background.addComponent(UITransform).setContentSize(width, height);
        const graphics = background.addComponent(Graphics);
        graphics.fillColor = fill;
        if (radius > 0) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        else graphics.rect(-width / 2, -height / 2, width, height);
        graphics.fill();
        if (stroke && lineWidth > 0) {
            graphics.strokeColor = stroke;
            graphics.lineWidth = lineWidth;
            if (radius > 0) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
            else graphics.rect(-width / 2, -height / 2, width, height);
            graphics.stroke();
        }
        return node;
    }

    private makeLabel(
        parent: Node,
        text: string,
        fontSize: number,
        color: Color,
        x: number,
        y: number,
        width: number,
        height: number,
        align = Label.HorizontalAlign.CENTER,
    ): Label {
        const node = new Node('Label');
        node.setParent(parent);
        node.addComponent(UITransform).setContentSize(width, height);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.max(fontSize + 4, height);
        label.color = color;
        label.horizontalAlign = align;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    onDestroy() {
        this.panel?.destroy();
        this.root?.destroy();
    }
}
