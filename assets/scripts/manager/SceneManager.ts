import { _decorator, Component, director, Scene } from 'cc';
const { ccclass, property } = _decorator;

/** 设置页关闭后应回到的场景 */
export type SettingsReturnTarget = 'home' | 'game';

@ccclass('SceneManager')
export class SceneManager extends Component {
    private static instance: SceneManager = null;

    private static settingsReturnTarget: SettingsReturnTarget = 'home';

    /**
     * 进入设置页之前调用，记录返回目标（无 SceneManager 实例时也可直接调本静态方法）。
     */
    static prepareSettingsReturnTarget(target: SettingsReturnTarget): void {
        SceneManager.settingsReturnTarget = target;
    }

    /**
     * 设置页返回时读取并清空目标（下次默认回首页）。
     */
    static takeSettingsReturnTarget(): SettingsReturnTarget {
        const t = SceneManager.settingsReturnTarget;
        SceneManager.settingsReturnTarget = 'home';
        return t;
    }

    // 场景名称常量
    public static readonly SCENE_NAMES = {
        HOME: 'mainscene',      // 对应你的mainscene.scene
        GAME: 'playscene',      // 对应你的playscene.scene
        SETTINGS: 'settingscene', // 与 assets/settingscene.scene 场景名一致
    };

    public static getInstance(): SceneManager {
        return SceneManager.instance;
    }

    start() {
        SceneManager.instance = this;
    }

    /**
     * 加载首页场景
     */
    loadHomeScene() {
        console.log('加载首页场景');
        director.loadScene(SceneManager.SCENE_NAMES.HOME);
    }

    /**
     * 加载游戏场景
     */
    loadGameScene() {
        console.log('加载游戏场景');
        director.loadScene(SceneManager.SCENE_NAMES.GAME);
    }

    /** 设置页场景（与 playscene 分离） */
    loadSettingsScene(returnTo: SettingsReturnTarget = 'home') {
        SceneManager.prepareSettingsReturnTarget(returnTo);
        director.loadScene(SceneManager.SCENE_NAMES.SETTINGS, (err) => {
            if (!err) return;
            console.error('[SceneManager] 加载 settings 失败(主名):', SceneManager.SCENE_NAMES.SETTINGS, err);
            // 兼容历史命名，避免拼写差异导致按钮点击无效
            director.loadScene('settingsscene', (err2) => {
                if (err2) {
                    console.error('[SceneManager] 加载 settings 失败(兼容名): settingsscene', err2);
                }
            });
        });
    }

    /**
     * 重新加载当前场景
     */
    reloadCurrentScene() {
        const currentScene = director.getScene();
        if (currentScene) {
            director.loadScene(currentScene.name);
        }
    }

    /**
     * 获取当前场景名称
     */
    getCurrentSceneName(): string {
        const currentScene = director.getScene();
        return currentScene ? currentScene.name : '';
    }

    /**
     * 检查是否在指定场景
     */
    isInScene(sceneName: string): boolean {
        return this.getCurrentSceneName() === sceneName;
    }

    /**
     * 预加载场景
     */
    preloadScene(sceneName: string, callback?: Function) {
        director.preloadScene(sceneName, (err, scene) => {
            if (err) {
                console.error(`预加载场景失败: ${sceneName}`, err);
            } else {
                console.log(`预加载场景成功: ${sceneName}`);
            }
            if (callback) callback(err, scene);
        });
    }

    /**
     * 预加载所有场景
     */
    preloadAllScenes() {
        const sceneNames = Object.values(SceneManager.SCENE_NAMES) as string[];
        sceneNames.forEach(sceneName => {
            this.preloadScene(sceneName);
        });
    }

    onDestroy() {
        SceneManager.instance = null;
    }
}
