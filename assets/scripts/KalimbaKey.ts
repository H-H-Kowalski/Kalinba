import { _decorator, Component, Node, AudioSource, AudioClip, UITransform, Color, Sprite, tween, Tween, Vec3, Label, instantiate } from 'cc';
import { AudioManager } from './manager/AudioManager';
import { vibrateKeyTap } from './manager/HapticFeedback';
import { PerformanceRecorder } from './manager/PerformanceRecorder';
const { ccclass, property } = _decorator;

@ccclass('KalimbaKey')
export class KalimbaKey extends Component {
    private static keyRegistry: Map<number, KalimbaKey> = new Map();
    private static readonly playListeners = new Set<(keyIndex: number) => void>();

    @property
    keyIndex: number = 0;  // 琴键编号（0-16）

    @property(Label)
    noteLabel: Label = null; // 显示音符的标签

    @property(Label)
    dotLabel: Label = null; // 显示高音点的标签

    @property(Label)
    dotLabel2: Label = null; // 第二个点（两个点时用，与 dotLabel 紧挨竖向排布）

    // 卡林巴琴简谱映射 (从左到右: D6 B5 G5 E5 C5 A4 F4 D4 C4 E4 G4 B4 D5 F5 A5 C6 E6)
    private static noteMap = [
        { num: '2', dot: '••' }, { num: '7', dot: '•' }, { num: '5', dot: '•' }, 
        { num: '3', dot: '•' }, { num: '1', dot: '•' }, { num: '6', dot: '' }, 
        { num: '4', dot: '' }, { num: '2', dot: '' }, { num: '1', dot: '' }, 
        { num: '3', dot: '' }, { num: '5', dot: '' }, { num: '7', dot: '' }, 
        { num: '2', dot: '•' }, { num: '4', dot: '•' }, { num: '6', dot: '•' }, 
        { num: '1', dot: '••' }, { num: '3', dot: '••' }
    ];

    @property(AudioClip)
    keySound: AudioClip = null;

    private audioSource: AudioSource = null;
    private sprite: Sprite = null;
    private isPressed: boolean = false;
    private replayVisualToken = 0;
    private defaultScale: Vec3 = new Vec3(1, 1, 1);
    private normalSpriteColor: Color = new Color(255, 255, 255, 255);
    private guidanceActive = false;

    static getByIndex(index: number): KalimbaKey | null {
        return KalimbaKey.keyRegistry.get(index) ?? null;
    }

    static setGuidanceKey(keyIndex: number | null): void {
        for (const [index, key] of KalimbaKey.keyRegistry) {
            key.setGuidanceActive(keyIndex !== null && index === keyIndex);
        }
    }

    static getDisplayNote(index: number): string {
        return this.noteMap[index]?.num ?? '?';
    }

    /** 挑战谱面使用：保留高低音点，避免左右两侧同数字琴键产生歧义。 */
    static getChallengeDisplayNote(index: number): string {
        const note = this.noteMap[index];
        return note ? `${note.dot}${note.num}` : '?';
    }

    /** 关卡判定等玩法订阅真实用户按键；回放不会经过此入口。 */
    static addPlayListener(listener: (keyIndex: number) => void): void {
        this.playListeners.add(listener);
    }

    static removePlayListener(listener: (keyIndex: number) => void): void {
        this.playListeners.delete(listener);
    }

    private static emitUserPlay(keyIndex: number): void {
        for (const listener of this.playListeners) {
            try {
                listener(keyIndex);
            } catch (e) {
                console.warn('[KalimbaKey] play listener failed', e);
            }
        }
    }

