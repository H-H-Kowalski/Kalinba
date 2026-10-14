import { _decorator, BlockInputEvents, Button, Color, Component, Game, Graphics, Label, Node, UITransform, Vec3, Widget, director, game, sys, isValid } from 'cc';
import { KalimbaManager } from '../manager/KalimbaManager';
import { AudioManager } from '../manager/AudioManager';
import { AudioSettingsStore } from '../manager/AudioSettingsStore';
import { applySavedFontToSubtree } from '../manager/GlobalFontApplier';
import { SceneManager } from '../manager/SceneManager';
import { SheetMusicBackground } from './SheetMusicBackground';
import { showToast } from './SimpleToast';
import { showBusyIndicator, showPlaybackNotice, confirmShareImageSave } from './AppearanceFeedback';
import { PerformanceRecorder } from '../manager/PerformanceRecorder';
import { ContentSecurityService, ContentSecurityError } from '../manager/ContentSecurityService';
import { PerformanceCloudService, getPerformanceShareEnvironment, type ShareCodeEnvironment } from '../manager/PerformanceCloudService';
import { PerformancePlayer } from '../manager/PerformancePlayer';
import { PERFORMANCE_MAX_DURATION_MS, type PerformanceRecord } from '../manager/PerformanceTypes';
import { AchievementCloudService } from '../manager/AchievementCloudService';
import { installShareLaunchCapture, onPendingGameLaunch, takePendingSharedRecordId } from '../manager/PerformanceShareLaunch';
import { getWx } from '../manager/WeChatNative';
import { ImageExportError, loadShareCodeImage, saveShareImageToAlbum } from '../manager/PerformanceImageExport';
import { DEFAULT_SHARE_POSTER_STYLE, drawSharePoster, loadSharePosterArt, type SharePosterStyle } from '../manager/PerformanceSharePoster';
import { LevelProgressStore } from '../manager/LevelProgressStore';
import { ChallengeLaunchStore } from '../manager/ChallengeLaunchStore';
import { MetronomeController } from '../manager/MetronomeController';
import { KalimbaKey } from '../KalimbaKey';
import { ChallengeSession } from '../gameplay/ChallengeSession';
import { getLevelById, getNextLevel } from '../gameplay/LevelCatalog';
import type { JudgeEvent, LevelResult } from '../gameplay/LevelTypes';
import { PracticeOverlay } from './PracticeOverlay';
import { FallingNoteStage } from './FallingNoteStage';
import { getAchievementById, resolveAchievementIds, type AchievementDefinition } from '../gameplay/AchievementCatalog';
import { EditableCaption } from './EditableCaption';
import { ProceduralMenuBgm } from '../manager/ProceduralMenuBgm';
import { installPerformanceShareMenu, isTimelineShareAvailable, setPreparedPerformanceShare,
    clearPreparedPerformanceShare, setReceivedPerformanceShare, showTimelineShareGuide } from '../manager/PerformanceShareMenu';
const { ccclass, property } = _decorator;

/**
 * 弹琴场景 playscene：主玩法 + 回首页 + 进设置。
 * 音色与合成档位等放在 settingscene，由 SettingsScene 管理；听感音量由系统音量键调节，应用内默认主增益见 AudioSettingsStore.DEFAULT_APP_GAIN。
 */
@ccclass('GameScene')
export class GameScene extends Component {
    private static readonly CAPTION_DEFAULT_TEXT = '《生日快乐》';
    private static readonly RECORD_GUIDE_STORAGE_KEY = 'kalinba_record_guide_seen_v1';

    @property(KalimbaManager)
    kalimbaManager: KalimbaManager = null;

    @property(SheetMusicBackground)
    sheetMusicBackground: SheetMusicBackground = null;

    @property(Button)
    backButton: Button = null;

    @property(Button)
    settingsButton: Button = null;

    @property(Button)
    recordStartButton: Button = null;

    /** 可选：录制按钮上的“开始”图标节点（录制中会隐藏） */
    @property(Node)
    recordIconStartNode: Node = null;

    /** 可选：录制按钮上的“停止”图标节点（录制中会显示） */
    @property(Node)
    recordIconStopNode: Node = null;

    /** 可选：录制按钮上的文字（自动切换“开始录制/停止录制”） */
    @property(Label)
    recordToggleLabel: Label = null;

    @property(Button)
    recordShareButton: Button = null;

    @property(Button)
    replayLastButton: Button = null;

    /** 可选：绑定演奏页的节拍器按钮；未绑定不影响自由弹奏。 */
    @property(Button)
    metronomeButton: Button = null;

    /** 可选：显示“♩=80 / 关闭”等节拍器状态。 */
    @property(Label)
    metronomeStatusLabel: Label = null;

    @property(Label)
    challengeFeedbackLabel: Label = null;

    private audioManager: AudioManager = null;
    private _syncRetry = 0;
    private lastRecord: PerformanceRecord | null = null;
    private canShareRecordedResult = false;
    private shareBusy = false;
    private shareRequest = 0;
    private warnedInvalidRecordIconBinding = false;
    private warnedSameRecordIconBinding = false;
    private _playbackLocked = false;
    private metronomeController: MetronomeController | null = null;
    private challengeSession: ChallengeSession | null = null;
    private challengeScore = 0;
    private challengeRhythmEnabled = false;
    private challengeFollowMode = false;
    private practiceOverlay: PracticeOverlay | null = null;
    private fallingNoteStage: FallingNoteStage | null = null;
    private editableCaption: EditableCaption | null = null;
    private unsubscribePendingGameLaunch: (() => void) | null = null;
    private sharedPlaybackLaunch = false;
    private sharedPlaybackRequest = 0;
    private closeSharedFeedback: (() => void) | null = null;
    private closeShareLoading: (() => void) | null = null;
    private cancelImageExport: (() => void) | null = null;
    private sharePosterStyle: SharePosterStyle = { ...DEFAULT_SHARE_POSTER_STYLE };
    private imageExportRecord: { source: PerformanceRecord; caption: string; recordId: string } | null = null;
    private playbackInputBlocker: BlockInputEvents | null = null;
    private lastChallengeLevelId = 'c1-01';
    private activeChallengeLevelId: string | null = null;
    private challengeChromeState = new Map<Node, boolean>();
    private immersiveButtonNode: Node | null = null;
    private immersiveButtonLabel: Label | null = null;
    private immersiveModeActive = false;
    private immersiveChromeState = new Map<Node, boolean>();
    private sceneActive = true;
    private sceneStarted = false;
    private sceneDisposed = false;
    private challengeRequest = 0;
    private rhythmRequest = 0;
    private metronomeRequest = 0;
    private progressRequest = 0;
    private isSceneCurrent(): boolean { return this.sceneActive && !this.sceneDisposed && isValid(this, true); }
    private onGameHide = () => {
        if (!this.isSceneCurrent()) return;
        this.challengeRequest++; this.rhythmRequest++; this.metronomeRequest++;
        if (this.sharedPlaybackLaunch) this.finishSharedPlayback();
        // 微信切到聊天、接电话或锁屏时不能让谱面继续跑；恢复后由玩家主动继续。
        if (this.activeChallengeLevelId && this.challengeSession?.isActive() && !this.challengeSession.isPaused()) {
            this.toggleChallengePause();
        }
        if (this.activeChallengeLevelId && !this.challengeSession?.isActive()) this.challengeSession?.stop();
        this.metronomeController?.stopMetronome();
    };

    update() { PerformancePlayer.update(); }

    start() {
        this.sceneStarted = true;
        // 自由演奏与挑战演奏共用 playscene；两种模式均禁止菜单 BGM 混入。
        ProceduralMenuBgm.stop(true);
        installShareLaunchCapture();
        installPerformanceShareMenu();
        game.on(Game.EVENT_HIDE, this.onGameHide, this);
        if (!this.sheetMusicBackground) {
            this.sheetMusicBackground =
                this.node.scene.getComponentInChildren(SheetMusicBackground) ?? null;
            console.log(`[AutoScroll] GameScene.start: 自动查找 sheetMusicBackground=${!!this.sheetMusicBackground}`);
        }
        this.setupUI();
        this.editableCaption = this.node.scene.getComponentInChildren(EditableCaption) ?? null;
        this.setupAudioManager();
        this.setupMetronome();
        this.setupChallengeSession();
        this.setupPracticeOverlay();
        this.setupFallingNoteStage();
        this.setupSharedLaunchHandling();
        this.consumeChallengeLaunchSoon();
        this.syncPendingChallengeResultsSoon();
        this.syncAudioFromStoreSoon();
        this.scheduleOnce(() => {
            void applySavedFontToSubtree(this.node);
        }, 0);
    }

    setupUI() {
        this.autoBindRecordUiFallback();
        if (this.backButton) {
            this.backButton.node.on(Button.EventType.CLICK, this.onBackButtonClick, this);
        }
        if (this.settingsButton) {
            this.settingsButton.interactable = true;
            this.settingsButton.node.on(Button.EventType.CLICK, this.openSettingsScene, this);
        }
        this.recordStartButton?.node.on(Button.EventType.CLICK, this.onToggleRecordClick, this);
        this.metronomeButton?.node.on(Button.EventType.CLICK, this.onMetronomeClick, this);
        // 回放与分享进入“录制结果卡”，不再占用常驻工具栏。
        if (this.recordShareButton?.node) this.recordShareButton.node.active = false;
        if (this.replayLastButton?.node) this.replayLastButton.node.active = false;
        this.refreshRecordButtons();
        this.organizeFreePlaySideButtons();
        this.setupImmersiveButton();
        // Widget/适配策略可能在首帧再次刷新尺寸，下一帧按微信胶囊位置复核一次。
        this.scheduleOnce(() => this.organizeFreePlaySideButtons(), 0);
    }

