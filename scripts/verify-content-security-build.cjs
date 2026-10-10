// Exercise the generated WeChat bundle so an old build cannot masquerade as updated source.
// Run after a Cocos build: node scripts/verify-content-security-build.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const build = path.resolve(root, process.argv[2] || 'build/wechatgame');
const registrations = new Map(), modules = new Map(), noop = () => {};
const wx = {};
const context = vm.createContext({wx, console, setTimeout, clearTimeout, System: {
    register(name, deps, declare) {
        if (Array.isArray(name)) {
            assert.equal(name.length, 0, 'only the dependency-free bundle wrapper may execute eagerly');
            deps(noop, {}).execute();
        } else registrations.set(name, {deps, declare});
    },
}});
vm.runInContext(fs.readFileSync(path.join(build, 'assets/main/index.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(build, 'src/chunks/bundle.js'), 'utf8'), context);
modules.set('cc', {cclegacy: {_RF: {push: noop, pop: noop}}, sys: {localStorage: {
    getItem: () => null, setItem: noop, removeItem: noop,
}}});
function load(name) {
    const key = name === 'cc' ? name : `chunks:///_virtual/${path.basename(name)}`;
    if (modules.has(key)) return modules.get(key);
    const registration = registrations.get(key);
    assert.ok(registration, `Missing built module: ${key}`);
    const exports = {};
    modules.set(key, exports);
    const module = registration.declare((name, value) => {
        if (typeof name === 'object') Object.assign(exports, name);
        else exports[name] = value;
        return value;
    });
    (module.setters || []).forEach((set, index) => set(load(registration.deps[index])));
    module.execute();
    return exports;
}
(async () => {
    const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json')));
    const builtProject = JSON.parse(fs.readFileSync(path.join(build, 'project.config.json')));
    assert.notEqual(project.appid, 'wx6ac3f5090a6b99c5', 'Cocos default test AppID cannot be used for cloud APIs or release');
    assert.equal(builtProject.appid, project.appid);
    const helper = load('WeChatCloudFunction.ts');
    const env = 'cloud1-2gvremt83958d276';
    let initialized, verdict = {status: 'pass'}, calls = 0;
    wx.cloud = {
        init(o) { initialized = o.env; },
        callFunction(o) {
            assert.equal(o.config.env, env);
            assert.equal(o.name, 'checkContentSecurity');
            assert.equal(o.data.kind, 'text');
            calls++;
            o.success({result: verdict});
        },
    };
    load('PerformanceShareLaunch.ts').installShareLaunchCapture();
    assert.equal(initialized, env);
    const gate = load('ContentSecurityService.ts').ContentSecurityService;
    await gate.requireText('生日快乐');
    verdict = {status: 'reject'};
    await assert.rejects(gate.requireText('未通过的测试输入'), /不符合规范/);
    verdict = {status: 'unavailable', errorCode: 750033};
    await assert.rejects(gate.requireText('生日快乐'), /暂时不可替换/);
    assert.equal(calls, 3);
    // Real mini-game API surface: getImageInfo is intentionally absent.
    const imageSteps = [];
    const cloudPath = 'content-security/' + 'a'.repeat(64) + '/' + 'b'.repeat(48) + '.png';
    const fileID = `cloud://${env}.bucket/${cloudPath}`;
    wx.getFileSystemManager = () => ({
        getFileInfo(o) {imageSteps.push('size');o.success({size:128});},
        readFile(o) {
            assert.equal(o.position,0);assert.equal(o.length,12);assert.equal(o.encoding,undefined);
            imageSteps.push('header');o.success({data:Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]).buffer});
        },
    });
    wx.cloud.callFunction = o => {
        assert.equal(o.config.env,env);imageSteps.push(o.data.kind);
        o.success({result:o.data.kind==='prepareImage'?{status:'ready',env,cloudPath}:{status:'pass'}});
    };
    wx.cloud.uploadFile = o => {imageSteps.push('upload');assert.equal(o.filePath,'wxfile://selected');o.success({fileID});};
    wx.cloud.deleteFile = o => {imageSteps.push('cleanup');o.success({});};
    await gate.requireImages(['wxfile://selected']);
    assert.deepEqual(imageSteps,['size','header','prepareImage','upload','image','cleanup']);
    let dialog;
    modules.set('chunks:///_virtual/PrivacyConsentDialog.ts', {showPrivacyConsentDialog(name, actions) {
        dialog = actions; return noop;
    }});
    const picker = load('ChooseImageHelper.ts');
    let consent, opened = 0;
    wx.requirePrivacyAuthorize = o => { consent = o; };
    wx.chooseImage = o => { opened++; o.success({tempFilePaths: ['wxfile://image']}); };
    const selected = picker.chooseImagesUpTo();
    assert.equal(opened, 0);
    consent.success(); consent.success();
    assert.equal((await selected).ok, true); assert.equal(opened, 1);
    const refused = picker.chooseImagesUpTo();
    consent.fail({errno: 1026, errMsg: 'privacy denied'});
    assert.equal((await refused).ok, false); assert.equal(opened, 1);
    let listener; const events=[];
    wx.onNeedPrivacyAuthorization=fn=>{listener=fn;};
    wx.getPrivacySetting=o=>o.success({privacyContractName:'《隐私保护指引》'});
    wx.requirePrivacyAuthorize=o=>{
        consent=o;
        listener(res=>{events.push(res.event);if(res.event==='agree')o.success();if(res.event==='disagree')o.fail({errno:1026});});
    };
    const custom = picker.chooseImagesUpTo();
    assert.equal(opened,1); assert.equal(events.length,0);
    dialog.exposed(); assert.deepEqual(events,['exposureAuthorization']);
    dialog.agree(); assert.equal((await custom).ok,true); assert.equal(opened,2);
    const customRefused = picker.chooseImagesUpTo();
    dialog.exposed();dialog.disagree();assert.equal((await customRefused).ok,false);assert.equal(opened,2);
    assert.equal(helper.WECHAT_CLOUD_ENV, env);
    console.log('PASS built WeChat client: AppID, environment, mini-game file APIs without getImageInfo, image upload/review/cleanup, text verdicts and privacy consent');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
