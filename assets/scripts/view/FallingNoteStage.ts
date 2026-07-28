import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, sys, UITransform, Widget } from 'cc';
import { KalimbaKey } from '../KalimbaKey';
import type { JudgeEvent, LevelDefinition, LevelNote } from '../gameplay/LevelTypes';
const { ccclass } = _decorator;

type NoteVisual = { note: LevelNote; node: Node; resolved: boolean };
type ThemeColors = {
    panel: Color;
    border: Color;
    lane: Color;
    laneAlt: Color;
    hit: Color;
    note: Color;
    noteBorder: Color;
    text: Color;
};
type StageActions = {
    onStart: () => void;
    onExit: () => void;
    onTogglePause: () => void;
    onHelp: () => void;
};

const TUTORIAL_KEY = 'kalinba_challenge_tutorial_seen_v1';

/**
 * 挑战专用落键舞台。时间轴由 AudioContext 驱动，画面只负责展示，
 * 因此暂停、低帧率和界面动画都不会改变判定结果。
 */
@ccclass('FallingNoteStage')
export class FallingNoteStage extends Component {
    private root: Node | null = null;
    private scoreLabel: Label | null = null;
    private comboLabel: Label | null = null;
    private feedbackLabel: Label | null = null;
    private progressGraphics: Graphics | null = null;
    private noteLayer: Node | null = null;
    private modal: Node | null = null;
    private pauseLabel: Label | null = null;
    private level: LevelDefinition | null = null;
    private startedAtSec = 0;
    private audioNow: (() => number | null) | null = null;
    private visuals: NoteVisual[] = [];
    private running = false;
    private paused = false;
    private score = 0;
    private stageWidth = 1160;
    private stageHeight = 420;
    private laneWidth = 1080;
    private laneTopY = 82;
    private hitY = -126;
    private actions: StageActions | null = null;
    private theme: ThemeColors = FallingNoteStage.themeFor('amber');

    setAudioClock(getNow: () => number | null) {
        this.audioNow = getNow;
    }

    prepareLevel(level: LevelDefinition, actions: StageActions) {
        this.ensureRoot();
        this.clearNotes();
        this.level = level;
        this.actions = actions;
        this.theme = FallingNoteStage.themeFor(level.visualTheme);
        this.running = false;
        this.paused = false;
        this.score = 0;
        if (this.root) {
            this.root.active = true;
            this.root.setSiblingIndex(this.node.children.length - 1);
        }
        if (this.scoreLabel) this.scoreLabel.string = '0 分';
        if (this.comboLabel) this.comboLabel.string = 'COMBO 0';
        if (this.feedbackLabel) this.feedbackLabel.string = `${level.title} · ${level.bpm} BPM`;
        if (this.pauseLabel) this.pauseLabel.string = '暂停';
        this.redrawStage();
        this.drawProgress(0);
        this.showIntro();
    }

    startLevel(level: LevelDefinition, startedAtSec: number) {
        this.ensureRoot();
        this.clearNotes();
        this.level = level;
        this.theme = FallingNoteStage.themeFor(level.visualTheme);
        this.startedAtSec = startedAtSec;
        this.score = 0;
        this.running = true;
        this.paused = false;
        this.modal?.destroy();
        this.modal = null;
        if (this.root) this.root.active = true;
        if (this.scoreLabel) this.scoreLabel.string = '0 分';
        if (this.comboLabel) this.comboLabel.string = 'COMBO 0';
        if (this.feedbackLabel) this.feedbackLabel.string = '准备 3';
        if (this.pauseLabel) this.pauseLabel.string = '暂停';
        this.redrawStage();
        this.drawProgress(0);
        for (const note of level.notes) this.createNote(note);
    }

    syncStartedAt(startedAtSec: number) {
        this.startedAtSec = startedAtSec;
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        if (this.pauseLabel) this.pauseLabel.string = paused ? '继续' : '暂停';
        if (paused) this.showPauseModal();
        else {
            this.modal?.destroy();
            this.modal = null;
        }
    }

    showHelp(onClose: () => void) {
        this.showTutorialModal(false, onClose);
    }

    showError(message: string) {
        if (this.feedbackLabel) this.feedbackLabel.string = message;
        this.showMessageModal('无法开始', message, '返回', () => this.actions?.onExit());
    }

