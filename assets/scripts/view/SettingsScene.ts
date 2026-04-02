import {
    _decorator,
    Button,
    Component,
    director,
    instantiate,
    Label,
    Layout,
    Node,
    Prefab,
    UITransform,
    Widget,
} from 'cc';
import { SceneManager } from '../manager/SceneManager';
import { AudioSettingsStore } from '../manager/AudioSettingsStore';
import { FontSettingsStore } from '../manager/FontSettingsStore';
import { SheetSettingsStore } from '../manager/SheetSettingsStore';
import { SheetRuntimeStore } from '../manager/SheetRuntimeStore';
import { FONTS_CATALOG } from '../manager/FontsCatalog';
import { applySavedFontToSubtree, invalidateFontCache } from '../manager/GlobalFontApplier';
import { SettingLabel } from './SettingLabel';
import { showToast } from './SimpleToast';
const { ccclass, property } = _decorator;

/**
 * 独立设置场景：挂在 settingscene 的 Canvas 上。
 * 场景文件 assets/settingscene.scene，Canvas 上挂本脚本并绑定下列属性。
 */
@ccclass('SettingsScene')
export class SettingsScene extends Component {
    @property(Button)
    backButton: Button = null;

    @property(Button)
    resetDefaultsButton: Button = null; // 恢复默认

    @property(Button)
    synthModeButton: Button = null;

    @property(Label)
    synthStyleLabel: Label = null;

    @property(Node)
    synthStyleListRoot: Node = null; // 音色可选列表容器（可选）

    /** 留空则在 start 时自动建在 Canvas 上（相对音色行下移 fontListRowOffsetY） */
    @property(Node)
    fontListRoot: Node = null;

    @property(Prefab)
    settingLabelPrefab: Prefab = null; // 你的 settingLabel 预制体（可选）

    @property
    styleItemHeight: number = 56; // 音色按钮高度（可在编辑器调）

    @property
    styleItemMinWidth: number = 80; // 音色按钮最小宽度

    @property
    styleItemHorizontalPadding: number = 10; // 文案左右留白（用于宽度自适应）

    @property({ tooltip: '仅字体选项：按钮内文字左右留白，越大越不挤' })
    fontItemHorizontalPadding: number = 20;

    @property({ tooltip: '仅字体选项：相邻按钮之间的水平间距' })
    fontListSpacingX: number = 12;

    @property
    fontListRowOffsetY: number = -100; // 自动创建字体列表时相对音色行的 Y 偏移

    /** 留空则在 start 时自动建在 Canvas 上（相对字体行下移 pageTurnRowOffsetY） */
    @property(Node)
    pageTurnListRoot: Node = null;

    @property({ tooltip: '自动创建翻页选项行时相对字体列表的 Y 偏移' })
    pageTurnRowOffsetY: number = -200;

    private styleNames = ['明亮风格', '流行风格', '深沉风格', '清脆风格'];
    private styleItems: SettingLabel[] = [];
    private styleItemNodes: Node[] = [];
    private fontItems: SettingLabel[] = [];
    private fontItemNodes: Node[] = [];
    private pageTurnNames = ['横向翻页', '纵向翻页'];
    private pageTurnItems: SettingLabel[] = [];
    private pageTurnItemNodes: Node[] = [];

    /** 字体选项单行总宽超过此值则拆成两行 */
    private readonly FONT_LIST_MAX_ROW_WIDTH = 900;

    /** 保证根或子树有 SettingLabel（含按压高亮）；没有则在根上补一个 */
    private ensureSettingLabelOnRoot(itemNode: Node): SettingLabel {
        let sl = itemNode.getComponent(SettingLabel) || itemNode.getComponentInChildren(SettingLabel);
        if (!sl) {
            sl = itemNode.addComponent(SettingLabel);
        }
        return sl;
    }

