import type { LevelDefinition, LevelNote } from './LevelTypes';

/**
 * 首发曲库全部为项目原创练习旋律：不引用第三方歌曲、录音或网络谱面。
 * 一拍一个数字的写法让内容维护者无需理解代码即可继续扩关。
 */
function notes(keys: number[], startBeat = 0, step = 1): LevelNote[] {
    return keys.map((keyIndex, i) => ({ beat: startBeat + i * step, keyIndex }));
}

function level(
    id: string, chapter: number, order: number, title: string, subtitle: string,
    bpm: number, keys: number[], step = 1,
): LevelDefinition {
    return {
        id,
        chapter,
        order,
        title,
        subtitle,
        bpm,
        beatsPerBar: 4,
        visualTheme: ({
            'c1-01': 'amber', 'c1-02': 'leaf', 'c1-03': 'sky',
            'c2-01': 'coral', 'c2-02': 'plum', 'c2-03': 'mint',
            'c3-01': 'dawn', 'c3-02': 'violet', 'c3-03': 'festival',
        } as const)[id] ?? 'amber',
        notes: notes(keys, 0, step),
        passScore: 360,
        twoStarScore: 650,
        threeStarScore: 880,
    };
}

export const LEVEL_CATALOG: LevelDefinition[] = [
    level('c1-01', 1, 1, '第一声', '找到中央的 1', 72, [8, 8, 8, 8, 8, 8, 8, 8]),
    level('c1-02', 1, 2, '向上走', '每一拍上行一步', 72, [8, 9, 10, 11, 12, 13, 14, 15]),
    level('c1-03', 1, 3, '回来吧', '上行与下行', 76, [8, 9, 10, 11, 12, 11, 10, 9, 8]),
    level('c2-01', 2, 1, '左右问答', '两组琴键交替回答', 80, [7, 9, 7, 9, 6, 10, 6, 10, 7, 9, 8]),
    level('c2-02', 2, 2, '雨点节奏', '八分音符的轻快节奏', 82, [8, 8, 9, 9, 10, 10, 9, 8, 8, 9, 10, 9], 0.5),
    level('c2-03', 2, 3, '小小跳跃', '隔一个琴键也要稳住', 86, [8, 10, 9, 11, 10, 12, 11, 9, 8, 10, 12, 11]),
    level('c3-01', 3, 1, '晨光旋律', '第一首完整原创练习曲', 82, [8, 9, 10, 9, 8, 7, 8, 10, 11, 10, 9, 8, 7, 8, 9, 8]),
    level('c3-02', 3, 2, '星光漫步', '保持节奏，听见旋律', 90, [8, 10, 12, 10, 9, 11, 13, 11, 10, 12, 14, 12, 11, 10, 9, 8], 0.5),
    level('c3-03', 3, 3, '舞台首演', '把学到的都连起来', 92, [8, 9, 10, 12, 10, 9, 8, 7, 8, 10, 11, 13, 11, 10, 9, 8, 8, 10, 12, 14, 12, 10, 9, 8]),
];

export function getLevelById(levelId: string): LevelDefinition | null {
    return LEVEL_CATALOG.find((level) => level.id === levelId) ?? null;
}

export function getNextLevel(levelId: string): LevelDefinition | null {
    const i = LEVEL_CATALOG.findIndex((level) => level.id === levelId);
    return i >= 0 ? LEVEL_CATALOG[i + 1] ?? null : null;
}
