// Deterministic interruption/race tests, also runnable against the real WeChat bundle.
// node scripts/verify-playback-lifecycle.cjs [--check-build]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {loadSource, loadBuilt, compileSource, completeCocosDestruction} = require('./verify-release-compat.cjs');
const noop = () => {};
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const tick = () => new Promise(resolve => setImmediate(resolve));
function Dummy() {}
Dummy.EventType = {TOUCH_START: 'touch-start', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel'};
const cc = new Proxy({Component: Dummy, cclegacy: {_RF: {push: noop, pop: noop}},
    isValid: value => !!value && value.isValid !== false && !value.destroying,
    _decorator: {ccclass: () => value => value, property: (...args) => typeof args[1] === 'string' ? undefined : noop}},
    {get: (object, key) => object[key] ?? Dummy});
const empty = new Proxy({}, {get: () => Dummy});
const synthImports = id => id === 'cc' ? cc : id.endsWith('WeChatNative')
    ? {getWx: noop} : {kalimbaAudioLog: noop, kalimbaAudioWarn: noop};
const level = {id: 'c1-01', bpm: 80, notes: [{beat: 0, key: 8}]};
function components(load) {
    let savedEnabled = false;
    const store = {defaultSnapshot: () => ({bpm: 80, beatsPerBar: 4, subdivision: 4}),
        save: value => {if ('enabled' in value) savedEnabled = value.enabled; return value;}};
    const key = {addPlayListener: noop, removePlayListener: noop, setGuidanceKey: noop};
    const {ChallengeSession} = load('assets/scripts/gameplay/ChallengeSession.ts', id => id === 'cc' ? cc
        : id.endsWith('KalimbaKey') ? {KalimbaKey: key} : empty);
    const {MetronomeController} = load('assets/scripts/manager/MetronomeController.ts', id => id === 'cc' ? cc
        : id.endsWith('MetronomeSettingsStore') ? {MetronomeSettingsStore: store} : empty);
    return {ChallengeSession, MetronomeController, enabled: () => savedEnabled};
}
function fakeAudio(wake) {
    return {isValid: true, resumeWebAudio: () => wake.promise, getAudioCurrentTime: () => 2,
        scheduleMetronomeTick: noop};
}

async function checkRaces(load, check) {
    const {ChallengeSession, MetronomeController, enabled} = components(load);
    for (const cancel of ['stop', 'disable', 'destroy']) {
        await check(`challenge pending start then ${cancel}`, async () => {
            const wake = deferred(), session = new ChallengeSession();
            session.audioManager = fakeAudio(wake);
            const pending = session.begin(level);
            if (cancel === 'stop') session.stop();
            else if (cancel === 'disable') session.onDisable?.();
            else completeCocosDestruction(session);
            wake.resolve(true);
            assert.equal(await pending, false, 'cancelled challenge must not start or throw');
            assert.equal(session.isActive(), false);
        });
        await check(`metronome pending start then ${cancel}`, async () => {
            const wake = deferred(), controller = new MetronomeController();
            controller.audioManager = fakeAudio(wake);
            const pending = controller.startMetronome();
            if (cancel === 'stop') controller.stopMetronome();
            else if (cancel === 'disable') controller.onDisable();
            else completeCocosDestruction(controller);
            wake.resolve(true);
            assert.equal(await pending, false, 'cancelled metronome must not start or throw');
            assert.equal(controller.isRunning(), false);
            assert.equal(enabled(), false, 'cancelled start cannot save enabled=true');
        });
    }
    await check('latest challenge wins when older wake arrives last', async () => {
        const first = deferred(), second = deferred(), session = new ChallengeSession();
        let calls = 0;
        session.audioManager = {...fakeAudio(first), resumeWebAudio: () => (++calls === 1 ? first : second).promise};
        const old = session.begin(level), next = session.begin({...level, id: 'c1-02'});
        second.resolve(true); assert.equal(await next, true);
        first.resolve(true); assert.equal(await old, false);
        assert.equal(session.level.id, 'c1-02');
    });
    await check('second metronome toggle cancels a pending first toggle', async () => {
        const wake = deferred(), controller = new MetronomeController();
        controller.audioManager = fakeAudio(wake);
        const first = controller.toggle(), second = controller.toggle();
        wake.resolve(true);
        assert.equal(await first, false); assert.equal(await second, false);
        assert.equal(controller.isRunning(), false);
    });
    await check('metronome skips hours of missed beats without scheduling a burst', async () => {
        const controller = new MetronomeController(); let now = 2, ticks = 0;
        controller.audioManager = {isValid: true, resumeWebAudio: async () => true, getAudioCurrentTime: () => now,
            scheduleMetronomeTick: () => {ticks++; if (ticks > 32) throw Error('unbounded missed-beat loop');}};
        assert.equal(await controller.startMetronome(), true);
        now = 7200; controller.update(); assert.ok(ticks <= 2);
        controller.lookAheadSec = Infinity; controller.update(); assert.ok(ticks <= 32);
        controller.stopMetronome();
    });
    await check('stopped synthesizer cannot emit a note after delayed resume', async () => {
        const {SynthKalimbaEngine} = load('assets/scripts/manager/SynthKalimbaEngine.ts', synthImports);
        const wake = deferred(), engine = new SynthKalimbaEngine();
        const context = {state: 'suspended', resume: () => wake.promise};
        engine.audioContext = context; engine.ensureContext = () => true;
        let notes = 0;
        engine.playKey = () => {notes++; return true;};
        engine.playKeyInUserGesture(8); engine.stopAll(); context.state = 'running'; wake.resolve();
        await wake.promise; await tick();
        assert.equal(notes, 0, 'stopAll must invalidate notes waiting for resume');
        engine.playKeyInUserGesture(9); assert.equal(notes, 1, 'new user gesture still works');
    });
    await check('audio manager cannot fall back after an explicit stop', async () => {
        const {AudioManager} = load('assets/scripts/manager/AudioManager.ts', id => id === 'cc' ? cc : empty);
        const manager = new AudioManager(); let complete, fallback = 0;
        manager.synthEngine = {isSupported: () => true, setParams: noop, stopAll: noop,
            playKeyInUserGesture: (_key, _gain, done) => {complete = done;}};
        manager.keySounds = [{name: 'test'}];
        manager.audioSource = {playing: false, playOneShot: () => fallback++, stop: noop};
        manager.playKeySound(0); manager.stopAllSounds(); complete(false);
        assert.equal(fallback, 0, 'late failure cannot restart stopped audio via a fallback clip');
    });
    await check('one invalid voice cannot interrupt audio disposal', async () => {
        const {SynthKalimbaEngine} = load('assets/scripts/manager/SynthKalimbaEngine.ts', synthImports);
        const engine = new SynthKalimbaEngine(); let closed = 0, stopped = 0;
        engine.audioContext = {currentTime: 2, close: () => closed++};
        for (const broken of [true, false]) engine.activeVoices.add({
            releaseGain: {gain: {setValueAtTime: () => {if (broken) throw Error('audio node already invalid');}, linearRampToValueAtTime: noop}},
            fundamentalOsc: {stop: () => stopped++}, overtoneOsc: {stop: () => stopped++}, transientOsc: {stop: () => stopped++},
        });
        engine.dispose(); engine.dispose();
        assert.equal(stopped, 6); assert.equal(closed, 1); assert.equal(engine.activeVoices.size, 0);
    });
    await check('audio wake has a bounded deadline and late success cannot revive it', async () => {
        const timers = new Map(); let next = 0;
        const {AudioManager} = load('assets/scripts/manager/AudioManager.ts', id => id === 'cc' ? cc : empty,
            {setTimeout: callback => {timers.set(++next, callback); return next;}, clearTimeout: id => timers.delete(id)});
        const wake = deferred(), manager = new AudioManager();
        manager.synthEngine = {isSupported: () => true, isRunning: () => true, resume: () => wake.promise};
        const pending = manager.resumeWebAudio();
        assert.equal(timers.size, 1, 'wake deadline must be installed before waiting');
        const expire = [...timers.values()][0]; expire();
        assert.equal(await pending, false); assert.equal(timers.size, 0);
        wake.resolve(); await tick();
    });
    await check('old key cleanup cannot remove or play through keys from a new scene', async () => {
        let played = 0;
        const {KalimbaKey} = load('assets/scripts/KalimbaKey.ts', id => id === 'cc' ? cc
            : id.endsWith('AudioManager') ? {AudioManager: {getInstance: () => ({playKeySound: () => played++})}}
            : id.endsWith('PerformanceRecorder') ? {PerformanceRecorder: {recordKey: noop}}
            : {vibrateKeyTap: noop});
        const old = new KalimbaKey(), fresh = new KalimbaKey();
        old.keyIndex = fresh.keyIndex = 8; old.node = {off: noop};
        KalimbaKey.keyRegistry.set(8, fresh); old.onDestroy();
        assert.equal(KalimbaKey.getByIndex(8), fresh);
        old.onTouchStart({getUILocation: () => ({x: 1, y: 1})}); assert.equal(played, 0);
        fresh.onTouchStart({getUILocation: () => ({x: 1, y: 1})}); assert.equal(played, 1);
        fresh.isValid = false; assert.equal(KalimbaKey.getByIndex(8), null);
        KalimbaKey.setGuidanceKey(8);
    });
    for (const cancel of ['new share', 'disable', 'destroy']) await check(`page ignores delayed challenge result after ${cancel}`, async () => {
        const wake = deferred(); let writes = 0;
        const {GameScene} = load('assets/scripts/view/GameScene.ts', id => id === 'cc' ? {...cc, game: {off: noop}, Game: {EVENT_HIDE: 'hide'}}
            : id.endsWith('LevelCatalog') ? {getLevelById: () => level}
            : id.endsWith('PerformancePlayer') ? {PerformancePlayer: {stop: noop}}
            : id.endsWith('PerformanceRecorder') ? {PerformanceRecorder: {stop: noop}}
            : id.endsWith('KalimbaKey') ? {KalimbaKey: {setGuidanceKey: noop}}
            : id.endsWith('SimpleToast') ? {showToast: () => writes++} : empty);
        const scene = new GameScene();
        scene.activeChallengeLevelId = level.id;
        scene.challengeSession = {stop: noop, begin: () => wake.promise, getStartedAtSec: () => 1};
        scene.fallingNoteStage = {showError: () => writes++, startLevel: () => writes++, stop: noop};
        const pending = scene.beginPreparedChallenge(level.id);
        if (cancel === 'new share') {scene.activeChallengeLevelId = null; scene.sharedPlaybackLaunch = true;}
        else if (cancel === 'disable') scene.onDisable();
        else completeCocosDestruction(scene);
        wake.resolve(false); await pending;
        assert.equal(writes, 0, 'old await cannot paint an error or restart a replaced page');
    });
}

// Execute Cocos 3.8.6's actual CCObject destruction/queue code, without renderer or native audio.
function engineCore() {
    const legacyCC = {Node: Dummy, Component: Dummy};
    const codes = [];
    const exports = {};
    const code = compileSource(fs.readFileSync('/Applications/Cocos/Creator/3.8.6/CocosCreator.app/Contents/Resources/resources/3d/engine/cocos/core/data/object.ts', 'utf8'));
    vm.runInNewContext(code, {exports, console, setTimeout, require: id => {
        if (id === 'internal:constants') return {SUPPORT_JIT: false, EDITOR: false, TEST: false, JSB: false, EDITOR_NOT_IN_PREVIEW: false};
        if (id.endsWith('/js')) return {value: (object, key, value) => Object.defineProperty(object, key, {value, configurable: true}), copyAllProperties: noop};
        if (id.endsWith('/class')) return {CCClass: {_isCCClass: () => false, fastDefine: noop}};
        if (id.endsWith('/debug')) return {errorID: code => codes.push(code), warnID: code => codes.push(code)};
        if (id.endsWith('/global-exports')) return {legacyCC};
        return {editorExtrasTag: Symbol('editorExtras')};
    }});
    const ObjectBase = exports.CCObject;
    function Component() {ObjectBase.call(this);}
    Component.prototype = Object.create(ObjectBase.prototype); Component.prototype.constructor = Component;
    Component.prototype._onPreDestroy = function () {this.onDisable?.(); this.onDestroy?.();};
    legacyCC.Component = Component;
    return {ObjectBase, Component, isValid: exports.isValid, codes};
}
async function checkEngineQueue(load, check) {
    await check('200 scene teardowns drain the actual Cocos destruction queue', async () => {
        const core = engineCore();
        const engineCC = {...cc, Component: core.Component, isValid: core.isValid,
            Enum: value => value, Button: Dummy, Node: Dummy,
            cclegacy: {_RF: {push: noop, pop: noop}}, game: {off: noop}, Game: {EVENT_HIDE: 'hide'}};
        const {AudioManager} = load('assets/scripts/manager/AudioManager.ts', id => id === 'cc' ? engineCC : empty);
        const {SynthKalimbaEngine} = load('assets/scripts/manager/SynthKalimbaEngine.ts', synthImports);
        const {GameScene} = load('assets/scripts/view/GameScene.ts', id => id === 'cc' ? engineCC
            : id.endsWith('PerformancePlayer') ? {PerformancePlayer: {stop: noop}}
            : id.endsWith('PerformanceRecorder') ? {PerformanceRecorder: {stop: noop}}
            : id.endsWith('KalimbaKey') ? {KalimbaKey: {setGuidanceKey: noop}} : empty, {console: {log: noop, warn: console.warn, error: console.error}});
        let disposals = 0, sentinelCount = 0;
        for (let i = 0; i < 200; i++) {
            const audio = new AudioManager(), scene = new GameScene();
            const engine = new SynthKalimbaEngine();
            engine.audioContext = {currentTime: 2, close: () => disposals++};
            engine.activeVoices.add({releaseGain: {gain: {setValueAtTime: () => {throw Error('invalid host audio node');}}},
                fundamentalOsc: {stop: noop}, overtoneOsc: {stop: noop}, transientOsc: {stop: noop}});
            audio.synthEngine = engine; scene.audioManager = audio;
            if (i % 3 === 0) {audio.destroy(); core.ObjectBase._deferredDestroy(); scene.destroy();}
            else if (i % 3 === 1) {scene.destroy(); core.ObjectBase._deferredDestroy(); audio.destroy();}
            else {audio.destroy(); scene.destroy();}
            const sentinel = new core.Component(); sentinel.onDestroy = () => sentinelCount++; sentinel.destroy();
            core.ObjectBase._deferredDestroy();
            assert.equal(audio.isValid, false); assert.equal(scene.isValid, false);
            assert.equal(audio.audioSources, null, 'real engine cleared audio references');
            audio.stopAllSounds();
            scene.onDestroy(); scene.onDisable(); scene.onBackButtonClick(); scene.openSettingsScene();
            core.ObjectBase._deferredDestroy();
        }
        assert.equal(disposals, 200); assert.equal(sentinelCount, 200);
        assert.deepEqual(core.codes, [], 'no repeated destruction warning/error 5000');
    });
}

(async () => {
    let failures = 0;
    const load = process.argv.includes('--check-build') ? loadBuilt : loadSource;
    const check = async (name, test) => {try {await test(); console.log('PASS', name);} catch (error) {failures++; console.error('FAIL', name, error.message);}};
    await checkRaces(load, check); await checkEngineQueue(load, check);
    if (failures) {console.error(`${failures} lifecycle checks failed`); process.exitCode = 1;}
})().catch(error => {console.error(error); process.exitCode = 1;});