    start() {
        this.applyStoreToUI();

        if (this.backButton) {
            this.backButton.node.on(Button.EventType.CLICK, this.onBackClick, this);
        }
        if (this.resetDefaultsButton) {
            this.resetDefaultsButton.node.on(Button.EventType.CLICK, this.onResetDefaultsClick, this);
        }
        this.buildStyleList();
        this.ensureFontListRoot();
        this.buildFontList();
        this.ensurePageTurnRoot();
        this.buildPageTurnList();
        void applySavedFontToSubtree(this.node);
    }

    private applyStoreToUI() {
        const s = AudioSettingsStore.load();
        this.updateSynthLabels(true, s.synthStylePreset);
        if (this.synthModeButton) {
            this.synthModeButton.interactable = false;
        }
    }

    private updateSynthLabels(_useSynth: boolean, preset: number) {
        if (this.synthModeButton) {
            const label = this.synthModeButton.getComponentInChildren(Label);
            if (label) {
                label.string = '音源: 合成API(固定)';
            }
        }
        const names = ['明亮风格', '流行风格', '深沉风格', '清脆风格'];
        if (this.synthStyleLabel) {
            this.synthStyleLabel.string = `音色: ${names[preset] ?? '流行'}`;
        }
        this.refreshStyleList(preset);
    }

    private buildStyleList() {
        if (!this.synthStyleListRoot || !this.settingLabelPrefab) return;
        this.styleItems = [];
        this.styleItemNodes = [];
        for (const c of [...this.synthStyleListRoot.children]) {
            c.removeFromParent();
            c.destroy();
        }
        const s = AudioSettingsStore.load();
        const hasLayout = !!this.synthStyleListRoot.getComponent(Layout);
        const itemH = Math.max(24, this.styleItemHeight);
        const gapY = 12;
        for (let i = 0; i < this.styleNames.length; i++) {
            const itemNode = instantiate(this.settingLabelPrefab);
            itemNode.setParent(this.synthStyleListRoot);
            // 让 Layout/触摸都能正确工作：给 prefab 根节点补 UITransform 尺寸
            const rootUi = itemNode.getComponent(UITransform) || itemNode.addComponent(UITransform);
            const childUi = itemNode.getComponentInChildren(UITransform);
            const labelForMeasure = itemNode.getComponentInChildren(Label);
            const text = this.styleNames[i];
            const fontSize = Math.max(14, Math.min(36, Math.floor(itemH * 0.42)));
            // 近似宽度估算：中文约等于 fontSize 宽
            const adaptiveW = Math.ceil(text.length * fontSize + this.styleItemHorizontalPadding * 2 + 20);
            const w = Math.max(this.styleItemMinWidth, adaptiveW);
            const h = itemH;
            rootUi.setContentSize(w, h);
            // 可见背景通常在子节点(Sprite)上：同步其尺寸，否则视觉高度仍是 prefab 原值
            const visualNode = itemNode.getChildByName('Sprite') ?? itemNode;
            const visualUi = visualNode.getComponent(UITransform)
                || visualNode.getComponentInChildren(UITransform);
            if (visualUi) {
                visualUi.setContentSize(w, h);
            }
            // 如果没配 Layout，自动纵向排开，避免全部叠在一起只看到最后一个
            if (!hasLayout) {
                const y = -i * (itemH + gapY);
                itemNode.setPosition(0, y, 0);
            }
            const sl = this.ensureSettingLabelOnRoot(itemNode);
            if (sl) {
                sl.text = text;
                sl.setChecked(i === s.synthStylePreset);
                if (sl.label) {
                    sl.label.fontSize = fontSize;
                    sl.label.lineHeight = Math.max(fontSize + 4, Math.floor(itemH * 0.6));
                }
                this.styleItems.push(sl);
            } else {
                const lab = itemNode.getComponentInChildren(Label);
                if (lab) {
                    lab.string = i === s.synthStylePreset ? `✓ ${text}` : text;
                    lab.fontSize = fontSize;
                    lab.lineHeight = Math.max(fontSize + 4, Math.floor(itemH * 0.6));
                } else if (i === 0) {
                    console.warn('[SettingsScene] settingLabelPrefab 未找到 Label/SettingLabel，无法显示音色文字。');
                }
            }
            this.styleItemNodes.push(itemNode);

            // 兼容 root 无 Button 的结构，优先找子树任一 Button
            let btn = itemNode.getComponent(Button) || itemNode.getComponentInChildren(Button);
            // root 没 Button/没命中区域时，优先绑定到带 UITransform 的可见子节点
            const touchNode = btn?.node
                ?? itemNode.getChildByName('Sprite')
                ?? itemNode.getComponentInChildren(UITransform)?.node
                ?? itemNode;
            // 统一走 Button 点击，避免 TOUCH_END 抢占拖动手势影响 Slider
            if (!btn) {
                btn = touchNode.addComponent(Button);
            }
            touchNode.on(Button.EventType.CLICK, () => this.selectStyle(i), this);
            sl.ensureButtonPressHighlight();
        }
        const layout = this.synthStyleListRoot.getComponent(Layout);
        if (layout) {
            // 立即刷新布局，避免第一帧全部重叠显示
            layout.updateLayout(true);
        }
        if (!hasLayout) {
            const ui = this.synthStyleListRoot.getComponent(UITransform) || this.synthStyleListRoot.addComponent(UITransform);
            const totalH = this.styleNames.length * itemH + Math.max(0, this.styleNames.length - 1) * gapY;
            if (ui.height < totalH) {
                ui.setContentSize(ui.width || 240, totalH);
            }
        }
    }

