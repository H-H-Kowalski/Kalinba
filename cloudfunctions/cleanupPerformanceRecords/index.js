const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const COLLECTION = 'performance_records';
const BATCH_LIMIT = 100;

async function removeBatch() {
  const now = Date.now();
  const q = await db.collection(COLLECTION)
    .where({ expireAtMs: _.lte(now) })
    .field({ _id: true })
    .limit(BATCH_LIMIT)
    .get();
  const ids = (q.data || []).map((x) => x._id).filter(Boolean);
  if (ids.length === 0) return 0;
  await db.collection(COLLECTION).where({ _id: _.in(ids) }).remove();
  return ids.length;
}

exports.main = async () => {
  let removed = 0;
  while (true) {
    const n = await removeBatch();
    removed += n;
    if (n < BATCH_LIMIT) break;
  }
  return { removed };
};
