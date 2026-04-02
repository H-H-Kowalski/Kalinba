import { _decorator, Button, Color, Component, Label, Sprite, UITransform } from 'cc';
const { ccclass, property } = _decorator;

/**
 * 挂在 settingLabel 预制体根节点上：统一改文案；自带 Button 按压高亮（与 Sprite 颜色或缩放反馈）。
 * 编辑器可拖子节点 Label；不拖则在 onLoad 时自动查找子节点上的 Label。
 */
@ccclass('SettingLabel')
export class SettingLabel extends Component {
    @property(Label)
    label: Label = null;
    private _rawText = '';

    onLoad() {
        if (!this.label) {
            this.label = this.getComponentInChildren(Label);
        }
    }

    start() {
        // 晚一帧，确保外部若在同一帧给 Sprite 挂了 Button、注册了点击，仍能被正确配置过渡
        this.scheduleOnce(() => this.ensureButtonPressHighlight(), 0);
    }

    set text(s: string) {
        this._rawText = s ?? '';
        if (this.label) {
            this.label.string = this._rawText;
        }
    }

    get text(): string {
        return this.label ? this.label.string : '';
    }

    setChecked(checked: boolean) {
        if (!this.label) return;
        this.label.string = checked ? `✓ ${this._rawText}` : this._rawText;
    }

    /** 与 SettingsScene 原逻辑一致：有 Sprite 用颜色变深，否则略缩小 */
    ensureButtonPressHighlight() {
        if (!this.node?.isValid) return;
        const root = this.node;
        let btn = root.getComponent(Button) || root.getComponentInChildren(Button);
        const touchNode =
            btn?.node
            ?? root.getChildByName('Sprite')
            ?? root.getComponentInChildren(UITransform)?.node
            ?? root;
        if (!btn) {
            btn = touchNode.addComponent(Button);
        }
        const visualNode = root.getChildByName('Sprite') ?? root;
        const sprite = visualNode.getComponent(Sprite);
        btn.duration = 0.08;
        if (sprite) {
            btn.transition = Button.Transition.COLOR;
            btn.target = visualNode;
            const n = sprite.color.clone();
            btn.normalColor = n;
            btn.hoverColor = n;
            btn.pressedColor = SettingLabel.pressDarken(n, 0.14);
            btn.disabledColor = new Color(180, 180, 180, 200);
        } else {
            btn.transition = Button.Transition.SCALE;
            btn.target = root;
            btn.zoomScale = 0.94;
        }
    }

    private static pressDarken(c: Color, ratio: number): Color {
        return new Color(
            Math.max(0, Math.floor(c.r * (1 - ratio))),
            Math.max(0, Math.floor(c.g * (1 - ratio))),
            Math.max(0, Math.floor(c.b * (1 - ratio))),
            c.a,
        );
    }
}
