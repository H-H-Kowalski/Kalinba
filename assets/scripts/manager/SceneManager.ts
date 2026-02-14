import { _decorator, Component, director, Scene } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('SceneManager')
export class SceneManager extends Component {
    private static instance: SceneManager = null;

    // 场景名称常量
    public static readonly SCENE_NAMES = {
        HOME: 'mainscene',      // 对应你的mainscene.scene
        GAME: 'playscene'       // 对应你的playscene.scene
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
        const sceneNames = Object.values(SceneManager.SCENE_NAMES);
        sceneNames.forEach(sceneName => {
            this.preloadScene(sceneName);
        });
    }

    onDestroy() {
        SceneManager.instance = null;
    }
}
