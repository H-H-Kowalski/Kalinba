import { _decorator, Component, Graphics, Color, UITransform, CCBoolean } from 'cc';
const { ccclass, property, executeInEditMode, requireComponent } = _decorator;

@ccclass('RoundedRect')
@executeInEditMode // 允许在编辑器中预览
@requireComponent(Graphics) // 自动添加Graphics组件
export class RoundedRect extends Component {
    @property({ tooltip: '圆角半径' })
    radius: number = 20;

    @property({ tooltip: '是否使用百分比' })
    isPercentage: boolean = false;

    @property({ tooltip: '圆角百分比 (0-1)', visible: function() { return this.isPercentage; } })
    radiusPercent: number = 0.1;

    @property({ tooltip: '背景颜色' })
    fillColor: Color = new Color(255, 255, 255, 255);

    private graphics: Graphics = null;
    private uiTransform: UITransform = null;

    onLoad() {
        this.init();
        this.draw();
    }

    init() {
        this.graphics = this.getComponent(Graphics);
        this.uiTransform = this.getComponent(UITransform);
    }

    update() {
        // 仅在编辑器模式下实时刷新，方便调整
        if (EDITOR) {
            this.init();
            this.draw();
        }
    }

    /**
     * 绘制圆角矩形
     */
    draw() {
        if (!this.graphics || !this.uiTransform) return;

        const width = this.uiTransform.width;
        const height = this.uiTransform.height;
        const anchorX = this.uiTransform.anchorX;
        const anchorY = this.uiTransform.anchorY;

        // 清除之前的绘制
        this.graphics.clear();

        // 设置颜色
        this.graphics.fillColor = this.fillColor;

        // 计算起始坐标（基于锚点）
        const x = -width * anchorX;
        const y = -height * anchorY;

        // 计算圆角半径
        let r = this.radius;
        if (this.isPercentage) {
            // 使用最短边计算百分比
            const minSide = Math.min(width, height);
            r = minSide * this.radiusPercent;
        }

        // 绘制圆角矩形
        this.graphics.roundRect(x, y, width, height, r);
        this.graphics.fill();
    }

    /**
     * 当节点大小改变时重新绘制
     */
    onTransformChanged() {
        this.draw();
    }

    onEnable() {
        this.node.on(Node.EventType.SIZE_CHANGED, this.onTransformChanged, this);
        this.node.on(Node.EventType.ANCHOR_CHANGED, this.onTransformChanged, this);
    }

    onDisable() {
        this.node.off(Node.EventType.SIZE_CHANGED, this.onTransformChanged, this);
        this.node.off(Node.EventType.ANCHOR_CHANGED, this.onTransformChanged, this);
    }
}

// 声明 EDITOR 变量防止TS报错
declare const EDITOR: boolean;
import { Node } from 'cc';
