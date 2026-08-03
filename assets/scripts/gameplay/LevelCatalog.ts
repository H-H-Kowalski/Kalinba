import type { LevelDefinition, LevelNote } from './LevelTypes';

/** 首发曲库只保存公版传统旋律的短简谱，不包含第三方录音或现代编曲。 */

const NOTE_KEY_INDEX: Record<string, number> = {
    '1,': 8, '2,': 7, '3,': 9, '4,': 6, '5,': 10, '6,': 5, '7,': 11,
    '1': 8, '2': 7, '3': 9, '4': 6, '5': 10, '6': 5, '7': 11,
    "1'": 4, "2'": 12, "3'": 3, "4'": 13, "5'": 2, "6'": 14, "7'": 1,
    "1''": 15, "2''": 0, "3''": 16,
};

/**
 * 半拍简谱：数字=音级，'=高音，逗号=低音，-=空半拍，|=视觉分句，+=双音。
 * 例如：5 5 6 - 5 - 1' - | 7 - - -
 */
export function parseNotation(notation: string, slotBeat = 0.5): LevelNote[] {
    const result: LevelNote[] = [];
    let beat = 0;
    const tokens = notation.replace(/\|/g, ' | ').trim().split(/\s+/).filter(Boolean);
    for (const token of tokens) {
        if (token === '|') continue;
        if (token !== '-') {
            const chord = token.split('+');
            if (chord.length > 2) {
                throw new Error(`[LevelCatalog] 单拍最多双音和弦: ${token}`);
            }
            for (const symbol of chord) {
                const keyIndex = NOTE_KEY_INDEX[symbol];
                if (keyIndex === undefined) throw new Error(`[LevelCatalog] 无效简谱符号: ${symbol}`);
                result.push({ beat, keyIndex });
            }
        }
        beat += slotBeat;
    }
    return enforceTwoThumbLimit(result);
}

/**
 * 拇指琴只能自然地用两根拇指同时弹奏；任何同拍内容最多允许两个音符。
 * 约到 1/1000 拍再分组，兼容小数节拍，同时避免浮点误差造成漏检。
 */
function enforceTwoThumbLimit(source: LevelNote[]): LevelNote[] {
    const countByBeat = new Map<number, number>();
    return source.filter((note) => {
        const beatKey = Math.round(note.beat * 1000);
        const count = countByBeat.get(beatKey) ?? 0;
        if (count >= 2) throw new Error(`[LevelCatalog] 第 ${note.beat} 拍超过两个音符`);
        countByBeat.set(beatKey, count + 1);
        return true;
    });
}

function level(
    id: string, chapter: number, order: number, title: string, subtitle: string,
    bpm: number, notation: string,
): LevelDefinition {
    const expandedNotation = extendToMinimumDuration(notation, bpm, 60);
    const levelNotes = parseNotation(expandedNotation);
    const noteCount = Math.max(1, levelNotes.length);
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
        notation: expandedNotation,
        notes: levelNotes,
        // 一、二星鼓励完整跟弹；三星要求稳定 Perfect 与较长连击。
        passScore: noteCount * 28,
        twoStarScore: noteCount * 62,
        threeStarScore: noteCount * 118,
    };
}

/**
 * 挑战关卡至少持续一分钟。基础谱仍是一段容易维护的简谱字符串，
 * 运行时按完整乐句循环，并在两轮之间留两拍呼吸，不复制维护多份音符数组。
 */
function extendToMinimumDuration(baseNotation: string, bpm: number, minimumSec: number): string {
    let expanded = baseNotation.trim();
    for (let repeat = 1; repeat < 12; repeat++) {
        const notes = parseNotation(expanded);
        const lastBeat = notes[notes.length - 1]?.beat ?? 0;
        const durationSec = (lastBeat + 1) * 60 / bpm;
        if (durationSec >= minimumSec) return expanded;
        expanded += ` | - - - - | ${baseNotation.trim()}`;
    }
    return expanded;
}

export const LEVEL_CATALOG: LevelDefinition[] = [
    level('c1-01', 1, 1, '生日快乐', '完整四乐句 · 约一分钟挑战', 68,
        "5 5 6 - 5 - 1' - 7 - - - | 5 5 6 - 5 - 2' - 1' - - - | 5 5 5' - 3' - 1' - 7 - 6 - | 4' 4' 3' - 1' - 2' - 1' - - -"),
    level('c1-02', 1, 2, '小星星', '公版法国传统旋律片段', 70,
        '1 - 1 - 5 - 5 - | 6 - 6 - 5 - - - | 4 - 4 - 3 - 3 - | 2 - 2 - 1 - - -'),
    level('c1-03', 1, 3, '欢乐颂', '贝多芬公版旋律片段', 72,
        '3 - 3 - 4 - 5 - | 5 - 4 - 3 - 2 - | 1 - 1 - 2 - 3 - | 3 - 2 - 2 - - -'),
    level('c2-01', 2, 1, '玛丽有只小羊羔', '公版童谣片段', 74,
        '3 - 2 - 1 - 2 - | 3 - 3 - 3 - - - | 2 - 2 - 2 - - - | 3 - 5 - 5 - - -'),
    level('c2-02', 2, 2, '铃儿响叮当', '公版圣诞旋律片段', 76,
        "3 - 3 - 3 - - - | 3 - 3 - 3 - - - | 3 - 5 - 1' - 2' - | 3' - - -"),
    level('c2-03', 2, 3, '两只老虎', '法国传统轮唱片段', 78,
        '1 - 2 - 3 - 1 - | 1 - 2 - 3 - 1 - | 3 - 4 - 5 - - - | 3 - 4 - 5 - - -'),
    level('c3-01', 3, 1, '伦敦桥', '英国传统童谣片段', 80,
        '5 - 6 - 5 - 4 - | 3 - 4 - 5 - - - | 2 - 3 - 4 - 3 - | 4 - 5 - - -'),
    level('c3-02', 3, 2, '划船歌', 'Row Row Row Your Boat 公版片段', 82,
        '1 - 1 - 1 2 3 - | 3 2 3 4 5 - - - | 1\' 1\' 1\' 5 5 5 | 3 3 3 1 1 1 | 5 4 3 2 1 - - -'),
    level('c3-03', 3, 3, '小蜜蜂', '德国传统童谣片段', 84,
        '5 - 3 - 3 - - - | 4 - 2 - 2 - - - | 1 - 2 - 3 - 4 - | 5 - 5 - 5 - - -'),
];

export function getLevelById(levelId: string): LevelDefinition | null {
    return LEVEL_CATALOG.find((level) => level.id === levelId) ?? null;
}

export function getNextLevel(levelId: string): LevelDefinition | null {
    const i = LEVEL_CATALOG.findIndex((level) => level.id === levelId);
    return i >= 0 ? LEVEL_CATALOG[i + 1] ?? null : null;
}