    private refreshStyleList(selected: number) {
        if (this.styleItems.length > 0) {
            for (let i = 0; i < this.styleItems.length; i++) {
                this.styleItems[i].setChecked(i === selected);
            }
            return;
        }
        // 兼容未挂 SettingLabel 的情况：直接改 Label 文案
        for (let i = 0; i < this.styleItemNodes.length; i++) {
            const lab = this.styleItemNodes[i].getComponentInChildren(Label);
            if (!lab) continue;
            lab.string = i === selected ? `✓ ${this.styleNames[i]}` : this.styleNames[i];
        }
    }

    private ensureFontListRoot() {
        if (this.fontListRoot?.isValid) return;
        const anchor = this.synthStyleListRoot;
        const parent = this.node;
        const n = new Node('FontListRoot');
        const ui = n.addComponent(UITransform);
        ui.setContentSize(1100, 120);
        const lay = n.addComponent(Layout);
        lay.type = Layout.Type.HORIZONTAL;
        lay.resizeMode = Layout.ResizeMode.CONTAINER;
        lay.spacingX = 8;
        lay.paddingLeft = 6;
        n.setParent(parent);
        if (anchor) {
            const p = anchor.position;
            n.setPosition(p.x, p.y + this.fontListRowOffsetY, p.z);
        } else {
            n.setPosition(0, -80, 0);
        }
        this.fontListRoot = n;
    }

    private ensurePageTurnRoot() {
        if (this.pageTurnListRoot?.isValid) return;
        const anchor = this.fontListRoot ?? this.synthStyleListRoot;
        const parent = this.node;
        const n = new Node('PageTurnListRoot');
        const ui = n.addComponent(UITransform);
        ui.setContentSize(520, 72);
        const lay = n.addComponent(Layout);
        lay.type = Layout.Type.HORIZONTAL;
        lay.resizeMode = Layout.ResizeMode.CONTAINER;
        lay.spacingX = 12;
        lay.paddingLeft = 8;
        lay.paddingRight = 8;
        n.setParent(parent);
        if (anchor) {
            const p = anchor.position;
            n.setPosition(p.x, p.y + this.pageTurnRowOffsetY, p.z);
        } else {
            n.setPosition(0, -200, 0);
        }
        this.pageTurnListRoot = n;
    }

