const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'performance_records';
const MAX_BASE64 = 350000;

function validImage(value) {
  return typeof value === 'string' && value.length <= MAX_BASE64 &&
    /^(iVBORw0KGgo|\/9j\/)[A-Za-z0-9+/]*={0,2}$/.test(value);
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID;
  const recordId = event && event.recordId;
  const explicitEnvironment = event && Object.prototype.hasOwnProperty.call(event, 'envVersion');
  const envVersion = explicitEnvironment ? event.envVersion : 'release';
  if (!['release', 'trial', 'develop'].includes(envVersion)) throw new Error('invalid envVersion');
  if (!openid) throw new Error('missing OPENID');
  if (typeof recordId !== 'string' || !/^[a-zA-Z0-9_-]{1,28}$/.test(recordId)) throw new Error('invalid recordId');
  const rows = await db.collection(COLLECTION).where({ recordId, ownerOpenId: openid }).limit(1).get();
  const row = rows && rows.data && rows.data[0];
  const now = Date.now();
  if (!row || !Number.isFinite(row.expireAtMs) || row.expireAtMs <= now) throw new Error('record unavailable');
  if (row.contentSecurityVersion !== 1) throw new Error('record not reviewed');
  // 兼容旧客户端：未传环境的请求仍取正式版；新客户端校验版本和环境防止混合部署误用。
  const reply = imageBase64 => ({ recordId, imageBase64, codeVersion: explicitEnvironment ? 2 : 1, envVersion, expireAtMs: row.expireAtMs });
  const cachedEnvironment = row.shareCodeVersion === 1 ? 'release' : row.shareCodeEnvVersion;
  if ((row.shareCodeVersion === 1 || row.shareCodeVersion === 2) && cachedEnvironment === envVersion && validImage(row.shareCodeBase64)) {
    return reply(row.shareCodeBase64);
  }
  if (row.shareCodeRequestedAtMs > now - 30000) throw new Error('please retry later');
  const recent = await db.collection(COLLECTION).where({
    ownerOpenId: openid, shareCodeRequestedAtMs: db.command.gte(now - 60000),
  }).count();
  if (recent.total >= 5) throw new Error('too many requests');
  await db.collection(COLLECTION).doc(row._id).update({ data: { shareCodeRequestedAtMs: now } });
  // 不传 page：小游戏没有页面路由，业务参数从 query.scene 接收。
  // 测试码必须进入对应开发/体验版本，正式客户端则生成正式码；不接受 AppID 或自定义页面。
  const result = await cloud.openapi.wxacode.getUnlimited({ scene: `rid=${recordId}`, width: 430, envVersion });
  if (!result || !Buffer.isBuffer(result.buffer) || result.buffer.length > 262500) throw new Error('invalid code image');
  const imageBase64 = result.buffer.toString('base64');
  if (!validImage(imageBase64)) throw new Error('invalid code image');
  // 与演奏一起缓存、一起过期清理，不新增云存储文件或个人信息。
  await db.collection(COLLECTION).doc(row._id).update({ data: { shareCodeBase64: imageBase64, shareCodeVersion: 2, shareCodeEnvVersion: envVersion } });
  return reply(imageBase64);
};
