import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, UITransform, Widget } from 'cc';
import type { LevelDefinition, LevelResult } from '../gameplay/LevelTypes';
const { ccclass } = _decorator;

type Action = () => void;

/**
 * 不依赖场景预制体的轻量演奏 HUD。
 * 首发阶段用代码绘制，保证现有 playscene 打开即有节拍器、成长记录和挑战 HUD；
 * 视觉资源确定后可在不动玩法逻辑的情况下替换为正式 Prefab。
 */
@ccclass('PracticeOverlay')
export class PracticeOverlay extends Component {
    private root: Node | null = null;
    private metronomeButton: Label | null = null;
    private metronomeButtonNode: Node | null = null;
    private feedbackLabel: Label | null = null;
    private targetLabel: Label | null = null;
    private progressButton: Label | null = null;
    private resultMask: Node | null = null;
    private resultPanel: Node | null = null;
    private resultLabel: Label | null = null;
    private resultCardRoot: Node | null = null;
    private resultTitleLabel: Label | null = null;
    private resultStarsLabel: Label | null = null;
    private resultScoreLabel: Label | null = null;
    private resultRankLabel: Label | null = null;
    private resultEncouragementLabel: Label | null = null;
    private resultStatLabels: Label[] = [];
    private panelActionLabel: Label | null = null;
    private primaryActionButton: Node | null = null;
    private secondaryActionButton: Node | null = null;
    private shareActionButton: Node | null = null;
    private freeControls: Node[] = [];
    private onMetronome: Action | null = null;
    private onRetry: Action | null = null;
    private onProgress: Action | null = null;
    private onTempoDown: Action | null = null;
    private onTempoUp: Action | null = null;
    private onExitChallenge: Action | null = null;
    private onExitFree: Action | null = null;
    private onShareResult: ((result: LevelResult, levelTitle: string, rankTitle: string) => void) | null = null;
    private panelAction: Action | null = null;

    onLoad() {
        this.root = new Node('PracticeOverlay');
        this.root.setParent(this.node);
        this.root.setSiblingIndex(this.node.children.length - 1);
        const parentUi = this.node.getComponent(UITransform);
        this.root.addComponent(UITransform).setContentSize(parentUi?.width ?? 1280, parentUi?.height ?? 720);

        this.makeRailButton('FreeExitButton', '←', 12, 27, () => this.onExitFree?.());
        const rhythm = this.makeRailButton('MetronomeQuickButton', '节奏', 76, 17, () => this.onMetronome?.());
        this.metronomeButton = rhythm.label;
        this.metronomeButtonNode = rhythm.node;

        this.resultMask = this.makeResultMask();
        this.resultPanel = this.makePanel();
        this.resultMask.active = false;
        this.resultPanel.active = false;
    }

    bind(actions: { onMetronome: Action; onRetry: Action; onProgress: Action; onTempoDown: Action; onTempoUp: Action; onExitChallenge: Action; onExitFree: Action; onShareResult: (result: LevelResult, levelTitle: string, rankTitle: string) => void }) {
        this.onMetronome = actions.onMetronome;
        this.onRetry = actions.onRetry;
        this.onProgress = actions.onProgress;
        this.onTempoDown = actions.onTempoDown;
        this.onTempoUp = actions.onTempoUp;
        this.onExitChallenge = actions.onExitChallenge;
        this.onExitFree = actions.onExitFree;
        this.onShareResult = actions.onShareResult;
    }

    setChallengeMode(active: boolean) {
        for (const control of this.freeControls) {
            if (control?.isValid) control.active = !active;
        }
        if (!active) this.hideResult();
    }

    setMetronome(running: boolean, _bpm: number) {
        if (this.metronomeButton) {
            this.metronomeButton.string = '节奏';
            this.metronomeButton.color = running ? new Color(58, 111, 45, 255) : new Color(58, 43, 27, 255);
        }
        if (this.metronomeButtonNode) this.drawRailButton(this.metronomeButtonNode, running);
    }

    setChallengeIdle() {
        if (this.feedbackLabel) this.feedbackLabel.string = '自由弹奏';
        if (this.targetLabel) this.targetLabel.string = '';
    }

    setChallengeStarted(level: LevelDefinition) {
        if (this.feedbackLabel) this.feedbackLabel.string = `《${level.title}》 · ${level.bpm} BPM`;
        if (this.targetLabel) this.targetLabel.string = '预备拍…';
    }

