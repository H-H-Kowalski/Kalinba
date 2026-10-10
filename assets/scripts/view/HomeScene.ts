import { _decorator, Component, Node, Button, Label, Sprite, director, input, Input, isValid } from 'cc';
import { SceneManager } from '../manager/SceneManager';
import { applySavedFontToSubtree } from '../manager/GlobalFontApplier';
import { showAboutContactPanel } from './AboutContactPanel';
import { hasPendingSharedRecordId, installShareLaunchCapture, onPendingGameLaunch, takePendingAchievementLaunch } from '../manager/PerformanceShareLaunch';
import { ChallengeLaunchStore } from '../manager/ChallengeLaunchStore';
import { AchievementCloudService } from '../manager/AchievementCloudService';
import { LevelProgressStore } from '../manager/LevelProgressStore';
import { LevelSelectOverlay } from './LevelSelectOverlay';
import { showAchievementOverlay } from './AchievementOverlay';
import { ProceduralMenuBgm } from '../manager/ProceduralMenuBgm';
const { ccclass, property } = _decorator;

/** 挂在 mainscene 的 Canvas 上；开始按钮可拖入 startBtn，或留空由节点名 start_button 自动绑定 */
@ccclass('HomeScene')
export class HomeScene extends Component {
    @property(Button)
    startBtn: Button = null;  // 开始游戏按钮（可选：不填则查找子节点 start_button）

    @property(Button)
    settingsButton: Button = null;  // 设置按钮

    @property(Button)
    aboutButton: Button = null;  // 关于按钮

    /** 可选：若场景未配置，将自动生成“挑战练习”入口。 */
    @property(Button)
    challengeButton: Button = null;

    /** 可选：若场景未配置，将自动生成“成就”入口。 */
    @property(Button)
    achievementButton: Button = null;

    @property(Label)
    titleLabel: Label = null;  // 标题文字

    @property(Sprite)
    backgroundSprite: Sprite = null;  // 背景图片

    @property(Node)
    logoNode: Node = null;  // Logo节点

    private levelSelectOverlay: LevelSelectOverlay | null = null;
    private unsubscribePendingGameLaunch: (() => void) | null = null;
    private routingSharedLaunch = false;

    onLoad() {
        installShareLaunchCapture();
        this.unsubscribePendingGameLaunch = onPendingGameLaunch(() => this.routePendingGameLaunch());
        this.bindStartButtonIfNeeded();
        this.bindChallengeButtonIfNeeded();
        this.bindAchievementButtonIfNeeded();
    }

    /** 未在编辑器绑定 startBtn 时，自动使用子节点 start_button */
    private bindStartButtonIfNeeded() {
        if (this.startBtn) return;
        const n = this.node.getChildByName('start_button');
        if (n) {
            this.startBtn = n.getComponent(Button);
            if (!this.startBtn) {
                console.warn('[HomeScene] 节点 start_button 上缺少 Button 组件');
            }
        }
    }

    private bindChallengeButtonIfNeeded() {
        if (this.challengeButton) return;
        const n = this.node.getChildByName('challengeButton') ?? this.node.getChildByName('challenge_button');
        this.challengeButton = n?.getComponent(Button) ?? null;
    }

    private bindAchievementButtonIfNeeded() {
        if (this.achievementButton) return;
        const n = this.node.getChildByName('achievementButton') ?? this.node.getChildByName('achievement_button');
        this.achievementButton = n?.getComponent(Button) ?? null;
    }

    start() {
        this.setupButtons();
        this.levelSelectOverlay = this.getComponent(LevelSelectOverlay)
            ?? this.addComponent(LevelSelectOverlay);
        this.setupLabels();
        // 分享冷启动会直接进演奏页，不在首页短暂响起 BGM。
        if (!hasPendingSharedRecordId() && !ChallengeLaunchStore.hasPending()) {
            void ProceduralMenuBgm.start();
        }
        // 使用全局输入，避免按钮/遮罩截获触摸后 Canvas 收不到 WebAudio 解锁手势。
        input.on(Input.EventType.TOUCH_START, this.ensureMenuBgm, this);
        input.on(Input.EventType.MOUSE_DOWN, this.ensureMenuBgm, this);
        // 分享冷启动时参数已在 onLoad 捕获；不让好友先落到首页再手动点击。
        this.scheduleOnce(() => this.routePendingGameLaunch(), 0);
        this.scheduleOnce(() => {
            if (takePendingAchievementLaunch()) void showAchievementOverlay(this.node);
        }, 0.12);
        this.scheduleOnce(() => {
            void applySavedFontToSubtree(this.node);
        }, 0);
    }

    private routePendingGameLaunch() {
        if (!isValid(this, true)) return;
        if (this.routingSharedLaunch) return;
        if (!hasPendingSharedRecordId() && !ChallengeLaunchStore.hasPending()) return;
        this.routingSharedLaunch = true;
        ProceduralMenuBgm.stop(true);
        console.log('[ShareLaunch] home -> playscene');
        this.switchToGameScene();
    }

    private ensureMenuBgm() {
        if (!isValid(this, true)) return;
        if (!hasPendingSharedRecordId() && !ChallengeLaunchStore.hasPending()) {
            void ProceduralMenuBgm.start();
        }
    }

