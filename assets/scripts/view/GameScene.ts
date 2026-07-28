import { _decorator, BlockInputEvents, Component, Button, Game, Label, Node, director, game, sys } from 'cc';
import { KalimbaManager } from '../manager/KalimbaManager';
import { AudioManager } from '../manager/AudioManager';
import { AudioSettingsStore } from '../manager/AudioSettingsStore';
import { applySavedFontToSubtree } from '../manager/GlobalFontApplier';
import { SceneManager } from '../manager/SceneManager';
import { SheetMusicBackground } from './SheetMusicBackground';
import { showToast } from './SimpleToast';
import { PerformanceRecorder } from '../manager/PerformanceRecorder';
import { PerformanceCloudService } from '../manager/PerformanceCloudService';
import { PerformancePlayer } from '../manager/PerformancePlayer';
import { PERFORMANCE_MAX_DURATION_MS, type PerformanceRecord } from '../manager/PerformanceTypes';
import { AchievementCloudService } from '../manager/AchievementCloudService';
import { installShareLaunchCapture, takePendingSharedRecordId } from '../manager/PerformanceShareLaunch';
import { getWx } from '../manager/WeChatNative';
import { LevelProgressStore } from '../manager/LevelProgressStore';
import { ChallengeLaunchStore } from '../manager/ChallengeLaunchStore';
import { MetronomeController } from '../manager/MetronomeController';
import { KalimbaKey } from '../KalimbaKey';
import { ChallengeSession } from '../gameplay/ChallengeSession';
import { getLevelById, getNextLevel } from '../gameplay/LevelCatalog';
import type { JudgeEvent, LevelResult } from '../gameplay/LevelTypes';
import { PracticeOverlay } from './PracticeOverlay';
import { FallingNoteStage } from './FallingNoteStage';
import { getAchievementById } from '../gameplay/AchievementCatalog';
const { ccclass, property } = _decorator;

/**
 * 弹琴场景 playscene：主玩法 + 回首页 + 进设置。
 * 音色与合成档位等放在 settingscene，由 SettingsScene 管理；听感音量由系统音量键调节，应用内默认主增益见 AudioSettingsStore.DEFAULT_APP_GAIN。
 */
@ccclass('GameScene')
export class GameScene extends Component {
    private static readonly CAPTION_STORAGE_KEY = 'user_caption';
    private static readonly CAPTION_DEFAULT_TEXT = '《生日快乐》';

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
    private warnedInvalidRecordIconBinding = false;
    private warnedSameRecordIconBinding = false;
    private _playbackLocked = false;
    private metronomeController: MetronomeController | null = null;
    private challengeSession: ChallengeSession | null = null;
    private challengeScore = 0;
    private practiceOverlay: PracticeOverlay | null = null;
    private fallingNoteStage: FallingNoteStage | null = null;
    private lastChallengeLevelId = 'c1-01';
    private activeChallengeLevelId: string | null = null;
    private onGameHide = () => {
        // 微信切到聊天、接电话或锁屏时不能让谱面继续跑；恢复后由玩家主动继续。
        if (this.activeChallengeLevelId && this.challengeSession?.isActive() && !this.challengeSession.isPaused()) {
            this.toggleChallengePause();
        }
    };

