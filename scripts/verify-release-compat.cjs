// node scripts/verify-release-compat.cjs
// Optional, after a user-created Cocos build: node scripts/verify-release-compat.cjs --check-build
// No build/deployment or writes to assets. Emulate the spread/for-of transforms observed in the WeChat bundle.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ts = require(process.env.KALIMBA_TYPESCRIPT || '/Applications/Cocos/Creator/3.8.6/CocosCreator.app/Contents/Resources/app.asar.unpacked/node_modules/typescript');
const babelRoot = process.env.KALIMBA_BABEL_ROOT || '/Applications/Cocos/Creator/3.8.6/CocosCreator.app/Contents/Resources/resources/3d/engine/node_modules';
const babel = require(path.join(babelRoot, '@babel/core'));
function compileSource(source) {
    const js = ts.transpileModule(source, {compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true,
    }}).outputText;
    return babel.transformSync(js, {babelrc: false, configFile: false, plugins: [
        [require(path.join(babelRoot, '@babel/plugin-transform-classes')), {loose: true}],
        [require(path.join(babelRoot, '@babel/plugin-transform-spread')), {loose: true}],
        [require(path.join(babelRoot, '@babel/plugin-transform-for-of')), {loose: true}],
    ]}).code;
}
function compileForWechat(relative) { return compileSource(fs.readFileSync(path.join(root, relative), 'utf8')); }
function evaluate(code, requireMock, extra = {}) {
    const exports = {};
    vm.runInNewContext(code, {exports, require: requireMock, console, setTimeout, clearTimeout, ...extra});
    return exports;
}
function load(relative, requireMock, extra) { return evaluate(compileForWechat(relative), requireMock, extra); }
const noop = () => {};
const debug = {kalimbaAudioLog: noop, kalimbaAudioWarn: noop};
function engineImports(id) { return id.endsWith('WeChatNative') ? {getWx: () => undefined} : debug; }
function Dummy() {}
Dummy.EventType = {CLICK: 'click'};
const cc = {
    cclegacy: {_RF: {push: noop, pop: noop}},
    Component: Dummy, Button: Dummy, AudioClip: Dummy, AudioSource: Dummy, Prefab: Dummy, Node: Dummy,
    _decorator: {ccclass: () => value => value, property: (...args) => typeof args[1] === 'string' ? undefined : noop},
    Enum: value => value, Game: {EVENT_HIDE: 'hide'}, game: {off: noop},
    isValid: value => !!value && value.isValid !== false && !value.destroying,
};
const emptyModule = new Proxy({}, {get: () => Dummy});

