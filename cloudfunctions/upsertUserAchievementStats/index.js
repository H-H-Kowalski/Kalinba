const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'user_achievement_stats';
const MAX_PLAY_DELTA_MS = 30 * 60 * 1000;
const MAX_LEVEL_SCORE = 1000000;
const MAX_LEVEL_COMBO = 10000;
const MAX_NOTES_PER_RESULT = 10000;
const DATE_MS = 24 * 60 * 60 * 1000;
const CHINA_TIMEZONE_OFFSET_MS = 8 * 60 * 60 * 1000;
const LEVEL_IDS = ['c1-01', 'c1-02', 'c1-03', 'c2-01', 'c2-02', 'c2-03', 'c3-01', 'c3-02', 'c3-03'];

function safeString(v) {
  return typeof v === 'string' ? v : '';
}

function formatDateKey(ts) {
  // 游戏按中国自然日计算连续练习，避免北京时间早晨被 UTC 前一天切断。
  const d = new Date(ts + CHINA_TIMEZONE_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diffDays(aDateKey, bDateKey) {
  const a = Date.parse(`${aDateKey}T00:00:00.000Z`);
  const b = Date.parse(`${bDateKey}T00:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((a - b) / DATE_MS);
}

function ensureStatsRow(row, nowMs) {
  const dateKey = formatDateKey(nowMs);
  if (!row) {
    return {
      totalPlayDurationMs: 0,
      streakDays: 0,
      lastActiveDateKey: '',
      bestLevelScore: 0,
      levelScores: {},
      levelProgress: {},
      totalNotes: 0,
      totalStars: 0,
      maxCombo: 0,
      completedLevelIds: [],
      achievementIds: [],
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      activeDateKey: dateKey,
    };
  }
  return {
    totalPlayDurationMs: Number(row.totalPlayDurationMs || 0),
    streakDays: Number(row.streakDays || 0),
    lastActiveDateKey: safeString(row.lastActiveDateKey),
    bestLevelScore: Number(row.bestLevelScore || 0),
    levelScores: row.levelScores && typeof row.levelScores === 'object' ? row.levelScores : {},
    levelProgress: row.levelProgress && typeof row.levelProgress === 'object' ? row.levelProgress : {},
    totalNotes: Math.max(0, Number(row.totalNotes || 0)),
    totalStars: Math.max(0, Number(row.totalStars || 0)),
    maxCombo: Math.max(0, Number(row.maxCombo || 0)),
    completedLevelIds: Array.isArray(row.completedLevelIds) ? row.completedLevelIds.filter((id) => LEVEL_IDS.includes(id)) : [],
    achievementIds: Array.isArray(row.achievementIds) ? row.achievementIds.filter((id) => typeof id === 'string') : [],
    createdAtMs: Number(row.createdAtMs || nowMs),
    updatedAtMs: Number(row.updatedAtMs || nowMs),
    activeDateKey: dateKey,
  };
}

function applyActiveDate(stats, todayKey) {
  if (!stats.lastActiveDateKey) {
    stats.streakDays = 1;
    stats.lastActiveDateKey = todayKey;
    return;
  }
  const dayDiff = diffDays(todayKey, stats.lastActiveDateKey);
  if (dayDiff === 0) {
    return;
  }
  if (dayDiff === 1) {
    stats.streakDays += 1;
  } else {
    stats.streakDays = 1;
  }
  stats.lastActiveDateKey = todayKey;
}

function applyPayload(stats, payload, todayKey) {
  const readOnly = !!payload.readOnly;
  if (readOnly) return false;

  let changed = false;
  const durationDelta = Number(payload.playDurationMsDelta || 0);
  if (Number.isFinite(durationDelta) && durationDelta > 0) {
    if (durationDelta > MAX_PLAY_DELTA_MS) {
      throw new Error('playDurationMsDelta too large');
    }
    stats.totalPlayDurationMs += Math.floor(durationDelta);
    changed = true;
  }

  const levelId = safeString(payload.levelId).trim();
  const levelScore = Number(payload.levelScore);
  if (levelId) {
    if (!LEVEL_IDS.includes(levelId)) {
      throw new Error('levelId invalid');
    }
    if (!Number.isFinite(levelScore) || levelScore < 0 || levelScore > MAX_LEVEL_SCORE) {
      throw new Error('levelScore invalid');
    }
    const prev = Number(stats.levelScores[levelId] || 0);
    const next = Math.max(prev, Math.floor(levelScore));
    stats.levelScores[levelId] = next;
    stats.bestLevelScore = Math.max(stats.bestLevelScore, next);
    const stars = Number(payload.levelStars);
    const maxCombo = Number(payload.levelMaxCombo);
    const playedNotes = Number(payload.playedNoteCount);
    if (!Number.isInteger(stars) || stars < 0 || stars > 3) {
      throw new Error('levelStars invalid');
    }
    if (!Number.isFinite(maxCombo) || maxCombo < 0 || maxCombo > MAX_LEVEL_COMBO) {
      throw new Error('levelMaxCombo invalid');
    }
    if (!Number.isFinite(playedNotes) || playedNotes < 0 || playedNotes > MAX_NOTES_PER_RESULT) {
      throw new Error('playedNoteCount invalid');
    }
    const prevProgress = stats.levelProgress[levelId] || {};
    const prevStars = Math.max(0, Math.min(3, Number(prevProgress.stars || 0)));
    const nextStars = Math.max(prevStars, Math.floor(stars));
    stats.levelProgress[levelId] = {
      score: next,
      stars: nextStars,
      maxCombo: Math.max(Number(prevProgress.maxCombo || 0), Math.floor(maxCombo)),
      updatedAtMs: Date.now(),
    };
    stats.totalNotes += Math.floor(playedNotes);
    stats.totalStars += nextStars - prevStars;
    stats.maxCombo = Math.max(stats.maxCombo, Math.floor(maxCombo));
    if (nextStars > 0 && !stats.completedLevelIds.includes(levelId)) {
      stats.completedLevelIds.push(levelId);
    }
    unlockAchievements(stats);
    changed = true;
  }

  if (changed) {
    applyActiveDate(stats, todayKey);
  }
  return changed;
}

function unlockAchievements(stats) {
  const ids = new Set(stats.achievementIds);
  if (stats.completedLevelIds.length >= 1) ids.add('first_challenge');
  if (stats.totalStars >= 3) ids.add('three_stars_total');
  if (stats.maxCombo >= 20) ids.add('combo_20');
  if (stats.maxCombo >= 50) ids.add('combo_50');
  if (stats.totalNotes >= 100) ids.add('notes_100');
  if (stats.totalNotes >= 500) ids.add('notes_500');
  if (LEVEL_IDS.every((id) => stats.completedLevelIds.includes(id))) ids.add('complete_launch_catalog');
  stats.achievementIds = [...ids];
}

function computeUnlockedLevelIds(stats) {
  const unlocked = [LEVEL_IDS[0]];
  for (let i = 0; i < LEVEL_IDS.length - 1; i++) {
    if (stats.completedLevelIds.includes(LEVEL_IDS[i])) unlocked.push(LEVEL_IDS[i + 1]);
    else break;
  }
  return unlocked;
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) throw new Error('missing OPENID');

  const nowMs = Date.now();
  const todayKey = formatDateKey(nowMs);
  const q = await db.collection(COLLECTION).where({ openid }).limit(1).get();
  const row = q && q.data && q.data[0];
  const stats = ensureStatsRow(row, nowMs);
  const changed = applyPayload(stats, event || {}, todayKey);
  stats.updatedAtMs = nowMs;

  if (changed) {
    const doc = {
      openid,
      totalPlayDurationMs: stats.totalPlayDurationMs,
      streakDays: stats.streakDays,
      lastActiveDateKey: stats.lastActiveDateKey,
      bestLevelScore: stats.bestLevelScore,
      levelScores: stats.levelScores,
      levelProgress: stats.levelProgress,
      totalNotes: stats.totalNotes,
      totalStars: stats.totalStars,
      maxCombo: stats.maxCombo,
      completedLevelIds: stats.completedLevelIds,
      achievementIds: stats.achievementIds,
      createdAtMs: stats.createdAtMs,
      updatedAtMs: stats.updatedAtMs,
      updatedAt: db.serverDate(),
    };
    if (row && row._id) {
      await db.collection(COLLECTION).doc(row._id).update({ data: doc });
    } else {
      await db.collection(COLLECTION).add({
        data: {
          ...doc,
          createdAt: db.serverDate(),
        },
      });
    }
  }

  return {
    stats: {
      totalPlayDurationMs: stats.totalPlayDurationMs,
      streakDays: stats.streakDays,
      lastActiveDateKey: stats.lastActiveDateKey,
      bestLevelScore: stats.bestLevelScore,
      levelScores: stats.levelScores,
      levelProgress: stats.levelProgress,
      totalNotes: stats.totalNotes,
      totalStars: stats.totalStars,
      maxCombo: stats.maxCombo,
      completedLevelIds: stats.completedLevelIds,
      unlockedLevelIds: computeUnlockedLevelIds(stats),
      achievementIds: stats.achievementIds,
      updatedAtMs: stats.updatedAtMs,
    },
  };
};