    setJudgeFeedback(text: string, targetText: string) {
        if (this.feedbackLabel) this.feedbackLabel.string = text;
        if (this.targetLabel) this.targetLabel.string = targetText;
    }

    showResult(result: LevelResult, levelTitle: string, actionText = '再练一次') {
        if (!this.resultPanel || !this.resultCardRoot) return;
        this.root?.setSiblingIndex(this.node.children.length - 1);
        const rankTitle = PracticeOverlay.getRankTitle(result);
        const stars = `${'★'.repeat(result.stars)}${'☆'.repeat(3 - result.stars)}`;
        this.resultCardRoot.active = true;
        if (this.resultLabel) this.resultLabel.node.active = false;
        if (this.resultTitleLabel) this.resultTitleLabel.string = `《${levelTitle}》挑战完成`;
        if (this.resultStarsLabel) this.resultStarsLabel.string = stars;
        if (this.resultScoreLabel) this.resultScoreLabel.string = `${result.score} 分\n最高连击 ${result.maxCombo}`;
        if (this.resultRankLabel) this.resultRankLabel.string = rankTitle;
        if (this.resultEncouragementLabel) this.resultEncouragementLabel.string = PracticeOverlay.getEncouragement(result);
        const stats = [
            `PERFECT  完美     ${result.perfectCount}`,
            `GOOD  良好          ${result.goodCount}`,
            `BAD  偏差             ${result.badCount ?? result.wrongCount}`,
            `MISS  漏音           ${result.missCount}`,
        ];
        this.resultStatLabels.forEach((label, index) => { label.string = stats[index] ?? ''; });
        if (this.panelActionLabel) this.panelActionLabel.string = actionText;
        if (this.secondaryActionButton) this.secondaryActionButton.active = true;
        if (this.shareActionButton) this.shareActionButton.active = true;
        this.primaryActionButton?.setPosition(220, -205, 0);
        this.panelAction = () => this.onRetry?.();
        this.shareActionButton?.off(Button.EventType.CLICK);
        this.shareActionButton?.on(Button.EventType.CLICK, () => this.onShareResult?.(result, levelTitle, rankTitle), this);
        if (this.resultMask) this.resultMask.active = true;
        this.resultPanel.active = true;
    }

    showProgress(content: string) {
        if (!this.resultPanel || !this.resultLabel) return;
        this.root?.setSiblingIndex(this.node.children.length - 1);
        if (this.resultCardRoot) this.resultCardRoot.active = false;
        if (this.resultTitleLabel) this.resultTitleLabel.string = '成长记录';
        this.resultLabel.node.active = true;
        this.resultLabel.string = content;
        if (this.panelActionLabel) this.panelActionLabel.string = '关闭';
        if (this.secondaryActionButton) this.secondaryActionButton.active = false;
        if (this.shareActionButton) this.shareActionButton.active = false;
        this.primaryActionButton?.setPosition(0, -205, 0);
        this.panelAction = () => this.hideResult();
        if (this.resultMask) this.resultMask.active = true;
        this.resultPanel.active = true;
    }

    hideResult() {
        if (this.resultMask) this.resultMask.active = false;
        if (this.resultPanel) this.resultPanel.active = false;
    }

    private makeResultMask(): Node {
        const parentUi = this.node.getComponent(UITransform);
        const width = parentUi?.width ?? 1280;
        const height = parentUi?.height ?? 720;
        const mask = new Node('ChallengeResultMask');
        mask.setParent(this.root!);
        mask.addComponent(UITransform).setContentSize(width, height);
        mask.addComponent(BlockInputEvents);
        const graphics = mask.addComponent(Graphics);
        graphics.fillColor = new Color(48, 33, 20, 205);
        graphics.rect(-width / 2, -height / 2, width, height);
        graphics.fill();
        return mask;
    }