// The production build uses System.register and Babel helpers, rather than our TS emulation.
function loadBuilt(relative, imports, extra = {}) {
    const definitions = new Map(), cache = new Map();
    const context = vm.createContext({console, setTimeout, clearTimeout, ...extra, System: {register(name, deps, declare) {
        if (Array.isArray(name)) deps(noop, {}).execute();
        else definitions.set(name, {deps, declare});
    }}});
    for (const relativePath of ['assets/main/index.js', 'src/chunks/bundle.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, 'build/wechatgame', relativePath), 'utf8'), context);
    }
    function moduleFor(key) {
        if (cache.has(key)) return cache.get(key);
        const definition = definitions.get(key);
        assert.ok(definition, `missing built module ${key}`);
        const exports = {}; cache.set(key, exports);
        const module = definition.declare((name, value) => {
            if (typeof name === 'object') Object.assign(exports, name);
            else exports[name] = value;
            return value;
        });
        (module.setters || []).forEach((set, i) => {
            const dependency = definition.deps[i];
            set(dependency.includes('Helpers') || dependency.includes('decoratorHelper')
                ? moduleFor(`chunks:///_virtual/${path.basename(dependency)}`)
                : imports(dependency.replace(/\.ts$/, '')));
        });
        module.execute(); return exports;
    }
    return moduleFor(`chunks:///_virtual/${path.basename(relative)}`);
}

// Cocos CCObject._destruct clears object/function fields after onDestroy; it does not leave [] behind.
function completeCocosDestruction(component) {
    component.onDestroy?.();
    for (const key of Object.keys(component)) {
        if (typeof component[key] === 'object' || typeof component[key] === 'function') component[key] = null;
        else if (typeof component[key] === 'string') component[key] = '';
    }
    component.isValid = false;
}

function testVoiceLifecycle() {
    const relative = 'assets/scripts/manager/SynthKalimbaEngine.ts';
    const {SynthKalimbaEngine} = load(relative, engineImports);
    // Negative control: the published spread transform must fail to release an active voice.
    const oldCode = fs.readFileSync(path.join(root, relative), 'utf8')
        .replace('Array.from(this.activeVoices)', '[...this.activeVoices]')
        .replace('for (const v of Array.from(this.activeVoices))', 'for (const v of [...this.activeVoices])');
    const OldEngine = evaluate(compileSource(oldCode), engineImports).SynthKalimbaEngine;
    const broken = new OldEngine();
    broken.activeVoices.add({releaseGain: {gain: {setValueAtTime: noop, linearRampToValueAtTime: noop}},
        fundamentalOsc: {stop: noop}, overtoneOsc: {stop: noop}, transientOsc: {stop: noop}});
    broken.stopAll(); assert.equal(broken.getActiveVoiceCount(), 1, 'legacy spread must reproduce the unreleased voice');
    const empty = new SynthKalimbaEngine();
    empty.stopAll(); empty.dispose(); empty.dispose(); empty.stopAll();
    assert.equal(empty.ensureContext(), false, 'disposed engine cannot create a new context');
    const engine = new SynthKalimbaEngine();
    let stops = 0, ramps = 0, cueStops = 0, closed = 0;
    engine.audioContext = {currentTime: 1, state: 'running', close() { closed++; }};
    for (let i = 0; i < 3; i++) engine.activeVoices.add({
        releaseGain: {gain: {setValueAtTime: noop, linearRampToValueAtTime: () => ramps++}},
        fundamentalOsc: {stop: () => stops++}, overtoneOsc: {stop: () => stops++}, transientOsc: {stop: () => stops++},
    });
    engine.uiCueSources.add({stop: () => cueStops++, disconnect: noop});
    engine.stopAll(); engine.dispose(); engine.dispose(); engine.stopAll();
    assert.equal(stops, 9); assert.equal(ramps, 3); assert.equal(cueStops, 1); assert.equal(closed, 1);
    assert.equal(engine.getActiveVoiceCount(), 0); assert.equal(engine.uiCueSources.size, 0);
    console.log('PASS release-compatible audio: old failure reproduced, empty/active/repeated disposal');
}

function testShareEntry() {
    const storage = new Map();
    let onShow, first = 0, second = 0, later = 0, removeFirst;
    let initOptions;
    const cloudConfig = load('assets/scripts/manager/WeChatCloudFunction.ts', () => ({getWx: () => api}));
    const api = {cloud: {init: o => {initOptions=o;}}, getLaunchOptionsSync: () => ({query: {rid: 'cold-id'}}), onShow: fn => {onShow = fn;}};
    const launch = load('assets/scripts/manager/PerformanceShareLaunch.ts', id => {
        if (id === 'cc') return {sys: {localStorage: {setItem: (k,v) => storage.set(k,v), getItem: k => storage.get(k), removeItem: k => storage.delete(k)}}};
        if (id.endsWith('WeChatNative')) return {getWx: () => api};
        if (id.endsWith('WeChatCloudFunction')) return cloudConfig;
        return {ChallengeLaunchStore: {request: noop,take: noop}};
    });
    removeFirst = launch.onPendingGameLaunch(() => {first++; removeFirst(); launch.onPendingGameLaunch(() => later++);});
    launch.onPendingGameLaunch(() => {throw Error('one listener fails');});
    const removeSecond = launch.onPendingGameLaunch(() => second++);
    launch.installShareLaunchCapture();
    assert.equal(initOptions.env, 'cloud1-2gvremt83958d276');
    const appId = JSON.parse(fs.readFileSync(path.join(root,'project.config.json'),'utf8')).appid;
    assert.ok(/^wx[0-9a-f]{16}$/.test(appId), 'a registered WeChat AppID is required');
    assert.notEqual(appId, 'wx6ac3f5090a6b99c5', 'Cocos default test AppID cannot be used for cloud APIs or release');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,'build-templates/wechatgame/project.config.json'),'utf8')).appid,appId,
        'generated project must retain the same AppID as the opened root project');
    const profilePath = path.join(root, 'profiles/v2/packages/wechatgame.json');
    if (fs.existsSync(profilePath)) {
        const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8')).builder;
        assert.equal(profile.options.wechatgame.appid, appId, 'Cocos default AppID must match the root project');
        for (const [task, options] of Object.entries(profile.taskOptionsMap || {})) {
            assert.equal(options.appid, appId, `Cocos task ${task} must not override the project AppID`);
        }
    }
    assert.equal(first, 1); assert.equal(second, 1); assert.equal(later, 0, 'notify a snapshot, not new listeners');
    assert.equal(launch.takePendingSharedRecordId(), 'cold-id');
    onShow({query: {rid: 'warm-id'}});
    assert.equal(first, 1); assert.equal(second, 2); assert.equal(later, 1);
    assert.equal(launch.takePendingSharedRecordId(), 'warm-id');
    removeSecond(); onShow({query: {rid: 'again-id'}});
    assert.equal(second, 2); assert.equal(later, 2);
    console.log('PASS release-compatible share entry: cold/warm starts, unsubscribe and listener isolation');
}

