export interface LevelNote {
    /** 从音乐开始计的拍数，可为 0.5 表示八分音符。 */
    beat: number;
    /** 现有 KalimbaKey 的 0~16 索引。 */
    keyIndex: number;
}

export interface LevelDefinition {
    id: string;
    chapter: number;
    order: number;
    title: string;
    subtitle: string;
    bpm: number;
    beatsPerBar: 2 | 3 | 4;
    /** 挑战舞台的落键主题；只影响挑战 HUD，不改变首页主视觉。 */
    visualTheme: 'amber' | 'leaf' | 'sky' | 'coral' | 'plum' | 'mint' | 'dawn' | 'violet' | 'festival';
    notes: LevelNote[];
    passScore: number;
    twoStarScore: number;
    threeStarScore: number;
}

export type JudgeGrade = 'perfect' | 'good' | 'miss' | 'wrong';

export interface JudgeEvent {
    grade: JudgeGrade;
    keyIndex: number;
    expectedKeyIndex?: number;
    offsetMs?: number;
    combo: number;
    scoreDelta: number;
}

export interface LevelResult {
    levelId: string;
    score: number;
    stars: 0 | 1 | 2 | 3;
    maxCombo: number;
    perfectCount: number;
    goodCount: number;
    missCount: number;
    wrongCount: number;
    playedNoteCount: number;
}
