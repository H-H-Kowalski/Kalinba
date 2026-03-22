import { _decorator, Component, UITransform, Vec2, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 让带 Button 的节点使用「圆形」点击区域（与圆形视觉一致）。
 * 默认 UITransform.hitTest 是轴对齐矩形，四角会多点；挂上本组件后仅在圆内可点。
 *
 * 用法：挂在与 Button、UITransform 同一节点上；节点建议正方形（宽高一致），圆半径 = min(w,h)/2。
 */
@ccclass('CircularButtonHitArea')
export class CircularButtonHitArea extends Component {
    @property({ tooltip: '半径占 min(宽,高) 的比例，默认 0.5 即内切圆' })
    radiusScale: number = 0.5;

    private _ui: UITransform | null = null;
    private _origHitTest: ((this: UITransform, p: Vec2) => boolean) | null = null;

    onLoad() {
        this._ui = this.node.getComponent(UITransform);
        if (!this._ui) {
            console.warn('[CircularButtonHitArea] 需要 UITransform');
            return;
        }

        const ui = this._ui as UITransform & { hitTest?: (p: Vec2) => boolean };
        if (typeof ui.hitTest !== 'function') {
            console.warn('[CircularButtonHitArea] 当前引擎 UITransform 无 hitTest，无法打补丁');
            return;
        }

        this._origHitTest = ui.hitTest.bind(ui);
        const self = this;
        ui.hitTest = function (this: UITransform, screenPoint: Vec2): boolean {
            if (!self._origHitTest!.call(this, screenPoint)) {
                return false;
            }
            const bb = this.getBoundingBoxToWorld();
            const rw = Math.min(bb.width, bb.height) * self.radiusScale;
            const cx = bb.x + bb.width * 0.5;
            const cy = bb.y + bb.height * 0.5;
            const dx = screenPoint.x - cx;
            const dy = screenPoint.y - cy;
            return dx * dx + dy * dy <= rw * rw;
        };
    }

    onDestroy() {
        const ui = this.node.getComponent(UITransform) as UITransform & { hitTest?: (p: Vec2) => boolean };
        if (ui && this._origHitTest) {
            ui.hitTest = this._origHitTest;
        }
    }
}
