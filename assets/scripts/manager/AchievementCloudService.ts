import type { LevelResult } from '../gameplay/LevelTypes';
import { callWxCloudFunction } from './WeChatCloudFunction';

type DateScorePair = {
    dateKey: string;
    score: number;
};

export type UserAchievementStats = {
    totalPlayDurationMs: number;
    streakDays: number;
    lastActiveDateKey: string;
    bestLevelScore: number;
    levelScores: Record<string, number>;
    levelProgress: Record<string, { score: number; stars: number; maxCombo: number; updatedAtMs: number }>;
    totalNotes: number;
    totalStars: number;
    maxCombo: number;
    completedLevelIds: string[];
    unlockedLevelIds: string[];
    achievementIds: string[];
    updatedAtMs: number;
};

type UpsertStatsResult = {
    stats: UserAchievementStats;
};

export class AchievementCloudService {
    static async reportPlayDuration(durationMs: number): Promise<UserAchievementStats> {
        const ms = Math.floor(Number(durationMs));
        if (!Number.isFinite(ms) || ms <= 0) {
            throw new Error('durationMs must be positive');
        }
        const result = await callWxCloudFunction<UpsertStatsResult>('upsertUserAchievementStats', {
            playDurationMsDelta: ms,
        });
        if (!result?.stats) throw new Error('missing stats');
        return result.stats;
    }

    static async reportLevelScore(levelId: string, score: number): Promise<UserAchievementStats> {
        const id = (levelId ?? '').trim();
        const safeScore = Math.floor(Number(score));
        if (!id) throw new Error('levelId is required');
        if (!Number.isFinite(safeScore) || safeScore < 0) throw new Error('score is invalid');
        const result = await callWxCloudFunction<UpsertStatsResult>('upsertUserAchievementStats', {
            levelId: id,
            levelScore: safeScore,
            levelStars: 0,
            levelMaxCombo: 0,
            playedNoteCount: 0,
        });
        if (!result?.stats) throw new Error('missing stats');
        return result.stats;
    }

    static async reportLevelResult(levelResult: LevelResult): Promise<UserAchievementStats> {
        const levelId = (levelResult?.levelId ?? '').trim();
        if (!levelId) throw new Error('levelId is required');
        const result = await callWxCloudFunction<UpsertStatsResult>('upsertUserAchievementStats', {
            levelId,
            levelScore: Math.max(0, Math.floor(Number(levelResult.score) || 0)),
            levelStars: Math.max(0, Math.min(3, Math.floor(Number(levelResult.stars) || 0))),
            levelMaxCombo: Math.max(0, Math.floor(Number(levelResult.maxCombo) || 0)),
            playedNoteCount: Math.max(0, Math.floor(Number(levelResult.playedNoteCount) || 0)),
        });
        if (!result?.stats) throw new Error('missing stats');
        return result.stats;
    }

    static async getStats(): Promise<UserAchievementStats> {
        const result = await callWxCloudFunction<UpsertStatsResult>('upsertUserAchievementStats', {
            readOnly: true,
        });
        if (!result?.stats) throw new Error('missing stats');
        return result.stats;
    }

    static pickTopScores(stats: UserAchievementStats, limit = 3): DateScorePair[] {
        const pairs = Object.entries(stats.levelScores || {}).map(([dateKey, score]) => ({
            dateKey,
            score: Number(score) || 0,
        }));
        return pairs.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
    }
}