    private makePill(name: string, text: string, width: number, height: number, top: number, right: number, onClick?: Action, interactive = true): Label {
        const n = new Node(name);
        n.setParent(this.root!);
        const ui = n.addComponent(UITransform);
        ui.setContentSize(width, height);
        const widget = n.addComponent(Widget);
        widget.isAlignTop = true;
        widget.top = top;
        widget.isAlignRight = true;
        widget.right = right;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        const background = new Node('Background');
        background.setParent(n);
        background.addComponent(UITransform).setContentSize(width, height);
        const graphics = background.addComponent(Graphics);
        graphics.fillColor = interactive ? new Color(139, 63, 27, 235) : new Color(91, 75, 52, 215);
        graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(22, height / 2));
        graphics.fill();
        graphics.strokeColor = interactive ? new Color(255, 222, 143, 150) : new Color(255, 233, 181, 95);
        graphics.lineWidth = 1.5;
        graphics.roundRect(-width / 2, -height / 2, width, height, Math.min(22, height / 2));
        graphics.stroke();
        const textNode = new Node('Label');
        textNode.setParent(n);
        textNode.addComponent(UITransform).setContentSize(width - 10, height);
        const label = textNode.addComponent(Label);
        label.string = text;
        label.fontSize = interactive ? 25 : 21;
        label.lineHeight = height;
        label.color = new Color(255, 246, 224, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        if (interactive && onClick) {
            n.addComponent(Button);
            n.on(Button.EventType.CLICK, onClick, this);
        }
        this.freeControls.push(n);
        return label;
    }

    private makeRailButton(name: string, text: string, top: number, fontSize: number, onClick: Action): { node: Node; label: Label } {
        const node = new Node(name);
        node.setParent(this.root!);
        node.addComponent(UITransform).setContentSize(54, 54);
        const widget = node.addComponent(Widget);
        widget.isAlignLeft = true;
        widget.left = 8;
        widget.isAlignTop = true;
        widget.top = top;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        node.addComponent(Graphics);
        this.drawRailButton(node, false);
        const label = this.makePanelLabel(node, 'Label', text, 0, 0, 48, 48, fontSize, new Color(58, 43, 27, 255));
        label.lineHeight = fontSize + 4;
        const button = node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.94;
        node.on(Button.EventType.CLICK, onClick, this);
        this.freeControls.push(node);
        return { node, label };
    }

    private drawRailButton(node: Node, active: boolean) {
        const graphics = node.getComponent(Graphics);
        if (!graphics) return;
        graphics.clear();
        graphics.fillColor = active ? new Color(218, 242, 194, 250) : new Color(255, 241, 200, 245);
        graphics.circle(0, 0, 27);
        graphics.fill();
        graphics.strokeColor = active ? new Color(77, 130, 55, 240) : new Color(139, 68, 31, 210);
        graphics.lineWidth = active ? 3 : 2;
        graphics.circle(0, 0, 27);
        graphics.stroke();
    }