    stop() {
        this.running = false;
        this.paused = false;
        this.actions = null;
        this.modal?.destroy();
        this.modal = null;
        if (this.root) this.root.active = false;
        this.clearNotes();
    }

    finish(score: number) {
        this.running = false;
        this.paused = false;
        this.score = score;
        if (this.feedbackLabel) this.feedbackLabel.string = '挑战完成';
        if (this.scoreLabel) this.scoreLabel.string = `${score} 分`;
        this.clearNotes();
        // 结算面板由 PracticeOverlay 展示，舞台让位避免挡住结果按钮。
        if (this.root) this.root.active = false;
    }

    onJudge(event: JudgeEvent, totalScore: number) {
        this.score = totalScore;
        const text = event.grade === 'perfect' ? 'PERFECT'
            : event.grade === 'good' ? 'GOOD'
                : event.grade === 'miss' ? 'MISS' : '按错了';
        if (this.feedbackLabel) this.feedbackLabel.string = event.scoreDelta > 0 ? `${text}  +${event.scoreDelta}` : text;
        if (this.comboLabel) this.comboLabel.string = `COMBO ${event.combo}`;
        if (this.scoreLabel) this.scoreLabel.string = `${totalScore} 分`;
        if (event.grade === 'perfect' || event.grade === 'good') this.resolveClosest(event.expectedKeyIndex ?? event.keyIndex);
    }

    update() {
        if (!this.running || this.paused || !this.level || !this.noteLayer) return;
        const now = this.audioNow?.();
        if (now === null || now === undefined) return;
        const elapsed = now - this.startedAtSec;
        const previewSec = 3.15;
        const beatSec = 60 / this.level.bpm;

        if (elapsed < 0) {
            const count = Math.max(1, Math.min(3, Math.ceil(-elapsed / beatSec)));
            if (this.feedbackLabel) this.feedbackLabel.string = `准备 ${count}`;
        }

        const lastBeat = this.level.notes[this.level.notes.length - 1]?.beat ?? 0;
        const duration = Math.max(beatSec, lastBeat * beatSec + beatSec);
        this.drawProgress(Math.max(0, Math.min(1, elapsed / duration)));

        for (const visual of this.visuals) {
            if (visual.resolved || !visual.node.isValid) continue;
            const targetAt = visual.note.beat * beatSec;
            const delta = targetAt - elapsed;
            const visible = delta >= -0.34 && delta <= previewSec;
            visual.node.active = visible;
            if (visible) {
                const ratio = delta / previewSec;
                visual.node.setPosition(this.keyToX(visual.note.keyIndex), this.hitY + ratio * (this.laneTopY - this.hitY), 0);
            }
        }
    }

