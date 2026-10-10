import { _decorator, BlockInputEvents, Button, Color, Component, Graphics, Label, Node, sys, tween, Tween, UITransform, Vec3, Widget } from 'cc';
import { KalimbaKey } from '../KalimbaKey';
import type { JudgeEvent, LevelDefinition, LevelNote } from '../gameplay/LevelTypes';
const { ccclass } = _decorator;

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
    onToggleRhythm: () => void;
    onToggleFollow: () => void;
};

const TUTORIAL_KEY = 'kalinba_challenge_tutorial_seen_v1';

/**
 * 挑战专用落键舞台。时间轴由 ChallengeSession 的单调时钟驱动，画面只负责展示，
 * 因此暂停、低帧率和界面动画都不会改变判定结果。
 */
@ccclass('FallingNoteStage')
export class FallingNoteStage extends Component {
    private root: Node | null = null;
    private scoreLabel: Label | null = null;
    private comboLabel: Label | null = null;
    private feedbackLabel: Label | null = null;
    private progressGraphics: Graphics | null = null;
    private laneGraphics: Graphics | null = null;
    private feedbackEffectGraphics: Graphics | null = null;
    private noteLayer: Node | null = null;
    private consumedNoteIndices = new Set<number>();
    private consumeEffects: Array<{ x: number; grade: JudgeEvent['grade']; startedAtMs: number; consumed: boolean }> = [];
    private modal: Node | null = null;
    private pauseLabel: Label | null = null;
    private rhythmLabel: Label | null = null;
    private followLabel: Label | null = null;
    private level: LevelDefinition | null = null;
    private startedAtSec = 0;
    private audioNow: (() => number | null) | null = null;
    private running = false;
    private paused = false;
    private followMode = false;
    private score = 0;
    private debugLastTimelineBucket = Number.MIN_SAFE_INTEGER;
    private debugDidDrawNote = false;
    private stageWidth = 1160;
    private stageHeight = 420;
    private laneWidth = 1080;
    private laneTopY = 82;
    private hitY = -126;
    private actions: StageActions | null = null;
    private theme: ThemeColors = FallingNoteStage.themeFor('amber');

    setTimelineClock(getNow: () => number | null) {
        this.audioNow = getNow;
    }

    prepareLevel(level: LevelDefinition, actions: StageActions, followMode = false) {
        this.ensureRoot();
        this.clearNotes();
        this.level = level;
        this.actions = actions;
        this.theme = FallingNoteStage.themeFor(level.visualTheme);
        this.running = false;
        this.paused = false;
        this.followMode = followMode;
        this.score = 0;
        this.consumedNoteIndices.clear();
        this.consumeEffects = [];
        this.debugLastTimelineBucket = Number.MIN_SAFE_INTEGER;
        this.debugDidDrawNote = false;
        console.log('[ChallengeDebug] stage.prepare ' + JSON.stringify({
            levelId: level.id,
            bpm: level.bpm,
            noteCount: level.notes.length,
            firstNotes: level.notes.slice(0, 4),
        }));
        if (this.root) {
            this.root.active = true;
            this.root.setSiblingIndex(this.node.children.length - 1);
        }
        this.refreshModeLabels();
        if (this.pauseLabel) this.pauseLabel.string = '暂停';
        this.setRhythmEnabled(false);
        this.redrawStage();
        this.drawProgress(0);
        this.showIntro();
    }