    /** 自由演奏右侧功能组：设置、选谱、录制、回放、分享，统一圆形浅色按钮底。 */
    private organizeFreePlaySideButtons() {
        const chooseNode = this.sheetMusicBackground?.node.getChildByName('chooseButton') ?? null;
        const railParent = this.settingsButton?.node.parent ?? chooseNode?.parent ?? null;
        const firstY = this.getWechatSafeRightRailStartY(railParent);
        const controls: Array<{ node: Node | null; y: number }> = [
            { node: this.settingsButton?.node ?? null, y: firstY },
            { node: chooseNode, y: firstY - 70 },
            { node: this.recordStartButton?.node ?? null, y: firstY - 140 },
        ];
        const rightX = Math.abs(this.settingsButton?.node.position.x ?? 605) || 605;
        for (const item of controls) {
            const node = item.node;
            const parent = node?.parent;
            if (!node?.isValid || !parent?.isValid) continue;
            node.setPosition(rightX, item.y, node.position.z);
            const chromeName = `${node.name}_Chrome`;
            let chrome = parent.getChildByName(chromeName);
            if (!chrome) {
                chrome = new Node(chromeName);
                chrome.layer = node.layer;
                chrome.setParent(parent);
                chrome.addComponent(UITransform).setContentSize(56, 56);
                chrome.addComponent(Graphics);
            }
            this.drawFreePlayIconChrome(chrome);
            chrome.setPosition(rightX, item.y, 0);
            chrome.setSiblingIndex(node.getSiblingIndex());
            node.setSiblingIndex(chrome.getSiblingIndex() + 1);
        }
        for (const removed of [this.replayLastButton?.node, this.recordShareButton?.node]) {
            if (!removed?.isValid) continue;
            removed.active = false;
            const oldChrome = removed.parent?.getChildByName(`${removed.name}_Chrome`);
            if (oldChrome?.isValid) oldChrome.active = false;
        }
    }

    /** 木纹背景上的按钮采用低饱和焦糖色，避免高亮奶油白形成网页悬浮控件感。 */
    private drawFreePlayIconChrome(chrome: Node) {
        const graphics = chrome.getComponent(Graphics);
        if (!graphics) return;
        graphics.clear();
        // 很轻的下投影，只负责从木纹中分离，不做厚重拟物凸起。
        graphics.fillColor = new Color(48, 24, 10, 72);
        graphics.circle(0, -2.5, 28);
        graphics.fill();
        graphics.fillColor = new Color(226, 184, 112, 252);
        graphics.circle(0, 0, 26);
        graphics.fill();
        graphics.strokeColor = new Color(104, 55, 28, 238);
        graphics.lineWidth = 2.2;
        graphics.circle(0, 0, 26);
        graphics.stroke();
        // 上沿柔光呼应琴体金属高光，同时控制透明度避免发白。
        graphics.strokeColor = new Color(255, 229, 174, 118);
        graphics.lineWidth = 1.2;
        graphics.arc(0, 1, 22.5, Math.PI * 0.18, Math.PI * 0.82, false);
        graphics.stroke();
    }

    /** 左下角低存在感入口：沉浸时它是唯一保留的功能按钮。 */
    private setupImmersiveButton() {
        if (this.immersiveButtonNode?.isValid) return;
        const node = new Node('ImmersiveToggleButton');
        node.layer = this.node.layer;
        node.setParent(this.node);
        node.addComponent(UITransform).setContentSize(72, 38);
        node.addComponent(Graphics);
        const widget = node.addComponent(Widget);
        widget.isAlignLeft = true;
        widget.left = 13;
        widget.isAlignBottom = true;
        widget.bottom = 13;
        widget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

        const labelNode = new Node('Label');
        labelNode.layer = node.layer;
        labelNode.setParent(node);
        labelNode.addComponent(UITransform).setContentSize(64, 32);
        const label = labelNode.addComponent(Label);
        label.string = '沉浸';
        label.fontSize = 16;
        label.lineHeight = 20;
        label.color = new Color(75, 41, 23, 255);
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;

        const button = node.addComponent(Button);
        button.transition = Button.Transition.SCALE;
        button.zoomScale = 0.95;
        node.on(Button.EventType.CLICK, this.toggleImmersiveMode, this);
        this.immersiveButtonNode = node;
        this.immersiveButtonLabel = label;
        this.drawImmersiveButton();
    }

    private drawImmersiveButton() {
        const node = this.immersiveButtonNode;
        const graphics = node?.getComponent(Graphics);
        if (!node || !graphics) return;
        graphics.clear();
        if (this.immersiveModeActive) {
            // 沉浸时只保留一个接近木纹水印的恢复入口；点击热区仍由 72×38 的节点保证。
            graphics.fillColor = new Color(34, 18, 9, 34);
            graphics.roundRect(-36, -14, 50, 25, 12);
            graphics.fill();
            graphics.fillColor = new Color(91, 53, 29, 92);
            graphics.roundRect(-36, -12, 48, 23, 11);
            graphics.fill();
            graphics.strokeColor = new Color(211, 166, 96, 72);
            graphics.lineWidth = 1;
            graphics.roundRect(-36, -12, 48, 23, 11);
            graphics.stroke();
        } else {
            graphics.fillColor = new Color(45, 22, 9, 58);
            graphics.roundRect(-36, -21, 72, 38, 18);
            graphics.fill();
            graphics.fillColor = new Color(226, 184, 112, 224);
            graphics.roundRect(-36, -19, 72, 36, 18);
            graphics.fill();
            graphics.strokeColor = new Color(104, 55, 28, 220);
            graphics.lineWidth = 1.6;
            graphics.roundRect(-36, -19, 72, 36, 18);
            graphics.stroke();
        }
        if (this.immersiveButtonLabel) {
            this.immersiveButtonLabel.string = this.immersiveModeActive ? '显示' : '沉浸';
            this.immersiveButtonLabel.fontSize = this.immersiveModeActive ? 13 : 16;
            this.immersiveButtonLabel.color = this.immersiveModeActive
                ? new Color(236, 201, 143, 148)
                : new Color(75, 41, 23, 255);
            this.immersiveButtonLabel.node.setPosition(this.immersiveModeActive ? -12 : 0, 0, 0);
        }
    }

    private toggleImmersiveMode() {
        this.immersiveModeActive = !this.immersiveModeActive;
        this.practiceOverlay?.setImmersiveMode(this.immersiveModeActive);
        const controls = [
            this.backButton?.node,
            this.settingsButton?.node,
            this.sheetMusicBackground?.node.getChildByName('chooseButton'),
            this.recordStartButton?.node,
            this.replayLastButton?.node,
            this.recordShareButton?.node,
            this.metronomeButton?.node,
            this.metronomeStatusLabel?.node,
        ].filter((item): item is Node => !!item?.isValid);
        const chromeNodes = controls
            .map((control) => control.parent?.getChildByName(`${control.name}_Chrome`) ?? null)
            .filter((item): item is Node => !!item?.isValid);
        const candidates = Array.from(new Set([...controls, ...chromeNodes]));
        if (this.immersiveModeActive) {
            for (const candidate of candidates) {
                if (!this.immersiveChromeState.has(candidate)) {
                    this.immersiveChromeState.set(candidate, candidate.active);
                }
                candidate.active = false;
            }
        } else {
            for (const [candidate, wasActive] of this.immersiveChromeState) {
                if (candidate.isValid) candidate.active = wasActive;
            }
            this.immersiveChromeState.clear();
        }
        this.drawImmersiveButton();
    }

    /**
     * 把右侧第一颗按钮放到微信胶囊下方。微信坐标以屏幕左上为原点，
     * Cocos UI 以画布中心为原点，因此按实际 windowHeight 换算，不能写死机型像素。
     */
    private getWechatSafeRightRailStartY(parent: Node | null): number {
        if (!parent?.isValid) return 70;
        const wxApi = getWx() as {
            getMenuButtonBoundingClientRect?: () => { bottom?: number };
            getWindowInfo?: () => { windowHeight?: number };
            getSystemInfoSync?: () => { windowHeight?: number };
        } | undefined;
        if (!wxApi?.getMenuButtonBoundingClientRect) return 70;
        try {
            const menuBottomPx = Number(wxApi.getMenuButtonBoundingClientRect()?.bottom);
            let windowHeightPx = Number.NaN;
            try {
                windowHeightPx = Number(wxApi.getWindowInfo?.().windowHeight);
            } catch {
                // 部分较旧基础库虽暴露 getWindowInfo，但调用时仍可能抛错。
            }
            if (!Number.isFinite(windowHeightPx) || windowHeightPx <= 0) {
                try {
                    windowHeightPx = Number(wxApi.getSystemInfoSync?.().windowHeight);
                } catch {
                    // 使用下方的保守默认位置。
                }
            }
            const canvasUi = this.node.getComponent(UITransform);
            const parentUi = parent.getComponent(UITransform);
            const canvasH = Number(canvasUi?.height);
            if (!canvasUi || !parentUi || !Number.isFinite(menuBottomPx) || !Number.isFinite(windowHeightPx) || !Number.isFinite(canvasH) || windowHeightPx <= 0 || canvasH <= 0) {
                return 70;
            }
            const menuBottomDesign = menuBottomPx * canvasH / windowHeightPx;
            const desiredCanvasY = canvasH / 2 - menuBottomDesign - 42;
            const desiredWorld = canvasUi.convertToWorldSpaceAR(new Vec3(0, desiredCanvasY, 0));
            const localY = parentUi.convertToNodeSpaceAR(desiredWorld).y;
            // 不把按钮推回胶囊方向；极端小屏最多向下压到能保留整列的位置。
            return Math.max(-5, Math.min(70, localY));
        } catch {
            return 70;
        }
    }