    private ensureRoot() {
        if (this.root?.isValid) return;
        const parentUi = this.node.getComponent(UITransform);
        const canvasW = parentUi?.width ?? 1280;
        const canvasH = parentUi?.height ?? 720;
        this.stageWidth = Math.min(1180, canvasW - 30);
        this.stageHeight = Math.min(430, canvasH * 0.62);
        this.laneWidth = this.stageWidth - 72;
        this.laneTopY = this.stageHeight / 2 - 116;
        this.hitY = -this.stageHeight / 2 + 55;

        const root = new Node('FallingNoteStage');
        root.setParent(this.node);
        root.setSiblingIndex(this.node.children.length - 1);
        root.addComponent(UITransform).setContentSize(this.stageWidth, this.stageHeight);
        const widget = root.addComponent(Widget);
        widget.isAlignHorizontalCenter = true;
        widget.horizontalCenter = 0;
        widget.isAlignTop = true;
        widget.top = 10;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        const panel = new Node('Panel');
        panel.setParent(root);
        panel.addComponent(UITransform).setContentSize(this.stageWidth, this.stageHeight);
        panel.addComponent(Graphics);

        const headerY = this.stageHeight / 2 - 40;
        this.scoreLabel = this.makeText(root, 'Score', -130, headerY, 24, new Color(121, 59, 27, 255), 150);
        this.comboLabel = this.makeText(root, 'Combo', 30, headerY, 20, new Color(185, 99, 42, 255), 160);
        this.feedbackLabel = this.makeText(root, 'Feedback', 0, this.hitY - 28, 18, new Color(121, 59, 27, 255), this.stageWidth - 380);

        const title = this.makeText(root, 'Title', -this.stageWidth / 2 + 185, headerY, 23, new Color(121, 59, 27, 255), 300);
        title.horizontalAlign = Label.HorizontalAlign.LEFT;

        this.makeControlButton(root, 'ExitButton', '退出', this.stageWidth / 2 - 48, headerY, 74, () => this.actions?.onExit());
        this.makeControlButton(root, 'HelpButton', '教程', this.stageWidth / 2 - 132, headerY, 74, () => this.actions?.onHelp());
        this.pauseLabel = this.makeControlButton(root, 'PauseButton', '暂停', this.stageWidth / 2 - 216, headerY, 74, () => this.actions?.onTogglePause());

        const progress = new Node('Progress');
        progress.setParent(root);
        progress.addComponent(UITransform).setContentSize(this.stageWidth - 46, 10);
        progress.setPosition(0, this.stageHeight / 2 - 78, 0);
        this.progressGraphics = progress.addComponent(Graphics);

        const lanes = new Node('LaneLines');
        lanes.setParent(root);
        lanes.addComponent(UITransform).setContentSize(this.laneWidth, this.laneTopY - this.hitY + 16);
        lanes.addComponent(Graphics);

        // 判定线下方固定显示与实体琴键一致的音名，让 17 条轨道不是抽象空格。
        const laneLabelY = this.hitY + 18;
        for (let i = 0; i < 17; i++) {
            const label = this.makeText(root, `LaneLabel_${i}`, this.keyToX(i), laneLabelY, 13, new Color(255, 249, 225, 235), Math.max(30, this.laneWidth / 17 - 4));
            label.string = KalimbaKey.getChallengeDisplayNote(i);
        }

        const noteLayer = new Node('Notes');
        noteLayer.setParent(root);
        noteLayer.addComponent(UITransform).setContentSize(this.laneWidth, this.laneTopY - this.hitY + 20);
        this.noteLayer = noteLayer;
        this.root = root;
        this.redrawStage();
    }

    private showIntro() {
        if (!this.level) return;
        let seen = false;
        try {
            seen = sys.localStorage.getItem(TUTORIAL_KEY) === '1';
        } catch {
            // 无本地存储时每次展示完整教程。
        }
        if (!seen) {
            this.showTutorialModal(true, () => this.actions?.onStart());
            return;
        }
        this.showMessageModal(
            this.level.title,
            `${this.level.subtitle}\n${this.level.bpm} BPM · ${this.level.notes.length} 个音符\n\n音符落到判定线时，点击相同数字的琴键`,
            '开始挑战',
            () => this.actions?.onStart(),
            true,
        );
    }

    private showTutorialModal(startMode: boolean, onClose: () => void) {
        this.modal?.destroy();
        if (!this.root || !this.level) return;
        const modal = this.makeShape(this.root, 'TutorialModal', Math.min(760, this.stageWidth - 90), this.stageHeight - 54, new Color(255, 246, 218, 252), 24, this.theme.border, 3);
        modal.setSiblingIndex(this.root.children.length - 1);
        modal.addComponent(BlockInputEvents);
        this.modal = modal;

        this.makeText(modal, 'TutorialTitle', 0, this.stageHeight / 2 - 82, 29, this.theme.text, 650).string =
            startMode ? '第一次挑战，先看这里' : '挑战教程';
        this.makeText(modal, 'Step1', -205, 58, 19, this.theme.text, 210).string = '① 看数字音符向下落';
        this.makeText(modal, 'Step2', 0, 58, 19, this.theme.text, 210).string = '② 到达亮色判定线';
        this.makeText(modal, 'Step3', 205, 58, 19, this.theme.text, 210).string = '③ 点击相同数字琴键';

        const demoLane = this.makeShape(modal, 'DemoLane', 560, 86, new Color(239, 226, 190, 255), 16, new Color(this.theme.border.r, this.theme.border.g, this.theme.border.b, 120), 1.5);
        demoLane.setPosition(0, -18, 0);
        const demoGraphics = demoLane.getChildByName('Background')?.getComponent(Graphics);
        if (demoGraphics) {
            demoGraphics.strokeColor = this.theme.hit;
            demoGraphics.lineWidth = 4;
            demoGraphics.moveTo(-250, -22);
            demoGraphics.lineTo(250, -22);
            demoGraphics.stroke();
        }
        const sample = this.makeShape(demoLane, 'SampleNote', 50, 50, this.theme.note, 14, this.theme.noteBorder, 2);
        sample.setPosition(-120, 12, 0);
        this.makeText(sample, 'SampleNumber', 0, 0, 24, new Color(255, 249, 225, 255), 46).string = '1';
        this.makeText(demoLane, 'Arrow', -50, 10, 28, this.theme.hit, 60).string = '↓';
        this.makeText(demoLane, 'HitHint', 105, -22, 17, this.theme.text, 250).string = '到这里时弹奏';

        this.makeText(modal, 'Hint', 0, -88, 16, new Color(126, 96, 59, 255), 650).string =
            '数字前的圆点代表高音；看准位置，PERFECT 得分最高';
        this.makeActionButton(modal, startMode ? '我懂了，开始' : '继续挑战', 230, 54, 0, -132, () => {
            if (startMode) {
                try {
                    sys.localStorage.setItem(TUTORIAL_KEY, '1');
                } catch {
                    // 不影响开始挑战。
                }
            }
            this.modal?.destroy();
            this.modal = null;
            onClose();
        });
    }