    private buildPageTurnList() {
        if (!this.pageTurnListRoot || !this.settingLabelPrefab) return;
        this.pageTurnItems = [];
        this.pageTurnItemNodes = [];
        for (const c of [...this.pageTurnListRoot.children]) {
            c.removeFromParent();
            c.destroy();
        }
        const oldLay = this.pageTurnListRoot.getComponent(Layout);
        if (oldLay) {
            this.pageTurnListRoot.removeComponent(oldLay);
        }
        const rootLay = this.pageTurnListRoot.addComponent(Layout);
        rootLay.type = Layout.Type.HORIZONTAL;
        rootLay.resizeMode = Layout.ResizeMode.CONTAINER;
        rootLay.spacingX = 12;
        rootLay.paddingLeft = 8;
        rootLay.paddingRight = 8;

        const ss = SheetSettingsStore.load();
        const selected = ss.pageTurnMode;
        const itemH = Math.max(24, this.styleItemHeight);
        for (let i = 0; i < this.pageTurnNames.length; i++) {
            const itemNode = instantiate(this.settingLabelPrefab);
            itemNode.setParent(this.pageTurnListRoot);
            const rootUi = itemNode.getComponent(UITransform) || itemNode.addComponent(UITransform);
            const text = this.pageTurnNames[i];
            const fontSize = Math.max(14, Math.min(36, Math.floor(itemH * 0.42)));
            const adaptiveW = Math.ceil(text.length * fontSize + this.styleItemHorizontalPadding * 2 + 20);
            const w = Math.max(this.styleItemMinWidth, adaptiveW);
            const h = itemH;
            rootUi.setContentSize(w, h);
            const visualNode = itemNode.getChildByName('Sprite') ?? itemNode;
            const visualUi = visualNode.getComponent(UITransform)
                || visualNode.getComponentInChildren(UITransform);
            if (visualUi) {
                visualUi.setContentSize(w, h);
            }
            const sl = this.ensureSettingLabelOnRoot(itemNode);
            if (sl) {
                sl.text = text;
                sl.setChecked(i === selected);
                if (sl.label) {
                    sl.label.fontSize = fontSize;
                    sl.label.lineHeight = Math.max(fontSize + 4, Math.floor(itemH * 0.6));
                }
                this.pageTurnItems.push(sl);
            } else {
                const lab = itemNode.getComponentInChildren(Label);
                if (lab) {
                    lab.string = i === selected ? `✓ ${text}` : text;
                    lab.fontSize = fontSize;
                    lab.lineHeight = Math.max(fontSize + 4, Math.floor(itemH * 0.6));
                }
            }
            this.pageTurnItemNodes.push(itemNode);

            let btn = itemNode.getComponent(Button) || itemNode.getComponentInChildren(Button);
            const touchNode = btn?.node
                ?? itemNode.getChildByName('Sprite')
                ?? itemNode.getComponentInChildren(UITransform)?.node
                ?? itemNode;
            if (!btn) {
                btn = touchNode.addComponent(Button);
            }
            touchNode.on(Button.EventType.CLICK, () => this.selectPageTurn(i), this);
            sl.ensureButtonPressHighlight();
        }
        rootLay.updateLayout(true);
    }

    private refreshPageTurnList(selected: number) {
        if (this.pageTurnItems.length > 0) {
            for (let i = 0; i < this.pageTurnItems.length; i++) {
                this.pageTurnItems[i].setChecked(i === selected);
            }
            return;
        }
        for (let i = 0; i < this.pageTurnItemNodes.length; i++) {
            const lab = this.pageTurnItemNodes[i].getComponentInChildren(Label);
            if (!lab) continue;
            lab.string = i === selected ? `✓ ${this.pageTurnNames[i]}` : this.pageTurnNames[i];
        }
    }

    private selectPageTurn(index: number) {
        const next = Math.max(0, Math.min(this.pageTurnNames.length - 1, index));
        if (next === 0 && SheetRuntimeStore.isLongImageActive()) {
            showToast(this.node, '长图仅支持纵向滚动，无法切换为横向');
            this.scheduleOnce(() => {
                void applySavedFontToSubtree(this.node);
            }, 0);
            this.refreshPageTurnList(SheetSettingsStore.load().pageTurnMode);
            return;
        }
        SheetSettingsStore.save({ pageTurnMode: next });
        this.refreshPageTurnList(next);
    }