    /** 防止场景返回后序列化引用丢失：按常见节点名自动兜底绑定录制UI */
    private autoBindRecordUiFallback() {
        const pickNode = (names: string[]): Node | null => {
            const queue: Node[] = [this.node];
            const lc = names.map((n) => n.toLowerCase());
            while (queue.length > 0) {
                const cur = queue.shift()!;
                const nm = (cur.name || '').toLowerCase();
                if (lc.includes(nm)) return cur;
                for (const c of cur.children) queue.push(c);
            }
            return null;
        };
        const pickLabel = (root: Node | null): Label | null => {
            if (!root) return null;
            const queue: Node[] = [root];
            while (queue.length > 0) {
                const cur = queue.shift()!;
                const lab = cur.getComponent(Label);
                if (lab) return lab;
                for (const c of cur.children) queue.push(c);
            }
            return null;
        };

        if (!this.recordStartButton) {
            const n = pickNode(['recordbutton', 'recordstartbutton', 'record_btn', 'btnrecord', 'play_icon', 'stop_icon', 'startbutton']);
            this.recordStartButton = n?.getComponent(Button) ?? n?.getComponentInChildren(Button) ?? null;
        }
        if (!this.recordShareButton) {
            const n = pickNode(['sharebutton', 'recordsharebutton', 'share_btn', 'btnshare', 'share_icon']);
            this.recordShareButton = n?.getComponent(Button) ?? n?.getComponentInChildren(Button) ?? null;
        }
        if (!this.replayLastButton) {
            const n = pickNode(['replaybutton', 'recordreplaybutton', 'replay_btn', 'btnreplay', 'replay_icon']);
            this.replayLastButton = n?.getComponent(Button) ?? n?.getComponentInChildren(Button) ?? null;
        }
        if (!this.metronomeButton) {
            const n = pickNode(['metronomebutton', 'metronome_btn', 'tempobutton', 'tempo_btn']);
            this.metronomeButton = n?.getComponent(Button) ?? n?.getComponentInChildren(Button) ?? null;
        }
        const rb = this.recordStartButton?.node ?? null;
        if (rb && !this.recordIconStartNode) {
            this.recordIconStartNode =
                rb.getChildByName('IconStart')
                ?? rb.getChildByName('RecordIconStart')
                ?? rb.getChildByName('PlayIcon')
                ?? rb.getChildByName('play_icon')
                ?? null;
        }
        if (rb && !this.recordIconStopNode) {
            this.recordIconStopNode =
                rb.getChildByName('IconStop')
                ?? rb.getChildByName('RecordIconStop')
                ?? rb.getChildByName('PauseIcon')
                ?? rb.getChildByName('stop_icon')
                ?? null;
        }
        if (!this.recordToggleLabel) {
            this.recordToggleLabel = pickLabel(rb);
        }
    }

    /** 进设置前把当前 AudioManager 状态写入本地 */
    private persistAudioSettings() {
        if (!this.audioManager) return;
        AudioSettingsStore.saveFromAudioManager(this.audioManager);
    }

    openSettingsScene() {
        if (!this.isSceneCurrent()) return;
        console.log('[GameScene:v5] navigation', { target: 'settings', reason: 'settings-button' });
        if (this.sharedPlaybackLaunch) this.finishSharedPlayback();
        this.cancelPendingShare();
        this.persistAudioSettings();
        const sm = SceneManager.getInstance();
        if (sm) {
            sm.loadSettingsScene('game');
        } else {
            SceneManager.prepareSettingsReturnTarget('game');
            director.loadScene(SceneManager.SCENE_NAMES.SETTINGS);
        }
    }

    setupAudioManager() {
        if (this.kalimbaManager) {
            this.audioManager = this.kalimbaManager.getAudioManager();
        }
    }

    private setupMetronome() {
        this.metronomeController = this.getComponent(MetronomeController)
            ?? this.addComponent(MetronomeController);
        this.metronomeController.audioManager = this.audioManager;
        this.refreshMetronomeUI();
    }

    private setupChallengeSession() {
        this.challengeSession = this.getComponent(ChallengeSession)
            ?? this.addComponent(ChallengeSession);
        this.challengeSession.audioManager = this.audioManager;
    }

    private setupPracticeOverlay() {
        this.practiceOverlay = this.getComponent(PracticeOverlay)
            ?? this.addComponent(PracticeOverlay);
        this.practiceOverlay.bind({
            onMetronome: () => { void this.toggleMetronome(); },
            onRetry: () => { void this.startChallengeLevel(this.lastChallengeLevelId); },
            onProgress: () => { void this.openProgressPanel(); },
            onTempoDown: () => this.adjustMetronomeBpm(-5),
            onTempoUp: () => this.adjustMetronomeBpm(5),
            onExitChallenge: () => this.exitChallengeToHome(),
            onExitFree: () => this.onBackButtonClick(),
            onShareResult: (result, levelTitle, rankTitle, achievements) => this.shareChallengeResult(result, levelTitle, rankTitle, achievements),
        });
        this.practiceOverlay.setChallengeIdle();
        this.refreshMetronomeUI();
    }

    private setupFallingNoteStage() {
        this.fallingNoteStage = this.getComponent(FallingNoteStage)
            ?? this.addComponent(FallingNoteStage);
        this.fallingNoteStage.setTimelineClock(() => this.challengeSession?.getCurrentTimeSec() ?? null);
    }

    private consumeChallengeLaunchSoon() {
        this.scheduleOnce(() => {
            // 演奏记录分享优先级最高，避免历史遗留的挑战意图打断好友回放。
            if (this.sharedPlaybackLaunch) {
                ChallengeLaunchStore.take();
                return;
            }
            const levelId = ChallengeLaunchStore.take();
            if (levelId) {
                void this.startChallengeLevel(levelId);
                return;
            }
            // 只有从首页“开始”进入自由演奏才显示；挑战模式使用自己的下落音符教程。
            this.scheduleOnce(() => {
                // 分享可能在这两次调度之间到达，不能再弹出全屏教程挡住好友回放。
                if (!this.sharedPlaybackLaunch && !this.activeChallengeLevelId && isValid(this, true)) {
                    this.practiceOverlay?.showFreeTutorialIfNeeded();
                }
            }, 0.05);
        }, 0.12);
    }

    private async openProgressPanel() {
        if (!this.isSceneCurrent()) return;
        const request = ++this.progressRequest;
        this.practiceOverlay?.showProgress('正在读取成长记录…');
        try {
            const stats = await AchievementCloudService.getStats();
            if (!this.isSceneCurrent() || request !== this.progressRequest) return;
            const titles = stats.achievementIds
                .map((id) => getAchievementById(id)?.title ?? id)
                .slice(0, 5);
            const achievements = titles.length > 0 ? titles.join(' · ') : '还没有解锁成就';
            const unlockedCount = Array.isArray(stats.unlockedLevelIds) ? stats.unlockedLevelIds.length : 1;
            this.practiceOverlay?.showProgress(
                `成长记录\n\n已解锁 ${unlockedCount} / 9 关\n累计 ${stats.totalStars} 颗星 · ${stats.totalNotes} 音\n最高连击 ${stats.maxCombo}\n\n成就：${achievements}`,
            );
        } catch {
            if (!this.isSceneCurrent() || request !== this.progressRequest) return;
            this.practiceOverlay?.showProgress('成长记录暂未同步。\n联网并部署云函数后会自动保存到微信账号。');
        }
    }

    /** 先展示关卡说明/教程，由玩家点击“开始挑战”后再解锁 WebAudio 并启动时间轴。 */
    public async startChallengeLevel(levelId: string): Promise<void> {
        if (!this.isSceneCurrent()) return;
        this.challengeRequest++; this.rhythmRequest++; this.metronomeRequest++;
        if (this.sharedPlaybackLaunch) this.finishSharedPlayback();
        const level = getLevelById(levelId);
        if (!level || !this.challengeSession || !this.fallingNoteStage) {
            showToast(this.node, '关卡暂不可用', 1.2);
            return;
        }
        this.lastChallengeLevelId = level.id;
        this.cancelPendingShare();
        this.activeChallengeLevelId = level.id;
        this.challengeSession.stop();
        this.metronomeController?.stopMetronome();
        this.challengeRhythmEnabled = false;
        this.challengeScore = 0;
        this.refreshChallengeFeedback('准备开始');
        this.practiceOverlay?.hideResult();
        this.practiceOverlay?.setChallengeMode(true);
        this.practiceOverlay?.setChallengeStarted(level);
        this.setChallengeChromeHidden(true);
        this.editableCaption?.setText(`《${level.title}》`);
        if (this.sheetMusicBackground?.node) this.sheetMusicBackground.node.active = false;
        this.fallingNoteStage.prepareLevel(level, {
            onStart: () => { void this.beginPreparedChallenge(level.id); },
            onExit: () => this.exitChallengeToHome(),
            onTogglePause: () => this.toggleChallengePause(),
            onHelp: () => this.openChallengeTutorial(),
            onToggleRhythm: () => { void this.toggleChallengeRhythm(); },
            onToggleFollow: () => this.toggleChallengeFollowMode(),
        }, this.challengeFollowMode);
    }

