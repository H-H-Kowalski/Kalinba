import { getWx } from './WeChatNative';

type CallResult<T> = {
    result?: T;
};

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
    updatedAtMs: number;
};

type UpsertStatsResult = {
    stats: UserAchievementStats;
};

function callWxCloudFunction<T>(name: string, data: Record<string, unknown>): Promise<T> {
    const wxApi = getWx() as {
        cloud?: {
            callFunction?: (arg: { name: string; data: Record<string, unknown> }) => Promise<CallResult<T>>;
        };
    } | undefined;
    if (!wxApi?.cloud?.callFunction) {
        return Promise.reject(new Error('wx.cloud.callFunction is unavailable'));
    }
    return wxApi.cloud.callFunction({ name, data }).then((res) => {
        if (!res?.result) throw new Error('empty cloud result');
        return res.result;
    });
}

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
