import { BlockInputEvents, Button, Color, Graphics, Label, Node, UITransform, Widget } from 'cc';
import { ACHIEVEMENT_CATALOG, resolveAchievementIds } from '../gameplay/AchievementCatalog';
import { AchievementCloudService, type UserAchievementStats } from '../manager/AchievementCloudService';
import { LevelProgressStore, type LocalChallengeSummary } from '../manager/LevelProgressStore';
import { getWx } from '../manager/WeChatNative';
import { showToast } from './SimpleToast';

type DisplayStats = {
    totalStars: number;
    totalNotes: number;
    maxCombo: number;
    completedCount: number;
    unlockedIds: Set<string>;
};

type AchievementProgress = {
    current: number;
    target: number;
};

const PAPER = new Color(255, 243, 207, 255);
const PAPER_DARK = new Color(244, 218, 161, 255);
const WOOD = new Color(126, 62, 28, 255);
const WOOD_SOFT = new Color(174, 91, 39, 255);
const INK = new Color(91, 57, 31, 255);
const MUTED = new Color(139, 111, 75, 255);
const GOLD = new Color(229, 155, 56, 255);

/** 首页成就档案：云端优先，同时保留可立即展示的本地进度。 */
export async function showAchievementOverlay(canvas: Node): Promise<void> {
    if (!canvas?.isValid) return;
    canvas.getChildByName('AchievementOverlay')?.destroy();

    const local = LevelProgressStore.getSummary();
    // 先用本地档案立即绘制，避免微信云调用较慢时看起来“点击无效果”。
    let activeRoot = renderAchievementOverlay(canvas, local, null);
    let cloud: UserAchievementStats | null = null;
    try {
        cloud = await AchievementCloudService.getStats();
    } catch {
        // 浏览器或离线环境使用本地进度，微信环境恢复后会自动同步。
    }
    // 玩家已经主动关闭时，异步返回不得把面板重新弹出来。
    if (!canvas.isValid || !activeRoot?.isValid || !cloud) return;
    activeRoot.destroy();
    activeRoot = renderAchievementOverlay(canvas, local, cloud);
}

function renderAchievementOverlay(
    canvas: Node,
    local: LocalChallengeSummary,
    cloud: UserAchievementStats | null,
): Node | null {
    if (!canvas?.isValid) return null;
    const stats = mergeStats(local, cloud);
    const canvasUi = canvas.getComponent(UITransform);
    const cw = canvasUi?.width ?? 1280;
    const ch = canvasUi?.height ?? 720;

    const root = new Node('AchievementOverlay');
    root.setParent(canvas);
    root.setSiblingIndex(canvas.children.length - 1);
    root.addComponent(UITransform).setContentSize(cw, ch);
    root.addComponent(BlockInputEvents);

    const close = () => root.isValid && root.destroy();
    const mask = makeShape(root, 'Mask', cw, ch, new Color(52, 37, 22, 190), 0);
    mask.addComponent(Button).transition = Button.Transition.NONE;
    mask.on(Button.EventType.CLICK, close);

    const panelW = Math.min(1060, cw * 0.94);
    const panelH = Math.min(650, ch * 0.92);
    const panel = makeShape(root, 'AchievementPanel', panelW, panelH, PAPER, 28, WOOD_SOFT, 3);
    panel.addComponent(BlockInputEvents);
    const panelWidget = panel.addComponent(Widget);
    panelWidget.isAlignHorizontalCenter = true;
    panelWidget.isAlignVerticalCenter = true;
    panelWidget.horizontalCenter = 0;
    panelWidget.verticalCenter = 0;
    panelWidget.alignMode = Widget.AlignMode.ON_WINDOW_RESIZE;

    const header = makeShape(panel, 'AchievementHeader', panelW - 24, 84, WOOD, 24, GOLD, 2);
    header.setPosition(0, panelH / 2 - 54, 0);
    makeLabel(header, '成就图鉴', 34, new Color(255, 246, 216, 255), -70, 13, panelW - 380, 44);
    makeLabel(
        header,
        cloud ? '微信档案已同步' : '当前显示本地进度 · 微信环境会自动同步',
        14,
        cloud ? new Color(196, 235, 170, 255) : new Color(245, 211, 151, 255),
        -70,
        -20,
        panelW - 380,
        24,
    );
    makeButton(header, 'ShareButton', '分享', 104, 46, panelW / 2 - 145, 0, () => shareAchievementArchive(canvas, stats), new Color(88, 139, 72, 255), PAPER);
    makeButton(header, 'CloseButton', '×', 50, 50, panelW / 2 - 53, 0, close, new Color(104, 52, 26, 255), PAPER);

    const unlockedCount = stats.unlockedIds.size;
    const statY = panelH / 2 - 128;
    const chipW = Math.min(235, (panelW - 100) / 4);
    const chipGap = chipW + 18;
    const firstChipX = -chipGap * 1.5;
    makeStatChip(panel, firstChipX, statY, chipW, '点亮成就', `${unlockedCount} / ${ACHIEVEMENT_CATALOG.length}`);
    makeStatChip(panel, firstChipX + chipGap, statY, chipW, '累计星星', `${stats.totalStars} ★`);
    makeStatChip(panel, firstChipX + chipGap * 2, statY, chipW, '最高连击', `${stats.maxCombo}`);
    makeStatChip(panel, firstChipX + chipGap * 3, statY, chipW, '完成关卡', `${stats.completedCount} / 9`);

    const contentTop = statY - 58;
    const contentBottom = -panelH / 2 + 34;
    const rows = 4;
    const cardGapX = 18;
    const cardGapY = 12;
    const cardW = (panelW - 74 - cardGapX) / 2;
    const cardH = Math.max(82, (contentTop - contentBottom - cardGapY * (rows - 1)) / rows);
    const leftX = -cardW / 2 - cardGapX / 2;
    const rightX = cardW / 2 + cardGapX / 2;

    ACHIEVEMENT_CATALOG.forEach((item, index) => {
        const row = Math.floor(index / 2);
        const col = index % 2;
        const y = contentTop - cardH / 2 - row * (cardH + cardGapY);
        const progress = getProgress(item.id, stats);
        makeAchievementCard(
            panel,
            col === 0 ? leftX : rightX,
            y,
            cardW,
            cardH,
            item.title,
            item.description,
            stats.unlockedIds.has(item.id),
            progress,
        );
    });
    return root;
}

