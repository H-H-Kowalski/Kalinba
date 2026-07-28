export interface AchievementDefinition {
    id: string;
    title: string;
    description: string;
}

/** 成就文案与云端规则 ID 必须保持一致；展示层只依赖此目录。 */
export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
    { id: 'first_challenge', title: '初次登台', description: '完成任意一关挑战。' },
    { id: 'three_stars_total', title: '星光初现', description: '累计获得 3 颗星。' },
    { id: 'combo_20', title: '节奏新星', description: '达成 20 连击。' },
    { id: 'combo_50', title: '稳稳的节拍', description: '达成 50 连击。' },
    { id: 'notes_100', title: '百音练习生', description: '在挑战中累计弹奏 100 个音符。' },
    { id: 'notes_500', title: '五百次心动', description: '在挑战中累计弹奏 500 个音符。' },
    { id: 'complete_launch_catalog', title: '舞台首演', description: '完成全部首发关卡。' },
];

export function getAchievementById(id: string): AchievementDefinition | null {
    return ACHIEVEMENT_CATALOG.find((achievement) => achievement.id === id) ?? null;
}
