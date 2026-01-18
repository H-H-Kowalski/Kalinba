import { _decorator, Component, resources, SpriteFrame, AudioClip, ImageAsset, Texture2D } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ResourceManager')
export class ResourceManager extends Component {
    private static instance: ResourceManager = null;
    
    // 资源缓存
    private spriteFrameCache: Map<string, SpriteFrame> = new Map();
    private audioClipCache: Map<string, AudioClip> = new Map();
    
    // 琴键贴图资源
    @property([SpriteFrame])
    keyTextures: SpriteFrame[] = [];
    
    // 背景贴图资源
    @property([SpriteFrame])
    backgroundTextures: SpriteFrame[] = [];
    
    public static getInstance(): ResourceManager {
        return ResourceManager.instance;
    }
    
    start() {
        ResourceManager.instance = this;
        this.preloadResources();
    }
    
    /**
     * 预加载资源
     */
    private preloadResources() {
        // 预加载琴键贴图
        this.loadKeyTextures();
        // 预加载背景贴图
        this.loadBackgroundTextures();
    }
    
    /**
     * 加载琴键贴图
     */
    private loadKeyTextures() {
        // 这里可以动态加载资源
        // 示例：从resources目录加载
        resources.loadDir('textures/keys', SpriteFrame, (err, spriteFrames) => {
            if (!err && spriteFrames) {
                spriteFrames.forEach((frame, index) => {
                    this.spriteFrameCache.set(`key_${index}`, frame);
                });
                console.log('琴键贴图加载完成');
            }
        });
    }
    
    /**
     * 加载背景贴图
     */
    private loadBackgroundTextures() {
        resources.loadDir('textures/backgrounds', SpriteFrame, (err, spriteFrames) => {
            if (!err && spriteFrames) {
                spriteFrames.forEach((frame, index) => {
                    this.spriteFrameCache.set(`bg_${index}`, frame);
                });
                console.log('背景贴图加载完成');
            }
        });
    }
    
    /**
     * 获取琴键贴图
     * @param index 琴键索引
     * @param theme 主题 ('classic', 'modern', 'warm')
     */
    getKeyTexture(index: number, theme: string = 'classic'): SpriteFrame | null {
        const key = `key_${theme}_${index}`;
        return this.spriteFrameCache.get(key) || this.keyTextures[index] || null;
    }
    
    /**
     * 获取背景贴图
     * @param index 背景索引
     */
    getBackgroundTexture(index: number): SpriteFrame | null {
        const key = `bg_${index}`;
        return this.spriteFrameCache.get(key) || this.backgroundTextures[index] || null;
    }
    
    /**
     * 设置琴键主题
     * @param theme 主题名称
     */
    setKeyTheme(theme: string) {
        // 这里可以实现主题切换逻辑
        console.log(`切换到${theme}主题`);
    }
    
    /**
     * 清理资源缓存
     */
    clearCache() {
        this.spriteFrameCache.clear();
        this.audioClipCache.clear();
    }
    
    onDestroy() {
        this.clearCache();
    }
} 