'use strict';
const crypto = require('crypto');
const MAX_IMAGE_BYTES = 10 * 1000 * 1000;
const EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'bmp', 'tif', 'tiff', 'webp', 'gif']);
const ownerKey = openid => crypto.createHash('sha256').update(openid).digest('hex');

function prepareImage(openid, env, extension) {
  if (!openid || !env || !EXTENSIONS.has(extension)) return { status: 'unavailable' };
  return { status: 'ready', cloudPath: `content-security/${ownerKey(openid)}/${crypto.randomBytes(24).toString('hex')}.${extension}`, env };
}
function ownedUpload(openid, env, fileID) {
  if (!openid || !env || typeof fileID !== 'string') return false;
  const match = /^cloud:\/\/([^/]+)\/content-security\/([a-f0-9]{64})\/([a-f0-9]{48})\.(jpg|jpeg|png|bmp|tif|tiff|webp|gif)$/.exec(fileID);
  return !!match && match[1].startsWith(`${env}.`) && /^[a-zA-Z0-9_.-]+$/.test(match[1]) && match[2] === ownerKey(openid);
}
function imageExtension(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  if (bytes.subarray(0, 2).toString('ascii') === 'BM') return 'bmp';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (bytes.subarray(0, 4).equals(Buffer.from([73,73,42,0])) || bytes.subarray(0, 4).equals(Buffer.from([77,77,0,42]))) return 'tiff';
  return null;
}
async function inspectImage(cloud, openid, env, fileID, checkImage) {
  // Do not download or delete arbitrary file IDs, other users' uploads, or files from another environment.
  if (!ownedUpload(openid, env, fileID)) return { status: 'unavailable' };
  const cleanup = [fileID];
  try {
    const downloaded = await cloud.downloadFile({ fileID });
    const extension = imageExtension(downloaded?.fileContent);
    if (!extension) return { status: 'unavailable' };
    // A private random copy prevents the client replacing the remote bytes during review.
    const copy = await cloud.uploadFile({
      cloudPath: `content-security-review/${crypto.randomBytes(24).toString('hex')}.${extension}`,
      fileContent: downloaded.fileContent,
    });
    if (typeof copy?.fileID !== 'string' || !copy.fileID.startsWith('cloud://')) return { status: 'unavailable' };
    cleanup.push(copy.fileID);
    const urls = await cloud.getTempFileURL({ fileList: [{ fileID: copy.fileID, maxAge: 120 }] });
    const file = urls?.fileList?.find(item => item.fileID === copy.fileID);
    if (!file || file.status !== 0) return { status: 'unavailable' };
    return await checkImage(cloud, openid, file.tempFileURL);
  } catch (error) {
    console.warn('[ContentSecurity] image storage failed', { errorCode: error?.errCode ?? error?.errcode });
    return { status: 'unavailable' };
  } finally {
    try {
      const result = await cloud.deleteFile({ fileList: cleanup });
      if (!result?.fileList || result.fileList.some(item => item.status !== 0)) console.warn('[ContentSecurity] temporary image cleanup incomplete');
    } catch { console.warn('[ContentSecurity] temporary image cleanup failed'); }
  }
}
module.exports = { prepareImage, inspectImage, ownedUpload, imageExtension, MAX_IMAGE_BYTES };
