import { _decorator, Component, Node, Prefab, instantiate, Vec3, UITransform, view, Label, Color } from 'cc';
import { KalimbaKey } from '../KalimbaKey';
import { AudioManager } from './AudioManager';
import { applySavedFontToSubtree } from './GlobalFontApplier';
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
    keyHeight: number = 200;  // 琴键基础高度

    @property
    maxKeyHeight: number = 400;  // 琴键最大高度限制

    @property
    bottomPadding: number = 25;  // 最长琴键底部与屏幕底部的最小间距

    @property
    labelBottomMargin: number = 16;  // 琴键 Label 距离琴键底部的间距（在编辑器里改 KalimbaManager 上的此属性才生效）

    @property(Color)
    labelColor: Color = new Color(55, 55, 60, 255);  // 琴键数字/点的颜色（深灰偏冷，比纯黑柔和）

    @property
    vShapeOffset: number = 5; // V形排列的每级高度偏移量

    @property({ range: [0, 1, 0.01], slide: true })
    keyCenterYPercent: number = 0.25; // 琴键区域中心点在屏幕的 Y 位置（0=底部, 1=顶部）

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
        
        // 计算琴键区域中心的 Y 坐标（基于百分比，0=底部, 1=顶部）
        const keyCenterY = -visibleSize.height / 2 + visibleSize.height * this.keyCenterYPercent;
        
        // 最长琴键（中间）的高度
        const maxDist = Math.floor(this.keyCount / 2);
        
        // 计算基于配置的最大高度
        let maxHeight = Math.min(this.keyHeight + (maxDist * this.vShapeOffset), this.maxKeyHeight);
        
        // 计算基于底部间距限制的最大高度：确保琴键底部不会超过屏幕底部 + bottomPadding
        // 琴键底部 Y = keyCenterY - maxHeight/2
        // 屏幕底部 Y = -visibleSize.height/2
        // 需要：keyCenterY - maxHeight/2 >= -visibleSize.height/2 + bottomPadding
        // 即：maxHeight <= 2 * (keyCenterY + visibleSize.height/2 - bottomPadding)
        const maxHeightByBottom = 2 * (keyCenterY + visibleSize.height / 2 - this.bottomPadding);
        maxHeight = Math.min(maxHeight, maxHeightByBottom);
        
        // 顶部对齐线 Y 坐标（最长琴键的中心在 keyCenterY，所以顶部 = 中心 + 高度/2）
        const topY = keyCenterY + maxHeight / 2;

        // 创建琴键
        for (let i = 0; i < this.keyCount; i++) {
            const key = instantiate(this.keyPrefab);
            this.node.addChild(key);

            // 计算 V 形布局：中间最长，两边最短，顶部对齐
            const distFromCenter = Math.abs(i - centerIndex);
            
            // 计算当前琴键的高度（越靠近中心，高度越高）
            // 使用相对比例来计算，确保所有琴键按相同比例缩放
            const heightIncrease = (maxDist - distFromCenter) * this.vShapeOffset;
            const rawHeight = this.keyHeight + heightIncrease;
            const rawMaxHeight = this.keyHeight + (maxDist * this.vShapeOffset);
            // 按比例缩放：当前高度 = maxHeight * (rawHeight / rawMaxHeight)
            const currentHeight = maxHeight * (rawHeight / rawMaxHeight);

            // 设置琴键大小和位置
            const uiTransform = key.getComponent(UITransform);
            if (uiTransform) {
                uiTransform.width = this.keyWidth;
                uiTransform.height = currentHeight;
                
                // 当前琴键的中心 Y 坐标 = 顶部线 - 当前高度的一半（顶部对齐）
                const y = topY - currentHeight / 2;
                const x = startX + i * this.keySpacing;
                
                key.setPosition(new Vec3(x, y, 0));
            }

            // 将琴键上所有 Label 贴到底部，避免拉伸后文字与图片错位
            this.layoutKeyLabelsToBottom(key, currentHeight);

            // 设置琴键编号并更新显示
            const kalimbaKey = key.getComponent(KalimbaKey);
            if (kalimbaKey) {
                // 注意：这里我们使用 i (0-16) 而不是 i+1
                // 这样能正确匹配 KalimbaKey.noteMap 数组的索引
                kalimbaKey.setKeyIndex(i);
            }

            this.keys.push(key);
        }
        void applySavedFontToSubtree(this.node);
    }

    /**
     * 将琴键上所有 Label 子节点贴到琴键底部；DotLabel 紧挨数字上方约 3px
     */
    private layoutKeyLabelsToBottom(key: Node, keyHeight: number) {
        const bottomY = -keyHeight / 2 + this.labelBottomMargin;
        const dotGap = 3; // 点与数字的间距（px）
        const labelNodes: { node: Node; ui: UITransform; label: Label; name: string }[] = [];
        for (let i = 0; i < key.children.length; i++) {
            const child = key.children[i];
            const label = child.getComponent(Label);
            if (!label) continue;
            const ui = child.getComponent(UITransform);
            if (!ui) continue;
            labelNodes.push({ node: child, ui, label, name: child.name });
        }
        const noteEntry = labelNodes.find(t => t.name === 'NoteLabel');
        const noteLabelHeight = noteEntry ? (noteEntry.label.lineHeight || noteEntry.ui.height || 20) : 20;
        for (const { node, ui, label, name } of labelNodes) {
            ui.setAnchorPoint(0.5, 0);
            label.color = this.labelColor;
            if (name === 'NoteLabel') {
                node.setPosition(0, bottomY, 0);
            } else if (name === 'DotLabel') {
                node.setPosition(0, bottomY + noteLabelHeight / 1.5 + dotGap, 0);
            } else if (name === 'DotLabel2') {
                const dotY = bottomY + noteLabelHeight / 1.5 + dotGap;
                const dot2Gap = 2;
                node.setPosition(0, dotY + dot2Gap, 0);
            } else {
                node.setPosition(0, bottomY, 0);
            }
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