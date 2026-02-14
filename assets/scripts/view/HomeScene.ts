import { _decorator, Component, Node, Button, Label, Sprite, Color, tween, Vec3, UIOpacity } from 'cc';
import { RoundedRect } from '../RoundedRect';
import { SceneManager } from '../manager/SceneManager';
const { ccclass, property } = _decorator;

@ccclass('HomeScene')
export class HomeScene extends Component {
    @property(Button)
    startBtn: Button = null;  // 开始游戏按钮

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

    start() {
        this.setupButtons();
        this.setupLabels(); // 添加这行
        this.setupStartButtonRound(); // 设置圆角
    }

    /**
     * 设置开始按钮圆角
     */
    setupStartButtonRound() {
        if (this.startBtn) {
            // 获取或添加RoundedRect组件
            let roundedRect = this.startBtn.node.getComponent(RoundedRect);
            if (!roundedRect) {
                roundedRect = this.startBtn.node.addComponent(RoundedRect);
            }
            
            // 设置为10%圆角
            if (roundedRect) {
                roundedRect.isPercentage = true;
                roundedRect.radiusPercent = 0.1; // 10%
                // 触发重绘
                roundedRect.draw();
            }
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
        console.log('尝试切换到游戏场景...');
        
        // 优先使用SceneManager
        const sceneManager = SceneManager.getInstance();
        if (sceneManager) {
            console.log('使用SceneManager跳转');
            sceneManager.loadGameScene();
        } else {
            // 备用方案：直接使用director加载
            // 注意：这里直接硬编码了场景名 'playscene'，确保它和你的文件名一致
            console.log('SceneManager未找到，直接使用director跳转');
            const { director } = require('cc');
            director.loadScene('playscene');
        }
    }

    /**
     * 显示设置面板
     */
    showSettingsPanel() {
        // TODO: 实现设置面板
        console.log('显示设置面板');
    }

    /**
     * 显示关于面板
     */
    showAboutPanel() {
        // TODO: 实现关于面板
        console.log('显示关于面板');
    }

    onDestroy() {
        // 移除按钮事件监听
        if (this.startBtn) {
            this.startBtn.node.off(Button.EventType.CLICK, this.onPlayButtonClick, this);
        }
        if (this.settingsButton) {
            this.settingsButton.node.off(Button.EventType.CLICK, this.onSettingsButtonClick, this);
        }
        if (this.aboutButton) {
            this.aboutButton.node.off(Button.EventType.CLICK, this.onAboutButtonClick, this);
        }
    }
}
