import { _decorator, Component, Button, director } from 'cc';
import { KalimbaManager } from '../manager/KalimbaManager';
import { AudioManager } from '../manager/AudioManager';
import { AudioSettingsStore } from '../manager/AudioSettingsStore';
import { applySavedFontToSubtree } from '../manager/GlobalFontApplier';
import { SceneManager } from '../manager/SceneManager';
import { SheetMusicBackground } from './SheetMusicBackground';
const { ccclass, property } = _decorator;

/**
 * 弹琴场景 playscene：主玩法 + 回首页 + 进设置。
 * 音色与合成档位等放在 settingscene，由 SettingsScene 管理；听感音量由系统音量键调节，应用内默认主增益见 AudioSettingsStore.DEFAULT_APP_GAIN。
 */
@ccclass('GameScene')
export class GameScene extends Component {
    @property(KalimbaManager)
    kalimbaManager: KalimbaManager = null;

    @property(SheetMusicBackground)
    sheetMusicBackground: SheetMusicBackground = null;

    @property(Button)
    backButton: Button = null;

    @property(Button)
    settingsButton: Button = null;

    private audioManager: AudioManager = null;
    private _syncRetry = 0;

    start() {
        this.setupUI();
        this.setupAudioManager();
        this.syncAudioFromStoreSoon();
        this.scheduleOnce(() => {
            void applySavedFontToSubtree(this.node);
        }, 0);
    }

    setupUI() {
        if (this.backButton) {
            this.backButton.node.on(Button.EventType.CLICK, this.onBackButtonClick, this);
        }
        if (this.settingsButton) {
            this.settingsButton.interactable = true;
            this.settingsButton.node.on(Button.EventType.CLICK, this.openSettingsScene, this);
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

    onBackButtonClick() {
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
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
        const offBtn = (btn: Button | null, handler: () => void) => {
            const n = btn?.node;
            if (n && n.isValid) {
                n.off(Button.EventType.CLICK, handler, this);
            }
        };
        offBtn(this.backButton, this.onBackButtonClick);
        offBtn(this.settingsButton, this.openSettingsScene);

        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
    }
}
