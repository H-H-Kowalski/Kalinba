import { _decorator, Component, EditBox, UITransform, Label, isValid } from 'cc';
import { getWx } from '../manager/WeChatNative';
import { ContentSecurityService } from '../manager/ContentSecurityService';
import { showToast } from './SimpleToast';
import { PerformanceAppearanceStore } from '../manager/PerformanceAppearanceStore';
import { showBusyIndicator } from './AppearanceFeedback';
const { ccclass, property } = _decorator;

/**
 * 与 EditBox 挂在同一节点（或指定 editBox）：
 * - 展示/编辑短标题，最多 maxChars 字（默认 10）
 * - 仅在本次运行中保留已审核文案
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

    @property({ tooltip: '旧版存储 key，仅用于清理旧存档' })
    storageKey: string = 'user_caption';

    @property({ tooltip: '保留旧场景兼容；现在总是同步恢复本次运行文案' })
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
    private approvedText = '';
    private checkRevision = 0;
    private checking = false;
    private acceptingInput = true;
    private closeLoading: (() => void) | null = null;


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

        PerformanceAppearanceStore.removeLegacyStorage(this.storageKey);
        this.approvedText = this.clamp(PerformanceAppearanceStore.getCaption(this.defaultCaption));
        this._eb.string = this.approvedText;
        // 空标题应当真正显示为空，不由 EditBox 占位文案补回默认标题。
        if (this._eb.placeholderLabel) this._eb.placeholderLabel.string = '';

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

    onEnable() { this.acceptingInput = true; }

    onDisable() {
        this.acceptingInput = false;
        this.closeLoading?.();
        this.closeLoading = null;
        this.checkRevision++;
        this.checking = false;
        if (this._eb?.isValid) {
            this._eb.string = this.approvedText;
            this._eb.enabled = true;
        }
    }

    onDestroy() {
        this.acceptingInput = false;
        this.closeLoading?.();
        this.closeLoading = null;
        this.checkRevision++;
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
        // Native keyboard callbacks can arrive after EditBox was disabled or the view changed.
        if (this.checking || !this.acceptingInput) {
            this._eb.string = this.approvedText;
            return;
        }
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
        if (!this._eb) return;
        if (this.checking || !this.acceptingInput) {
            this._eb.string = this.approvedText;
            return;
        }
        const candidate = this.clamp(this._eb.string.replace(/[\r\n]+/g, '').trim());
        // Restore immediately while the request is pending. Recording reads approvedText only.
        this._eb.string = this.approvedText;
        this.hideWechatKeyboard();
        this.alignInnerLabels();
        if (candidate !== this.approvedText) void this.approveAndApply(candidate);
    }

    private async approveAndApply(candidate: string) {
        const revision = ++this.checkRevision;
        this.checking = true;
        if (this._eb) this._eb.enabled = false;
        try {
            // 清空不是用户生成文本，不需要联网，也不能因额度/断网而清空失败。
            if (candidate) {
                this.closeLoading = showBusyIndicator(this.node, '正在检测文案，请稍候…').close;
                await ContentSecurityService.requireText(candidate);
            }
            if (!isValid(this, true) || revision !== this.checkRevision || !isValid(this._eb, true)) return;
            this.approvedText = candidate;
            this._eb.string = candidate;
            PerformanceAppearanceStore.setCaption(candidate);
        } catch (error) {
            if (isValid(this, true) && revision === this.checkRevision) {
                showToast(this.node, ContentSecurityService.message(error), 2);
            }
        } finally {
            if (isValid(this, true) && revision === this.checkRevision) {
                this.closeLoading?.();
                this.closeLoading = null;
                this.checking = false;
                if (this._eb?.isValid) this._eb.enabled = true;
                this.alignInnerLabels();
            }
        }
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

    restoreSessionCaption() { this.setText(PerformanceAppearanceStore.getCaption(this.defaultCaption)); }

    /** 外部读取当前文案 */
    get text(): string {
        return this.approvedText;
    }

    /** 仅供内置关卡或服务端已审核的分享标题使用；用户输入走 approveAndApply。 */
    setText(value: string) {
        if (!this._eb) return;
        this.closeLoading?.();
        this.closeLoading = null;
        this.checkRevision++;
        this.checking = false;
        this._eb.enabled = true;
        this.approvedText = this.clamp(value ?? '');
        this._eb.string = this.approvedText;
    }
}