    private makePanel(): Node {
        const panel = new Node('ChallengeResultPanel');
        panel.setParent(this.root!);
        const width = 760;
        const height = 500;
        const ui = panel.addComponent(UITransform);
        ui.setContentSize(width, height);
        panel.addComponent(BlockInputEvents);
        const widget = panel.addComponent(Widget);
        widget.isAlignHorizontalCenter = true;
        widget.horizontalCenter = 0;
        widget.isAlignVerticalCenter = true;
        widget.verticalCenter = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        this.makeCard(panel, 'Background', width, height, 0, 0, new Color(255, 243, 211, 252), new Color(151, 78, 34, 255), 30, 3);
        this.makeCard(panel, 'HeaderRibbon', width - 24, 70, 0, 205, new Color(139, 68, 31, 255), new Color(232, 166, 74, 255), 24, 2);

        const labelNode = new Node('ResultText');
        labelNode.setParent(panel);
        labelNode.addComponent(UITransform).setContentSize(width - 70, 330);
        labelNode.setPosition(0, 20, 0);
        const label = labelNode.addComponent(Label);
        label.string = '';
        label.fontSize = 24;
        label.lineHeight = 38;
        label.color = new Color(91, 57, 31, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.resultLabel = label;
        labelNode.active = false;

        const content = new Node('ScoreCardContent');
        content.setParent(panel);
        content.addComponent(UITransform).setContentSize(width, height);
        this.resultCardRoot = content;
        this.resultTitleLabel = this.makePanelLabel(panel, 'ResultTitle', '', 0, 205, 650, 54, 29, new Color(255, 246, 220, 255));

        const statsCard = this.makeCard(content, 'StatsCard', 330, 270, -190, 25, new Color(255, 251, 232, 255), new Color(221, 174, 98, 210), 22, 2);
        this.makePanelLabel(statsCard, 'StatsTitle', '演奏判定', 0, 104, 280, 34, 21, new Color(107, 64, 34, 255));
        const statColors = [
            new Color(196, 129, 31, 255),
            new Color(67, 143, 82, 255),
            new Color(207, 105, 49, 255),
            new Color(184, 62, 48, 255),
        ];
        [58, 12, -34, -80].forEach((y, index) => {
            const stat = this.makePanelLabel(statsCard, `Stat_${index}`, '', 0, y, 276, 38, 19, statColors[index]);
            stat.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.resultStatLabels.push(stat);
        });

        const scoreCard = this.makeCard(content, 'ScoreCard', 330, 270, 190, 25, new Color(255, 248, 219, 255), new Color(225, 158, 61, 230), 22, 2.5);
        const ringNode = new Node('ScoreRing');
        ringNode.setParent(scoreCard);
        ringNode.addComponent(UITransform).setContentSize(210, 210);
        ringNode.setPosition(0, 30, 0);
        const ring = ringNode.addComponent(Graphics);
        ring.strokeColor = new Color(226, 153, 48, 220);
        ring.lineWidth = 7;
        ring.circle(0, 18, 88);
        ring.stroke();
        this.resultStarsLabel = this.makePanelLabel(scoreCard, 'Stars', '☆☆☆', 0, 78, 230, 42, 30, new Color(230, 151, 41, 255));
        this.resultScoreLabel = this.makePanelLabel(scoreCard, 'Score', '', 0, 18, 220, 72, 25, new Color(111, 62, 31, 255));
        this.resultScoreLabel.lineHeight = 32;
        this.resultRankLabel = this.makePanelLabel(scoreCard, 'Rank', '', 0, -68, 260, 36, 23, new Color(174, 82, 34, 255));
        this.resultEncouragementLabel = this.makePanelLabel(scoreCard, 'Encouragement', '', 0, -108, 278, 46, 15, new Color(126, 99, 62, 255));

        const exit = this.makePanelButton(panel, 'ExitChallengeButton', '退出挑战', -220, -205, new Color(103, 76, 48, 255), new Color(255, 244, 213, 255), () => this.onExitChallenge?.());
        const share = this.makePanelButton(panel, 'ShareResultButton', '分享成绩', 0, -205, new Color(92, 143, 73, 255), new Color(255, 250, 224, 255));
        const retry = this.makePanelButton(panel, 'RetryChallengeButton', '再练一次', 220, -205, new Color(225, 153, 67, 255), new Color(83, 47, 22, 255), () => this.panelAction?.());
        this.secondaryActionButton = exit.node;
        this.shareActionButton = share.node;
        this.primaryActionButton = retry.node;
        this.panelActionLabel = retry.label;
        return panel;
    }

    private makeCard(parent: Node, name: string, width: number, height: number, x: number, y: number, fill: Color, stroke: Color, radius: number, lineWidth: number): Node {
        const node = new Node(name);
        node.setParent(parent);
        node.addComponent(UITransform).setContentSize(width, height);
        node.setPosition(x, y, 0);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = fill;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.fill();
        graphics.strokeColor = stroke;
        graphics.lineWidth = lineWidth;
        graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        graphics.stroke();
        return node;
    }

    private makePanelLabel(parent: Node, name: string, text: string, x: number, y: number, width: number, height: number, size: number, color: Color): Label {
        const node = new Node(name);
        node.setParent(parent);
        node.addComponent(UITransform).setContentSize(width, height);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = size;
        label.lineHeight = size + 7;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    private makePanelButton(parent: Node, name: string, text: string, x: number, y: number, fill: Color, textColor: Color, onClick?: Action): { node: Node; label: Label } {
        const node = this.makeCard(parent, name, 190, 56, x, y, fill, new Color(238, 190, 104, 160), 22, 1.5);
        const label = this.makePanelLabel(node, 'Label', text, 0, 0, 176, 52, 21, textColor);
        const button = node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.96;
        if (onClick) node.on(Button.EventType.CLICK, onClick, this);
        return { node, label };
    }

    private static getRankTitle(result: LevelResult): string {
        if (result.stars <= 0) return '音乐新手';
        if (result.stars === 1) return '节奏学徒';
        if (result.stars === 2) return '初级乐手';
        const total = Math.max(1, result.perfectCount + result.goodCount + result.badCount + result.missCount);
        return result.perfectCount / total >= 0.8 ? '拇指琴音乐家' : '闪耀乐手';
    }

    private static getEncouragement(result: LevelResult): string {
        if (result.stars <= 0) return '旋律已经开始发芽，再试一次就会更稳。';
        if (result.stars === 1) return '你完成了整段旋律，下一步是跟稳节拍。';
        if (result.stars === 2) return '节奏与旋律都很稳定，三星就在下一次。';
        return '精彩演奏！把这次闪耀的成绩分享给朋友吧。';
    }

    onDestroy() {
        this.root?.destroy();
        this.root = null;
    }
}