    start() {
        installShareLaunchCapture();
        game.on(Game.EVENT_HIDE, this.onGameHide, this);
        if (!this.sheetMusicBackground) {
            this.sheetMusicBackground =
                this.node.scene.getComponentInChildren(SheetMusicBackground) ?? null;
            console.log(`[AutoScroll] GameScene.start: 自动查找 sheetMusicBackground=${!!this.sheetMusicBackground}`);
        }
        this.setupUI();
        this.setupAudioManager();
        this.setupMetronome();
        this.setupChallengeSession();
        this.setupPracticeOverlay();
        this.setupFallingNoteStage();
        this.consumeChallengeLaunchSoon();
        this.syncPendingChallengeResultsSoon();
        this.syncAudioFromStoreSoon();
        this.tryConsumeSharedRecordSoon();
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
        this.recordShareButton?.node.on(Button.EventType.CLICK, this.onShareRecordClick, this);
        this.replayLastButton?.node.on(Button.EventType.CLICK, this.onReplayLastClick, this);
        this.metronomeButton?.node.on(Button.EventType.CLICK, this.onMetronomeClick, this);
        if (this.recordShareButton) this.recordShareButton.interactable = false;
        this.refreshRecordButtons();
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
        });
        this.practiceOverlay.setChallengeIdle();
        this.refreshMetronomeUI();
    }

    private setupFallingNoteStage() {
        this.fallingNoteStage = this.getComponent(FallingNoteStage)
            ?? this.addComponent(FallingNoteStage);
        this.fallingNoteStage.setAudioClock(() => this.audioManager?.getAudioCurrentTime() ?? null);
    }

    private consumeChallengeLaunchSoon() {
        this.scheduleOnce(() => {
            const levelId = ChallengeLaunchStore.take();
            if (levelId) void this.startChallengeLevel(levelId);
        }, 0.12);
    }

    private async openProgressPanel() {
        this.practiceOverlay?.showProgress('正在读取成长记录…');
        try {
            const stats = await AchievementCloudService.getStats();
            const titles = stats.achievementIds
                .map((id) => getAchievementById(id)?.title ?? id)
                .slice(0, 5);
            const achievements = titles.length > 0 ? titles.join(' · ') : '还没有解锁成就';
            const unlockedCount = Array.isArray(stats.unlockedLevelIds) ? stats.unlockedLevelIds.length : 1;
            this.practiceOverlay?.showProgress(
                `成长记录\n\n已解锁 ${unlockedCount} / 9 关\n累计 ${stats.totalStars} 颗星 · ${stats.totalNotes} 音\n最高连击 ${stats.maxCombo}\n\n成就：${achievements}`,
            );
        } catch {
            this.practiceOverlay?.showProgress('成长记录暂未同步。\n联网并部署云函数后会自动保存到微信账号。');
        }
    }

    /** 先展示关卡说明/教程，由玩家点击“开始挑战”后再解锁 WebAudio 并启动时间轴。 */
    public async startChallengeLevel(levelId: string): Promise<void> {
        const level = getLevelById(levelId);
        if (!level || !this.challengeSession || !this.fallingNoteStage) {
            showToast(this.node, '关卡暂不可用', 1.2);
            return;
        }
        this.lastChallengeLevelId = level.id;
        this.activeChallengeLevelId = level.id;
        this.challengeSession.stop();
        this.metronomeController?.stopMetronome();
        this.challengeScore = 0;
        this.refreshChallengeFeedback('准备开始');
        this.practiceOverlay?.hideResult();
        this.practiceOverlay?.setChallengeMode(true);
        this.practiceOverlay?.setChallengeStarted(level);
        if (this.sheetMusicBackground?.node) this.sheetMusicBackground.node.active = false;
        this.fallingNoteStage.prepareLevel(level, {
            onStart: () => { void this.beginPreparedChallenge(level.id); },
            onExit: () => this.exitChallengeToHome(),
            onTogglePause: () => this.toggleChallengePause(),
            onHelp: () => this.openChallengeTutorial(),
        });
    }

    private async beginPreparedChallenge(levelId: string): Promise<void> {
        const level = getLevelById(levelId);
        if (!level || !this.challengeSession || !this.fallingNoteStage || this.activeChallengeLevelId !== levelId) return;
        this.challengeSession.stop();
        this.challengeScore = 0;
        this.practiceOverlay?.hideResult();
        this.practiceOverlay?.setChallengeStarted(level);
        const started = await this.challengeSession.begin(
            level,
            (result) => this.onChallengeFinished(result),
            (event) => this.onChallengeJudge(event),
        );
        if (!started) {
            this.fallingNoteStage.showError('音频初始化失败，请返回后重新进入');
            return;
        }
        this.fallingNoteStage.startLevel(level, this.challengeSession.getStartedAtSec());
        this.refreshChallengeTarget();
        showToast(this.node, `${level.title}：3 拍预备后开始`, 1.2);
    }

    private toggleChallengePause() {
        const session = this.challengeSession;
        const stage = this.fallingNoteStage;
        if (!session?.isActive() || !stage) return;
        if (session.isPaused()) {
            if (!session.resume()) return;
            stage.syncStartedAt(session.getStartedAtSec());
            stage.setPaused(false);
            showToast(this.node, '继续挑战', 0.8);
            return;
        }
        if (session.pause()) {
            stage.setPaused(true);
            showToast(this.node, '挑战已暂停', 0.8);
        }
    }

    private openChallengeTutorial() {
        const session = this.challengeSession;
        const stage = this.fallingNoteStage;
        if (!stage || !this.activeChallengeLevelId) return;
        const wasPaused = session?.isPaused() ?? false;
        const pausedForHelp = !!session?.isActive() && !wasPaused && !!session.pause();
        if (pausedForHelp) stage.setPaused(true);
        stage.showHelp(() => {
            if (!session?.isActive()) return;
            if (wasPaused) {
                stage.setPaused(true);
                return;
            }
            if (pausedForHelp && session.resume()) {
                stage.syncStartedAt(session.getStartedAtSec());
                stage.setPaused(false);
            }
        });
    }

    private exitChallengeToHome() {
        this.challengeSession?.stop();
        this.fallingNoteStage?.stop();
        this.metronomeController?.stopMetronome();
        this.practiceOverlay?.setChallengeMode(false);
        if (this.sheetMusicBackground?.node) this.sheetMusicBackground.node.active = true;
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
                : event.grade === 'miss' ? 'Miss' : '按错了';
        this.refreshChallengeFeedback(`${text}  连击 ${event.combo}  分数 ${this.challengeScore}`);
        this.fallingNoteStage?.onJudge(event, this.challengeScore);
        this.refreshChallengeTarget();
    }

    private onChallengeFinished(result: LevelResult) {
        KalimbaKey.setGuidanceKey(null);
        this.fallingNoteStage?.finish(result.score);
        if (this.sheetMusicBackground?.node) this.sheetMusicBackground.node.active = true;
        LevelProgressStore.recordResult(result);
        const starText = result.stars > 0 ? `${result.stars} 星通关` : '再试一次';
        this.refreshChallengeFeedback(`${starText} · ${result.score} 分`);
        void this.reportChallengeResultAsync(result);
        showToast(this.node, `${starText}：${result.score} 分，最高连击 ${result.maxCombo}`, 2.3);
        const level = getLevelById(result.levelId);
        const nextLevel = result.stars > 0 ? getNextLevel(result.levelId) : null;
        if (nextLevel) this.lastChallengeLevelId = nextLevel.id;
        this.practiceOverlay?.showResult(
            result,
            level?.title ?? '练习完成',
            nextLevel ? `下一关：${nextLevel.title}` : '再练一次',
        );
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
        const target = this.challengeSession?.getExpectedKeyIndex();
        const targetText = target === null ? '' : `下一音：${KalimbaKey.getChallengeDisplayNote(target)}`;
        this.practiceOverlay?.setJudgeFeedback(text, targetText);
    }

    private refreshChallengeTarget() {
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
        const metronome = this.metronomeController;
        if (!metronome) return;
        const running = await metronome.toggle();
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
        if (this.settingsButton) this.settingsButton.interactable = !locked;
        if (this.backButton) this.backButton.interactable = !locked;
        const kmNode = this.kalimbaManager?.node;
        if (kmNode) {
            if (locked) {
                if (!kmNode.getComponent(BlockInputEvents)) {
                    kmNode.addComponent(BlockInputEvents);
                }
            } else {
                const blocker = kmNode.getComponent(BlockInputEvents);
                if (blocker) blocker.destroy();
            }
        }
        this.refreshRecordButtons();
    }

    private refreshRecordButtons() {
        const recording = PerformanceRecorder.isRecording();
        const locked = this._playbackLocked;
        if (this.recordStartButton) this.recordStartButton.interactable = !locked;
        if (this.recordShareButton) this.recordShareButton.interactable = !locked && !recording && this.canShareRecordedResult && !!this.lastRecord;
        if (this.replayLastButton) this.replayLastButton.interactable = !recording && !!this.lastRecord;
        if (this.recordIconStartNode && this.recordIconStopNode && this.recordIconStartNode === this.recordIconStopNode) {
            if (!this.warnedSameRecordIconBinding) {
                this.warnedSameRecordIconBinding = true;
                console.warn('[GameScene] recordIconStartNode 与 recordIconStopNode 绑定到了同一节点，将仅保留显示，避免图标被互斥逻辑隐藏。');
            }
            if (this.canToggleRecordIconNode(this.recordIconStartNode)) this.recordIconStartNode.active = true;
            if (this.recordToggleLabel) this.recordToggleLabel.string = recording ? '停止录制' : '开始录制';
            return;
        }
        if (this.canToggleRecordIconNode(this.recordIconStartNode)) this.recordIconStartNode!.active = !recording;
        if (this.canToggleRecordIconNode(this.recordIconStopNode)) this.recordIconStopNode!.active = recording;
        if (this.recordToggleLabel) this.recordToggleLabel.string = recording ? '停止录制' : '开始录制';
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
        const text = (sys.localStorage.getItem(GameScene.CAPTION_STORAGE_KEY) ?? '').trim();
        return text || GameScene.CAPTION_DEFAULT_TEXT;
    }

    private onToggleRecordClick() {
        if (PerformanceRecorder.isRecording()) {
            this.onStopRecordClick();
            return;
        }
        PerformancePlayer.stop();
        this.canShareRecordedResult = false;
        console.log(`[AutoScroll] onToggleRecordClick: sheetMusicBackground=${!!this.sheetMusicBackground}`);
        this.sheetMusicBackground?.alignForRecordingStart();
        this.sheetMusicBackground?.setAutoScrollRunning(true);
        const stylePreset = this.getCurrentStylePreset();
        PerformanceRecorder.start(stylePreset);
        const caption = this.getCurrentCaptionForToast();
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
        const secs = (rec.durationMs / 1000).toFixed(1);
        showToast(this.node, `录制完成：${secs}s，${rec.events.length} 个音符`, 2.0);
        this.refreshRecordButtons();
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
        if (PerformancePlayer.isPlaying()) {
            PerformancePlayer.stop();
            this.setPlaybackLock(false);
            this.sheetMusicBackground?.resetToDefault();
            showToast(this.node, '暂停回放', 1.2);
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
            this.setPlaybackLock(false);
            this.sheetMusicBackground?.resetToDefault();
        });
        if (!ok) {
            showToast(this.node, '回放失败：AudioManager 不可用', 1.8);
            this.setPlaybackLock(false);
            this.sheetMusicBackground?.resetToDefault();
        } else {
            showToast(this.node, '开始回放', 1.2);
        }
    }

    private async onShareRecordClick() {
        const rec = this.lastRecord;
        if (!rec || !this.canShareRecordedResult) {
            showToast(this.node, '请先录制并停止', 1.5);
            return;
        }
        if (rec.durationMs > PERFORMANCE_MAX_DURATION_MS) {
            showToast(this.node, '录制超过 3 分钟上限', 1.6);
            return;
        }
        try {
            const rid = await PerformanceCloudService.createRecord(rec);
            const wxApi = getWx() as {
                shareAppMessage?: (arg: { title?: string; query?: string }) => void;
            } | undefined;
            const query = `rid=${encodeURIComponent(rid)}`;
            if (wxApi?.shareAppMessage) {
                wxApi.shareAppMessage({
                    title: `我在拇指琴演奏家录了一段，来听听看`,
                    query,
                });
                showToast(this.node, '已拉起微信分享', 1.4);
            } else {
                showToast(this.node, `已生成记录ID：${rid}`, 2.0);
            }
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'unknown error';
            showToast(this.node, `分享失败：${msg}`, 2.0);
        }
    }

    private tryConsumeSharedRecordSoon() {
        const tryLoad = async () => {
            const rid = takePendingSharedRecordId();
            if (!rid) return;
            try {
                const rec = await PerformanceCloudService.getRecord(rid);
                this.lastRecord = rec;
                this.canShareRecordedResult = false;
                this.sheetMusicBackground?.switchToSharePlaybackBg();
                this.setPlaybackLock(true);
                const ok = PerformancePlayer.play(rec, () => {
                    this.setPlaybackLock(false);
                    this.sheetMusicBackground?.resetToDefault();
                });
                showToast(this.node, ok ? '已加载好友演奏，正在回放' : '已加载好友演奏，点击回放', 2.2);
                if (!ok) this.setPlaybackLock(false);
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'unknown error';
                showToast(this.node, `加载分享失败：${msg}`, 2.0);
            }
        };
        this.scheduleOnce(() => {
            void tryLoad();
        }, 0.05);
    }

    onBackButtonClick() {
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
            console.log('切换到首页场景');
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

        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
        this.sheetMusicBackground?.setAutoScrollRunning(false);
        this.metronomeController?.stopMetronome();
        this.challengeSession?.stop();
        this.fallingNoteStage?.stop();
        KalimbaKey.setGuidanceKey(null);
        this.setPlaybackLock(false);
        PerformanceRecorder.stop();
        PerformancePlayer.stop();
    }
}
