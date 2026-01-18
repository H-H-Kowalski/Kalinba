import { _decorator, Component, Node, Button, Label, Slider } from 'cc';
import { KalimbaManager } from './KalimbaManager';
import { AudioManager } from './AudioManager';
const { ccclass, property } = _decorator;

@ccclass('GameScene')
export class GameScene extends Component {
    @property(KalimbaManager)
    kalimbaManager: KalimbaManager = null;  // 卡林巴琴管理器

    @property(Button)
    backButton: Button = null;  // 返回按钮

    @property(Button)
    muteButton: Button = null;  // 静音按钮

    @property(Slider)
    volumeSlider: Slider = null;  // 音量滑块

    @property(Label)
    volumeLabel: Label = null;  // 音量显示标签

    @property(Label)
    playingCountLabel: Label = null;  // 当前播放数量标签

    @property(Node)
    uiPanel: Node = null;  // UI面板

    private audioManager: AudioManager = null;
    private isMuted: boolean = false;

    start() {
        this.setupUI();
        this.setupAudioManager();
        this.startUIUpdate();
    }

    /**
     * 设置UI
     */
    setupUI() {
        // 返回按钮
        if (this.backButton) {
            this.backButton.node.on(Button.EventType.CLICK, this.onBackButtonClick, this);
        }

        // 静音按钮
        if (this.muteButton) {
            this.muteButton.node.on(Button.EventType.CLICK, this.onMuteButtonClick, this);
        }

        // 音量滑块
        if (this.volumeSlider) {
            this.volumeSlider.node.on(Slider.EventType.SLIDE, this.onVolumeSliderChange, this);
            this.volumeSlider.progress = 0.8; // 默认音量
        }

        // 更新音量显示
        this.updateVolumeDisplay();
    }

    /**
     * 设置音频管理器
     */
    setupAudioManager() {
        if (this.kalimbaManager) {
            this.audioManager = this.kalimbaManager.getAudioManager();
        }
    }

    /**
     * 开始UI更新
     */
    startUIUpdate() {
        // 每0.1秒更新一次播放数量显示
        this.schedule(() => {
            this.updatePlayingCountDisplay();
        }, 0.1);
    }

    /**
     * 返回按钮点击
     */
    onBackButtonClick() {
        console.log('返回首页');
        
        // 停止所有音效
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }

        // 切换到首页场景
        this.switchToHomeScene();
    }

    /**
     * 静音按钮点击
     */
    onMuteButtonClick() {
        if (this.audioManager) {
            this.audioManager.toggleMute();
            this.isMuted = !this.isMuted;
            this.updateMuteButtonDisplay();
        }
    }

    /**
     * 音量滑块变化
     */
    onVolumeSliderChange() {
        if (this.volumeSlider && this.audioManager) {
            const volume = this.volumeSlider.progress;
            this.audioManager.setVolume(volume);
            this.updateVolumeDisplay();
        }
    }

    /**
     * 更新音量显示
     */
    updateVolumeDisplay() {
        if (this.volumeLabel && this.volumeSlider) {
            const volume = Math.round(this.volumeSlider.progress * 100);
            this.volumeLabel.string = `音量: ${volume}%`;
        }
    }

    /**
     * 更新静音按钮显示
     */
    updateMuteButtonDisplay() {
        if (this.muteButton) {
            const label = this.muteButton.getComponentInChildren(Label);
            if (label) {
                label.string = this.isMuted ? '取消静音' : '静音';
            }
        }
    }

    /**
     * 更新播放数量显示
     */
    updatePlayingCountDisplay() {
        if (this.playingCountLabel && this.audioManager) {
            const count = this.audioManager.getPlayingKeyCount();
            this.playingCountLabel.string = `正在播放: ${count} 个音效`;
        }
    }

    /**
     * 切换到首页场景
     */
    switchToHomeScene() {
        // 使用场景管理器切换场景
        const sceneManager = require('./SceneManager').SceneManager.getInstance();
        if (sceneManager) {
            sceneManager.loadHomeScene();
        } else {
            // 备用方案：直接加载场景
            console.log('切换到首页场景');
            // 这里可以使用 director.loadScene('HomeScene')
        }
    }

    /**
     * 显示/隐藏UI面板
     */
    toggleUIPanel() {
        if (this.uiPanel) {
            this.uiPanel.active = !this.uiPanel.active;
        }
    }

    /**
     * 重置游戏
     */
    resetGame() {
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
        
        // 重置音量滑块
        if (this.volumeSlider) {
            this.volumeSlider.progress = 0.8;
            this.updateVolumeDisplay();
        }
        
        // 重置静音状态
        this.isMuted = false;
        this.updateMuteButtonDisplay();
    }

    onDestroy() {
        // 移除事件监听
        if (this.backButton) {
            this.backButton.node.off(Button.EventType.CLICK, this.onBackButtonClick, this);
        }
        if (this.muteButton) {
            this.muteButton.node.off(Button.EventType.CLICK, this.onMuteButtonClick, this);
        }
        if (this.volumeSlider) {
            this.volumeSlider.node.off(Slider.EventType.SLIDE, this.onVolumeSliderChange, this);
        }

        // 停止所有音效
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
    }
}


