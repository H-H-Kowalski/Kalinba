import { _decorator, Component, EditBox, sys, UITransform, Label } from 'cc';
import { getWx } from '../manager/WeChatNative';
const { ccclass, property } = _decorator;

/**
 * 与 EditBox 挂在同一节点（或指定 editBox）：
 * - 展示/编辑短标题，最多 maxChars 字（默认 10）
 * - 可选 localStorage 持久化
 *
 * 【更简单：浮在 pianoHor 上面】不要当 pianoHor 子节点。
 * 1）与 pianoHor **同级**（都在 Canvas 下新建一空节点，例如 CaptionFloat）。
 * 2）层级列表里把 CaptionFloat 拖到 **pianoHor 下面**（更靠下 = 后画 = 浮在上层）。
 * 3）UITransform 用坐标把输入框摆到横条中间（对准 pianoHor 的位置即可）。
 * 4）本节点：UITransform + EditBox + EditableCaption。
 */
@ccclass('EditableCaption')
export class EditableCaption extends Component {
    @property({ tooltip: '不填则使用本节点上的 EditBox' })
    editBox: EditBox = null;

    @property({ tooltip: '最大字符数（中文按字计）' })
    maxChars: number = 10;

    @property({ tooltip: '留空则不做本地保存；否则用该 key 存取文字' })
    storageKey: string = 'user_caption';

    @property({ tooltip: '启动时从 localStorage 读取（需 storageKey 非空）' })
    loadOnStart: boolean = true;

    @property({ tooltip: '无存档时的默认标题（占位已去掉，首次进入显示此文案）' })
    defaultCaption: string = '《生日快乐》';

    @property({
        tooltip:
            '每帧强制 TEXT_LABEL/占位符在框内居中。EditBox 会反复把内部 Label 改回左对齐，需常驻为 true',
    })
    keepLabelCentered: boolean = true;

    @property({ tooltip: 'TEXT_LABEL 正文始终加粗（编辑与非编辑一致）' })
    textBold: boolean = true;

    private _eb: EditBox | null = null;


    /**
     * EditBox 在 update 里会重设 textLabel 的对齐/排版，必须在同一帧里晚于 EditBox 再改回来。
     * 请在本节点上把「EditableCaption」组件拖到 EditBox **下方**（组件列表更靠下 = 后执行）。
     */
    update() {
        if (!this.keepLabelCentered || !this._eb?.isValid) return;
        // 聚焦/弹出系统键盘时勿每帧改子 Label 坐标与尺寸，否则与微信原生输入层抢布局，易出现输入条卡屏幕中间、无法收起
        if (typeof this._eb.isFocused === 'function' && this._eb.isFocused()) {
            return;
        }
        this.alignInnerLabels();
    }

    onLoad() {
        this._eb = this.editBox ?? this.getComponent(EditBox);
        if (!this._eb) {
            console.warn('[EditableCaption] 需要 EditBox（本节点或属性指定）');
            return;
        }
        this._eb.maxLength = this.maxChars;
        // 单行输入：避免出现多行文本框的上下拉伸/换行指示（Web 上 textarea 角标等）
        this._eb.inputMode = EditBox.InputMode.SINGLE_LINE;

        if (this.loadOnStart && this.storageKey) {
            const saved = sys.localStorage.getItem(this.storageKey);
            if (saved === null) {
                this._eb.string = this.clamp(this.defaultCaption);
            } else {
                this._eb.string = this.clamp(saved);
            }
        }

        this._eb.node.on(EditBox.EventType.TEXT_CHANGED, this.onTextChanged, this);
        this._eb.node.on(EditBox.EventType.EDITING_DID_ENDED, this.onEditEnd, this);
        if (EditBox.EventType.EDITING_RETURN !== undefined) {
            this._eb.node.on(EditBox.EventType.EDITING_RETURN, this.onEditEnd, this);
        }
    }

    /**
     * 强制把 EditBox 内文字/占位 Label 铺满输入区域并在框内水平+垂直居中。
     * EditBox 每帧可能把 horizontalAlign 改回 LEFT，故需配合 update() 持续写入。
     */
    private alignInnerLabels() {
        const eb = this._eb;
        if (!eb?.isValid) return;
        const rootUi = eb.node.getComponent(UITransform);
        if (!rootUi) return;
        const w = rootUi.width;
        const h = rootUi.height;
        if (w < 2 || h < 2) return;

        const apply = (lab: Label | null, isTextLine: boolean) => {
            if (!lab) return;
            const n = lab.node;
            const ui = n.getComponent(UITransform);
            if (!ui) return;
            ui.setContentSize(w, h);
            ui.setAnchorPoint(0.5, 0.5);
            n.setPosition(0, 0, 0);
            // 关键：不要用 RESIZE_HEIGHT，否则会按多行排版，居中失效
            lab.overflow = Label.Overflow.NONE;
            lab.horizontalAlign = Label.HorizontalAlign.CENTER;
            lab.verticalAlign = Label.VerticalAlign.CENTER;
            lab.enableWrapText = false;
            const fs = lab.fontSize || 24;
            lab.lineHeight = fs;
            // 正文行加粗（占位符保持常规字重）
            if (isTextLine) {
                lab.isBold = this.textBold;
            } else {
                lab.isBold = false;
            }
            // 避免字符缓存导致排版不刷新
            if (lab.cacheMode !== undefined) {
                lab.cacheMode = Label.CacheMode.NONE;
            }
            lab.markForUpdateRenderData();
        };

        apply(eb.textLabel, true);
        apply(eb.placeholderLabel, false);
    }

    onDestroy() {
        if (this._eb && this._eb.isValid) {
            this._eb.node.off(EditBox.EventType.TEXT_CHANGED, this.onTextChanged, this);
            this._eb.node.off(EditBox.EventType.EDITING_DID_ENDED, this.onEditEnd, this);
            if (EditBox.EventType.EDITING_RETURN !== undefined) {
                this._eb.node.off(EditBox.EventType.EDITING_RETURN, this.onEditEnd, this);
            }
        }
    }

    private clamp(s: string): string {
        if (s.length <= this.maxChars) return s;
        return s.slice(0, this.maxChars);
    }

    private onTextChanged() {
        if (!this._eb) return;
        let t = this._eb.string;
        if (/[\r\n]/.test(t)) {
            t = t.replace(/[\r\n]+/g, '');
            this._eb.string = this.clamp(t);
            return;
        }
        if (t.length > this.maxChars) {
            this._eb.string = t.slice(0, this.maxChars);
        }
        this.alignInnerLabels();
    }

    private onEditEnd() {
        if (this._eb && this.storageKey) {
            sys.localStorage.setItem(this.storageKey, this._eb.string);
        }
        this.hideWechatKeyboard();
        this.scheduleOnce(() => {
            this.alignInnerLabels();
        }, 0);
    }

    /** 微信小游戏：部分机型上仅失焦不会收起键盘，需显式 hideKeyboard */
    private hideWechatKeyboard() {
        const w = getWx() as { hideKeyboard?: (opts?: Record<string, unknown>) => void } | undefined;
        if (w && typeof w.hideKeyboard === 'function') {
            try {
                w.hideKeyboard({});
            } catch {
                // ignore
            }
        }
    }

    /** 外部读取当前文案 */
    get text(): string {
        return this._eb?.string ?? '';
    }

    /** 外部设置文案（会截断到 maxChars） */
    setText(value: string) {
        if (!this._eb) return;
        this._eb.string = this.clamp(value ?? '');
    }
}
