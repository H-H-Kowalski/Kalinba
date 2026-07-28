import { sys } from 'cc';
import type { LevelResult } from '../gameplay/LevelTypes';
import { LEVEL_CATALOG } from '../gameplay/LevelCatalog';

const KEY = 'kalinba_level_progress_v1';

export interface LocalLevelProgress {
    score: number;
    stars: number;
    maxCombo: number;
    updatedAtMs: number;
}

interface PendingLevelResult extends LevelResult {}

interface Snapshot {
    version: 1;
    levels: Record<string, LocalLevelProgress>;
    pending: Record<string, PendingLevelResult>;
    totalPlayedNotes?: number;
}

export interface LocalChallengeSummary {
    completedLevelIds: string[];
    unlockedLevelIds: string[];
    totalStars: number;
    totalNotes: number;
    maxCombo: number;
}

/**
 * 云端为正式档案，本地档案用于立即展示与断网补传。
 * pending 按关卡合并：离线期间反复挑战不会无限膨胀存档。
 */
export class LevelProgressStore {
    static load(): Snapshot {
        try {
            const raw = sys.localStorage.getItem(KEY);
            if (!raw) return { version: 1, levels: {}, pending: {}, totalPlayedNotes: 0 };
            const parsed = JSON.parse(raw) as Partial<Snapshot>;
            return {
                version: 1,
                levels: parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {},
                pending: parsed.pending && typeof parsed.pending === 'object' ? parsed.pending : {},
                totalPlayedNotes: Math.max(0, Math.floor(Number(parsed.totalPlayedNotes) || 0)),
            };
        } catch {
            return { version: 1, levels: {}, pending: {}, totalPlayedNotes: 0 };
        }
    }

    static recordResult(result: LevelResult): void {
        const s = this.load();
        const id = result.levelId;
        if (!id) return;
        const prev = s.levels[id];
        s.levels[id] = {
            score: Math.max(prev?.score ?? 0, result.score),
            stars: Math.max(prev?.stars ?? 0, result.stars),
            maxCombo: Math.max(prev?.maxCombo ?? 0, result.maxCombo),
            updatedAtMs: Date.now(),
        };
        const pending = s.pending[id];
        s.pending[id] = {
            ...result,
            score: Math.max(pending?.score ?? 0, result.score),
            stars: Math.max(pending?.stars ?? 0, result.stars) as 0 | 1 | 2 | 3,
            maxCombo: Math.max(pending?.maxCombo ?? 0, result.maxCombo),
            // 只累计本地待上传期间的音符数，上传成功后归零。
            playedNoteCount: Math.min(10_000, (pending?.playedNoteCount ?? 0) + result.playedNoteCount),
        };
        s.totalPlayedNotes = Math.min(
            1_000_000,
            Math.max(0, Math.floor(Number(s.totalPlayedNotes) || 0)) + Math.max(0, result.playedNoteCount),
        );
        this.save(s);
    }

    static getPending(): LevelResult[] {
        const pending = this.load().pending;
        return Object.keys(pending).map((id) => pending[id]).filter((v): v is LevelResult => !!v);
    }

    static markSynced(levelId: string): void {
        const s = this.load();
        if (!s.pending[levelId]) return;
        delete s.pending[levelId];
        this.save(s);
    }

    static getLocallyUnlockedLevelIds(): string[] {
        const levels = this.load().levels;
        const unlocked: string[] = [];
        for (let i = 0; i < LEVEL_CATALOG.length; i++) {
            if (i === 0) {
                unlocked.push(LEVEL_CATALOG[i].id);
                continue;
            }
            const previous = levels[LEVEL_CATALOG[i - 1].id];
            if ((previous?.stars ?? 0) > 0) unlocked.push(LEVEL_CATALOG[i].id);
            else break;
        }
        return unlocked;
    }

    static getLevelProgress(levelId: string): LocalLevelProgress | null {
        return this.load().levels[levelId] ?? null;
    }

    static getSummary(): LocalChallengeSummary {
        const snapshot = this.load();
        const completedLevelIds = LEVEL_CATALOG
            .filter((level) => (snapshot.levels[level.id]?.stars ?? 0) > 0)
            .map((level) => level.id);
        let totalStars = 0;
        let maxCombo = 0;
        for (const levelId of Object.keys(snapshot.levels)) {
            const progress = snapshot.levels[levelId];
            totalStars += Math.max(0, Math.min(3, Math.floor(Number(progress?.stars) || 0)));
            maxCombo = Math.max(maxCombo, Math.max(0, Math.floor(Number(progress?.maxCombo) || 0)));
        }
        return {
            completedLevelIds,
            unlockedLevelIds: this.getLocallyUnlockedLevelIds(),
            totalStars,
            totalNotes: Math.max(0, Math.floor(Number(snapshot.totalPlayedNotes) || 0)),
            maxCombo,
        };
    }

    private static save(snapshot: Snapshot): void {
        try {
            sys.localStorage.setItem(KEY, JSON.stringify(snapshot));
        } catch {
            // 缓存失败只影响离线恢复，不阻断本局结算。
        }
    }
}
