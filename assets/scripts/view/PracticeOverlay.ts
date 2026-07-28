import { _decorator, Button, Color, Component, Graphics, Label, Node, UITransform, Widget } from 'cc';
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
    private feedbackLabel: Label | null = null;
    private targetLabel: Label | null = null;
    private progressButton: Label | null = null;
    private resultPanel: Node | null = null;
    private resultLabel: Label | null = null;
    private panelActionLabel: Label | null = null;
    private secondaryActionButton: Node | null = null;
    private freeControls: Node[] = [];
    private onMetronome: Action | null = null;
    private onRetry: Action | null = null;
    private onProgress: Action | null = null;
    private onTempoDown: Action | null = null;
    private onTempoUp: Action | null = null;
    private onExitChallenge: Action | null = null;
    private panelAction: Action | null = null;

    onLoad() {
        this.root = new Node('PracticeOverlay');
        this.root.setParent(this.node);
        this.root.setSiblingIndex(this.node.children.length - 1);

        this.metronomeButton = this.makePill('MetronomeQuickButton', '♩ 节拍器', 192, 56, 28, 28, () => this.onMetronome?.());
        this.makePill('TempoDownButton', '−5', 58, 56, 28, 228, () => this.onTempoDown?.());
        this.makePill('TempoUpButton', '+5', 58, 56, 28, 294, () => this.onTempoUp?.());
        this.feedbackLabel = this.makePill('ChallengeFeedback', '自由弹奏', 300, 52, 98, 28, undefined, false);
        this.targetLabel = this.makePill('ChallengeTarget', '', 300, 46, 160, 28, undefined, false);
        this.progressButton = this.makePill('ProgressQuickButton', '成长记录', 182, 48, 212, 28, () => this.onProgress?.());

        this.resultPanel = this.makePanel();
        this.resultPanel.active = false;
    }

    bind(actions: { onMetronome: Action; onRetry: Action; onProgress: Action; onTempoDown: Action; onTempoUp: Action; onExitChallenge: Action }) {
        this.onMetronome = actions.onMetronome;
        this.onRetry = actions.onRetry;
        this.onProgress = actions.onProgress;
        this.onTempoDown = actions.onTempoDown;
        this.onTempoUp = actions.onTempoUp;
        this.onExitChallenge = actions.onExitChallenge;
    }

    setChallengeMode(active: boolean) {
        for (const control of this.freeControls) {
            if (control?.isValid) control.active = !active;
        }
        if (!active) this.hideResult();
    }

    setMetronome(_running: boolean, bpm: number) {
        if (this.metronomeButton) this.metronomeButton.string = `♩ ${bpm} BPM`;
    }

    setChallengeIdle() {
        if (this.feedbackLabel) this.feedbackLabel.string = '自由弹奏';
        if (this.targetLabel) this.targetLabel.string = '';
    }

    setChallengeStarted(level: LevelDefinition) {
        if (this.feedbackLabel) this.feedbackLabel.string = `${level.title} · ${level.bpm} BPM`;
        if (this.targetLabel) this.targetLabel.string = '预备拍…';
    }

    setJudgeFeedback(text: string, targetText: string) {
        if (this.feedbackLabel) this.feedbackLabel.string = text;
        if (this.targetLabel) this.targetLabel.string = targetText;
    }

    showResult(result: LevelResult, retryTitle: string, actionText = '再练一次') {
        if (!this.resultPanel || !this.resultLabel) return;
        const stars = result.stars > 0 ? '★'.repeat(result.stars) : '再试一次';
        this.resultLabel.string =
            `${stars}\n${result.score} 分  ·  最高连击 ${result.maxCombo}\n` +
            `Perfect ${result.perfectCount}   Good ${result.goodCount}   Miss ${result.missCount}\n\n${retryTitle}`;
        if (this.panelActionLabel) this.panelActionLabel.string = actionText;
        if (this.secondaryActionButton) this.secondaryActionButton.active = true;
        this.panelAction = () => this.onRetry?.();
        this.resultPanel.active = true;
    }

    showProgress(content: string) {
        if (!this.resultPanel || !this.resultLabel) return;
        this.resultLabel.string = content;
        if (this.panelActionLabel) this.panelActionLabel.string = '关闭';
        if (this.secondaryActionButton) this.secondaryActionButton.active = false;
        this.panelAction = () => this.hideResult();
        this.resultPanel.active = true;
    }

    hideResult() {
        if (this.resultPanel) this.resultPanel.active = false;
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
        if (interactive && onClick) {
            n.addComponent(Button);
            n.on(Button.EventType.CLICK, onClick, this);
        }
        this.freeControls.push(n);
        return label;
    }

    private makePanel(): Node {
        const panel = new Node('ChallengeResultPanel');
        panel.setParent(this.root!);
        const width = 570;
        const height = 390;
        const ui = panel.addComponent(UITransform);
        ui.setContentSize(width, height);
        const widget = panel.addComponent(Widget);
        widget.isAlignHorizontalCenter = true;
        widget.horizontalCenter = 0;
        widget.isAlignVerticalCenter = true;
        widget.verticalCenter = 0;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        const background = new Node('Background');
        background.setParent(panel);
        background.addComponent(UITransform).setContentSize(width, height);
        const graphics = background.addComponent(Graphics);
        graphics.fillColor = new Color(104, 57, 29, 248);
        graphics.roundRect(-width / 2, -height / 2, width, height, 30);
        graphics.fill();
        graphics.strokeColor = new Color(238, 190, 104, 190);
        graphics.lineWidth = 3;
        graphics.roundRect(-width / 2, -height / 2, width, height, 30);
        graphics.stroke();
        const labelNode = new Node('ResultText');
        labelNode.setParent(panel);
        labelNode.addComponent(UITransform).setContentSize(width - 52, height - 112);
        labelNode.setPosition(0, 28, 0);
        const label = labelNode.addComponent(Label);
        label.string = '';
        label.fontSize = 26;
        label.lineHeight = 42;
        label.color = new Color(255, 244, 213, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        this.resultLabel = label;

        const retry = new Node('RetryChallengeButton');
        retry.setParent(panel);
        const retryUi = retry.addComponent(UITransform);
        retryUi.setContentSize(210, 56);
        retry.setPosition(120, -145, 0);
        const retryBackground = new Node('Background');
        retryBackground.setParent(retry);
        retryBackground.addComponent(UITransform).setContentSize(210, 56);
        const retryGraphics = retryBackground.addComponent(Graphics);
        retryGraphics.fillColor = new Color(225, 153, 67, 255);
        retryGraphics.roundRect(-105, -28, 210, 56, 24);
        retryGraphics.fill();
        const retryLabelNode = new Node('Label');
        retryLabelNode.setParent(retry);
        retryLabelNode.addComponent(UITransform).setContentSize(200, 56);
        const retryLabel = retryLabelNode.addComponent(Label);
        retryLabel.string = '再练一次';
        retryLabel.fontSize = 25;
        retryLabel.lineHeight = 56;
        retryLabel.color = new Color(83, 47, 22, 255);
        retryLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        retryLabel.verticalAlign = Label.VerticalAlign.CENTER;
        this.panelActionLabel = retryLabel;
        retry.addComponent(Button);
        retry.on(Button.EventType.CLICK, () => this.panelAction?.(), this);

        const exit = new Node('ExitChallengeButton');
        exit.setParent(panel);
        exit.addComponent(UITransform).setContentSize(210, 56);
        exit.setPosition(-120, -145, 0);
        const exitBackground = new Node('Background');
        exitBackground.setParent(exit);
        exitBackground.addComponent(UITransform).setContentSize(210, 56);
        const exitGraphics = exitBackground.addComponent(Graphics);
        exitGraphics.fillColor = new Color(82, 63, 43, 255);
        exitGraphics.roundRect(-105, -28, 210, 56, 24);
        exitGraphics.fill();
        exitGraphics.strokeColor = new Color(238, 190, 104, 130);
        exitGraphics.lineWidth = 1.5;
        exitGraphics.roundRect(-105, -28, 210, 56, 24);
        exitGraphics.stroke();
        const exitLabelNode = new Node('Label');
        exitLabelNode.setParent(exit);
        exitLabelNode.addComponent(UITransform).setContentSize(200, 56);
        const exitLabel = exitLabelNode.addComponent(Label);
        exitLabel.string = '退出挑战';
        exitLabel.fontSize = 23;
        exitLabel.lineHeight = 56;
        exitLabel.color = new Color(255, 244, 213, 255);
        exitLabel.horizontalAlign = Label.HorizontalAlign.CENTER;
        exitLabel.verticalAlign = Label.VerticalAlign.CENTER;
        const exitButton = exit.addComponent(Button);
        exitButton.transition = Button.Transition.SCALE;
        exitButton.zoomScale = 0.96;
        exit.on(Button.EventType.CLICK, () => this.onExitChallenge?.(), this);
        this.secondaryActionButton = exit;
        return panel;
    }

    onDestroy() {
        this.root?.destroy();
        this.root = null;
    }
}