    /** 总宽超过一行上限时，第一行尽量放满（贪心），其余放第二行 */
    private splitFontRowIndices(widths: number[], maxRowW: number, spacingX: number): [number[], number[]] {
        const n = widths.length;
        if (n === 0) {
            return [[], []];
        }
        const total =
            widths.reduce((a, b) => a + b, 0) + spacingX * Math.max(0, n - 1);
        if (total <= maxRowW) {
            return [Array.from({ length: n }, (_, i) => i), []];
        }
        const row1: number[] = [];
        let sum = 0;
        for (let i = 0; i < n; i++) {
            const w = widths[i];
            const need = w + (row1.length > 0 ? spacingX : 0);
            if (sum + need <= maxRowW) {
                row1.push(i);
                sum += need;
            } else {
                break;
            }
        }
        if (row1.length === 0) {
            row1.push(0);
        }
        const row2: number[] = [];
        for (let i = 0; i < n; i++) {
            if (row1.indexOf(i) < 0) {
                row2.push(i);
            }
        }
        return [row1, row2];
    }

    private buildFontList() {
        if (!this.fontListRoot || !this.settingLabelPrefab) return;
        this.fontItems = [];
        this.fontItemNodes = [];
        for (const c of [...this.fontListRoot.children]) {
            c.removeFromParent();
            c.destroy();
        }
        const oldLay = this.fontListRoot.getComponent(Layout);
        if (oldLay) {
            this.fontListRoot.removeComponent(oldLay);
        }

        const fs = FontSettingsStore.load();
        const selected = fs.fontIndex;
        const itemH = Math.max(24, this.styleItemHeight);
        const gapY = 12;
        const spacingX = this.fontListSpacingX;
        const pad = this.fontItemHorizontalPadding;
        const fontNames = FONTS_CATALOG.map((e) => e.displayName);
        const widths: number[] = [];
        const fontSizes: number[] = [];
        for (let i = 0; i < fontNames.length; i++) {
            const text = fontNames[i];
            const fontSize = Math.max(14, Math.min(32, Math.floor(itemH * 0.38)));
            fontSizes.push(fontSize);
            // 仅按字数估算宽度，不拉满行宽、不设过宽上限；留白略紧，短文案按钮更窄
            const adaptiveW = Math.ceil(text.length * fontSize + pad * 2 + 8);
            widths.push(Math.max(this.styleItemMinWidth, adaptiveW));
        }
        const n = fontNames.length;
        const totalW =
            widths.reduce((a, b) => a + b, 0) + spacingX * Math.max(0, n - 1);
        const useTwoRows =
            totalW > this.FONT_LIST_MAX_ROW_WIDTH && n > 1;

        const addItem = (i: number, parent: Node) => {
            const itemNode = instantiate(this.settingLabelPrefab);
            itemNode.setParent(parent);
            const rootUi = itemNode.getComponent(UITransform) || itemNode.addComponent(UITransform);
            const text = fontNames[i];
            const fontSize = fontSizes[i];
            const w = widths[i];
            const h = itemH;
            rootUi.setContentSize(w, h);
            const visualNode = itemNode.getChildByName('Sprite') ?? itemNode;
            const visualUi = visualNode.getComponent(UITransform)
                || visualNode.getComponentInChildren(UITransform);
            if (visualUi) {
                visualUi.setContentSize(w, h);
            }
            const sl = this.ensureSettingLabelOnRoot(itemNode);
            if (sl) {
                sl.text = text;
                sl.setChecked(i === selected);
                if (sl.label) {
                    sl.label.fontSize = fontSize;
                    sl.label.lineHeight = Math.max(fontSize + 4, Math.floor(itemH * 0.6));
                }
                this.fontItems.push(sl);
            } else {
                const lab = itemNode.getComponentInChildren(Label);
                if (lab) {
                    lab.string = i === selected ? `✓ ${text}` : text;
                    lab.fontSize = fontSize;
                    lab.lineHeight = Math.max(fontSize + 4, Math.floor(itemH * 0.6));
                }
            }
            this.fontItemNodes.push(itemNode);

            let btn = itemNode.getComponent(Button) || itemNode.getComponentInChildren(Button);
            const touchNode = btn?.node
                ?? itemNode.getChildByName('Sprite')
                ?? itemNode.getComponentInChildren(UITransform)?.node
                ?? itemNode;
            if (!btn) {
                btn = touchNode.addComponent(Button);
            }
            touchNode.on(Button.EventType.CLICK, () => this.selectFont(i), this);
            sl.ensureButtonPressHighlight();
        };

        if (!useTwoRows) {
            const rootUi = this.fontListRoot.getComponent(UITransform) || this.fontListRoot.addComponent(UITransform);
            const designW = rootUi.width > 50 ? rootUi.width : 1100;
            rootUi.setContentSize(designW, Math.max(rootUi.height, itemH + 16));

            const rowParent = new Node('FontRow');
            rowParent.setParent(this.fontListRoot);
            const rowUiTf = rowParent.addComponent(UITransform);
            rowUiTf.setAnchorPoint(0.5, 0.5);
            const rowLay = rowParent.addComponent(Layout);
            rowLay.type = Layout.Type.HORIZONTAL;
            rowLay.resizeMode = Layout.ResizeMode.CONTAINER;
            rowLay.spacingX = spacingX;
            for (let i = 0; i < n; i++) {
                addItem(i, rowParent);
            }
            rowLay.updateLayout(true);

            const w = rowParent.addComponent(Widget);
            w.isAlignHorizontalCenter = true;
            w.horizontalCenter = 0;
            w.isAlignVerticalCenter = true;
            w.verticalCenter = 0;
            w.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;
        } else {
            const [idx1, idx2] = this.splitFontRowIndices(
                widths,
                this.FONT_LIST_MAX_ROW_WIDTH,
                spacingX,
            );
            const rootLay = this.fontListRoot.addComponent(Layout);
            rootLay.type = Layout.Type.VERTICAL;
            rootLay.resizeMode = Layout.ResizeMode.CONTAINER;
            rootLay.spacingY = gapY;
            rootLay.paddingLeft = 8;
            rootLay.paddingRight = 8;
            // 纵向 Layout：子行左对齐（0=LEFT），避免第二行在容器内居中
            (rootLay as unknown as { horizontalAlign: number }).horizontalAlign = 0;

            const makeRow = (name: string, indices: number[]) => {
                const row = new Node(name);
                const rowUi = row.addComponent(UITransform);
                rowUi.setAnchorPoint(0, 0.5);
                rowUi.setContentSize(1, itemH);
                const lay = row.addComponent(Layout);
                lay.type = Layout.Type.HORIZONTAL;
                lay.resizeMode = Layout.ResizeMode.CONTAINER;
                lay.spacingX = spacingX;
                lay.paddingLeft = 4;
                lay.paddingRight = 4;
                row.setParent(this.fontListRoot);
                for (const j of indices) {
                    addItem(j, row);
                }
                lay.updateLayout(true);
            };
            makeRow('FontRow0', idx1);
            if (idx2.length > 0) {
                makeRow('FontRow1', idx2);
            }
            rootLay.updateLayout(true);
        }
    }

