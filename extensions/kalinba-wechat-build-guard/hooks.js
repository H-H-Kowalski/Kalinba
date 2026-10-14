'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
exports.throwError = true;
function identity() {
    const appid = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')).appid;
    const template = JSON.parse(fs.readFileSync(path.join(root, 'build-templates/wechatgame/project.config.json'), 'utf8'));
    if (!/^wx[0-9a-f]{16}$/.test(appid) || appid === 'wx6ac3f5090a6b99c5' || template.appid !== appid) {
        throw Error('[Kalinba AppID] 根项目与构建模板必须使用同一正式小游戏 AppID');
    }
    return appid;
}
exports.onBeforeBuild = async function (options) {
    const appid = identity();
    if (options.packages?.wechatgame?.appid !== appid) {
        throw Error(`[Kalinba AppID] 已阻止游客或其他账号构建；请将该构建任务的 AppID 改为 ${appid}`);
    }
    console.log(`[Kalinba AppID] validated task ${appid}`);
};
exports.onAfterBuild = async function (_options, result) {
    const appid = identity();
    const output = JSON.parse(fs.readFileSync(path.join(result.dest, 'project.config.json'), 'utf8'));
    if (output.appid !== appid || output.isGameTourist === true) {
        throw Error('[Kalinba AppID] 构建产物身份错误，禁止使用该包');
    }
    console.log(`[Kalinba AppID] validated output ${appid}`);
};
