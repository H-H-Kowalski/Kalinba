const cloud = require('wx-server-sdk');
const { checkText, checkImage } = require('./security');
const { prepareImage, inspectImage } = require('./images');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

exports.main = async (event = {}) => {
  const { OPENID, ENV } = cloud.getWXContext();
  if (!OPENID || !event || typeof event !== 'object') return { status: 'unavailable' };
  let result;
  if (event.kind === 'text') result = await checkText(cloud, OPENID, event.content);
  else if (event.kind === 'prepareImage') return prepareImage(OPENID, ENV, event.extension);
  else if (event.kind === 'image') result = await inspectImage(cloud, OPENID, ENV, event.fileID, checkImage);
  else return { status: 'unavailable' };
  if (result.status !== 'pass') console.warn('[ContentSecurity]', { kind: event.kind, ...result });
  return result;
};