    private async beginPreparedChallenge(levelId: string): Promise<void> {
        const level = getLevelById(levelId);
        const session = this.challengeSession, stage = this.fallingNoteStage;
        if (!this.isSceneCurrent() || !level || !isValid(session, true) || !isValid(stage, true)
            || this.activeChallengeLevelId !== levelId) return;
        const request = ++this.challengeRequest;
        session.stop();
        this.challengeScore = 0;
        this.practiceOverlay?.hideResult();
        this.practiceOverlay?.setChallengeStarted(level);
        const started = await session.begin(
            level,
            (result) => this.onChallengeFinished(result),
            (event) => this.onChallengeJudge(event),
            this.challengeFollowMode,
        );
        if (!this.isSceneCurrent() || request !== this.challengeRequest || this.sharedPlaybackLaunch
            || this.activeChallengeLevelId !== levelId || this.challengeSession !== session
            || this.fallingNoteStage !== stage || !isValid(session, true) || !isValid(stage, true)) return;
        if (!started) {
            stage.showError('音频初始化失败，请返回后重新进入');
            return;
        }
        stage.startLevel(level, session.getStartedAtSec(), this.challengeFollowMode);
        this.refreshChallengeTarget();
        showToast(this.node, `${level.title}：3 拍预备后${this.challengeFollowMode ? '开始跟弹' : '开始挑战'}`, 1.2);
    }

    private toggleChallengeFollowMode() {
        if (!this.activeChallengeLevelId) return;
        this.challengeFollowMode = !this.challengeFollowMode;
        this.challengeSession?.stop();
        this.metronomeController?.stopMetronome();
        this.challengeRhythmEnabled = false;
        this.audioManager?.stopAllSounds();
        KalimbaKey.setGuidanceKey(null);
        const levelId = this.activeChallengeLevelId;
        void this.startChallengeLevel(levelId);
        showToast(this.node, this.challengeFollowMode ? '已切换为跟弹模式：不评分' : '已切换为挑战模式：恢复评分', 1.4);
    }

    private toggleChallengePause() {
        const session = this.challengeSession;
        const stage = this.fallingNoteStage;
        if (!session?.isActive() || !stage) return;
        if (session.isPaused()) {
            if (!session.resume()) return;
            stage.syncStartedAt(session.getStartedAtSec());
            stage.setPaused(false);
            if (this.challengeRhythmEnabled) void this.startChallengeRhythmAligned();
            showToast(this.node, '继续挑战', 0.8);
            return;
        }
        if (session.pause()) {
            if (this.challengeRhythmEnabled) {
                this.metronomeController?.stopMetronome();
                stage.setRhythmEnabled(true, true);
            }
            stage.setPaused(true);
            showToast(this.node, '挑战已暂停', 0.8);
        }
    }

    private async toggleChallengeRhythm() {
        if (!this.isSceneCurrent()) return;
        if (!this.challengeSession?.isActive() || !this.activeChallengeLevelId) return;
        if (this.challengeRhythmEnabled) {
            this.rhythmRequest++;
            this.challengeRhythmEnabled = false;
            this.metronomeController?.stopMetronome();
            this.fallingNoteStage?.setRhythmEnabled(false);
            showToast(this.node, '挑战节奏已关闭', 1.0);
            return;
        }
        this.challengeRhythmEnabled = true;
        const starting = this.startChallengeRhythmAligned();
        const request = this.rhythmRequest;
        const started = await starting;
        if (!this.isSceneCurrent() || request !== this.rhythmRequest || !this.activeChallengeLevelId || !this.challengeRhythmEnabled) return;
        if (!started) {
            this.challengeRhythmEnabled = false;
            this.fallingNoteStage?.setRhythmEnabled(false);
            showToast(this.node, '节奏音暂时无法启动', 1.2);
            return;
        }
        showToast(this.node, '挑战节奏已开启（不计入录制）', 1.2);
    }

    private async startChallengeRhythmAligned(): Promise<boolean> {
        if (!this.isSceneCurrent()) return false;
        const request = ++this.rhythmRequest;
        const session = this.challengeSession;
        const metronome = this.metronomeController;
        const level = this.activeChallengeLevelId ? getLevelById(this.activeChallengeLevelId) : null;
        if (!session?.isActive() || session.isPaused() || !metronome || !level) return false;
        const now = session.getCurrentTimeSec();
        if (now === null || !Number.isFinite(now)) return false;
        const elapsedSec = now - session.getStartedAtSec();
        const started = await metronome.startAligned(elapsedSec, level.bpm, level.beatsPerBar);
        if (!this.isSceneCurrent() || request !== this.rhythmRequest || this.challengeSession !== session
            || this.activeChallengeLevelId !== level.id || !isValid(session, true) || !isValid(metronome, true)
            || session.isPaused() || !this.challengeRhythmEnabled) return false;
        this.fallingNoteStage?.setRhythmEnabled(started);
        this.refreshMetronomeUI();
        return started;
    }

    private openChallengeTutorial() {
        const session = this.challengeSession;
        const stage = this.fallingNoteStage;
        if (!stage || !this.activeChallengeLevelId) return;
        const wasPaused = session?.isPaused() ?? false;
        const pausedForHelp = !!session?.isActive() && !wasPaused && !!session.pause();
        if (pausedForHelp) {
            if (this.challengeRhythmEnabled) {
                this.metronomeController?.stopMetronome();
                stage.setRhythmEnabled(true, true);
            }
            stage.setPaused(true);
        }
        stage.showHelp(() => {
            if (!session?.isActive()) return;
            if (wasPaused) {
                stage.setPaused(true);
                return;
            }
            if (pausedForHelp && session.resume()) {
                stage.syncStartedAt(session.getStartedAtSec());
                stage.setPaused(false);
                if (this.challengeRhythmEnabled) void this.startChallengeRhythmAligned();
            }
        });
    }

    private exitChallengeToHome() {
        if (!this.isSceneCurrent()) return;
        console.log('[GameScene:v5] navigation', { target: 'home', reason: 'challenge-exit' });
        this.challengeRequest++; this.rhythmRequest++; this.metronomeRequest++;
        this.challengeSession?.stop();
        this.fallingNoteStage?.stop();
        this.metronomeController?.stopMetronome();
        this.challengeRhythmEnabled = false;
        this.practiceOverlay?.setChallengeMode(false);
        this.setChallengeChromeHidden(false);
        KalimbaKey.setGuidanceKey(null);
        this.activeChallengeLevelId = null;
        this.audioManager?.stopAllSounds();
        const sm = SceneManager.getInstance();
        if (sm) sm.loadHomeScene();
        else director.loadScene(SceneManager.SCENE_NAMES.HOME);
    }

    private onChallengeJudge(event: JudgeEvent) {
        this.challengeScore += event.scoreDelta;
        const text = event.grade === 'perfect' ? 'Perfect'
            : event.grade === 'good' ? 'Good'
                : event.grade === 'bad' ? 'Bad' : 'Miss';
        this.refreshChallengeFeedback(`${text}  连击 ${event.combo}  分数 ${this.challengeScore}`);
        this.fallingNoteStage?.onJudge(event, this.challengeScore);
        this.refreshChallengeTarget();
    }

    private onChallengeFinished(result: LevelResult) {
        if (this.challengeFollowMode) {
            this.onChallengeFollowFinished(result.levelId);
            return;
        }
        KalimbaKey.setGuidanceKey(null);
        this.metronomeController?.stopMetronome();
        this.challengeRhythmEnabled = false;
        this.fallingNoteStage?.setRhythmEnabled(false);
        this.fallingNoteStage?.finish(result.score);
        // 结算仍属于挑战模式，不能在失败后重新露出普通弹奏的琴谱和控制栏。
        if (this.sheetMusicBackground?.node) this.sheetMusicBackground.node.active = false;
        const beforeSummary = LevelProgressStore.getSummary();
        const beforeIds = new Set(resolveAchievementIds({
            completedCount: beforeSummary.completedLevelIds.length,
            totalStars: beforeSummary.totalStars,
            totalNotes: beforeSummary.totalNotes,
            maxCombo: beforeSummary.maxCombo,
        }));
        LevelProgressStore.recordResult(result);
        const afterSummary = LevelProgressStore.getSummary();
        const newAchievements = resolveAchievementIds({
            completedCount: afterSummary.completedLevelIds.length,
            totalStars: afterSummary.totalStars,
            totalNotes: afterSummary.totalNotes,
            maxCombo: afterSummary.maxCombo,
        })
            .filter((id) => !beforeIds.has(id))
            .map((id) => getAchievementById(id))
            .filter((item): item is AchievementDefinition => !!item);
        const starText = result.stars > 0 ? `${result.stars} 星通关` : '再试一次';
        this.audioManager?.playChallengeResultCue(result.stars);
        this.refreshChallengeFeedback(`${starText} · ${result.score} 分`);
        void this.reportChallengeResultAsync(result);
        showToast(this.node, `${starText}：${result.score} 分，最高连击 ${result.maxCombo}`, 2.3);
        if (newAchievements.length > 0) {
            this.scheduleOnce(() => {
                this.audioManager?.playAchievementCue();
                showToast(this.node, `成就解锁：${newAchievements.map((item) => item.title).join('、')}`, 2.8);
            }, 0.82);
        }
        const level = getLevelById(result.levelId);
        const nextLevel = result.stars > 0 ? getNextLevel(result.levelId) : null;
        if (nextLevel) this.lastChallengeLevelId = nextLevel.id;
        this.practiceOverlay?.showResult(
            result,
            level?.title ?? '练习完成',
            nextLevel ? `下一关：${nextLevel.title}` : '再练一次',
            newAchievements,
        );
    }

    private onChallengeFollowFinished(levelId: string) {
        KalimbaKey.setGuidanceKey(null);
        this.metronomeController?.stopMetronome();
        this.challengeRhythmEnabled = false;
        this.fallingNoteStage?.setRhythmEnabled(false);
        const level = getLevelById(levelId);
        showToast(this.node, '跟弹完成：本次不计成绩', 1.6);
        this.fallingNoteStage?.finishFollow(
            () => { void this.beginPreparedChallenge(levelId); },
            () => this.exitChallengeToHome(),
        );
        this.refreshChallengeFeedback(`《${level?.title ?? '曲目'}》跟弹完成`);
    }