    private showPauseModal() {
        this.showMessageModal('挑战已暂停', '节奏与音符已经停住，准备好后继续。', '继续挑战', () => this.actions?.onTogglePause());
    }

    private showMessageModal(title: string, body: string, action: string, onAction: () => void, compact = false) {
        this.modal?.destroy();
        if (!this.root) return;
        const width = compact ? 600 : 540;
        const height = compact ? 270 : 230;
        const modal = this.makeShape(this.root, 'MessageModal', width, height, new Color(255, 246, 218, 252), 24, this.theme.border, 3);
        modal.setSiblingIndex(this.root.children.length - 1);
        modal.addComponent(BlockInputEvents);
        this.modal = modal;
        this.makeText(modal, 'ModalTitle', 0, height / 2 - 48, 28, this.theme.text, width - 60).string = title;
        const bodyLabel = this.makeText(modal, 'ModalBody', 0, compact ? 18 : 10, 17, new Color(112, 81, 48, 255), width - 70);
        bodyLabel.string = body;
        bodyLabel.lineHeight = 28;
        bodyLabel.overflow = Label.Overflow.SHRINK;
        bodyLabel.node.getComponent(UITransform)?.setContentSize(width - 70, compact ? 112 : 72);
        this.makeActionButton(modal, action, 210, 52, 0, -height / 2 + 42, () => {
            this.modal?.destroy();
            this.modal = null;
            onAction();
        });
    }

    private createNote(note: LevelNote) {
        if (!this.noteLayer) return;
        const noteWidth = Math.max(34, Math.min(52, this.laneWidth / 17 - 8));
        const noteHeight = 46;
        const node = new Node('FallingNote');
        node.setParent(this.noteLayer);
        node.addComponent(UITransform).setContentSize(noteWidth, noteHeight);

        const shadow = new Node('Shadow');
        shadow.setParent(node);
        shadow.addComponent(UITransform).setContentSize(noteWidth, noteHeight);
        shadow.setPosition(0, -4, 0);
        const shadowG = shadow.addComponent(Graphics);
        shadowG.fillColor = new Color(this.theme.noteBorder.r, this.theme.noteBorder.g, this.theme.noteBorder.b, 85);
        shadowG.roundRect(-noteWidth / 2, -noteHeight / 2, noteWidth, noteHeight, 13);
        shadowG.fill();

        const shape = new Node('Shape');
        shape.setParent(node);
        shape.addComponent(UITransform).setContentSize(noteWidth, noteHeight);
        const graphics = shape.addComponent(Graphics);
        graphics.fillColor = this.theme.note;
        graphics.roundRect(-noteWidth / 2, -noteHeight / 2, noteWidth, noteHeight, 13);
        graphics.fill();
        graphics.strokeColor = this.theme.noteBorder;
        graphics.lineWidth = 2.5;
        graphics.roundRect(-noteWidth / 2, -noteHeight / 2, noteWidth, noteHeight, 13);
        graphics.stroke();

        const label = this.makeText(node, 'Number', 0, 0, 22, new Color(255, 249, 225, 255), noteWidth - 4);
        label.string = KalimbaKey.getChallengeDisplayNote(note.keyIndex);
        node.active = false;
        this.visuals.push({ note, node, resolved: false });
    }

