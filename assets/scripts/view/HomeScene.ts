import { _decorator, Component, Node, Button, Label, Sprite, director } from 'cc';
import { SceneManager } from '../manager/SceneManager';
import { applySavedFontToSubtree } from '../manager/GlobalFontApplier';
import { showAboutContactPanel } from './AboutContactPanel';
import { installShareLaunchCapture } from '../manager/PerformanceShareLaunch';
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

    @property(Label)
    titleLabel: Label = null;  // 标题文字

    @property(Sprite)
    backgroundSprite: Sprite = null;  // 背景图片

    @property(Node)
    logoNode: Node = null;  // Logo节点

    onLoad() {
        installShareLaunchCapture();
        this.bindStartButtonIfNeeded();
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

    start() {
        this.setupButtons();
        this.setupLabels();
        this.scheduleOnce(() => {
            void applySavedFontToSubtree(this.node);
        }, 0);
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
    }

    /**
     * 开始游戏按钮点击
     */
    onPlayButtonClick() {
        console.log('开始游戏');
        this.switchToGameScene();
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
    }
}