function testMenuStop() {
    for (const immediate of [true, false]) {
        const {ProceduralMenuBgm: bgm} = load('assets/scripts/manager/ProceduralMenuBgm.ts', engineImports,
            {setTimeout: () => 1, clearTimeout: noop, clearInterval: noop});
        let stops = 0, disconnects = 0;
        bgm.context = {currentTime: 2, state: 'running'};
        bgm.master = {gain: {cancelScheduledValues: noop, setValueAtTime: noop, setTargetAtTime: noop}};
        for (let i = 0; i < 4; i++) bgm.sources.add({stop: () => stops++, disconnect: () => disconnects++});
        bgm.stop(immediate);
        assert.equal(stops, 4);
        if (immediate) {assert.equal(disconnects, 4); assert.equal(bgm.sources.size, 0);}
    }
    console.log('PASS release-compatible BGM: all scheduled oscillators stop on share entry');
}

async function testComponents(loadModule = load) {
    const {AudioManager} = loadModule('assets/scripts/manager/AudioManager.ts', id => id === 'cc' ? cc : emptyModule);
    const manager = new AudioManager();
    let finishResume, disposed = 0, stopped = 0;
    manager.synthEngine = {isSupported: () => true, isRunning: () => true,
        resume: () => new Promise(resolve => {finishResume = resolve;}), dispose: () => disposed++, stopAll: noop};
    manager.audioSource = {isValid: false, stop() {throw Error('destroyed source touched');}};
    manager.audioSources = [{destroying: true, stop() {throw Error('destroying source touched');}}, {stop: () => stopped++}];
    manager.stopAllSounds(); assert.equal(stopped, 1);
    const ready = manager.resumeWebAudio();
    manager.onDestroy(); manager.onDestroy(); finishResume();
    assert.equal(await ready, false); assert.equal(disposed, 1);
    manager.stopAllSounds(); manager.playKeySound(8);
    completeCocosDestruction(manager);
    assert.equal(manager.audioSources, null);
    manager.stopAllSounds(); manager.playKeySound(8); manager.setVolume(0.8);
    assert.equal(manager.getAvailableAudioSource(), null);
    manager.onDestroy(); assert.equal(disposed, 1);

    let playbackStops = 0;
    const {GameScene} = loadModule('assets/scripts/view/GameScene.ts', id => {
        if (id === 'cc') return cc;
        if (id.endsWith('PerformancePlayer')) return {PerformancePlayer: {stop: () => playbackStops++}};
        if (id.endsWith('PerformanceRecorder')) return {PerformanceRecorder: {stop: noop}};
        if (id.endsWith('KalimbaKey')) return {KalimbaKey: {setGuidanceKey: noop}};
        return emptyModule;
    });
    const scene = new GameScene();
    const a = {isValid: true, active: true}, b = {isValid: true, active: false};
    scene.backButton = {node: a}; scene.settingsButton = {node: b};
    scene.drawImmersiveButton = noop;
    scene.toggleImmersiveMode(); assert.equal(a.active, false);
    scene.toggleImmersiveMode(); assert.equal(a.active, true); assert.equal(b.active, false);
    scene.setChallengeChromeHidden(true); assert.equal(a.active, false);
    scene.setChallengeChromeHidden(false); assert.equal(a.active, true); assert.equal(b.active, false);
    scene.backButton = null; scene.settingsButton = null;
    scene.setPlaybackLock = () => {throw Error('restored UI during destruction');};
    scene.setChallengeChromeHidden = () => {throw Error('restored UI during destruction');};
    scene.sheetMusicBackground = {isValid: false, setAutoScrollRunning() {throw Error('destroyed sheet touched');}};
    scene.fallingNoteStage = {destroying: true, stop() {throw Error('destroying stage touched');}};
    scene.audioManager = manager;
    scene.challengeSession = {isValid: false, stop() {throw Error('destroyed challenge touched');}};
    scene.onDestroy(); assert.equal(playbackStops, 1);

    // Both destruction orders must finish, and a new scene must remain playable afterwards.
    for (const audioFirst of [true, false]) {
        for (let iteration = 0; iteration < 3; iteration++) {
            const audio = new AudioManager(), view = new GameScene();
            let notes = 0, releases = 0, lateNote;
            audio.keySounds = [{}];
            audio.audioSource = {isValid: true, playing: false, stop: noop, playOneShot: () => {throw Error('late fallback played');}};
            audio.synthEngine = {isSupported: () => true, setParams: noop, stopAll: noop,
                dispose: () => releases++, playKeyInUserGesture: (_key, _gain, complete) => {notes++; lateNote = complete;}};
            view.audioManager = audio;
            AudioManager.instance = audio;
            assert.equal(AudioManager.getInstance(), audio);
            audio.destroying = true; assert.equal(AudioManager.getInstance(), null);
            audio.destroying = false;
            audio.playKeySound(8); audio.playKeySound(9); audio.playKeySound(10);
            assert.equal(notes, 3);
            if (audioFirst) {
                completeCocosDestruction(audio);
                // The caller must not touch even a destroyed component with an unsafe method.
                audio.stopAllSounds = () => {throw Error('destroyed audio manager touched');};
                view.onDestroy();
            } else {
                view.onDestroy(); completeCocosDestruction(audio);
            }
            lateNote(false); assert.equal(releases, 1, 'one engine disposal per scene');
            assert.equal(AudioManager.getInstance(), null, 'new keys cannot retain the old scene singleton');
        }
    }

    const {HomeScene} = loadModule('assets/scripts/view/HomeScene.ts', id => {
        if (id === 'cc') return cc;
        if (id.endsWith('LevelProgressStore')) return {LevelProgressStore: {getLocallyUnlockedLevelIds: () => ['c1-01', 'c1-02']}};
        if (id.endsWith('AchievementCloudService')) return {AchievementCloudService: {getStats: async () => ({unlockedLevelIds: ['c1-02', 'c1-03']})}};
        return emptyModule;
    });
    const home = new HomeScene(), opened = [];
    home.node = {isValid: true}; home.levelSelectOverlay = {open: ids => opened.push(Array.from(ids)), isOpen: () => true};
    await home.openLevelSelect();
    assert.deepEqual(opened[1], ['c1-01', 'c1-02', 'c1-03']);
    console.log('PASS components: resume/dispose race, Cocos field clearing, both teardown orders, late note callback, repeated scenes, UI restoration, progress merge');
}

