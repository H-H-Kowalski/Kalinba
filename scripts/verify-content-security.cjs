// Offline failure-path tests. No cloud calls or production mutations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { compileForWechat } = require('./verify-release-compat.cjs');
const security = require('../cloudfunctions/checkContentSecurity/security');
function load(path, imports, extra = {}) {
    const exports = {};
    vm.runInNewContext(compileForWechat(path), {exports, require: imports, console, setTimeout, clearTimeout, ...extra});
    return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function main() {
    for (const result of [null, {}, {errCode: 0}, {errCode: 45009}, {errCode: 0, result: {suggest: 'review'}}, {errCode: 0, result: {suggest: 'unknown'}}]) {
        assert.equal(security.verdict(result, true).status, 'unavailable');
    }
    assert.equal(security.verdict({errcode: 0, result: {suggest: 'pass'}}, true).status, 'pass');
    assert.equal(security.verdict({errCode: 0, result: {suggest: 'risky'}}, true).status, 'reject');
    assert.equal(security.verdict({errCode: 87014}, false).status, 'reject');
    let requested;
    const cloud = {openapi: {wxa: {game: {contentSpam: {msgSecCheck: async args => {
        requested = args; return {errCode: 0, result: {suggest: 'pass'}};
    }, mediaCheckSync: async () => ({errCode: 0, result: {suggest: 'pass'}})}}}}};
    assert.equal((await security.checkText(cloud, 'server-openid', '生日快乐')).status, 'pass');
    assert.equal(requested.openid, 'server-openid');
    assert.equal(requested.version, 2);
    assert.equal((await security.checkText(cloud, '', '生日快乐')).status, 'unavailable');
    cloud.openapi.wxa.game.contentSpam.msgSecCheck = async () => {throw {errCode: 45009};};
    assert.equal((await security.checkText(cloud, 'id', '生日快乐')).status, 'unavailable');
    cloud.openapi.wxa.game.contentSpam.msgSecCheck = async () => {throw {errCode: 87014};};
    assert.equal((await security.checkText(cloud, 'id', 'test')).status, 'reject');
    assert.equal((await security.checkImage(cloud, 'server-openid', 'https://example.com/review.png')).status, 'pass');
    assert.equal((await security.checkImage(cloud, 'server-openid', 'not an image')).status, 'unavailable');
    assert.equal((await security.checkImage(cloud, '', 'https://example.com/image.png')).status, 'unavailable');
    cloud.openapi.wxa.game.contentSpam.mediaCheckSync = async () => {throw Error('network');};
    assert.equal((await security.checkImage(cloud, 'server-openid', 'https://example.com/review.png')).status, 'unavailable');

    let reply = {status: 'pass'}, checks = 0;
    const service = load('assets/scripts/manager/ContentSecurityService.ts', id => id.endsWith('WeChatNative')
        ? {getWx: () => undefined} : {callWxCloudFunction: async (_, data) => {checks++; return data.kind === 'prepareImage' ? {status: 'ready', env: 'env', cloudPath: 'content-security/' + 'a'.repeat(64) + '/' + 'b'.repeat(48) + '.png'} : reply;}});
    for (const value of [undefined, {}, {status: 'unavailable'}, {status: 'reject'}, {status: 'unexpected'}]) {
        reply = value;
        await assert.rejects(service.ContentSecurityService.requireText('歌名'));
    }
    const beforeEmptyText=checks; await service.ContentSecurityService.requireText(''); await service.ContentSecurityService.requireText('  ');
    assert.equal(checks,beforeEmptyText,'no moderation request for empty text');
    reply = {status: 'pass'};
    await service.ContentSecurityService.requireText('歌名');
    service.ContentSecurityService.uploadImage = async () => 'cloud://env.bucket/test.png';
    let reads = 0;
    service.ContentSecurityService.readImage = async () => {reads++; return 'png';};
    reply = {status: 'reject'};
    await assert.rejects(service.ContentSecurityService.requireImages(['a', 'b']));
    assert.equal(reads, 1, 'stop the batch at first rejection');
    reads = 0;
    service.ContentSecurityService.readImage = async () => {reads++; reply = {status: reads === 2 ? 'reject' : 'pass'}; return 'png';};
    await assert.rejects(service.ContentSecurityService.requireImages(['a', 'b', 'c']));
    assert.equal(reads, 2, 'a later rejection must stop the remaining batch');

    let finish, fail, notices = [], store = new Map();
    let captionCalls = 0;
    const gate = {requireText: () => {captionCalls++; return new Promise((resolve, reject) => {finish = resolve; fail = reject;});}, message: () => 'blocked'};
    function Component() {this.isValid = true; this.node = {};}
    const cc = {Component, isValid: value => !!value && value.isValid !== false && !value.destroying,
        EditBox: {InputMode: {SINGLE_LINE: 0}, EventType: {}}, sys: {localStorage: {
        getItem: k => store.get(k), setItem: (k,v) => store.set(k,v), removeItem: k => store.delete(k),
    }}, _decorator: {ccclass: () => C => C, property: (...args) => typeof args[1] === 'string' ? undefined : () => {}}};
    const appearance = load('assets/scripts/manager/PerformanceAppearanceStore.ts', () => cc);
    let loading = 0;
    const feedback = {showBusyIndicator: () => { loading++; let closed=false; return {update() {}, close() {if(!closed){loading--;closed=true;}}}; }};
    const Caption = load('assets/scripts/view/EditableCaption.ts', id => id === 'cc' ? cc
        : id.endsWith('PerformanceAppearanceStore') ? appearance
        : id.endsWith('AppearanceFeedback') ? feedback
        : id.endsWith('ContentSecurityService') ? {ContentSecurityService: gate}
        : id.endsWith('SimpleToast') ? {showToast: (...args) => notices.push(args)} : {getWx: () => undefined}).EditableCaption;
    const caption = new Caption();
    caption.alignInnerLabels = () => {};
    caption._eb = {isValid: true, string: '新歌名', enabled: true};
    caption.approvedText = '旧歌名';
    caption.onEditEnd(); caption.onEditEnd();
    caption._eb.string = '迟到的原生输入'; caption.onTextChanged();
    assert.equal(caption._eb.string, '旧歌名', 'native input cannot change pending approved text');
    caption._eb.string = '迟到的回车'; caption.onEditEnd();
    assert.equal(caption._eb.string, '旧歌名');
    assert.equal(captionCalls, 1, 'return/end events must not double submit'); assert.equal(loading,1);
    assert.equal(caption.text, '旧歌名');
    assert.equal(caption._eb.string, '旧歌名');
    assert.equal(store.size, 0, 'pending text cannot persist');
    fail(Error('quota')); await tick();
    assert.equal(caption.text, '旧歌名'); assert.equal(caption._eb.enabled, true);
    caption._eb.string = '新歌名'; caption.onEditEnd(); finish(); await tick();
    assert.equal(caption.text, '新歌名'); assert.equal(appearance.PerformanceAppearanceStore.getCaption('default'), '新歌名'); assert.equal(store.size,0); assert.equal(loading,0);
    caption._eb.string = '迟到结果'; caption.onEditEnd(); caption.setText('内置关卡'); finish(); await tick();
    assert.equal(caption.text, '内置关卡', 'stale approval cannot override a new scene mode');
    caption._eb.string = '销毁结果'; caption.onEditEnd(); caption.isValid = false; finish(); await tick();
    assert.equal(appearance.PerformanceAppearanceStore.getCaption('default'), '新歌名', 'destroyed component cannot save');
    caption.isValid = true; caption.onDisable(); caption._eb.string = '离开后的输入'; caption.onEditEnd();
    assert.equal(caption._eb.string, caption.text);

    caption.onEnable(); const beforeEmpty=captionCalls; caption._eb.string='  '; caption.onEditEnd();
    assert.equal(caption.text,''); assert.equal(captionCalls,beforeEmpty); assert.equal(loading,0);
    assert.equal(appearance.PerformanceAppearanceStore.getCaption('default'),'');

    let imageResolve, imageReject, applied = 0, saved = 0;
    const imageGate = {requireImages: () => new Promise((resolve,reject) => {imageResolve=resolve; imageReject=reject;}), message: () => 'blocked'};
    function Dummy() {}
    const sheetCC = {...cc, Color: Dummy, Vec3: Dummy, Enum: v => v};
    const Sheet = load('assets/scripts/view/SheetMusicBackground.ts', id => id === 'cc' ? sheetCC
        : id.endsWith('PerformanceAppearanceStore') ? appearance
        : id.endsWith('AppearanceFeedback') ? feedback
        : id.endsWith('ContentSecurityService') ? {ContentSecurityService: imageGate}
        : id.endsWith('ChooseImageHelper') ? {isWeChatMiniGame: () => true, chooseImagesUpTo: async () => ({ok:true,urls:['a','b']})}
        : id.endsWith('SimpleToast') ? {showToast: () => {}} : {}).SheetMusicBackground;
    const sheet = new Sheet();
    sheet.updateNavAndPageLabel = () => {};
    sheet.loadCarouselFromUrls = async () => {applied++; return true;};
    sheet.saveSelectedImageUrls = () => saved++;
    let operation = sheet.openImagePicker(); await tick();
    assert.equal(applied,0); assert.equal(saved,0);
    imageReject(Error('second image blocked')); await operation;
    assert.equal(applied,0); assert.equal(saved,0, 'rejected batch preserves old images and storage');
    operation = sheet.openImagePicker(); await tick(); imageResolve(); await operation;
    assert.equal(applied,1); assert.equal(saved,1);
    operation = sheet.openImagePicker(); await tick(); sheet.onDisable();
    const staleImageResolve = imageResolve;
    const newerOperation = sheet.openImagePicker(); await tick(); staleImageResolve(); await operation;
    assert.equal(applied,1, 'late image approval cannot override a disabled view');
    assert.equal(sheet._isPickingImages,true, 'old finally cannot unlock a newer selection');
    imageResolve(); await newerOperation;
    assert.equal(applied,2); assert.equal(saved,2);

    // Exercise backend write boundary, including direct calls bypassing the UI.
    let written = 0, textVerdict = 'reject';
    const serverCloud = {init() {}, getWXContext: () => ({OPENID:'trusted'}), database: () => ({
        command: {gte: x => x}, collection: () => ({where: () => ({count: async () => ({total:0})}),
            add: async () => {written++;}}), serverDate: () => 0,
    })};
    const exports = {};
    vm.runInNewContext(fs.readFileSync('cloudfunctions/createPerformanceRecord/index.js', 'utf8'), {
        exports, console: {warn: () => {}}, require: id => id === 'wx-server-sdk' ? serverCloud : {checkText: async () => ({status:textVerdict})},
    });
    const payload = {title:'歌名', durationMs:100, eventCount:1, stylePreset:1, eventsEncoded:'{}'};
    for (const state of ['reject','unavailable']) {
        textVerdict = state; assert.equal((await exports.main(payload)).securityStatus,state); assert.equal(written,0);
    }
    textVerdict = 'pass'; assert.ok((await exports.main(payload)).recordId); assert.equal(written,1);
    assert.equal(fs.readFileSync('cloudfunctions/createPerformanceRecord/security.js','utf8'),
        fs.readFileSync('cloudfunctions/checkContentSecurity/security.js','utf8'), 'deployment copies must match');
    console.log('PASS: moderation verdicts, quota/network/empty replies, image batch rejection, caption rollback/dedup/stale results, server write gate');
    await require('./verify-content-security-cases.cjs')();
    await require('./verify-game-security.cjs')();
    await require('./verify-privacy-authorization.cjs')();
}
main().catch(error => {console.error(error); process.exitCode = 1;});
