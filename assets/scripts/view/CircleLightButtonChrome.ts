import { _decorator, Component, UITransform, Graphics, Color, Node, Button, Sprite } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 圆形浅色底 + 自动修正同节点 Button，避免：
 * - SPRITE 过渡在 hover 时换成整张图，盖住图标、且只有悬停才「有背景」
 * - COLOR 过渡把整个节点（含图标）染色
 * - 父节点非等比缩放导致圆变椭圆
 *
 * 图标：放在子节点中；会自动排到 _Chrome* 之上。若仍异常，请把 Button 的 Transition 设为 NONE 试一次。
 */
@ccclass('CircleLightButtonChrome')
export class CircleLightButtonChrome extends Component {
    @property({ tooltip: '圆形填充色（浅色），常驻显示' })
    lightFillColor: Color = new Color(245, 248, 252, 255);

    @property({ tooltip: '是否绘制左半圆叠层（默认关）' })
    useLeftMask: boolean = false;

    @property({ tooltip: '左半圆蒙层（仅当 useLeftMask 为 true）' })
    leftMaskColor: Color = new Color(255, 255, 255, 70);

    @property({ tooltip: '相对按钮内切圆的边距（像素）' })
    circlePadding: number = 2;

    @property({
        tooltip:
            '自动修正同节点 Button：关 SPRITE hover 大图、统一颜色态，并把缩放/颜色目标指到图标子节点（若有）',
    })
    autoFixButton: boolean = true;

    private _lateFrames = 0;

    onLoad() {
        this.applyChrome();
        this.fixButtonIfNeeded();
        // 应对子节点晚于本组件创建的情况，再排一次层级
        this.scheduleOnce(() => {
            this.applyChrome();
            this.ensureNonChromeOnTop();
            this.fixButtonIfNeeded();
        }, 0);
    }

    onEnable() {
        this.applyChrome();
        this.ensureNonChromeOnTop();
        this.fixButtonIfNeeded();
    }

    lateUpdate() {
        // 前几帧持续把图标顶到最上，防止编辑器或其它脚本改 sibling 顺序
        if (this._lateFrames < 5) {
            this._lateFrames++;
            this.ensureNonChromeOnTop();
        }
    }

    refresh() {
        this.applyChrome();
        this.ensureNonChromeOnTop();
    }

    /** 手动再执行一次 Button 修正（例如运行时换了 Button 资源） */
    fixButtonNow() {
        this.fixButtonIfNeeded();
    }

    private applyChrome() {
        const host = this.node;
        const ui = host.getComponent(UITransform);
        if (!ui) {
            console.warn('[CircleLightButtonChrome] 需要 UITransform');
            return;
        }

        const w = ui.width;
        const h = ui.height;
        const r = Math.max(1, Math.min(w, h) * 0.5 - this.circlePadding);

        let fillNode = host.getChildByName('_ChromeCircleFill');
        let maskNode = host.getChildByName('_ChromeLeftMask');

        if (!fillNode) {
            fillNode = new Node('_ChromeCircleFill');
            fillNode.addComponent(UITransform).setContentSize(w, h);
            fillNode.setParent(host);
        }
        fillNode.getComponent(UITransform)?.setContentSize(w, h);
        fillNode.color = Color.WHITE;
        fillNode.active = true;

        // 父节点非等比缩放时，抵消缩放让「圆」在屏幕上仍是正圆
        const sx = host.scale.x;
        const sy = host.scale.y;
        if (Math.abs(sx) > 1e-5 && Math.abs(sy) > 1e-5) {
            fillNode.setScale(1 / sx, 1 / sy, 1);
        } else {
            fillNode.setScale(1, 1, 1);
        }

        if (!maskNode) {
            maskNode = new Node('_ChromeLeftMask');
            maskNode.addComponent(UITransform).setContentSize(w, h);
            maskNode.setParent(host);
        }
        maskNode.getComponent(UITransform)?.setContentSize(w, h);
        maskNode.color = Color.WHITE;
        maskNode.active = this.useLeftMask;
        if (Math.abs(sx) > 1e-5 && Math.abs(sy) > 1e-5) {
            maskNode.setScale(1 / sx, 1 / sy, 1);
        } else {
            maskNode.setScale(1, 1, 1);
        }

        this.drawCircleFill(fillNode, r);
        if (this.useLeftMask) {
            this.drawLeftHalfOverlay(maskNode, r);
        } else {
            const g = maskNode.getComponent(Graphics);
            if (g) g.clear();
        }

        // 先排好层级再画
        fillNode.setSiblingIndex(0);
        if (this.useLeftMask) {
            maskNode.setSiblingIndex(1);
        }
        this.ensureNonChromeOnTop();
    }

    /** 所有非 _Chrome 子节点保持在上层（后渲染），避免被圆底挡住 */
    private ensureNonChromeOnTop() {
        const host = this.node;
        const chromes: Node[] = [];
        const others: Node[] = [];
        for (const c of host.children) {
            if (c.name.startsWith('_Chrome')) chromes.push(c);
            else others.push(c);
        }
        let idx = 0;
        for (const c of chromes) c.setSiblingIndex(idx++);
        for (const o of others) o.setSiblingIndex(idx++);
    }

    private findIconTargetNode(): Node | null {
        for (const c of this.node.children) {
            if (c.name.startsWith('_Chrome')) continue;
            if (c.getComponent(Sprite) || c.getComponentInChildren(Sprite)) return c;
        }
        return null;
    }

    private fixButtonIfNeeded() {
        if (!this.autoFixButton) return;
        const btn = this.node.getComponent(Button);
        if (!btn) return;

        const icon = this.findIconTargetNode();

        // 1) SPRITE：hover/pressed 换图常导致「只有悬停有图」或整张盖住子节点 → 改为 SCALE（仅缩放图标）
        if (btn.transition === Button.Transition.SPRITE) {
            const b = btn as unknown as {
                normalSprite?: unknown;
                hoverSprite?: unknown;
                pressedSprite?: unknown;
            };
            const n = b.normalSprite ?? null;
            b.hoverSprite = n;
            b.pressedSprite = n;
            btn.transition = Button.Transition.SCALE;
            btn.zoomScale = 1.0;
        }

        // 2) COLOR：避免染到整块（含底图与图标）→ 只染图标子节点
        if (btn.transition === Button.Transition.COLOR && icon) {
            btn.target = icon;
        }

        // 3) SCALE：缩放只作用在图标上，不把整张底图一起「弹」飞盖住别人
        if (btn.transition === Button.Transition.SCALE) {
            btn.zoomScale = btn.zoomScale <= 0 ? 1.02 : btn.zoomScale;
            if (icon) {
                btn.target = icon;
            }
        }

        // 4) 无过渡时保持
        if (btn.transition === Button.Transition.NONE) {
            /* noop */
        }
    }

    private drawCircleFill(node: Node, r: number) {
        let g = node.getComponent(Graphics);
        if (!g) g = node.addComponent(Graphics);
        g.clear();
        g.fillColor = this.lightFillColor;
        g.circle(0, 0, r);
        g.fill();
    }

    private drawLeftHalfOverlay(node: Node, r: number) {
        let g = node.getComponent(Graphics);
        if (!g) g = node.addComponent(Graphics);
        g.clear();
        g.fillColor = this.leftMaskColor;
        g.moveTo(0, 0);
        g.arc(0, 0, r, Math.PI / 2, (Math.PI * 3) / 2, true);
        g.close();
        g.fill();
    }
}