    private resolveClosest(keyIndex: number) {
        const now = this.audioNow?.();
        if (now === null || now === undefined || !this.level) return;
        const elapsed = now - this.startedAtSec;
        const beatSec = 60 / this.level.bpm;
        const candidates = this.visuals.filter((visual) => !visual.resolved && visual.note.keyIndex === keyIndex);
        candidates.sort((a, b) => Math.abs(a.note.beat * beatSec - elapsed) - Math.abs(b.note.beat * beatSec - elapsed));
        const visual = candidates[0];
        if (!visual) return;
        visual.resolved = true;
        visual.node.active = false;
    }

    private keyToX(keyIndex: number): number {
        const safe = Math.max(0, Math.min(16, keyIndex));
        return -this.laneWidth / 2 + (this.laneWidth / 17) * (safe + 0.5);
    }

    private clearNotes() {
        for (const visual of this.visuals) visual.node.destroy();
        this.visuals = [];
    }

    private redrawStage() {
        if (!this.root) return;
        const panelGraphics = this.root.getChildByName('Panel')?.getComponent(Graphics);
        if (panelGraphics) {
            panelGraphics.clear();
            panelGraphics.fillColor = this.theme.panel;
            panelGraphics.roundRect(-this.stageWidth / 2, -this.stageHeight / 2, this.stageWidth, this.stageHeight, 24);
            panelGraphics.fill();
            panelGraphics.strokeColor = this.theme.border;
            panelGraphics.lineWidth = 3;
            panelGraphics.roundRect(-this.stageWidth / 2, -this.stageHeight / 2, this.stageWidth, this.stageHeight, 24);
            panelGraphics.stroke();
        }

        const laneGraphics = this.root.getChildByName('LaneLines')?.getComponent(Graphics);
        if (laneGraphics) {
            laneGraphics.clear();
            const laneW = this.laneWidth / 17;
            for (let i = 0; i < 17; i++) {
                if (i % 2 === 0) {
                    laneGraphics.fillColor = this.theme.laneAlt;
                    laneGraphics.rect(-this.laneWidth / 2 + i * laneW, this.hitY, laneW, this.laneTopY - this.hitY);
                    laneGraphics.fill();
                }
            }
            laneGraphics.strokeColor = this.theme.lane;
            laneGraphics.lineWidth = 1;
            for (let i = 0; i <= 17; i++) {
                const x = -this.laneWidth / 2 + laneW * i;
                laneGraphics.moveTo(x, this.hitY);
                laneGraphics.lineTo(x, this.laneTopY);
            }
            laneGraphics.stroke();
            laneGraphics.strokeColor = this.theme.hit;
            laneGraphics.lineWidth = 5;
            laneGraphics.moveTo(-this.laneWidth / 2, this.hitY);
            laneGraphics.lineTo(this.laneWidth / 2, this.hitY);
            laneGraphics.stroke();
        }

        const title = this.root.getChildByName('Title')?.getComponent(Label);
        if (title && this.level) title.string = `${this.level.title}  ·  ${this.level.bpm} BPM`;
        if (this.scoreLabel) this.scoreLabel.color = this.theme.text;
        if (this.comboLabel) this.comboLabel.color = this.theme.hit;
        if (this.feedbackLabel) this.feedbackLabel.color = this.theme.text;
    }

    private drawProgress(ratio: number) {
        const graphics = this.progressGraphics;
        if (!graphics) return;
        const width = this.stageWidth - 46;
        graphics.clear();
        graphics.fillColor = new Color(this.theme.border.r, this.theme.border.g, this.theme.border.b, 35);
        graphics.roundRect(-width / 2, -5, width, 10, 5);
        graphics.fill();
        if (ratio > 0) {
            const fillW = Math.max(10, width * ratio);
            graphics.fillColor = this.theme.hit;
            graphics.roundRect(-width / 2, -5, fillW, 10, 5);
            graphics.fill();
        }
    }

