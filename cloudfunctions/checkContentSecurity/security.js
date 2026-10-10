'use strict';

// wx-server-sdk uses errCode; HTTPS uses errcode. Never treat an empty reply as pass.
function codeOf(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (value.errCode !== undefined && value.errcode !== undefined && value.errCode !== value.errcode) return undefined;
  const code = value.errCode ?? value.errcode;
  return typeof code === 'number' ? code : undefined;
}
function verdict(value) {
  if (!value || typeof value !== 'object') return { status: 'unavailable' };
  const code = codeOf(value);
  if (code === 87014) return { status: 'reject' };
  // Some successful server APIs omit the code; explicit aggregate pass is still mandatory.
  if ((value.errCode !== undefined || value.errcode !== undefined) && code !== 0) {
    return { status: 'unavailable', ...(code === undefined ? {} : { errorCode: code }) };
  }
  const suggest = value.result?.suggest;
  if (suggest === 'risky') return { status: 'reject' };
  if (suggest !== 'pass') return { status: 'unavailable' };
  if (value.detail !== undefined) {
    if (!Array.isArray(value.detail)) return { status: 'unavailable' };
    for (const item of value.detail) {
      if (codeOf(item) !== 0) return { status: 'unavailable' };
      if (item.suggest === 'risky') return { status: 'reject' };
      if (item.suggest !== 'pass') return { status: 'unavailable' };
    }
  }
  return { status: 'pass' };
}
async function checkedCall(call, timeoutMs) {
  let timer;
  try {
    return verdict(await Promise.race([
      Promise.resolve().then(call),
      new Promise((_, reject) => { timer = setTimeout(() => reject({ errCode: -604102 }), timeoutMs); }),
    ]));
  } catch (error) {
    const code = codeOf(error);
    return { status: code === 87014 ? 'reject' : 'unavailable', ...(code === undefined ? {} : { errorCode: code }) };
  } finally { clearTimeout(timer); }
}
async function checkText(cloud, openid, content) {
  if (!openid || typeof content !== 'string' || !content.trim() || content.length > 2500) {
    return { status: 'unavailable' };
  }
  return checkedCall(() => cloud.openapi.wxa.game.contentSpam.msgSecCheck({
    content, version: 2, scene: 1, openid,
  }), 1000);
}
async function checkImage(cloud, openid, mediaUrl) {
  // The caller derives this signed URL from its own immutable cloud copy, never from client input.
  if (!openid || typeof mediaUrl !== 'string' || !/^https:\/\/[^\s]+$/.test(mediaUrl)) return { status: 'unavailable' };
  return checkedCall(() => cloud.openapi.wxa.game.contentSpam.mediaCheckSync({
    openid, version: 2, scene: 1, media_type: 2, media_url: mediaUrl,
  }), 5000);
}
module.exports = { checkText, checkImage, verdict };