    start() {
        this.audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this.sprite = this.getComponent(Sprite) || this.addComponent(Sprite);
        this.defaultScale = this.node.getScale().clone();
        this.normalSpriteColor = this.sprite.color.clone();
        
        // 尝试自动获取 Label
        if (!this.noteLabel) {
            const noteNode = this.node.getChildByName("NoteLabel");
            if (noteNode) this.noteLabel = noteNode.getComponent(Label);
            // 备用：随便找一个
            if (!this.noteLabel) this.noteLabel = this.node.getComponentInChildren(Label);
        }
        
        if (!this.dotLabel) {
            const dotNode = this.node.getChildByName("DotLabel");
            if (dotNode) this.dotLabel = dotNode.getComponent(Label);
        }
        if (!this.dotLabel2) {
            let dot2Node = this.node.getChildByName("DotLabel2");
            if (!dot2Node && this.dotLabel) {
                dot2Node = instantiate(this.dotLabel.node);
                dot2Node.name = "DotLabel2";
                this.node.addChild(dot2Node);
                this.dotLabel2 = dot2Node.getComponent(Label);
                const ui = dot2Node.getComponent(UITransform);
                if (ui) ui.setAnchorPoint(0.5, 0);
                if (this.dotLabel2) this.dotLabel2.color = this.dotLabel.color.clone();
            } else if (dot2Node) {
                this.dotLabel2 = dot2Node.getComponent(Label);
            }
        }
        
        this.updateNoteDisplay();
        KalimbaKey.keyRegistry.set(this.keyIndex, this);

        // 注册触摸事件
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    /** 按下即给出金属弹片的暖高光与短促下压。 */
    onTouchStart(event: any) {
        this.isPressed = true;
        
        if (this.sprite) {
            const color = this.sprite.color.clone();
            color.a = 128;
            this.sprite.color = color;
        }
            
        vibrateKeyTap();
        const touchPos = event.getUILocation();
        this.playKeySound(new Vec3(touchPos.x, touchPos.y, 0));
    }

    /**
     * 松开：恢复不透明
     */
    onTouchEnd() {
        if (!this.isPressed) return;
        this.isPressed = false;
        this.applyPressedVisual(false);
    }

    updateNoteDisplay() {
        if (this.keyIndex >= 0 && this.keyIndex < KalimbaKey.noteMap.length) {
            const noteInfo = KalimbaKey.noteMap[this.keyIndex];
            
            // 如果配置了独立的 DotLabel，分开显示；两个点用两个 Label 紧挨竖排，无第二个 Label 时用冒号 ":" 替代
            if (this.dotLabel && this.noteLabel) {
                this.noteLabel.string = noteInfo.num;
                if (noteInfo.dot === '••') {
                    if (this.dotLabel2) {
                        this.dotLabel.string = '•';
                        this.dotLabel2.string = '•';
                        this.dotLabel2.node.active = true;
                        const gap = 8;
                        this.dotLabel2.node.setPosition(0, this.dotLabel.node.position.y + gap, 0);
                    } else {
                        this.dotLabel.string = ':';
                    }
                } else {
                    this.dotLabel.string = noteInfo.dot;
                    if (this.dotLabel2) this.dotLabel2.node.active = false;
                }
            } 
            // 否则使用换行符兼容旧模式
            else if (this.noteLabel) {
                const dotText = noteInfo.dot ? noteInfo.dot + '\n' : '';
                this.noteLabel.string = dotText + noteInfo.num;
            }
        }
    }
    
    setKeyIndex(index: number) {
        KalimbaKey.keyRegistry.delete(this.keyIndex);
        this.keyIndex = index;
        this.updateNoteDisplay();
        KalimbaKey.keyRegistry.set(this.keyIndex, this);
    }

    /** 回放时的按键视觉反馈：短暂按下再抬起 */
    playReplayPress(durationMs = 85): void {
        this.replayVisualToken += 1;
        const token = this.replayVisualToken;
        this.applyPressedVisual(true);
        this.playReplayPulse();
        const sec = Math.max(0.03, durationMs / 1000);
        this.scheduleOnce(() => {
            if (token !== this.replayVisualToken) return;
            if (this.isPressed) return;
            this.applyPressedVisual(false);
        }, sec);
    }

    /** 回放点击指示：短促按压缩放，再回到原尺寸 */
    private playReplayPulse(): void {
        Tween.stopAllByTarget(this.node);
        const sx = this.defaultScale.x;
        const sy = this.defaultScale.y;
        const sz = this.defaultScale.z;
        this.node.setScale(sx, sy, sz);
        tween(this.node)
            .to(0.05, { scale: new Vec3(sx * 0.95, sy * 0.95, sz) })
            .to(0.06, { scale: new Vec3(sx, sy, sz) })
            .start();
    }

    private applyPressedVisual(pressed: boolean) {
        if (!this.sprite) return;
        const c = this.normalSpriteColor.clone();
        if (this.guidanceActive) {
            c.r = 255;
            c.g = Math.min(255, c.g + 5);
            c.b = Math.max(0, c.b - 45);
        }
        if (pressed) {
            // 保留贴图明暗细节，只用轻微暖色调模拟弹片受光，不做半透明以免显得廉价。
            c.r = Math.min(255, c.r + 8);
            c.g = Math.min(255, c.g + 1);
            c.b = Math.max(0, c.b - 24);
        }
        this.sprite.color = c;
        Tween.stopAllByTarget(this.node);
        const sx = this.defaultScale.x;
        const sy = this.defaultScale.y;
        const sz = this.defaultScale.z;
        if (pressed) {
            tween(this.node)
                .to(0.035, { scale: new Vec3(sx * 0.985, sy * 0.955, sz) })
                .start();
        } else {
            tween(this.node)
                .to(0.075, { scale: new Vec3(sx, sy, sz) })
                .start();
        }
    }

    private setGuidanceActive(active: boolean) {
        if (this.guidanceActive === active) return;
        this.guidanceActive = active;
        if (!this.isPressed) this.applyPressedVisual(false);
    }

    private playKeySound(worldPos?: Vec3) {
        try {
            const audioManager = AudioManager.getInstance();
            if (audioManager) {
                KalimbaKey.emitUserPlay(this.keyIndex);
                PerformanceRecorder.recordKey(this.keyIndex);
                audioManager.playKeySound(this.keyIndex, worldPos, this.keySound);
                return;
            }
            if (this.keySound && this.audioSource) {
                this.audioSource.playOneShot(this.keySound);
            }
        } catch {
            if (this.keySound && this.audioSource) {
                this.audioSource.playOneShot(this.keySound);
            }
        }
    }

    onDestroy() {
        KalimbaKey.keyRegistry.delete(this.keyIndex);
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }
}
