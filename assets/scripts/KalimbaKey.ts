import { _decorator, Component, Node, AudioSource, AudioClip, UITransform, Color, Sprite, tween, Vec3, Label, instantiate } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('KalimbaKey')
export class KalimbaKey extends Component {
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

    start() {
        this.audioSource = this.getComponent(AudioSource) || this.addComponent(AudioSource);
        this.sprite = this.getComponent(Sprite) || this.addComponent(Sprite);
        
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

        // 注册触摸事件
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }

    /**
     * 按下：变透明(50%)、播放
     */
    onTouchStart(event: any) {
        if (this.isPressed) return;
        this.isPressed = true;
        
        // 视觉反馈：变透明
        if (this.sprite) {
            const color = this.sprite.color.clone();
            color.a = 128; // 50% 透明度
            this.sprite.color = color;
        }
            
        // 播放逻辑（按下即播放）
        const touchPos = event.getUILocation();
        this.playKeySound(new Vec3(touchPos.x, touchPos.y, 0));
    }

    /**
     * 松开：恢复不透明
     */
    onTouchEnd() {
        if (!this.isPressed) return;
        this.isPressed = false;
        
        // 恢复不透明
        if (this.sprite) {
            const color = this.sprite.color.clone();
            color.a = 255; // 100% 不透明
            this.sprite.color = color;
        }
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
        this.keyIndex = index;
        this.updateNoteDisplay();
    }

    private playKeySound(worldPos?: Vec3) {
        try {
            const audioManager = (globalThis as any).AudioManager?.getInstance();
            if (audioManager) {
                audioManager.playKeySound(this.keyIndex, worldPos);
            } else if (this.keySound) {
                this.audioSource.playOneShot(this.keySound);
            }
        } catch (error) {
            if (this.keySound) this.audioSource.playOneShot(this.keySound);
        }
    }

    onDestroy() {
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(Node.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
    }
}