    private async shareChallengeResult(result: LevelResult, levelTitle: string, rankTitle: string, achievements: AchievementDefinition[] = []) {
        const wxApi = getWx() as {
            shareAppMessage?: (arg: { title?: string; query?: string; imageUrl?: string }) => void;
        } | undefined;
        if (!wxApi?.shareAppMessage) {
            showToast(this.node, '微信真机中可分享挑战成绩', 1.6);
            return;
        }
        try {
            // A result overlay can still have an editable caption behind it. Use a built-in card.
            const imageUrl = await this.createPerformanceShareImage(levelTitle, `挑战获得 ${result.stars} 星`);
            if (!isValid(this, true)) return;
            if (!imageUrl) throw new Error('分享图片生成失败，请稍后重试');
            const achievementText = achievements.length > 0
                ? `，还解锁了「${achievements.map((item) => item.title).join('」「')}」`
                : '';
            wxApi.shareAppMessage({
                title: `我在《${levelTitle}》挑战获得 ${result.stars} 星，成为「${rankTitle}」${achievementText}！`,
                query: `challenge=${encodeURIComponent(result.levelId)}`,
                imageUrl,
            });
            showToast(this.node, '已拉起微信分享', 1.3);
        } catch (e) {
            if (!isValid(this, true)) return;
            const message = e instanceof Error ? e.message : 'unknown error';
            showToast(this.node, `分享失败：${message}`, 1.8);
        }
    }

    private setChallengeChromeHidden(hidden: boolean) {
        const candidates = [
            this.backButton?.node,
            this.settingsButton?.node,
            this.recordStartButton?.node,
            this.recordShareButton?.node,
            this.replayLastButton?.node,
            this.metronomeButton?.node,
            this.metronomeStatusLabel?.node,
            this.challengeFeedbackLabel?.node,
            this.immersiveButtonNode,
        ];
        const nodes = Array.from(new Set(candidates.filter((node): node is Node => !!node?.isValid)));
        if (hidden) {
            for (const node of nodes) {
                if (!this.challengeChromeState.has(node)) this.challengeChromeState.set(node, node.active);
                node.active = false;
            }
            return;
        }
        for (const [node, wasActive] of this.challengeChromeState) {
            if (node.isValid) node.active = wasActive;
        }
        this.challengeChromeState.clear();
    }

