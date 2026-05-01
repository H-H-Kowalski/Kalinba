const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'performance_records';
const MAX_DURATION_MS = 180000;
const MAX_EVENTS = 6000;
const MAX_ENCODED_SIZE = 128 * 1024;
const MAX_TITLE_LEN = 40;
const MAX_CREATE_PER_MINUTE = 5;
const EXPIRE_DAYS = 90;

function safeString(v) {
  return typeof v === 'string' ? v : '';
}

function isValidStylePreset(v) {
  return Number.isInteger(v) && v >= 0 && v <= 4;
}

function makeRecordId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePayload(data) {
  const durationMs = Number(data.durationMs);
  const eventCount = Number(data.eventCount);
  const stylePreset = Number(data.stylePreset);
  const title = safeString(data.title).trim();
  const eventsEncoded = safeString(data.eventsEncoded);
  const appVersion = safeString(data.appVersion).trim() || '1.0.0';

  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > MAX_DURATION_MS) {
    throw new Error('durationMs out of range');
  }
  if (!Number.isFinite(eventCount) || eventCount < 1 || eventCount > MAX_EVENTS) {
    throw new Error('eventCount out of range');
  }
  if (!isValidStylePreset(stylePreset)) {
    throw new Error('stylePreset invalid');
  }
  if (!eventsEncoded || eventsEncoded.length > MAX_ENCODED_SIZE) {
    throw new Error('eventsEncoded invalid');
  }
  if (title.length > MAX_TITLE_LEN) {
    throw new Error('title too long');
  }

  return { durationMs, eventCount, stylePreset, title, eventsEncoded, appVersion };
}

async function checkRateLimit(openid) {
  const since = Date.now() - 60 * 1000;
  const r = await db.collection(COLLECTION)
    .where({
      ownerOpenId: openid,
      createdAtMs: _.gte(since),
    })
    .count();
  if ((r && r.total) >= MAX_CREATE_PER_MINUTE) {
    throw new Error('too many requests');
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    throw new Error('missing OPENID');
  }

  const payload = ensurePayload(event || {});
  await checkRateLimit(openid);

  const now = Date.now();
  const expireAtMs = now + EXPIRE_DAYS * 24 * 60 * 60 * 1000;
  const recordId = makeRecordId();

  await db.collection(COLLECTION).add({
    data: {
      recordId,
      ownerOpenId: openid,
      title: payload.title,
      stylePreset: payload.stylePreset,
      durationMs: payload.durationMs,
      eventCount: payload.eventCount,
      eventsEncoded: payload.eventsEncoded,
      appVersion: payload.appVersion,
      createdAt: db.serverDate(),
      createdAtMs: now,
      expireAtMs,
    },
  });

  return { recordId };
};
