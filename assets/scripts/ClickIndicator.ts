import { _decorator, Component, Node, Sprite, Color, tween, Vec3, UITransform } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('ClickIndicator')
export class ClickIndicator extends Component {
    @property
    duration: number = 0.8;  // 指示器显示时长

    @property
    maxScale: number = 1.5;  // 最大缩放比例

    @property
    fadeOutDuration: number = 0.3;  // 淡出时长

    private sprite: Sprite = null;
    private uiTransform: UITransform = null;
    private originalScale: Vec3 = new Vec3(1, 1, 1);

    start() {
        this.sprite = this.getComponent(Sprite);
        this.uiTransform = this.getComponent(UITransform);
        
        if (this.sprite) {
            this.sprite.color = new Color(255, 255, 255, 200); // 半透明白色
        }
        
        this.originalScale = this.node.scale.clone();
        this.playAnimation();
    }

    /**
     * 播放点击指示动画
     */
    playAnimation() {
        // 重置状态
        this.node.scale = this.originalScale;
        if (this.sprite) {
            this.sprite.color = new Color(255, 255, 255, 200);
        }

        // 缩放动画
        tween(this.node)
            .to(0.2, { scale: new Vec3(this.maxScale, this.maxScale, 1) })
            .delay(this.duration - 0.2 - this.fadeOutDuration)
            .to(this.fadeOutDuration, { 
                scale: new Vec3(this.maxScale * 1.2, this.maxScale * 1.2, 1) 
            })
            .start();

        // 淡出动画
        if (this.sprite) {
            tween(this.sprite)
                .delay(this.duration - this.fadeOutDuration)
                .to(this.fadeOutDuration, { 
                    color: new Color(255, 255, 255, 0) 
                })
                .call(() => {
                    // 动画结束后销毁节点
                    this.node.destroy();
                })
                .start();
        } else {
            // 如果没有sprite组件，延迟销毁
            this.scheduleOnce(() => {
                this.node.destroy();
            }, this.duration);
        }
    }

    /**
     * 设置指示器位置
     * @param worldPos 世界坐标位置
     */
    setPosition(worldPos: Vec3) {
        this.node.setPosition(worldPos);
    }

    /**
     * 设置指示器大小
     * @param size 大小
     */
    setSize(size: number) {
        if (this.uiTransform) {
            this.uiTransform.width = size;
            this.uiTransform.height = size;
        }
    }
}