    private async reportChallengeResultAsync(result: LevelResult) {
        try {
            const stats = await AchievementCloudService.reportLevelResult(result);
            LevelProgressStore.markSynced(result.levelId);
            // 只在本局确实解锁新成就时提示，避免每次结算都刷屏。
            if (stats.achievementIds.length > 0) {
                console.log('[Achievement] synced', {
                    stars: stats.totalStars,
                    unlockedLevels: stats.unlockedLevelIds,
                    achievements: stats.achievementIds,
                });
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'unknown error';
            console.warn(`[Challenge] cloud sync failed: ${msg}`);
        }
    }

    private syncPendingChallengeResultsSoon() {
        this.scheduleOnce(() => {
            void this.syncPendingChallengeResults();
        }, 0.3);
    }

    private async syncPendingChallengeResults() {
        for (const result of LevelProgressStore.getPending()) {
            try {
                await AchievementCloudService.reportLevelResult(result);
                LevelProgressStore.markSynced(result.levelId);
            } catch {
                // 当前网络不可用时保留队列，下次启动继续补传。
                return;
            }
        }
    }

    private refreshChallengeFeedback(text: string) {
        if (this.challengeFeedbackLabel) this.challengeFeedbackLabel.string = text;
        if (this.challengeFollowMode) {
            this.practiceOverlay?.setJudgeFeedback(text, '自由跟弹 · 不评分');
            return;
        }
        const target = this.challengeSession?.getExpectedKeyIndex();
        const targetText = target === null ? '' : `下一音：${KalimbaKey.getChallengeDisplayNote(target)}`;
        this.practiceOverlay?.setJudgeFeedback(text, targetText);
    }

    private refreshChallengeTarget() {
        if (this.challengeFollowMode) {
            KalimbaKey.setGuidanceKey(null);
            this.practiceOverlay?.setJudgeFeedback('跟随落键自由练习', '不判定 · 不记录成绩');
            return;
        }
        const target = this.challengeSession?.getExpectedKeyIndex() ?? null;
        KalimbaKey.setGuidanceKey(target);
        const targetText = target === null ? '' : `下一音：${KalimbaKey.getChallengeDisplayNote(target)}`;
        this.practiceOverlay?.setJudgeFeedback(
            this.challengeFeedbackLabel?.string ?? `分数 ${this.challengeScore}`,
            targetText,
        );
    }

    /** 可直接绑定给节拍器按钮。首次点击也会完成 WebAudio 的用户手势解锁。 */
    public onMetronomeClick() {
        void this.toggleMetronome();
    }

    public async toggleMetronome(): Promise<void> {
        if (!this.isSceneCurrent()) return;
        const request = ++this.metronomeRequest;
        const metronome = this.metronomeController;
        if (!metronome) return;
        const running = await metronome.toggle();
        if (!this.isSceneCurrent() || request !== this.metronomeRequest || this.metronomeController !== metronome
            || !isValid(metronome, true)) return;
        this.refreshMetronomeUI();
        showToast(this.node, running ? `节拍器 ${metronome.getSettings().bpm} BPM` : '节拍器已关闭', 1.1);
    }

    /** 供 Inspector 的 +/- 按钮或后续节拍器面板调用。 */
    public adjustMetronomeBpm(delta: number) {
        const metronome = this.metronomeController;
        if (!metronome) return;
        metronome.setBpm(metronome.getSettings().bpm + Math.round(delta));
        this.refreshMetronomeUI();
    }

    private refreshMetronomeUI() {
        const metronome = this.metronomeController;
        if (!metronome) return;
        const s = metronome.getSettings();
        if (this.metronomeStatusLabel) {
            this.metronomeStatusLabel.string = metronome.isRunning() ? `♩ = ${s.bpm}` : '节拍器';
        }
        this.practiceOverlay?.setMetronome(metronome.isRunning(), s.bpm);
    }

    /** 场景切回后兜底同步一次音频设置，避免组件启动顺序导致配置未生效 */
    private syncAudioFromStoreSoon() {
        const trySync = () => {
            if (!this.audioManager && this.kalimbaManager) {
                this.audioManager = this.kalimbaManager.getAudioManager();
            }
            if (!this.audioManager) {
                if (this._syncRetry++ < 20) this.scheduleOnce(trySync, 0);
                return;
            }
            try {
                AudioSettingsStore.applyToAudioManager(this.audioManager);
            } catch {
                if (this._syncRetry++ < 20) this.scheduleOnce(trySync, 0);
            }
        };
        this._syncRetry = 0;
        this.scheduleOnce(trySync, 0);
    }

    private setPlaybackLock(locked: boolean) {
        this._playbackLocked = locked;
        // 返回/设置始终可用，不能因回放结束回调丢失把整页困住。
        if (this.settingsButton) this.settingsButton.interactable = true;
        if (this.backButton) this.backButton.interactable = true;
        const kmNode = this.kalimbaManager?.node;
        if (kmNode && locked && !isValid(this.playbackInputBlocker, true)) {
            this.playbackInputBlocker = kmNode.addComponent(BlockInputEvents);
        }
        // 立即解绑输入拦截，避免 destroy 延迟至帧末且同帧再试听时复用待销毁组件。
        if (isValid(this.playbackInputBlocker, true)) this.playbackInputBlocker!.enabled = locked;
        this.refreshRecordButtons();
    }

    private refreshRecordButtons() {
        const recording = PerformanceRecorder.isRecording();
        const locked = this._playbackLocked;
        if (this.recordStartButton) this.recordStartButton.interactable = !locked;
        if (this.recordShareButton?.node) this.recordShareButton.node.active = false;
        if (this.replayLastButton?.node) this.replayLastButton.node.active = false;
        if (this.recordIconStartNode && this.recordIconStopNode && this.recordIconStartNode === this.recordIconStopNode) {
            if (!this.warnedSameRecordIconBinding) {
                this.warnedSameRecordIconBinding = true;
                console.warn('[GameScene] recordIconStartNode 与 recordIconStopNode 绑定到了同一节点，将仅保留显示，避免图标被互斥逻辑隐藏。');
            }
            if (this.canToggleRecordIconNode(this.recordIconStartNode)) this.recordIconStartNode.active = true;
            if (this.recordToggleLabel) this.recordToggleLabel.string = recording ? '停止录制' : this.canShareRecordedResult && this.lastRecord ? '录制结果' : '开始录制';
            return;
        }
        if (this.canToggleRecordIconNode(this.recordIconStartNode)) this.recordIconStartNode!.active = !recording;
        if (this.canToggleRecordIconNode(this.recordIconStopNode)) this.recordIconStopNode!.active = recording;
        if (this.recordToggleLabel) this.recordToggleLabel.string = recording ? '停止录制' : this.canShareRecordedResult && this.lastRecord ? '录制结果' : '开始录制';
    }

    /** 防误绑：icon 必须是 recordStartButton 的子节点（或后代），否则不执行 active 切换，避免整页 UI 被隐藏 */
    private canToggleRecordIconNode(iconNode: Node | null): boolean {
        if (!iconNode || !iconNode.isValid) return false;
        const btnNode = this.recordStartButton?.node;
        if (!btnNode || !btnNode.isValid) return false;
        let cur: Node | null = iconNode;
        while (cur) {
            if (cur === btnNode) return true;
            cur = cur.parent;
        }
        if (!this.warnedInvalidRecordIconBinding) {
            this.warnedInvalidRecordIconBinding = true;
            console.warn('[GameScene] recordIcon 节点绑定无效：必须是 recordStartButton 的子节点/后代，已跳过切换以防误隐藏UI。');
        }
        return false;
    }

    private getCurrentStylePreset(): number {
        if (!this.audioManager) return 1;
        return this.audioManager.getSynthStylePreset();
    }

    private getCurrentCaptionForToast(): string {
        return this.editableCaption ? this.editableCaption.text.trim() : GameScene.CAPTION_DEFAULT_TEXT;
    }

    private getShareSongTitle(caption: string): string {
        const text = (caption || '自由演奏')
            .replace(/[\r\n|｜]+/g, ' ')
            .trim()
            .slice(0, 16) || '自由演奏';
        return /^《.+》$/.test(text) ? text : `《${text}》`;
    }

    private buildPerformanceShareTitle(caption: string, customMessage = ''): string {
        const songTitle = this.getShareSongTitle(caption);
        const message = customMessage.replace(/[\r\n|｜]+/g, ' ').trim().slice(0, 20);
        if (message === this.buildDefaultShareMessage(caption)) return message;
        return message ? `${message}｜${songTitle}拇指琴演奏` : this.buildDefaultShareMessage(caption);
    }

    private buildDefaultShareMessage(_caption: string): string {
        return '送你一首歌';
    }

    private promptPerformanceShareMessage(caption: string, savingImage = false): Promise<string | null> {
        const wxApi = getWx() as {
            showModal?: (arg: {
                title?: string;
                content?: string;
                editable?: boolean;
                placeholderText?: string;
                confirmText?: string;
                cancelText?: string;
                success?: (res: { confirm?: boolean; cancel?: boolean; content?: string }) => void;
                fail?: () => void;
            }) => void;
        } | undefined;
        const defaultMessage = this.buildDefaultShareMessage(caption);
        if (!wxApi?.showModal) return Promise.resolve(defaultMessage);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: string | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => finish(null), 120000);
            try {
                wxApi.showModal!({
                    title: '分享文案',
                    content: defaultMessage,
                    editable: true,
                    placeholderText: defaultMessage,
                    confirmText: savingImage ? '生成图片' : '去分享',
                    cancelText: '取消',
                    success: (res) => {
                        if (!res?.confirm) {
                            finish(null);
                            return;
                        }
                        const content = (typeof res.content === 'string' ? res.content : '').replace(/[\r\n]+/g, ' ').trim().slice(0, 20);
                        finish(content);
                    },
                    fail: () => finish(null),
                });
            } catch {
                finish(null);
            }
        });
    }

    /** 微信卡片为 5:4，带小游戏码的相册图片为 3:4；失败必须停止分享。 */
    private async createPerformanceShareImage(caption: string, customMessage: string, codeBase64?: string, posterStyle: SharePosterStyle = this.sharePosterStyle, codeEnvironment: ShareCodeEnvironment = 'release'): Promise<string | undefined> {
        const wxApi = getWx() as {
            createCanvas?: () => {
                width: number;
                height: number;
                getContext: (type: '2d') => CanvasRenderingContext2D | null;
                toTempFilePath?: (arg: {
                    x?: number; y?: number; width?: number; height?: number;
                    destWidth?: number; destHeight?: number;
                    fileType?: 'jpg' | 'png'; quality?: number;
                    success?: (res: { tempFilePath?: string }) => void;
                    fail?: () => void;
                }) => void;
            };
        } | undefined;
        if (!wxApi?.createCanvas) return Promise.resolve(undefined);
        const code = codeBase64 ? await loadShareCodeImage(codeBase64) : undefined;
        let art: Awaited<ReturnType<typeof loadSharePosterArt>> | undefined;
        try {
            if (code) art = await loadSharePosterArt(posterStyle.art);
            return await new Promise<string | undefined>((resolve) => {
            let settled = false;
            const finish = (value?: string) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => finish(), 10000);
            try {
                const canvas = wxApi.createCanvas!();
                canvas.width = code ? 900 : 600;
                canvas.height = code ? 1200 : 480;
                const ctx = canvas.getContext('2d');
                if (!ctx || !canvas.toTempFilePath) {
                    finish();
                    return;
                }
                const roundRect = (x: number, y: number, w: number, h: number, r: number) => {
                    const rr = Math.min(r, w / 2, h / 2);
                    ctx.beginPath();
                    ctx.moveTo(x + rr, y);
                    ctx.lineTo(x + w - rr, y);
                    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
                    ctx.lineTo(x + w, y + h - rr);
                    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
                    ctx.lineTo(x + rr, y + h);
                    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
                    ctx.lineTo(x, y + rr);
                    ctx.quadraticCurveTo(x, y, x + rr, y);
                    ctx.closePath();
                };
                const songTitle = this.getShareSongTitle(caption);
                const message = customMessage.trim().slice(0, 20) || this.buildDefaultShareMessage(caption);

                if (code && art) {
                    drawSharePoster(ctx, art.image, code.image, songTitle, message, posterStyle, codeEnvironment);
                } else {
                    ctx.fillStyle = '#F5EEDC';
                    ctx.fillRect(0, 0, 600, canvas.height);
                    ctx.fillStyle = '#E9DDBF';
                    ctx.fillRect(0, 0, 18, canvas.height);
                    ctx.fillStyle = '#6D452C';
                    ctx.font = '20px sans-serif';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('拇指琴演奏家', 48, 54);
                    ctx.fillStyle = '#B98B55';
                    ctx.fillRect(48, 82, 504, 2);

                    ctx.fillStyle = '#4C3425';
                    const messageLines = message.length > 12
                        ? [message.slice(0, 12), message.slice(12)]
                        : [message];
                    ctx.font = `${messageLines.length > 1 ? 34 : 40}px sans-serif`;
                    messageLines.forEach((line, index) => ctx.fillText(line, 48, messageLines.length > 1 ? 130 + index * 44 : 145, 500));
                    ctx.fillStyle = '#94653F';
                    ctx.font = '27px sans-serif';
                    ctx.fillText(songTitle, 48, messageLines.length > 1 ? 222 : 205, 470);

                    // 简洁木质拇指琴图形，保持阅读类分享卡的留白感。
                    ctx.fillStyle = '#B86B32';
                    roundRect(338, 278, 190, 154, 22);
                    ctx.fill();
                    ctx.strokeStyle = '#704027';
                    ctx.lineWidth = 4;
                    ctx.stroke();
                    ctx.fillStyle = '#7D472B';
                    ctx.beginPath();
                    ctx.arc(433, 382, 22, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.strokeStyle = '#E7E0D3';
                    ctx.lineWidth = 9;
                    ctx.lineCap = 'round';
                    for (let i = 0; i < 9; i++) {
                        const x = 365 + i * 17;
                        const length = 70 + (4 - Math.abs(4 - i)) * 8;
                        ctx.beginPath();
                        ctx.moveTo(x, 300);
                        ctx.lineTo(x, 300 + length);
                        ctx.stroke();
                    }
                }
                canvas.toTempFilePath({
                    x: 0, y: 0, width: canvas.width, height: canvas.height,
                    destWidth: canvas.width, destHeight: canvas.height,
                    fileType: 'jpg', quality: 0.92,
                    success: (res) => finish(typeof res?.tempFilePath === 'string' ? res.tempFilePath : undefined),
                    fail: () => finish(),
                });
            } catch (e) {
                console.warn('[ShareCard] create image failed', e);
                finish();
            }
        }); } finally { art?.dispose(); code?.dispose(); }
    }

    private onToggleRecordClick() {
        if (PerformanceRecorder.isRecording()) {
            this.onStopRecordClick();
            return;
        }
        if (this.lastRecord && this.canShareRecordedResult) {
            this.showCurrentRecordingResult();
            return;
        }
        let seenGuide = false;
        try {
            seenGuide = sys.localStorage.getItem(GameScene.RECORD_GUIDE_STORAGE_KEY) === '1';
        } catch {}
        if (!seenGuide) {
            try { sys.localStorage.setItem(GameScene.RECORD_GUIDE_STORAGE_KEY, '1'); } catch {}
            this.practiceOverlay?.showRecordingGuide(() => this.startNewRecording());
            if (this.practiceOverlay) return;
        }
        this.startNewRecording();
    }

    private startNewRecording() {
        if (!this.isSceneCurrent()) return;
        if (this.sharedPlaybackLaunch) this.finishSharedPlayback();
        this.cancelPendingShare();
        PerformancePlayer.stop();
        this.practiceOverlay?.setRecordingPreviewing(false);
        this.setPlaybackLock(false);
        this.lastRecord = null;
        this.imageExportRecord = null;
        clearPreparedPerformanceShare();
        this.canShareRecordedResult = false;
        console.log(`[AutoScroll] onToggleRecordClick: sheetMusicBackground=${!!this.sheetMusicBackground}`);
        this.sheetMusicBackground?.alignForRecordingStart();
        this.sheetMusicBackground?.setAutoScrollRunning(true);
        const stylePreset = this.getCurrentStylePreset();
        const caption = this.getCurrentCaptionForToast();
        PerformanceRecorder.start(stylePreset, caption);
        showToast(this.node, `开始录制${caption}（最长 3 分钟）`, 1.6);
        this.refreshRecordButtons();
    }

    private onStopRecordClick() {
        const rec = PerformanceRecorder.stop();
        this.sheetMusicBackground?.setAutoScrollRunning(false);
        if (!rec) {
            showToast(this.node, '当前未在录制', 1.4);
            this.refreshRecordButtons();
            return;
        }
        this.lastRecord = rec;
        this.canShareRecordedResult = true;
        if (rec.durationMs > 0) {
            void this.reportPlayDurationAsync(rec.durationMs);
        }
        this.refreshRecordButtons();
        this.showCurrentRecordingResult();
    }

    private showCurrentRecordingResult() {
        const rec = this.lastRecord;
        if (!rec || !this.canShareRecordedResult) return;
        const caption = rec.title === undefined ? this.getCurrentCaptionForToast() : rec.title.trim();
        this.practiceOverlay?.showRecordingResult(
            this.getShareSongTitle(caption),
            rec.durationMs / 1000,
            rec.events.length,
            {
                onPreview: () => this.onReplayLastClick(),
                onShare: () => {
                    this.stopRecordingPreview();
                    void this.onShareRecordClick();
                },
                onShareTimeline: () => {
                    this.stopRecordingPreview();
                    void this.onShareRecordClick('timeline');
                },
                onSaveImage: () => {
                    this.stopRecordingPreview();
                    void this.onShareRecordClick('image');
                },
                onRerecord: () => {
                    this.stopRecordingPreview();
                    this.startNewRecording();
                },
                onClose: () => this.stopRecordingPreview(),
            },
        );
    }

    private stopRecordingPreview() {
        if (PerformancePlayer.isPlaying()) PerformancePlayer.stop();
        this.practiceOverlay?.setRecordingPreviewing(false);
        this.setPlaybackLock(false);
        this.sheetMusicBackground?.resetToDefault();
    }

    private async reportPlayDurationAsync(durationMs: number) {
        try {
            await AchievementCloudService.reportPlayDuration(durationMs);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'unknown error';
            console.warn(`[Achievement] reportPlayDuration failed: ${msg}`);
        }
    }

    /** 供关卡模式结算调用：上报关卡最高分 */
    public async reportLevelScore(levelId: string, score: number): Promise<void> {
        try {
            await AchievementCloudService.reportLevelScore(levelId, score);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'unknown error';
            console.warn(`[Achievement] reportLevelScore failed: ${msg}`);
        }
    }

    private onReplayLastClick() {
        if (!this.isSceneCurrent()) return;
        if (PerformancePlayer.isPlaying()) {
            PerformancePlayer.stop();
            this.setPlaybackLock(false);
            this.sheetMusicBackground?.resetToDefault();
            this.practiceOverlay?.setRecordingPreviewing(false);
            return;
        }
        const rec = this.lastRecord;
        if (!rec) {
            showToast(this.node, '暂无可回放记录', 1.5);
            return;
        }
        this.sheetMusicBackground?.switchToSharePlaybackBg();
        this.setPlaybackLock(true);
        const ok = PerformancePlayer.play(rec, () => {
            if (!this.isSceneCurrent()) return;
            this.setPlaybackLock(false);
            this.sheetMusicBackground?.resetToDefault();
            this.practiceOverlay?.setRecordingPreviewing(false);
        });
        if (!ok) {
            showToast(this.node, '回放失败：AudioManager 不可用', 1.8);
            this.setPlaybackLock(false);
            this.sheetMusicBackground?.resetToDefault();
            this.practiceOverlay?.setRecordingPreviewing(false);
        } else {
            this.practiceOverlay?.setRecordingPreviewing(true);
        }
    }

    private async onShareRecordClick(target: 'friend' | 'timeline' | 'image' = 'friend') {
        if (!this.isSceneCurrent() || this.shareBusy) return;
        const rec = this.lastRecord;
        if (!rec || !this.canShareRecordedResult) {
            showToast(this.node, '请先录制并停止', 1.5);
            return;
        }
        if (rec.durationMs > PERFORMANCE_MAX_DURATION_MS) {
            showToast(this.node, '录制超过 3 分钟上限', 1.6);
            return;
        }
        if (target === 'timeline' && !isTimelineShareAvailable()) {
            showToast(this.node, '当前微信暂不支持朋友圈分享，可先分享给好友', 2.5);
            return;
        }
        const caption = rec.title === undefined ? this.getCurrentCaptionForToast() : rec.title.trim();
        this.shareBusy = true;
        const request = ++this.shareRequest;
        const isCurrent = () => this.isSceneCurrent() && request === this.shareRequest &&
            this.lastRecord === rec && this.canShareRecordedResult;
        try {
            const customMessage = await this.promptPerformanceShareMessage(caption, target === 'image');
            if (customMessage === null || !isCurrent()) return;
            const title = this.buildPerformanceShareTitle(caption, customMessage);
            const loading = showBusyIndicator(this.node, target === 'image' ? '正在检测文案并生成分享图片…' : '正在检测分享文案并准备分享…');
            this.closeShareLoading = loading.close;
            // Include the final formatted title as well as all user text drawn on the card.
            await ContentSecurityService.requireText(`${caption}\n${customMessage}\n${title}`);
            if (!isCurrent()) return;
            // 兼容修改前生成但尚未分享的旧记录：分享时补上当前歌曲名/祝福语。
            const recordToShare: PerformanceRecord = { ...rec, title: caption };
            if (target === 'image') {
                const codeEnvironment = getPerformanceShareEnvironment();
                const cached = this.imageExportRecord;
                const rid = cached?.source === rec && cached.caption === caption ? cached.recordId
                    : await PerformanceCloudService.createRecord(recordToShare);
                if (!isCurrent()) return;
                // 保存失败后重试复用这段演奏，不能重复上传消耗创建额度。
                this.imageExportRecord = { source: rec, caption, recordId: rid };
                const code = await PerformanceCloudService.getShareCode(rid, codeEnvironment);
                if (!isCurrent()) return;
                const image = await this.createPerformanceShareImage(caption, customMessage, code, this.sharePosterStyle, codeEnvironment);
                if (!isCurrent()) return;
                if (!image) throw new ImageExportError('分享图片生成失败，请稍后重试');
                this.closeShareLoading?.(); this.closeShareLoading = null;
                const confirmation = confirmShareImageSave(this.node, image, this.sharePosterStyle,
                    style => this.createPerformanceShareImage(caption, customMessage, code, style, codeEnvironment), isCurrent, codeEnvironment);
                this.cancelImageExport = confirmation.cancel;
                const confirmed = await confirmation.promise;
                if (!confirmed || !isCurrent()) return;
                this.sharePosterStyle = confirmed.style;
                this.closeShareLoading = showBusyIndicator(this.node, '正在保存图片，请完成相册授权…').close;
                const saving = saveShareImageToAlbum(confirmed.filePath, isCurrent);
                this.cancelImageExport = saving.cancel;
                await saving.promise;
                if (isCurrent()) showToast(this.node, '已保存到相册', 2);
                return;
            }
            const wxApi = getWx() as {
                shareAppMessage?: (arg: { title?: string; query?: string; imageUrl?: string }) => void;
            } | undefined;
            if (wxApi?.shareAppMessage || target === 'timeline') {
                const imageUrl = await this.createPerformanceShareImage(caption, customMessage);
                // Never fall back to an automatic screenshot that may contain an input draft.
                if (!imageUrl) throw new Error('分享图片生成失败，请稍后重试');
                if (!isCurrent()) return;
                const rid = await PerformanceCloudService.createRecord(recordToShare);
                if (!isCurrent()) return;
                this.imageExportRecord = { source: rec, caption, recordId: rid };
                setPreparedPerformanceShare({ title, recordId: rid, imageUrl });
                if (target === 'timeline') {
                    const ready = showTimelineShareGuide();
                    showToast(this.node, ready ? '右上角「…」→「分享到朋友圈」'
                        : '当前微信暂不支持朋友圈分享，可先分享给好友', 3);
                } else {
                    wxApi!.shareAppMessage!({ title, query: `rid=${encodeURIComponent(rid)}`, imageUrl });
                    showToast(this.node, '已拉起微信分享', 1.4);
                }
            } else {
                showToast(this.node, '暂时不可分享，请稍后重试', 2.0);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'unknown error';
            if (isCurrent() && !(e instanceof ImageExportError && e.cancelled)) showToast(this.node, e instanceof ContentSecurityError
                ? (e.rejected ? e.message : '暂时不可分享，请稍后重试')
                : target === 'image' ? (e instanceof ImageExportError ? e.message : '暂时无法生成分享图片，请稍后重试')
                : `分享失败：${msg}`, target === 'image' ? 3 : 2);
        } finally {
            if (request === this.shareRequest) {
                this.cancelImageExport = null;
                this.closeShareLoading?.(); this.closeShareLoading = null;
                this.shareBusy = false;
            }
        }
    }

    private cancelPendingShare() {
        this.cancelImageExport?.(); this.cancelImageExport = null;
        this.closeShareLoading?.(); this.closeShareLoading = null;
        this.shareRequest++;
        this.shareBusy = false;
    }

    onEnable() {
        if (this.sceneDisposed) return;
        this.sceneActive = true;
        if (this.sceneStarted) {
            if (this.sharedPlaybackLaunch || this._playbackLocked) this.finishSharedPlayback();
            this.setupSharedLaunchHandling();
        }
    }

    onDisable() {
        if (this.sceneDisposed) return;
        this.sceneActive = false;
        this.challengeRequest++; this.rhythmRequest++; this.metronomeRequest++; this.progressRequest++;
        this.cancelPendingShare();
        this.sharedPlaybackRequest++;
        this.closeSharedFeedback?.(); this.closeSharedFeedback = null;
        PerformancePlayer.stop();
        this.unsubscribePendingGameLaunch?.(); this.unsubscribePendingGameLaunch = null;
        if (isValid(this.playbackInputBlocker, true)) this.playbackInputBlocker!.enabled = false;
    }

    private setupSharedLaunchHandling() {
        this.unsubscribePendingGameLaunch?.();
        this.unsubscribePendingGameLaunch = onPendingGameLaunch(() => {
            if (!this.isSceneCurrent()) return;
            const rid = takePendingSharedRecordId();
            if (rid) {
                this.beginSharedRecordPlayback(rid);
                return;
            }
            const levelId = ChallengeLaunchStore.take();
            if (levelId) void this.startChallengeLevel(levelId);
        });
        const rid = takePendingSharedRecordId();
        if (rid) this.beginSharedRecordPlayback(rid);
    }

    private beginSharedRecordPlayback(rid: string) {
        if (!this.isSceneCurrent()) return;
        this.challengeRequest++; this.rhythmRequest++; this.metronomeRequest++; this.progressRequest++;
        this.closeSharedFeedback?.();
        this.cancelPendingShare();
        clearPreparedPerformanceShare();
        // 再做一次幂等硬停止：即使分享参数在场景启动后才到达，也不允许菜单音混入回放。
        ProceduralMenuBgm.stop(true);
        this.sharedPlaybackLaunch = true;
        const request = ++this.sharedPlaybackRequest;
        PerformancePlayer.stop();
        PerformanceRecorder.stop();
        this.sheetMusicBackground?.setAutoScrollRunning(false);
        this.audioManager?.stopAllSounds();
        this.metronomeController?.stopMetronome();
        this.challengeSession?.stop();
        this.fallingNoteStage?.stop();
        this.activeChallengeLevelId = null;
        if (this.immersiveModeActive) this.toggleImmersiveMode();
        this.setChallengeChromeHidden(false);
        if (this.sheetMusicBackground?.node) this.sheetMusicBackground.node.active = true;
        this.challengeRhythmEnabled = false;
        this.challengeFollowMode = false;
        KalimbaKey.setGuidanceKey(null);
        this.practiceOverlay?.setChallengeMode(false);
        this.practiceOverlay?.hideResult();
        this.practiceOverlay?.setChallengeIdle();
        this.refreshMetronomeUI();
        this.practiceOverlay?.hideRecordingFlow();
        this.setPlaybackLock(false);
        console.log('[ShareLaunch:v2] loading shared performance', { rid, request });
        this.practiceOverlay?.hideFreeTutorialForSharedPlayback();
        this.closeSharedFeedback = showBusyIndicator(this.node, '正在读取好友演奏…').close;
        this.scheduleOnce(() => { void this.loadAndPlaySharedRecord(rid, request); }, 0.05);
    }

    private async loadAndPlaySharedRecord(rid: string, request: number) {
        let stage = '读取演奏';
        const isCurrent = () => this.isSceneCurrent() && request === this.sharedPlaybackRequest;
        try {
            const rec = await PerformanceCloudService.getRecord(rid);
            if (!isCurrent()) return;
            stage = '准备音色';
            console.log('[ShareLaunch] shared performance loaded', { eventCount: rec.events.length, durationMs: rec.durationMs, stylePreset: rec.stylePreset });
            this.lastRecord = rec;
            this.canShareRecordedResult = false;
            setReceivedPerformanceShare(rid);
            if (!isValid(this.audioManager, true)) this.audioManager = AudioManager.getInstance();
            if (!this.audioManager) throw new Error('音频未就绪，请重试');
            this.audioManager.setSynthStylePreset(rec.stylePreset);
            this.editableCaption?.setText(rec.title?.trim() ?? '');
            this.sheetMusicBackground?.switchToSharePlaybackBg();
            stage = '唤醒声音';
            // 分享跳转不保证保留音频解锁手势；失败后通过弹窗“重试”再次唤醒。
            let wakeTimer: ReturnType<typeof setTimeout> | undefined;
            let ready = false;
            try {
                ready = await Promise.race([
                    this.audioManager.resumeWebAudio(),
                    new Promise<boolean>((resolve) => { wakeTimer = setTimeout(() => resolve(false), 3000); }),
                ]);
            } finally {
                if (wakeTimer !== undefined) clearTimeout(wakeTimer);
            }
            if (!isCurrent()) return;
            if (!ready) throw new Error('请点击重试开启声音');
            stage = '播放演奏';
            this.setPlaybackLock(true);
            const ok = PerformancePlayer.play(rec, () => {
                if (!isCurrent()) return;
                this.finishSharedPlayback();
                showToast(this.node, '好友演奏已结束，现在可以自由弹奏', 2);
            }, (error) => {
                if (isCurrent()) this.showSharedPlaybackError(rid, request, stage, error);
            });
            if (!ok) throw new Error('演奏暂时无法播放，请重试');
            this.closeSharedFeedback?.();
            this.closeSharedFeedback = showPlaybackNotice(this.node, () => {
                if (isCurrent()) this.finishSharedPlayback();
            });
        } catch (e) {
            if (isCurrent()) this.showSharedPlaybackError(rid, request, stage, e);
        }
    }

    private finishSharedPlayback() {
        if (!this.isSceneCurrent()) return;
        this.sharedPlaybackRequest++;
        this.sharedPlaybackLaunch = false;
        PerformancePlayer.stop();
        this.closeSharedFeedback?.(); this.closeSharedFeedback = null;
        // 解锁先于外观恢复；即使资源恢复失败，返回/弹奏也不能被留在锁定状态。
        this.setPlaybackLock(false);
        if (isValid(this.audioManager, true)) {
            this.audioManager.stopAllSounds();
            AudioSettingsStore.applyToAudioManager(this.audioManager);
        }
        if (isValid(this.practiceOverlay, true)) {
            this.practiceOverlay.hideRecordingFlow();
            this.practiceOverlay.hideFreeTutorialForSharedPlayback();
            this.practiceOverlay.setChallengeIdle();
        }
        if (isValid(this.editableCaption, true)) this.editableCaption.restoreSessionCaption();
        if (isValid(this.sheetMusicBackground, true)) this.sheetMusicBackground.resetToDefault();
        console.log('[SharePlayback:v5] returned to free play');
    }

    private showSharedPlaybackError(rid: string, request: number, stage: string, error: unknown) {
        this.finishSharedPlayback();
        const retryRequest = this.sharedPlaybackRequest;
        const detail = error instanceof Error ? error.message : String(error);
        console.error('[SharePlayback:v2] failed', { stage, request, message: detail }, error);
        const wxApi = getWx() as {
            showModal?: (options: { title: string; content: string; confirmText: string; cancelText: string;
                success: (res: { confirm?: boolean }) => void; fail: () => void }) => void;
        } | undefined;
        const message = `${stage}失败：${detail}`;
        if (!wxApi?.showModal) { showToast(this.node, message, 6); return; }
        try {
            wxApi.showModal({
                title: '暂时无法播放好友演奏', content: `${message}\n（分享修复版 S2）`,
                confirmText: '重试', cancelText: '关闭',
                success: (res) => {
                    if (!res.confirm || !isValid(this, true) || retryRequest !== this.sharedPlaybackRequest) return;
                    // 在点击回调内立即调用 resume，保留本次真实用户手势。
                    void this.audioManager?.resumeWebAudio().catch(() => {});
                    this.beginSharedRecordPlayback(rid);
                },
                fail: () => { if (this.node.isValid) showToast(this.node, message, 6); },
            });
        } catch { showToast(this.node, message, 6); }
    }

    onBackButtonClick() {
        if (!this.isSceneCurrent()) return;
        console.log('[GameScene:v5] navigation', { target: 'home', reason: 'back-button' });
        if (this.sharedPlaybackLaunch) this.finishSharedPlayback();
        this.cancelPendingShare();
        if (this.activeChallengeLevelId) {
            this.exitChallengeToHome();
            return;
        }
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
        this.sheetMusicBackground?.setAutoScrollRunning(false);
        const sm = SceneManager.getInstance();
        if (sm) {
            sm.loadHomeScene();
        } else {
            director.loadScene(SceneManager.SCENE_NAMES.HOME);
        }
    }

    resetGame() {
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
        if (this.sheetMusicBackground) {
            this.sheetMusicBackground.resetToDefault();
        }
    }

    onDestroy() {
        if (this.sceneDisposed) return;
        this.sceneDisposed = true;
        this.sceneActive = false;
        this.challengeRequest++; this.rhythmRequest++; this.metronomeRequest++; this.progressRequest++;
        this.closeSharedFeedback?.(); this.closeSharedFeedback = null;
        this.cancelPendingShare();
        ++this.sharedPlaybackRequest;
        // 先取消回放定时器；销毁中只释放资源，不再恢复即将销毁的按钮/输入组件。
        PerformancePlayer.stop();
        PerformanceRecorder.stop();
        this.unsubscribePendingGameLaunch?.();
        this.unsubscribePendingGameLaunch = null;
        game.off(Game.EVENT_HIDE, this.onGameHide, this);
        const offBtn = (btn: Button | null, handler: () => void) => {
            const n = btn?.node;
            if (n && n.isValid) {
                n.off(Button.EventType.CLICK, handler, this);
            }
        };
        offBtn(this.backButton, this.onBackButtonClick);
        offBtn(this.settingsButton, this.openSettingsScene);
        offBtn(this.recordStartButton, this.onToggleRecordClick);
        offBtn(this.recordShareButton, this.onShareRecordClick);
        offBtn(this.replayLastButton, this.onReplayLastClick);
        offBtn(this.metronomeButton, this.onMetronomeClick);
        if (this.immersiveButtonNode?.isValid) {
            this.immersiveButtonNode.off(Button.EventType.CLICK, this.toggleImmersiveMode, this);
        }
        this.immersiveChromeState.clear();
        this.challengeChromeState.clear();

        if (isValid(this.audioManager, true)) {
            this.audioManager.stopAllSounds();
        }
        this.audioManager = null;
        if (isValid(this.sheetMusicBackground, true)) this.sheetMusicBackground.setAutoScrollRunning(false);
        if (isValid(this.metronomeController, true)) this.metronomeController.stopMetronome();
        if (isValid(this.challengeSession, true)) this.challengeSession.stop();
        if (isValid(this.fallingNoteStage, true)) this.fallingNoteStage.stop();
        KalimbaKey.setGuidanceKey(null);
        this._playbackLocked = false;
        console.log('[GameScene:v5] teardown complete');
    }
}