async function checkExistingBuild() {
    const filename = path.join(root, 'build/wechatgame/assets/main/index.js');
    const code = fs.readFileSync(filename, 'utf8').split('\n')
        .find(line => line.startsWith('System.register("chunks:///_virtual/SynthKalimbaEngine.ts"'));
    assert.ok(code, 'SynthKalimbaEngine module must exist in build');
    const exports = {};
    vm.runInNewContext(code, {console, System: {register(id, deps, declare) {
        const mod = declare((name, value) => (exports[name] = value));
        mod.setters.forEach((set, i) => set(deps[i].includes('Helpers') ? {extends: Object.assign, asyncToGenerator: fn => fn}
            : deps[i] === 'cc' ? {cclegacy: {_RF: {push: noop, pop: noop}}} : engineImports(deps[i].replace(/\.ts$/, ''))));
        mod.execute();
    }}});
    const engine = new exports.SynthKalimbaEngine();
    engine.stopAll(); engine.dispose(); engine.dispose();
    console.log('PASS existing WeChat build: empty-engine cleanup');
    await testComponents(loadBuilt);
    console.log('PASS existing WeChat build: real compiled audio and scene lifecycle regression');
}
async function testReleaseCompatibility() {
    testVoiceLifecycle(); testShareEntry(); testMenuStop(); await testComponents();
}
module.exports = {compileForWechat, compileSource, loadSource: load, loadBuilt, completeCocosDestruction, testReleaseCompatibility};
if (require.main === module) {
    testReleaseCompatibility().then(async () => {if (process.argv.includes('--check-build')) await checkExistingBuild();})
        .catch(error => {console.error(error.stack); process.exitCode = 1;});
}
