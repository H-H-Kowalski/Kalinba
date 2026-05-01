const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'user_achievement_stats';
const MAX_PLAY_DELTA_MS = 30 * 60 * 1000;
const MAX_LEVEL_SCORE = 1000000;
const DATE_MS = 24 * 60 * 60 * 1000;

function safeString(v) {
  return typeof v === 'string' ? v : '';
}

function formatDateKey(ts) {
  const d = new Date(ts);
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
    if (!Number.isFinite(levelScore) || levelScore < 0 || levelScore > MAX_LEVEL_SCORE) {
      throw new Error('levelScore invalid');
    }
    const prev = Number(stats.levelScores[levelId] || 0);
    const next = Math.max(prev, Math.floor(levelScore));
    stats.levelScores[levelId] = next;
    stats.bestLevelScore = Math.max(stats.bestLevelScore, next);
    changed = true;
  }

  if (changed) {
    applyActiveDate(stats, todayKey);
  }
  return changed;
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
      updatedAtMs: stats.updatedAtMs,
    },
  };
};