    private refreshFontList(selected: number) {
        if (this.fontItems.length > 0) {
            for (let i = 0; i < this.fontItems.length; i++) {
                this.fontItems[i].setChecked(i === selected);
            }
            return;
        }
        const fontNames = FONTS_CATALOG.map((e) => e.displayName);
        for (let i = 0; i < this.fontItemNodes.length; i++) {
            const lab = this.fontItemNodes[i].getComponentInChildren(Label);
            if (!lab) continue;
            const text = fontNames[i];
            lab.string = i === selected ? `✓ ${text}` : text;
        }
    }

    private selectFont(index: number) {
        const next = Math.max(0, Math.min(FONTS_CATALOG.length - 1, index));
        FontSettingsStore.save({ fontIndex: next });
        invalidateFontCache();
        this.refreshFontList(next);
        void applySavedFontToSubtree(this.node);
    }

    private selectStyle(index: number) {
        const next = Math.max(0, Math.min(this.styleNames.length - 1, index));
        AudioSettingsStore.save({ synthStylePreset: next, useManualSynthTuning: false });
        this.updateSynthLabels(true, next);
        this.persistFull();
    }

    onBackClick() {
        this.persistFull();
        const backTo = SceneManager.takeSettingsReturnTarget();
        const sm = SceneManager.getInstance();
        if (backTo === 'game') {
            if (sm) {
                sm.loadGameScene();
            } else {
                director.loadScene(SceneManager.SCENE_NAMES.GAME);
            }
        } else {
            if (sm) {
                sm.loadHomeScene();
            } else {
                director.loadScene(SceneManager.SCENE_NAMES.HOME);
            }
        }
    }

