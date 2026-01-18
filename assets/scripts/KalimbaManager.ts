import { _decorator, Component, Node, Prefab, instantiate, Vec3, UITransform, view } from 'cc';
import { KalimbaKey } from './KalimbaKey';
import { AudioManager } from './AudioManager';
const { ccclass, property } = _decorator;

@ccclass('KalimbaManager')
export class KalimbaManager extends Component {
    @property(Prefab)
    keyPrefab: Prefab = null;  // 琴键预制体

    @property
    keyCount: number = 17;  // 琴键数量

    @property
    keySpacing: number = 60;  // 琴键间距，Windows下稍微加大

    @property
    keyWidth: number = 50;  // 琴键宽度，Windows下稍微加大

    @property
    keyHeight: number = 250;  // 琴键高度，Windows下稍微加大

    @property
    vShapeOffset: number = 15; // V形排列的每级高度偏移量

    @property
    bottomOffset: number = 50; // 最低琴键距离底部的距离

    private keys: Node[] = [];  // 存储所有琴键节点
    private audioManager: AudioManager = null;

    start() {
        // 确保UI适配Windows屏幕
        this.adjustForWindows();
        this.createKeys();
        this.setupAudioManager();
    }

    adjustForWindows() {
        // 获取屏幕尺寸
        const visibleSize = view.getVisibleSize();
        
        // 根据屏幕宽度调整琴键间距
        const maxWidth = visibleSize.width * 0.9; // 使用90%的屏幕宽度
        this.keySpacing = Math.min(this.keySpacing, maxWidth / (this.keyCount - 1));
        
        // 调整琴键大小
        this.keyWidth = Math.min(this.keyWidth, this.keySpacing * 0.8);
        this.keyHeight = Math.min(this.keyHeight, visibleSize.height * 0.6);
    }

    createKeys() {
        // 获取屏幕尺寸
        const visibleSize = view.getVisibleSize();
        
        // 计算起始位置，使琴键居中
        const totalWidth = (this.keyCount - 1) * this.keySpacing;
        const startX = -totalWidth / 2;
        const centerIndex = Math.floor(this.keyCount / 2);
        
        // 计算基础 Y 坐标 (屏幕底部 + 偏移量 + 琴键一半高度)
        // 坐标系原点在屏幕中心，所以底部是 -height/2
        const bottomY = -visibleSize.height / 2 + this.bottomOffset + this.keyHeight / 2;

        // 创建琴键
        for (let i = 0; i < this.keyCount; i++) {
            const key = instantiate(this.keyPrefab);
            this.node.addChild(key);

            // 计算 V 形布局
            // 顶部对齐逻辑：
            // 1. 基础高度是两边的最短高度
            // 2. 中间最长，两边最短
            // 3. 高度增量 = (中心距离最大值 - 当前距离) * vShapeOffset
            
            const maxDist = Math.floor(this.keyCount / 2); // 最大距离（边缘到中心的距离）
            const distFromCenter = Math.abs(i - centerIndex);
            
            // 计算当前琴键的高度（中间最长）
            // 越靠近中心，高度增加越多
            const heightIncrease = (maxDist - distFromCenter) * this.vShapeOffset;
            const currentHeight = this.keyHeight + heightIncrease;

            // 设置琴键大小
            const uiTransform = key.getComponent(UITransform);
            if (uiTransform) {
                uiTransform.width = this.keyWidth;
                uiTransform.height = currentHeight;
                
                // 重新计算 Y 坐标，确保顶部对齐
                // 假设我们希望所有琴键顶部在同一水平线上
                // 这里我们以"最低的琴键底部"为基准反推
                
                // 最长琴键（中间）的底部位置
                const centerKeyBottomY = -visibleSize.height / 2 + this.bottomOffset;
                // 最长琴键的高度
                const maxHeight = this.keyHeight + (maxDist * this.vShapeOffset);
                // 顶部对齐线 Y 坐标
                const topY = centerKeyBottomY + maxHeight;
                
                // 当前琴键的中心 Y 坐标 = 顶部线 - 当前高度的一半
                const y = topY - currentHeight / 2;
                
                // 计算 X 坐标
                const x = startX + i * this.keySpacing;
                
                key.setPosition(new Vec3(x, y, 0));
            }

            // 设置琴键编号并更新显示
            const kalimbaKey = key.getComponent(KalimbaKey);
            if (kalimbaKey) {
                // 注意：这里我们使用 i (0-16) 而不是 i+1
                // 这样能正确匹配 KalimbaKey.noteMap 数组的索引
                kalimbaKey.setKeyIndex(i);
            }

            this.keys.push(key);
        }
    }

    /**
     * 设置音频管理器
     */
    setupAudioManager() {
        // 获取或创建AudioManager
        this.audioManager = this.getComponent(AudioManager);
        if (!this.audioManager) {
            this.audioManager = this.addComponent(AudioManager);
        }
    }

    /**
     * 获取音频管理器
     */
    getAudioManager(): AudioManager {
        return this.audioManager;
    }

    /**
     * 停止所有音效
     */
    stopAllSounds() {
        if (this.audioManager) {
            this.audioManager.stopAllSounds();
        }
    }

    /**
     * 设置音量
     * @param volume 音量 (0.0 - 1.0)
     */
    setVolume(volume: number) {
        if (this.audioManager) {
            this.audioManager.setVolume(volume);
        }
    }

    /**
     * 获取当前播放的琴键数量
     */
    getPlayingKeyCount(): number {
        return this.audioManager ? this.audioManager.getPlayingKeyCount() : 0;
    }

    // 获取指定编号的琴键
    getKey(index: number): Node {
        if (index >= 1 && index <= this.keyCount) {
            return this.keys[index - 1];
        }
        return null;
    }
} 