    startLevel(level: LevelDefinition, startedAtSec: number, followMode = false) {
        this.ensureRoot();
        this.clearNotes();
        this.level = level;
        this.theme = FallingNoteStage.themeFor(level.visualTheme);
        this.startedAtSec = startedAtSec;
        this.score = 0;
        this.consumedNoteIndices.clear();
        this.consumeEffects = [];
        this.running = true;
        this.paused = false;
        this.followMode = followMode;
        this.modal?.destroy();
        this.modal = null;
        if (this.root) {
            this.root.active = true;
            this.root.setSiblingIndex(this.node.children.length - 1);
        }
        this.refreshModeLabels(true);
        if (this.pauseLabel) this.pauseLabel.string = '暂停';
        this.redrawStage();
        this.drawProgress(0);
        // 不等下一帧才布置音符，避免部分小游戏设备首帧较慢时整段预备拍都是空画面。
        const now = this.audioNow?.();
        console.log('[ChallengeDebug] stage.start ' + JSON.stringify({
            levelId: level.id,
            noteCount: level.notes.length,
            startedAtSec,
            now,
            startedFinite: Number.isFinite(startedAtSec),
            nowFinite: Number.isFinite(now),
            hasLaneGraphics: !!this.laneGraphics,
            hasNoteLayer: !!this.noteLayer,
            rootActive: !!this.root?.active,
            keyCenters: Array.from({ length: 17 }, (_, index) => Math.round(this.keyToX(index))),
        }));
        if (now !== null && now !== undefined) this.renderTimeline(now);
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

    setRhythmEnabled(enabled: boolean, paused = false) {
        if (this.rhythmLabel) this.rhythmLabel.string = paused ? '节奏 暂停' : enabled ? '节奏 开' : '节奏 关';
    }

    setFollowMode(enabled: boolean) {
        this.followMode = enabled;
        this.refreshModeLabels();
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

    finishFollow(onAgain: () => void, onExit: () => void) {
        this.running = false;
        this.paused = false;
        this.clearNotes();
        if (!this.root) return;
        this.modal?.destroy();
        const width = 560;
        const height = 250;
        const modal = this.makeShape(this.root, 'FollowCompleteModal', width, height, new Color(255, 246, 218, 252), 24, this.theme.border, 3);
        modal.setSiblingIndex(this.root.children.length - 1);
        modal.addComponent(BlockInputEvents);
        this.modal = modal;
        this.makeText(modal, 'ModalTitle', 0, 72, 29, this.theme.text, width - 60).string = '跟弹完成';
        this.makeText(modal, 'ModalBody', 0, 20, 18, new Color(112, 81, 48, 255), width - 70).string = '没有评分，也不会记录失败。\n可以放松练习，熟悉后再切回挑战模式。';
        this.makeActionButton(modal, '退出', 190, 52, -108, -78, onExit);
        this.makeActionButton(modal, '再跟一遍', 190, 52, 108, -78, onAgain);
    }

    onJudge(event: JudgeEvent, totalScore: number) {
        this.score = totalScore;
        const text = event.grade === 'perfect' ? 'PERFECT'
            : event.grade === 'good' ? 'GOOD'
                : event.grade === 'bad' ? 'BAD' : 'MISS';
        if (this.feedbackLabel) this.feedbackLabel.string = event.scoreDelta > 0 ? `${text}  +${event.scoreDelta}` : text;
        if (this.comboLabel) this.comboLabel.string = `COMBO ${event.combo}`;
        if (this.scoreLabel) this.scoreLabel.string = `${totalScore} 分`;
        if (event.noteIndex !== undefined) this.consumedNoteIndices.add(event.noteIndex);
        this.playJudgeFeedback(event);
    }

    private playJudgeFeedback(event: JudgeEvent) {
        const color = event.grade === 'perfect' ? new Color(255, 185, 47, 255)
            : event.grade === 'good' ? new Color(86, 174, 94, 255)
                : event.grade === 'bad' ? new Color(224, 104, 49, 255)
                    : new Color(196, 66, 47, 255);
        const labelNode = this.feedbackLabel?.node;
        if (this.feedbackLabel) this.feedbackLabel.color = color;
        if (labelNode?.isValid) {
            Tween.stopAllByTarget(labelNode);
            labelNode.setScale(Vec3.ONE);
            const peak = event.grade === 'perfect' ? 1.32 : event.grade === 'good' ? 1.18 : 1.12;
            tween(labelNode)
                .to(0.055, { scale: new Vec3(peak, peak, 1) })
                .to(0.14, { scale: Vec3.ONE })
                .start();
        }

        const keyIndex = event.expectedKeyIndex ?? event.keyIndex;
        if (keyIndex >= 0 && keyIndex <= 16) {
            this.consumeEffects.push({
                x: this.keyToX(keyIndex),
                grade: event.grade,
                startedAtMs: FallingNoteStage.monotonicNowMs(),
                consumed: event.noteIndex !== undefined,
            });
        }
        this.renderConsumeEffects();
    }

    update() {
        if (!this.running || this.paused || !this.level || !this.noteLayer) return;
        const now = this.audioNow?.();
        if (now === null || now === undefined) return;
        this.renderTimeline(now);
    }

    private renderTimeline(now: number) {
        if (!this.running || !this.level || !this.noteLayer) return;
        // 场景里的 Toast、录制控件可能在运行中动态创建，每帧确保挑战舞台和音符层位于最前。
        this.root?.setSiblingIndex(this.node.children.length - 1);
        this.noteLayer.setSiblingIndex(Math.max(0, (this.root?.children.length ?? 1) - 1));
        const elapsed = now - this.startedAtSec;
        // 轨道高度有限：过长预览会把相邻音符挤在一起。
        // 前章仍保留更多反应时间，但控制在不会明显重叠的范围。
        const previewSec = this.level.chapter === 1 ? 3.0
            : this.level.chapter === 2 ? 2.8 : 2.6;
        const beatSec = 60 / this.level.bpm;

        if (elapsed < 0) {
            const count = Math.max(1, Math.min(3, Math.ceil(-elapsed / beatSec)));
            if (this.feedbackLabel) this.feedbackLabel.string = this.followMode ? `跟弹准备 ${count}` : `准备 ${count}`;
        } else if (this.followMode && this.feedbackLabel) {
            this.feedbackLabel.string = '横杠到达亮线时自由跟弹';
        }

        const lastBeat = this.level.notes[this.level.notes.length - 1]?.beat ?? 0;
        const duration = Math.max(beatSec, lastBeat * beatSec + beatSec);
        this.drawProgress(Math.max(0, Math.min(1, elapsed / duration)));

        // 复用已经稳定显示的轨道 Graphics 绘制音符：轨道能显示时，
        // 音符必然走同一渲染组件与坐标空间。子节点只承担数字文字。
        const graphics = this.laneGraphics;
        if (graphics) this.drawLanes(graphics);
        // 窄横杠比带数字的大音符更容易对准判定线，也不会遮住紧邻节拍。
        const noteWidth = Math.max(38, Math.min(48, this.laneWidth / 17 - 10));
        const noteHeight = 12;
        let visibleCount = 0;
        let nextNote: LevelNote | null = null;

        // 直接读取原始谱面计算位置，Miss/得分回调不再维护另一份显示队列。
        for (let noteIndex = 0; noteIndex < this.level.notes.length; noteIndex++) {
            if (this.consumedNoteIndices.has(noteIndex)) continue;
            const note = this.level.notes[noteIndex];
            const targetAt = note.beat * beatSec;
            const delta = targetAt - elapsed;
            if (!nextNote && delta >= -0.34) nextNote = note;
            const visible = delta >= -0.34 && delta <= previewSec;
            if (visible) {
                visibleCount += 1;
                const ratio = delta / previewSec;
                const x = this.keyToX(note.keyIndex);
                const y = this.hitY + ratio * (this.laneTopY - this.hitY);
                const passedRatio = delta < 0 ? Math.max(0, Math.min(1, (delta + 0.34) / 0.34)) : 1;
                if (graphics) this.drawBatchNote(graphics, x, y, noteWidth, noteHeight, passedRatio);
            }
        }
        // 长休止或个别平台首帧时钟抖动时，也预先停放下一音在轨道顶部，
        // 避免玩家面对完全空白的谱面，只等到 MISS 才知道下一键。
        if (visibleCount === 0 && nextNote) {
            const x = this.keyToX(nextNote.keyIndex);
            if (graphics) this.drawBatchNote(graphics, x, this.laneTopY, noteWidth, noteHeight);
        }
        this.renderConsumeEffects();
        const bucket = Number.isFinite(elapsed) ? Math.floor(elapsed * 2) : Number.MAX_SAFE_INTEGER;
        if (bucket !== this.debugLastTimelineBucket) {
            this.debugLastTimelineBucket = bucket;
            console.log('[ChallengeDebug] stage.timeline ' + JSON.stringify({
                now,
                startedAtSec: this.startedAtSec,
                elapsed,
                nowFinite: Number.isFinite(now),
                startedFinite: Number.isFinite(this.startedAtSec),
                elapsedFinite: Number.isFinite(elapsed),
                noteCount: this.level.notes.length,
                visibleCount,
                nextNote,
                graphicsValid: !!graphics?.isValid,
            }));
        }
    }

    private drawBatchNote(graphics: Graphics, x: number, y: number, width: number, height: number, life = 1) {
        if (!this.debugDidDrawNote) {
            this.debugDidDrawNote = true;
            console.log('[ChallengeDebug] stage.drawFirstNote ' + JSON.stringify({
                x, y, width, height,
                color: { r: this.theme.note.r, g: this.theme.note.g, b: this.theme.note.b, a: this.theme.note.a },
                graphicsValid: !!graphics.isValid,
            }));
        }
        const alpha = Math.round(255 * (0.18 + life * 0.82));
        const visibleWidth = width * (0.62 + life * 0.38);
        graphics.fillColor = new Color(this.theme.hit.r, this.theme.hit.g, this.theme.hit.b, Math.round(92 * life));
        graphics.roundRect(x - visibleWidth / 2 - 5, y - height / 2 - 4, visibleWidth + 10, height + 8, 10);
        graphics.fill();

        graphics.fillColor = new Color(this.theme.note.r, this.theme.note.g, this.theme.note.b, alpha);
        graphics.roundRect(x - visibleWidth / 2, y - height / 2, visibleWidth, height, height / 2);
        graphics.fill();
        graphics.strokeColor = new Color(this.theme.noteBorder.r, this.theme.noteBorder.g, this.theme.noteBorder.b, alpha);
        graphics.lineWidth = 2;
        graphics.roundRect(x - visibleWidth / 2, y - height / 2, visibleWidth, height, height / 2);
        graphics.stroke();
        graphics.strokeColor = new Color(255, 249, 225, Math.round(190 * life));
        graphics.lineWidth = 2;
        graphics.moveTo(x - visibleWidth / 2 + 7, y + 1);
        graphics.lineTo(x + visibleWidth / 2 - 7, y + 1);
        graphics.stroke();
    }

    private renderConsumeEffects() {
        const graphics = this.feedbackEffectGraphics;
        if (!graphics) return;
        graphics.clear();
        const now = FallingNoteStage.monotonicNowMs();
        this.consumeEffects = this.consumeEffects.filter((effect) => now - effect.startedAtMs < 360);
        for (const effect of this.consumeEffects) {
            const progress = Math.max(0, Math.min(1, (now - effect.startedAtMs) / 360));
            const remain = 1 - progress;
            const base = effect.grade === 'perfect' ? new Color(255, 185, 47, 255)
                : effect.grade === 'good' ? new Color(86, 174, 94, 255)
                    : effect.grade === 'bad' ? new Color(224, 104, 49, 255)
                        : new Color(196, 66, 47, 255);
            graphics.strokeColor = new Color(base.r, base.g, base.b, Math.round(230 * remain));
            graphics.lineWidth = effect.grade === 'perfect' ? 5 : 3;
            graphics.circle(effect.x, this.hitY, 16 + progress * 28);
            graphics.stroke();
            if (!effect.consumed) continue;
            const direction = effect.grade === 'miss' ? -1 : 1;
            const centerY = this.hitY + direction * progress * 28;
            graphics.fillColor = new Color(base.r, base.g, base.b, Math.round(210 * remain));
            graphics.roundRect(effect.x - 24 * remain, centerY - 5 * remain, 48 * remain, 10 * remain, 5);
            graphics.fill();
            graphics.strokeColor = new Color(base.r, base.g, base.b, Math.round(190 * remain));
            graphics.lineWidth = 3;
            for (let i = 0; i < 4; i++) {
                const side = i % 2 === 0 ? -1 : 1;
                const vertical = i < 2 ? -1 : 1;
                graphics.moveTo(effect.x + side * 8, this.hitY + vertical * 2);
                graphics.lineTo(effect.x + side * (12 + progress * 25), this.hitY + vertical * (5 + progress * 18));
            }
            graphics.stroke();
        }
    }

    private ensureRoot() {
        if (this.root?.isValid) return;
        const parentUi = this.node.getComponent(UITransform);
        const canvasW = parentUi?.width ?? 1280;
        const canvasH = parentUi?.height ?? 720;
        this.stageWidth = Math.min(1180, canvasW - 30);
        // 上半区只承担落键提示，给下半区实体琴键保留完整触控高度。
        this.stageHeight = Math.min(350, canvasH * 0.50);
        this.laneWidth = this.stageWidth - 72;
        this.laneTopY = this.stageHeight / 2 - 105;
        this.hitY = -this.stageHeight / 2 + 48;

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
        this.rhythmLabel = this.makeControlButton(root, 'RhythmButton', '节奏 关', this.stageWidth / 2 - 312, headerY, 106, () => this.actions?.onToggleRhythm());
        this.followLabel = this.makeControlButton(root, 'FollowButton', '模式 挑战', 158, headerY, 104, () => this.actions?.onToggleFollow());

        const progress = new Node('Progress');
        progress.setParent(root);
        progress.addComponent(UITransform).setContentSize(this.stageWidth - 46, 10);
        progress.setPosition(0, this.stageHeight / 2 - 78, 0);
        this.progressGraphics = progress.addComponent(Graphics);

        const lanes = new Node('LaneLines');
        lanes.setParent(root);
        lanes.addComponent(UITransform).setContentSize(this.laneWidth, this.laneTopY - this.hitY + 16);
        this.laneGraphics = lanes.addComponent(Graphics);

        const noteLayer = new Node('Notes');
        noteLayer.setParent(root);
        noteLayer.addComponent(UITransform).setContentSize(this.laneWidth, this.laneTopY - this.hitY + 20);
        this.noteLayer = noteLayer;
        const effects = new Node('JudgeEffects');
        effects.setParent(root);
        effects.addComponent(UITransform).setContentSize(this.laneWidth, this.stageHeight);
        this.feedbackEffectGraphics = effects.addComponent(Graphics);
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
        const lastBeat = this.level.notes[this.level.notes.length - 1]?.beat ?? 0;
        const durationSec = Math.ceil(lastBeat * 60 / this.level.bpm);
        this.showMessageModal(
            `《${this.level.title}》`,
            `${this.level.subtitle}\n${this.level.bpm} BPM · 约 ${durationSec} 秒 · ${this.level.notes.length} 个音符\n\n${this.followMode ? '跟弹模式不评分：看横杠自由练习' : '横杠落到判定线时，点击对应轨道的琴键'}`,
            this.followMode ? '开始跟弹' : '开始挑战',
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
        this.makeText(modal, 'Step1', -205, 58, 19, this.theme.text, 210).string = '① 看节奏横杠向下落';
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
        const sample = this.makeShape(demoLane, 'SampleNote', 72, 12, this.theme.note, 6, this.theme.noteBorder, 2);
        sample.setPosition(-120, 12, 0);
        this.makeText(demoLane, 'Arrow', -50, 10, 28, this.theme.hit, 60).string = '↓';
        this.makeText(demoLane, 'HitHint', 105, -22, 17, this.theme.text, 250).string = '到这里时弹奏';

        this.makeText(modal, 'Hint', 0, -70, 16, new Color(126, 96, 59, 255), 650).string =
            this.followMode
                ? '跟弹模式没有 PERFECT / GOOD / BAD / MISS，也不会影响成绩'
                : '越贴近判定线越准：PERFECT / GOOD / BAD / MISS；右上可开启节奏提示';
        const actionText = startMode
            ? (this.followMode ? '我懂了，开始跟弹' : '我懂了，开始')
            : (this.followMode ? '继续跟弹' : '继续挑战');
        this.makeActionButton(modal, actionText, 230, 54, 0, -115, () => {
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

    private keyToX(keyIndex: number): number {
        const safe = Math.max(0, Math.min(16, keyIndex));
        const key = KalimbaKey.getByIndex(safe);
        const rootTransform = this.root?.getComponent(UITransform);
        if (key?.node?.isValid && rootTransform) {
            return rootTransform.convertToNodeSpaceAR(key.node.worldPosition).x;
        }
        return -this.laneWidth / 2 + (this.laneWidth / 17) * (safe + 0.5);
    }

    private clearNotes() {
        // 微信真机场景销毁时组件会先失效、随后 GameScene/FallingNoteStage 都收到 onDestroy。
        // 此阶段继续给 Graphics 写 Color 会触发 EngineError 5000 并中断场景切换。
        if (this.laneGraphics?.isValid && this.laneGraphics.node?.isValid) this.drawLanes(this.laneGraphics);
        if (this.feedbackEffectGraphics?.isValid && this.feedbackEffectGraphics.node?.isValid) {
            this.feedbackEffectGraphics.clear();
        }
    }

    private refreshModeLabels(countIn = false) {
        if (this.followLabel) this.followLabel.string = this.followMode ? '模式 跟弹' : '模式 挑战';
        if (this.scoreLabel) this.scoreLabel.string = this.followMode ? '自由跟弹' : '0 分';
        if (this.comboLabel) this.comboLabel.string = this.followMode ? '' : 'COMBO 0';
        if (this.feedbackLabel) {
            this.feedbackLabel.string = countIn
                ? (this.followMode ? '跟弹准备 3' : '准备 3')
                : (this.followMode ? '只看落键提示，不评分' : `${this.level?.title ?? ''} · ${this.level?.bpm ?? 0} BPM`);
        }
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

        if (this.laneGraphics) this.drawLanes(this.laneGraphics);

        const title = this.root.getChildByName('Title')?.getComponent(Label);
        if (title && this.level) title.string = `《${this.level.title}》  ·  ${this.level.bpm} BPM`;
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

    private drawLanes(graphics: Graphics) {
        if (!graphics.isValid || !graphics.node?.isValid || !this.node.isValid) return;
        graphics.clear();
        const laneW = this.laneWidth / 17;
        // 半透明命中带把判定区域从一根抽象细线变成明确目标，但保持足够窄。
        graphics.fillColor = new Color(this.theme.hit.r, this.theme.hit.g, this.theme.hit.b, 34);
        graphics.roundRect(-this.laneWidth / 2, this.hitY - 10, this.laneWidth, 20, 10);
        graphics.fill();
        for (let i = 0; i < 17; i++) {
            if (i % 2 === 0) {
                graphics.fillColor = this.theme.laneAlt;
                graphics.rect(-this.laneWidth / 2 + i * laneW, this.hitY, laneW, this.laneTopY - this.hitY);
                graphics.fill();
            }
        }
        graphics.strokeColor = this.theme.lane;
        graphics.lineWidth = 1;
        for (let i = 0; i <= 17; i++) {
            const x = -this.laneWidth / 2 + laneW * i;
            graphics.moveTo(x, this.hitY);
            graphics.lineTo(x, this.laneTopY);
        }
        graphics.stroke();
        graphics.strokeColor = this.theme.hit;
        graphics.lineWidth = 5;
        graphics.moveTo(-this.laneWidth / 2, this.hitY);
        graphics.lineTo(this.laneWidth / 2, this.hitY);
        graphics.stroke();
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
        this.running = false;
        this.paused = false;
        this.actions = null;
        // 节点树已由 Cocos 统一销毁；这里不再重画或二次 destroy 子节点。
        this.root = null;
        this.laneGraphics = null;
        this.progressGraphics = null;
        this.feedbackEffectGraphics = null;
        this.noteLayer = null;
        this.modal = null;
    }

    private static monotonicNowMs(): number {
        const perf = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
        const value = perf?.now?.();
        return Number.isFinite(value) ? value! : Date.now();
    }
}