    private makeControlButton(parent: Node, name: string, text: string, x: number, y: number, width: number, onClick: () => void): Label {
        const button = this.makeShape(parent, name, width, 42, new Color(126, 62, 28, 235), 14, new Color(255, 222, 150, 140), 1);
        button.setPosition(x, y, 0);
        const label = this.makeText(button, 'Label', 0, 0, 17, new Color(255, 246, 219, 255), width - 8);
        label.string = text;
        const component = button.addComponent(Button);
        component.transition = Button.Transition.SCALE;
        component.zoomScale = 0.94;
        button.on(Button.EventType.CLICK, onClick, this);
        return label;
    }

    private makeActionButton(parent: Node, text: string, width: number, height: number, x: number, y: number, onClick: () => void) {
        const button = this.makeShape(parent, 'ActionButton', width, height, this.theme.hit, 18, this.theme.noteBorder, 1.5);
        button.setPosition(x, y, 0);
        this.makeText(button, 'Label', 0, 0, 20, new Color(255, 249, 225, 255), width - 12).string = text;
        const component = button.addComponent(Button);
        component.transition = Button.Transition.SCALE;
        component.zoomScale = 0.96;
        button.on(Button.EventType.CLICK, onClick, this);
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

    private makeText(parent: Node, name: string, x: number, y: number, size: number, color: Color, width: number): Label {
        const node = new Node(name);
        node.setParent(parent);
        node.addComponent(UITransform).setContentSize(width, size + 14);
        node.setPosition(x, y, 0);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 8;
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    private static themeFor(theme: LevelDefinition['visualTheme']): ThemeColors {
        const c = (r: number, g: number, b: number, a = 255) => new Color(r, g, b, a);
        const themes: Record<LevelDefinition['visualTheme'], ThemeColors> = {
            amber:    { panel: c(255,239,194,246), border: c(139,63,27),  lane: c(139,63,27,66),  laneAlt: c(255,255,255,34), hit: c(200,105,34), note: c(231,151,53), noteBorder: c(121,59,27), text: c(121,59,27) },
            leaf:     { panel: c(235,244,207,246), border: c(81,112,51),  lane: c(81,112,51,68),  laneAlt: c(255,255,255,38), hit: c(103,147,52), note: c(145,178,72), noteBorder: c(65,95,42), text: c(65,95,42) },
            sky:      { panel: c(220,241,246,246), border: c(52,118,137), lane: c(52,118,137,68), laneAlt: c(255,255,255,45), hit: c(48,151,181), note: c(83,179,205), noteBorder: c(39,100,119), text: c(39,100,119) },
            coral:    { panel: c(255,231,207,246), border: c(174,78,49),  lane: c(174,78,49,68),  laneAlt: c(255,255,255,38), hit: c(219,96,56), note: c(237,132,78), noteBorder: c(145,61,39), text: c(145,61,39) },
            plum:     { panel: c(246,229,238,246), border: c(129,73,105), lane: c(129,73,105,68), laneAlt: c(255,255,255,42), hit: c(179,84,139), note: c(202,116,160), noteBorder: c(108,57,88), text: c(108,57,88) },
            mint:     { panel: c(220,244,231,246), border: c(48,122,96),  lane: c(48,122,96,68),  laneAlt: c(255,255,255,44), hit: c(48,157,119), note: c(79,185,144), noteBorder: c(39,101,79), text: c(39,101,79) },
            dawn:     { panel: c(255,237,205,246), border: c(170,100,39), lane: c(170,100,39,68), laneAlt: c(255,255,255,38), hit: c(226,132,37), note: c(244,164,58), noteBorder: c(142,80,29), text: c(142,80,29) },
            violet:   { panel: c(234,229,249,246), border: c(97,75,156),  lane: c(97,75,156,68), laneAlt: c(255,255,255,42), hit: c(125,91,201), note: c(151,117,219), noteBorder: c(78,60,128), text: c(78,60,128) },
            festival: { panel: c(255,235,201,246), border: c(159,73,35), lane: c(159,73,35,68), laneAlt: c(255,255,255,38), hit: c(210,68,39), note: c(232,116,39), noteBorder: c(130,57,27), text: c(130,57,27) },
        };
        return themes[theme];
    }

    onDestroy() {
        this.clearNotes();
        this.root?.destroy();
        this.root = null;
    }
}
