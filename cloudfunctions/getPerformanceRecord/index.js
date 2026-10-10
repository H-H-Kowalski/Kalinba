const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'performance_records';

function safeString(v) {
  return typeof v === 'string' ? v : '';
}

exports.main = async (event) => {
  const recordId = safeString(event && event.recordId).trim();
  if (!recordId) {
    throw new Error('recordId is required');
  }

  const now = Date.now();
  const q = await db.collection(COLLECTION).where({ recordId }).limit(1).get();
  const row = q && q.data && q.data[0];
  if (!row) {
    throw new Error('record not found');
  }
  if (Number(row.expireAtMs || 0) < now) {
    throw new Error('record expired');
  }
  let parsed;
  try {
    parsed = JSON.parse(row.eventsEncoded || '{}');
  } catch (e) {
    throw new Error('record payload corrupted');
  }
  const events = Array.isArray(parsed.events) ? parsed.events : [];

  return {
    contentSecurityVersion: 1,
    record: {
      // Legacy unchecked titles must never be shown by a recipient.
      title: row.contentSecurityVersion === 1 && typeof row.title === 'string' && row.title.length <= 40
        ? row.title.trim() : '《分享演奏》',
      stylePreset: Number.isInteger(Number(row.stylePreset)) ? Number(row.stylePreset) : 1,
      durationMs: Number(row.durationMs || 0),
      appVersion: row.appVersion || '1.0.0',
      events,
    },
  };
};