    /**
     * 设置标签控件（备用方案）
     */
    setupLabels() {
        // 如果titleLabel没有通过属性设置，尝试通过名称查找
        if (!this.titleLabel) {
            const titleNode = this.node.getChildByName('Title');
            if (titleNode) {
                this.titleLabel = titleNode.getComponent(Label);
                console.log('通过代码找到Title标签');
            }
        }
    }

    /**
     * 设置按钮事件
     */
    setupButtons() {
        // 开始游戏按钮
        if (this.startBtn) {
            this.startBtn.node.on(Button.EventType.CLICK, this.onPlayButtonClick, this);
        }

        // 设置按钮
        if (this.settingsButton) {
            this.settingsButton.node.on(Button.EventType.CLICK, this.onSettingsButtonClick, this);
        }

        // 关于按钮
        if (this.aboutButton) {
            this.aboutButton.node.on(Button.EventType.CLICK, this.onAboutButtonClick, this);
        }
        if (this.challengeButton) {
            this.challengeButton.node.on(Button.EventType.CLICK, this.onChallengeButtonClick, this);
        }
        if (this.achievementButton) {
            this.achievementButton.node.on(Button.EventType.CLICK, this.onAchievementButtonClick, this);
        }
    }

    /**
     * 开始游戏按钮点击
     */
    onPlayButtonClick() {
        console.log('开始游戏');
        this.switchToGameScene();
    }

    /** 首页是挑战玩法的唯一入口；进入演奏页后自动开始对应关卡。 */
    onChallengeButtonClick() {
        ProceduralMenuBgm.stop(true);
        void this.openLevelSelect();
    }

    onAchievementButtonClick() {
        void showAchievementOverlay(this.node);
    }

    private async openLevelSelect() {
        if (!this.levelSelectOverlay) return;
        // 本地进度立即打开，避免等待微信云调用时让玩家误以为按钮失效。
        const localUnlocked = LevelProgressStore.getLocallyUnlockedLevelIds();
        const selectLevel = (levelId: string) => {
            ChallengeLaunchStore.request(levelId);
            this.switchToGameScene();
        };
        const resumeHomeBgm = () => {
            if (this.node.isValid && !this.routingSharedLaunch) void ProceduralMenuBgm.start();
        };
        this.levelSelectOverlay.open(localUnlocked, selectLevel, resumeHomeBgm);
        try {
            const stats = await AchievementCloudService.getStats();
            if (Array.isArray(stats.unlockedLevelIds) && stats.unlockedLevelIds.length > 0) {
                const merged = Array.from(new Set([...localUnlocked, ...stats.unlockedLevelIds]));
                if (isValid(this, true) && isValid(this.levelSelectOverlay, true) && this.levelSelectOverlay.isOpen()) {
                    this.levelSelectOverlay.open(merged, selectLevel, resumeHomeBgm);
                }
            }
        } catch {
            // 保持已打开的本地关卡列表。
        }
    }

    /**
     * 设置按钮点击
     */
    onSettingsButtonClick() {
        console.log('打开设置');
        this.showSettingsPanel();
    }

    /**
     * 关于按钮点击
     */
    onAboutButtonClick() {
        console.log('显示关于信息');
        this.showAboutPanel();
    }

    /**
     * 切换到游戏场景
     */
    switchToGameScene() {
        // 分享回放和琴键声音开始前硬停首页 BGM，不能保留淡出尾音。
        ProceduralMenuBgm.stop(true);
        const sm = SceneManager.getInstance();
        if (sm) {
            sm.loadGameScene();
        } else {
            // mainscene 未挂 SceneManager 时仍可直接进游戏场景
            director.loadScene('playscene');
        }
    }

    /**
     * 进入设置场景（assets/settingscene.scene）
     */
    showSettingsPanel() {
        ProceduralMenuBgm.stop(true);
        const sm = SceneManager.getInstance();
        if (sm) {
            sm.loadSettingsScene('home');
        } else {
            SceneManager.prepareSettingsReturnTarget('home');
            director.loadScene(SceneManager.SCENE_NAMES.SETTINGS);
        }
    }

    /**
     * 显示关于面板（联系方式，支持复制微信 / 邮箱）
     */
    showAboutPanel() {
        showAboutContactPanel(this.node);
    }

    onDestroy() {
        input.off(Input.EventType.TOUCH_START, this.ensureMenuBgm, this);
        input.off(Input.EventType.MOUSE_DOWN, this.ensureMenuBgm, this);
        this.unsubscribePendingGameLaunch?.();
        this.unsubscribePendingGameLaunch = null;
        // 移除按钮事件监听（场景切换时 node 可能已先销毁）
        const off = (btn: Button | null, handler: () => void) => {
            const n = btn?.node;
            if (n && n.isValid) {
                n.off(Button.EventType.CLICK, handler, this);
            }
        };
        off(this.startBtn, this.onPlayButtonClick);
        off(this.settingsButton, this.onSettingsButtonClick);
        off(this.aboutButton, this.onAboutButtonClick);
        off(this.challengeButton, this.onChallengeButtonClick);
        off(this.achievementButton, this.onAchievementButtonClick);
    }
}
