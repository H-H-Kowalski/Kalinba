import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, sys, UITransform, Widget, isValid } from 'cc';
import type { LevelDefinition, LevelResult } from '../gameplay/LevelTypes';
import type { AchievementDefinition } from '../gameplay/AchievementCatalog';
const { ccclass } = _decorator;

type Action = () => void;
const FREE_TUTORIAL_KEY = 'kalinba_free_play_tutorial_seen_v1';

type RecordingResultActions = {
    onPreview: Action;
    onShare: Action;
    onShareTimeline: Action;
    onRerecord: Action;
    onClose: Action;
};

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
    private resultAchievementBanner: Node | null = null;
    private resultAchievementLabel: Label | null = null;
    private resultStatLabels: Label[] = [];
    private panelActionLabel: Label | null = null;
    private primaryActionButton: Node | null = null;
    private secondaryActionButton: Node | null = null;
    private shareActionButton: Node | null = null;
    private shareActionLabel: Label | null = null;
    private freeTutorialMask: Node | null = null;
    private freeTutorialPanel: Node | null = null;
    private freeTutorialTitle: Label | null = null;
    private freeTutorialBody: Label | null = null;
    private freeTutorialProgress: Label | null = null;
    private freeTutorialNextLabel: Label | null = null;
    private recordingFlowRoot: Node | null = null;
    private recordingPreviewLabel: Label | null = null;
    private freeTutorialPage = 0;
    private freeControls: Node[] = [];
    private challengeModeActive = false;
    private immersiveModeActive = false;
    private onMetronome: Action | null = null;
    private onRetry: Action | null = null;
    private onProgress: Action | null = null;
    private onTempoDown: Action | null = null;
    private onTempoUp: Action | null = null;
    private onExitChallenge: Action | null = null;
    private onExitFree: Action | null = null;
    private onShareResult: ((result: LevelResult, levelTitle: string, rankTitle: string, achievements: AchievementDefinition[]) => void) | null = null;
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

    bind(actions: { onMetronome: Action; onRetry: Action; onProgress: Action; onTempoDown: Action; onTempoUp: Action; onExitChallenge: Action; onExitFree: Action; onShareResult: (result: LevelResult, levelTitle: string, rankTitle: string, achievements: AchievementDefinition[]) => void }) {
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
        this.challengeModeActive = active;
        this.refreshFreeControlVisibility();
        if (!active) this.hideResult();
        if (active) this.closeFreeTutorial(false);
    }

    /** 自由演奏沉浸模式仅隐藏侧边按钮，不影响琴谱、琴键或演奏状态。 */
    setImmersiveMode(active: boolean) {
        this.immersiveModeActive = active;
        this.refreshFreeControlVisibility();
        if (active) this.closeFreeTutorial(false);
    }

    private refreshFreeControlVisibility() {
        const visible = !this.challengeModeActive && !this.immersiveModeActive;
        for (const control of this.freeControls) {
            if (control?.isValid) control.active = visible;
        }
    }

    /** 仅首次进入自由演奏时自动展示；挑战模式已有独立教程。 */
    showFreeTutorialIfNeeded() {
        let seen = false;
        try {
            seen = sys.localStorage.getItem(FREE_TUTORIAL_KEY) === '1';
        } catch {
            // 本地存储不可用时仍展示，避免首次进入完全没有说明。
        }
        if (!seen) this.showFreeTutorial(false);
    }

    /** 好友分享回放必须直接开始，不能被首次自由演奏引导遮挡。 */
    hideFreeTutorialForSharedPlayback() {
        this.closeFreeTutorial(false);
    }

    /** 左侧“?”可随时重新打开，不会重置任何演奏数据。 */
    showFreeTutorial(_manual = true) {
        if (!this.root?.isValid) return;
        this.closeFreeTutorial(false);
        this.root.setSiblingIndex(this.node.children.length - 1);

        const parentUi = this.node.getComponent(UITransform);
        const width = parentUi?.width ?? 1280;
        const height = parentUi?.height ?? 720;
        const mask = new Node('FreePlayTutorialMask');
        mask.setParent(this.root);
        mask.addComponent(UITransform).setContentSize(width, height);
        mask.addComponent(BlockInputEvents);
        const maskGraphics = mask.addComponent(Graphics);
        maskGraphics.fillColor = new Color(42, 29, 18, 205);
        maskGraphics.rect(-width / 2, -height / 2, width, height);
        maskGraphics.fill();
        this.freeTutorialMask = mask;

        const panel = this.makeCard(
            this.root,
            'FreePlayTutorialPanel',
            Math.min(790, width - 90),
            Math.min(500, height - 70),
            0,
            0,
            new Color(255, 247, 220, 255),
            new Color(151, 78, 34, 255),
            30,
            3,
        );
        panel.addComponent(BlockInputEvents);
        this.freeTutorialPanel = panel;
        this.makeCard(panel, 'Header', 750, 68, 0, 204, new Color(139, 68, 31, 255), new Color(235, 174, 77, 255), 23, 1.5);
        this.freeTutorialTitle = this.makePanelLabel(panel, 'Title', '', 0, 204, 680, 56, 28, new Color(255, 246, 220, 255));
        this.freeTutorialBody = this.makePanelLabel(panel, 'Body', '', 0, 35, 680, 255, 22, new Color(92, 54, 29, 255));
        this.freeTutorialBody.lineHeight = 38;
        this.freeTutorialProgress = this.makePanelLabel(panel, 'Progress', '', 0, -116, 220, 34, 17, new Color(148, 103, 58, 255));
        this.makePanelButton(panel, 'Skip', '跳过引导', -220, -190, new Color(104, 83, 58, 255), new Color(255, 246, 220, 255), () => this.closeFreeTutorial(true));
        const next = this.makePanelButton(panel, 'Next', '下一步', 220, -190, new Color(219, 145, 52, 255), new Color(78, 43, 23, 255), () => this.advanceFreeTutorial());
        this.freeTutorialNextLabel = next.label;
        this.freeTutorialPage = 0;
        this.refreshFreeTutorialPage();
    }

    private advanceFreeTutorial() {
        if (this.freeTutorialPage >= 2) {
            this.closeFreeTutorial(true);
            return;
        }
        this.freeTutorialPage += 1;
        this.refreshFreeTutorialPage();
    }

    private refreshFreeTutorialPage() {
        const pages = [
            {
                title: '第一次演奏，先认识琴键',
                body: '点击下方任意银色琴键即可发声\n上方显示当前琴谱，蓝色圆点表示所在页\n琴架中央的《生日快乐》可以点击修改标题',
            },
            {
                title: '左侧：最常用的演奏控制',
                body: '←　返回首页\n节奏　开启或关闭节拍提示音\n左下“沉浸”　隐藏两侧按钮，专心演奏\n\n节奏速度与提示密度可在“设置”中选择',
            },
            {
                title: '右侧：换谱与录制',
                body: '⚙　设置音色、翻页方向和节奏密度\n图片　更换琴谱　　▶ / ■　开始或结束录制\n\n录制结束会出现结果卡，可试听、分享或重新录制；已有结果时再次点击录制入口，不会直接覆盖。',
            },
        ];
        const page = pages[this.freeTutorialPage] ?? pages[0];
        if (this.freeTutorialTitle) this.freeTutorialTitle.string = page.title;
        if (this.freeTutorialBody) this.freeTutorialBody.string = page.body;
        if (this.freeTutorialProgress) this.freeTutorialProgress.string = `${this.freeTutorialPage + 1} / ${pages.length}`;
        if (this.freeTutorialNextLabel) this.freeTutorialNextLabel.string = this.freeTutorialPage === pages.length - 1 ? '开始弹琴' : '下一步';
    }

    private closeFreeTutorial(markSeen: boolean) {
        if (markSeen) {
            try {
                sys.localStorage.setItem(FREE_TUTORIAL_KEY, '1');
            } catch {
                // 不影响关闭引导。
            }
        }
        this.freeTutorialPanel?.destroy();
        this.freeTutorialMask?.destroy();
        this.freeTutorialPanel = null;
        this.freeTutorialMask = null;
        this.freeTutorialTitle = null;
        this.freeTutorialBody = null;
        this.freeTutorialProgress = null;
        this.freeTutorialNextLabel = null;
    }

    /** 第一次点击录制时展示一次，明确“录制 → 停止 → 试听/分享”的完整路径。 */
    showRecordingGuide(onStart: Action) {
        const panel = this.makeRecordingFlowBase(() => this.hideRecordingFlow());
        if (!panel) {
            onStart();
            return;
        }
        this.makePanelLabel(panel, 'GuideTitle', '第一次录制', 0, 118, 520, 48, 30, new Color(126, 62, 28, 255));
        const body = this.makePanelLabel(
            panel,
            'GuideBody',
            '① 点击“开始录制”后直接弹琴\n② 再点右侧按钮结束录制\n③ 在结果卡中试听、分享或重新录制\n\n录制只保存你的琴键演奏，节奏提示音不会录进去。',
            0,
            18,
            520,
            190,
            20,
            new Color(91, 57, 31, 255),
        );
        body.lineHeight = 30;
        this.makePanelButton(panel, 'GuideLater', '暂不录制', -120, -126, new Color(109, 82, 55, 255), new Color(255, 246, 220, 255), () => this.hideRecordingFlow());
        this.makePanelButton(panel, 'GuideStart', '开始录制', 120, -126, new Color(218, 145, 52, 255), new Color(76, 42, 22, 255), () => {
            this.hideRecordingFlow();
            onStart();
        });
    }

    showRecordingResult(songTitle: string, durationSec: number, noteCount: number, actions: RecordingResultActions) {
        const panel = this.makeRecordingFlowBase(() => {
            actions.onClose();
            this.hideRecordingFlow();
        });
        if (!panel) return;
        this.makePanelLabel(panel, 'RecordResultTitle', '已有一段录制', 0, 120, 520, 46, 30, new Color(126, 62, 28, 255));
        this.makePanelLabel(panel, 'RecordSongTitle', songTitle, 0, 78, 500, 36, 21, new Color(174, 82, 34, 255));
        const summaryCard = this.makeCard(panel, 'RecordSummary', 500, 112, 0, 12, new Color(255, 250, 229, 255), new Color(221, 174, 98, 190), 20, 1.8);
        this.makePanelLabel(summaryCard, 'DurationTitle', '录制时长', -125, 22, 190, 30, 16, new Color(141, 106, 69, 255));
        this.makePanelLabel(summaryCard, 'DurationValue', `${durationSec.toFixed(1)} 秒`, -125, -16, 190, 42, 27, new Color(106, 61, 33, 255));
        this.makePanelLabel(summaryCard, 'NotesTitle', '演奏音符', 125, 22, 190, 30, 16, new Color(141, 106, 69, 255));
        this.makePanelLabel(summaryCard, 'NotesValue', `${noteCount} 个`, 125, -16, 190, 42, 27, new Color(106, 61, 33, 255));

        const preview = this.makePanelButton(panel, 'PreviewRecord', '试听', -120, -80, new Color(105, 84, 59, 255), new Color(255, 246, 220, 255), actions.onPreview);
        this.recordingPreviewLabel = preview.label;
        this.makePanelButton(panel, 'Rerecord', '重新录制', 120, -80, new Color(184, 103, 47, 255), new Color(255, 246, 220, 255), () => {
            this.hideRecordingFlow();
            actions.onRerecord();
        });
        this.makePanelButton(panel, 'ShareRecord', '分享给好友', -120, -144, new Color(87, 139, 72, 255), new Color(255, 250, 224, 255), () => {
            this.hideRecordingFlow();
            actions.onShare();
        });
        this.makePanelButton(panel, 'ShareTimeline', '分享到朋友圈', 120, -144, new Color(87, 139, 72, 255), new Color(255, 250, 224, 255), () => {
            this.hideRecordingFlow();
            actions.onShareTimeline();
        });
    }

    setRecordingPreviewing(playing: boolean) {
        if (this.recordingPreviewLabel) this.recordingPreviewLabel.string = playing ? '停止试听' : '试听';
    }

    hideRecordingFlow() {
        this.recordingFlowRoot?.destroy();
        this.recordingFlowRoot = null;
        this.recordingPreviewLabel = null;
    }

    private makeRecordingFlowBase(onClose: Action): Node | null {
        if (!this.root?.isValid) return null;
        this.hideRecordingFlow();
        this.root.setSiblingIndex(this.node.children.length - 1);
        const parentUi = this.node.getComponent(UITransform);
        const width = parentUi?.width ?? 1280;
        const height = parentUi?.height ?? 720;
        const flow = new Node('RecordingFlowOverlay');
        flow.setParent(this.root);
        flow.addComponent(UITransform).setContentSize(width, height);
        flow.addComponent(BlockInputEvents);
        this.recordingFlowRoot = flow;

        const mask = new Node('Mask');
        mask.setParent(flow);
        mask.addComponent(UITransform).setContentSize(width, height);
        const maskGraphics = mask.addComponent(Graphics);
        maskGraphics.fillColor = new Color(42, 29, 18, 188);
        maskGraphics.rect(-width / 2, -height / 2, width, height);
        maskGraphics.fill();
        mask.addComponent(Button).transition = Button.Transition.NONE;
        mask.on(Button.EventType.CLICK, onClose, this);

        const panel = this.makeCard(flow, 'RecordingPanel', 640, 360, 0, 0, new Color(255, 243, 211, 255), new Color(151, 78, 34, 255), 28, 3);
        panel.addComponent(BlockInputEvents);
        const close = this.makeCard(panel, 'Close', 42, 42, 278, 142, new Color(126, 62, 28, 245), new Color(235, 174, 77, 180), 18, 1.3);
        this.makePanelLabel(close, 'Label', '×', 0, 1, 34, 34, 24, new Color(255, 246, 220, 255));
        close.addComponent(Button).transition = Button.Transition.SCALE;
        close.on(Button.EventType.CLICK, onClose, this);
        return panel;
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

    showResult(result: LevelResult, levelTitle: string, actionText = '再练一次', newAchievements: AchievementDefinition[] = []) {
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
        if (this.resultAchievementBanner) this.resultAchievementBanner.active = newAchievements.length > 0;
        if (this.resultAchievementLabel) {
            const titles = newAchievements.map((item) => `「${item.title}」`).join(' · ');
            this.resultAchievementLabel.string = newAchievements.length > 0 ? `✨ 新成就  ${titles}` : '';
        }
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
        if (this.shareActionLabel) this.shareActionLabel.string = newAchievements.length > 0 ? '分享成就' : '分享成绩';
        this.primaryActionButton?.setPosition(220, -205, 0);
        this.panelAction = () => this.onRetry?.();
        this.shareActionButton?.off(Button.EventType.CLICK);
        this.shareActionButton?.on(Button.EventType.CLICK, () => this.onShareResult?.(result, levelTitle, rankTitle, newAchievements), this);
        if (this.resultMask) this.resultMask.active = true;
        this.resultPanel.active = true;
    }

    showProgress(content: string) {
        if (!this.resultPanel || !this.resultLabel) return;
        this.root?.setSiblingIndex(this.node.children.length - 1);
        if (this.resultCardRoot) this.resultCardRoot.active = false;
        if (this.resultAchievementBanner) this.resultAchievementBanner.active = false;
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
        const label = this.makePanelLabel(node, 'Label', text, 0, 0, 48, 48, fontSize, new Color(70, 39, 23, 255));
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
        graphics.fillColor = new Color(48, 24, 10, 72);
        graphics.circle(0, -2.5, 28);
        graphics.fill();
        graphics.fillColor = active ? new Color(190, 205, 137, 252) : new Color(226, 184, 112, 252);
        graphics.circle(0, 0, 26);
        graphics.fill();
        graphics.strokeColor = active ? new Color(72, 111, 48, 242) : new Color(104, 55, 28, 238);
        graphics.lineWidth = active ? 2.6 : 2.2;
        graphics.circle(0, 0, 26);
        graphics.stroke();
        graphics.strokeColor = active ? new Color(235, 248, 196, 115) : new Color(255, 229, 174, 118);
        graphics.lineWidth = 1.2;
        graphics.arc(0, 1, 22.5, Math.PI * 0.18, Math.PI * 0.82, false);
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

        this.resultAchievementBanner = this.makeCard(
            content,
            'NewAchievementBanner',
            660,
            52,
            0,
            -142,
            new Color(255, 235, 168, 255),
            new Color(222, 147, 44, 255),
            18,
            2.5,
        );
        this.resultAchievementLabel = this.makePanelLabel(
            this.resultAchievementBanner,
            'NewAchievementLabel',
            '',
            0,
            0,
            628,
            46,
            18,
            new Color(133, 67, 24, 255),
        );
        this.resultAchievementBanner.active = false;

        const exit = this.makePanelButton(panel, 'ExitChallengeButton', '退出挑战', -220, -205, new Color(103, 76, 48, 255), new Color(255, 244, 213, 255), () => this.onExitChallenge?.());
        const share = this.makePanelButton(panel, 'ShareResultButton', '分享成绩', 0, -205, new Color(92, 143, 73, 255), new Color(255, 250, 224, 255));
        const retry = this.makePanelButton(panel, 'RetryChallengeButton', '再练一次', 220, -205, new Color(225, 153, 67, 255), new Color(83, 47, 22, 255), () => this.panelAction?.());
        this.secondaryActionButton = exit.node;
        this.shareActionButton = share.node;
        this.shareActionLabel = share.label;
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
        if (isValid(this.root, true)) this.root.destroy();
        this.root = null;
    }
}