function mergeStats(local: LocalChallengeSummary, cloud: UserAchievementStats | null): DisplayStats {
    const totalStars = Math.max(local.totalStars, cloud?.totalStars ?? 0);
    const totalNotes = Math.max(local.totalNotes, cloud?.totalNotes ?? 0);
    const maxCombo = Math.max(local.maxCombo, cloud?.maxCombo ?? 0);
    const completedCount = Math.max(local.completedLevelIds.length, cloud?.completedLevelIds?.length ?? 0);
    const unlockedIds = new Set<string>(cloud?.achievementIds ?? []);
    for (const id of resolveAchievementIds({ completedCount, totalStars, totalNotes, maxCombo })) unlockedIds.add(id);
    return { totalStars, totalNotes, maxCombo, completedCount, unlockedIds };
}

function shareAchievementArchive(canvas: Node, stats: DisplayStats) {
    const wxApi = getWx() as {
        shareAppMessage?: (arg: { title?: string; query?: string }) => void;
    } | undefined;
    if (!wxApi?.shareAppMessage) {
        showToast(canvas, '微信真机中可分享成就档案', 1.5);
        return;
    }
    const latest = [...ACHIEVEMENT_CATALOG].reverse().find((item) => stats.unlockedIds.has(item.id));
    const suffix = latest ? `，最新获得「${latest.title}」` : '';
    try {
        wxApi.shareAppMessage({
            title: `我在拇指琴演奏家点亮了 ${stats.unlockedIds.size} 个成就${suffix}！`,
            query: 'achievement=1',
        });
        showToast(canvas, '已拉起成就分享', 1.3);
    } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown error';
        showToast(canvas, `分享失败：${message}`, 1.6);
    }
}

function getProgress(id: string, stats: DisplayStats): AchievementProgress {
    switch (id) {
        case 'first_challenge': return { current: stats.completedCount, target: 1 };
        case 'three_stars_total': return { current: stats.totalStars, target: 3 };
        case 'combo_20': return { current: stats.maxCombo, target: 20 };
        case 'combo_50': return { current: stats.maxCombo, target: 50 };
        case 'notes_100': return { current: stats.totalNotes, target: 100 };
        case 'notes_500': return { current: stats.totalNotes, target: 500 };
        case 'complete_launch_catalog': return { current: stats.completedCount, target: 9 };
        default: return { current: 0, target: 1 };
    }
}