    onResetDefaultsClick() {
        const d = AudioSettingsStore.defaultSnapshot();
        AudioSettingsStore.save({
            useSynth: true,
            synthStylePreset: d.synthStylePreset,
            useManualSynthTuning: false,
        });
        FontSettingsStore.save(FontSettingsStore.defaultSnapshot());
        SheetSettingsStore.save(SheetSettingsStore.defaultSnapshot());
        invalidateFontCache();
        this.updateSynthLabels(true, d.synthStylePreset);
        this.buildFontList();
        this.buildPageTurnList();
        void applySavedFontToSubtree(this.node);
    }

    onSynthModeClick() {}

    private persistFull() {
        const s = AudioSettingsStore.load();
        AudioSettingsStore.save({
            useSynth: true,
            synthStylePreset: s.synthStylePreset,
            useManualSynthTuning: s.useManualSynthTuning,
        });
    }

    onDestroy() {
        const offBtn = (btn: Button | null, handler: () => void) => {
            const n = btn?.node;
            if (n && n.isValid) {
                n.off(Button.EventType.CLICK, handler, this);
            }
        };
        offBtn(this.backButton, this.onBackClick);
        offBtn(this.resetDefaultsButton, this.onResetDefaultsClick);

        const unbindStyle = this.styleItemNodes.length > 0
            ? this.styleItemNodes
            : this.styleItems.map((x) => x?.node).filter((n): n is Node => !!n);
        for (const n of unbindStyle) {
            if (!n || !n.isValid) continue;
            const btn = n.getComponent(Button) || n.getComponentInChildren(Button);
            const touchNode = btn?.node
                ?? n.getChildByName('Sprite')
                ?? n.getComponentInChildren(UITransform)?.node
                ?? n;
            touchNode.off(Button.EventType.CLICK);
        }
        const unbindFont = this.fontItemNodes.length > 0
            ? this.fontItemNodes
            : this.fontItems.map((x) => x?.node).filter((n): n is Node => !!n);
        for (const n of unbindFont) {
            if (!n || !n.isValid) continue;
            const btn = n.getComponent(Button) || n.getComponentInChildren(Button);
            const touchNode = btn?.node
                ?? n.getChildByName('Sprite')
                ?? n.getComponentInChildren(UITransform)?.node
                ?? n;
            touchNode.off(Button.EventType.CLICK);
        }
        const unbindPageTurn = this.pageTurnItemNodes.length > 0
            ? this.pageTurnItemNodes
            : this.pageTurnItems.map((x) => x?.node).filter((n): n is Node => !!n);
        for (const n of unbindPageTurn) {
            if (!n || !n.isValid) continue;
            const btn = n.getComponent(Button) || n.getComponentInChildren(Button);
            const touchNode = btn?.node
                ?? n.getChildByName('Sprite')
                ?? n.getComponentInChildren(UITransform)?.node
                ?? n;
            touchNode.off(Button.EventType.CLICK);
        }
    }
}