function makeAchievementCard(
    parent: Node,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    description: string,
    unlocked: boolean,
    progress: AchievementProgress,
) {
    const fill = unlocked ? new Color(255, 250, 226, 255) : new Color(235, 221, 188, 255);
    const border = unlocked ? GOLD : new Color(181, 159, 120, 220);
    const card = makeShape(parent, `Achievement_${title}`, width, height, fill, 18, border, unlocked ? 2.5 : 1.5);
    card.setPosition(x, y, 0);

    const iconSize = Math.min(58, height - 24);
    const iconX = -width / 2 + iconSize / 2 + 14;
    const icon = makeShape(card, 'Badge', iconSize, iconSize, unlocked ? GOLD : new Color(177, 158, 123, 255), iconSize / 2);
    icon.setPosition(iconX, 3, 0);
    makeLabel(icon, unlocked ? '★' : '♩', unlocked ? 30 : 25, unlocked ? new Color(255, 250, 220, 255) : new Color(241, 230, 205, 255), 0, 0, iconSize, iconSize);

    const textLeft = iconX + iconSize / 2 + 14;
    const textRight = width / 2 - 16;
    const textW = textRight - textLeft;
    const textX = (textLeft + textRight) / 2;
    makeLabel(card, title, 22, unlocked ? WOOD : new Color(111, 96, 72, 255), textX, height * 0.22, textW, 30, Label.HorizontalAlign.LEFT);
    makeLabel(card, description, 14, unlocked ? INK : MUTED, textX, -2, textW, 26, Label.HorizontalAlign.LEFT);

    const ratio = Math.max(0, Math.min(1, progress.current / Math.max(1, progress.target)));
    const barW = textW - 80;
    const barX = textLeft + barW / 2;
    const barY = -height / 2 + 16;
    const track = makeShape(card, 'ProgressTrack', barW, 8, new Color(198, 181, 148, 180), 4);
    track.setPosition(barX, barY, 0);
    if (ratio > 0) {
        const fillBar = makeShape(card, 'ProgressFill', Math.max(8, barW * ratio), 8, unlocked ? GOLD : WOOD_SOFT, 4);
        fillBar.setPosition(barX - barW / 2 + Math.max(8, barW * ratio) / 2, barY, 0);
    }
    makeLabel(
        card,
        unlocked ? '已点亮' : `${Math.min(progress.current, progress.target)} / ${progress.target}`,
        13,
        unlocked ? WOOD_SOFT : MUTED,
        width / 2 - 50,
        barY,
        80,
        22,
    );
}

function makeStatChip(parent: Node, x: number, y: number, width: number, title: string, value: string) {
    const chip = makeShape(parent, `Stat_${title}`, width, 62, PAPER_DARK, 15, new Color(207, 155, 78, 160), 1.5);
    chip.setPosition(x, y, 0);
    makeLabel(chip, title, 14, MUTED, 0, 13, width - 16, 22);
    makeLabel(chip, value, 22, WOOD, 0, -12, width - 16, 28);
}

function makeButton(
    parent: Node,
    name: string,
    text: string,
    width: number,
    height: number,
    x: number,
    y: number,
    onClick: () => void,
    fill: Color,
    textColor: Color,
): Node {
    const button = makeShape(parent, name, width, height, fill, Math.min(18, height / 2), new Color(255, 220, 143, 150), 1.5);
    button.setPosition(x, y, 0);
    makeLabel(button, text, 26, textColor, 0, 1, width - 8, height);
    const component = button.addComponent(Button);
    component.transition = Button.Transition.SCALE;
    component.zoomScale = 0.94;
    button.on(Button.EventType.CLICK, onClick);
    return button;
}

function makeShape(
    parent: Node,
    name: string,
    width: number,
    height: number,
    fill: Color,
    radius: number,
    stroke?: Color,
    lineWidth = 0,
): Node {
    const node = new Node(name);
    node.setParent(parent);
    node.addComponent(UITransform).setContentSize(width, height);
    const background = new Node('Background');
    background.setParent(node);
    background.addComponent(UITransform).setContentSize(width, height);
    const graphics = background.addComponent(Graphics);
    graphics.fillColor = fill;
    if (radius > 0) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
    else graphics.rect(-width / 2, -height / 2, width, height);
    graphics.fill();
    if (stroke && lineWidth > 0) {
        graphics.strokeColor = stroke;
        graphics.lineWidth = lineWidth;
        if (radius > 0) graphics.roundRect(-width / 2, -height / 2, width, height, radius);
        else graphics.rect(-width / 2, -height / 2, width, height);
        graphics.stroke();
    }
    return node;
}

function makeLabel(
    parent: Node,
    text: string,
    fontSize: number,
    color: Color,
    x: number,
    y: number,
    width: number,
    height: number,
    align = Label.HorizontalAlign.CENTER,
): Label {
    const node = new Node('Label');
    node.setParent(parent);
    node.addComponent(UITransform).setContentSize(width, height);
    node.setPosition(x, y, 0);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = fontSize;
    label.lineHeight = Math.max(fontSize + 4, height);
    label.color = color;
    label.horizontalAlign = align;
    label.verticalAlign = Label.VerticalAlign.CENTER;
    label.overflow = Label.Overflow.SHRINK;
    return label;
}
