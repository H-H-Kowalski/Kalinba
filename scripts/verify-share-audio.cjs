// Run: node scripts/verify-share-audio.cjs
// Offline WebAudio renders are QA outputs only; no audio files are added to assets.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const {compileForWechat: compile, testReleaseCompatibility} = require('./verify-release-compat.cjs');
function moduleFor(relative, requireMock, extra = {}) {
    const exports = {};
    vm.runInNewContext(compile(relative), { exports, require: requireMock, console, setTimeout, clearTimeout, ...extra });
    return exports;
}
async function testShare() {
    let api;
    const native = { getWx: () => api };
    const helper = moduleFor('assets/scripts/manager/WeChatCloudFunction.ts', () => native);
    const types = moduleFor('assets/scripts/manager/PerformanceTypes.ts');
    const recorder = moduleFor('assets/scripts/manager/PerformanceRecorder.ts', () => types);
    const safety = moduleFor('assets/scripts/manager/ContentSecurityService.ts', id => id.endsWith('WeChatNative') ? native : helper);
    const service = moduleFor('assets/scripts/manager/PerformanceCloudService.ts', id => {
        if (id.endsWith('WeChatCloudFunction')) return helper;
        if (id.endsWith('PerformanceRecorder')) return recorder;
        if (id.endsWith('ContentSecurityService')) return safety;
        return types;
    }).PerformanceCloudService;
    const record = { title: '生日快乐', durationMs: 1000, stylePreset: 4, events: [{ t: 0, k: 8 }], appVersion: '1.0.0' };
    for (const mode of ['void', 'null', 'promise', 'both']) {
        let calls = 0;
        api = { cloud: { callFunction(options) {
            assert.equal(this, api.cloud);
            calls++;
            const response = { result: options.name === 'getPerformanceRecord'
                ? { record, contentSecurityVersion: 1 } : { recordId: 'test-id', contentSecurityVersion: 1 } };
            if (mode !== 'promise') setTimeout(() => options.success(response), 1);
            if (mode === 'promise' || mode === 'both') return Promise.resolve(response);
            return mode === 'null' ? null : undefined;
        } } };
        assert.equal(await service.createRecord(record), 'test-id');
        assert.equal((await service.getRecord('test-id')).stylePreset, 4);
        assert.equal(calls, 2, 'must not retry writes');
        console.log('PASS share create/read:', mode);
    }
    api.cloud.callFunction = options => { setTimeout(() => options.fail({ errMsg: 'test failure', errCode: 123 }), 1); };
    await assert.rejects(service.getRecord('test-id'), /getPerformanceRecord: test failure/);
    api.cloud.callFunction = options => { setTimeout(() => options.success({result: {record: {...record, events: [{t: 0, k: 99}]}}}), 1); };
    await assert.rejects(service.getRecord('test-id'), /note key invalid/);
    let scheduled = [], failures = 0;
    const player = moduleFor('assets/scripts/manager/PerformancePlayer.ts', id => {
        if (id.endsWith('PerformanceRecorder')) return recorder;
        if (id.endsWith('AudioManager')) return { AudioManager: { getInstance: () => ({playKeySound() {throw Error('test note failure');}}) } };
        return { KalimbaKey: {getByIndex: () => undefined} };
    }, { setTimeout: fn => (scheduled.push(fn), scheduled.length), clearTimeout: () => {} }).PerformancePlayer;
    assert.equal(player.play(record, undefined, () => failures++), true);
    scheduled[0]();
    assert.equal(failures, 1);
    assert.equal(player.isPlaying(), false);
    console.log('PASS share: cloud errors, invalid data and asynchronous playback errors');
}
function wav(data, sampleRate) {
    const b = Buffer.alloc(44 + data.length * 2);
    b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
    b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length * 2, 40);
    data.forEach((v, i) => b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), 44 + 2 * i));
    return b;
}
async function testAudio() {
    const { SynthKalimbaEngine } = moduleFor('assets/scripts/manager/SynthKalimbaEngine.ts', id => id.endsWith('WeChatNative')
        ? {getWx: () => undefined} : {kalimbaAudioLog() {}, kalimbaAudioWarn() {}});
    for (const mode of ['void', 'null', 'promise', 'thenable']) {
        const synth = new SynthKalimbaEngine();
        const ctx = {state: 'suspended', resume() {
            ctx.state = 'running';
            if (mode === 'promise') return Promise.resolve();
            if (mode === 'thenable') return {then(done) {done();}};
            return mode === 'null' ? null : undefined;
        }};
        synth.audioContext = ctx;
        synth.ensureContext = () => true;
        let played = 0;
        synth.playKey = () => (++played, true);
        const ok = await new Promise(resolve => synth.playKeyInUserGesture(8, 1, resolve));
        assert.equal(ok, true); assert.equal(played, 1);
        ctx.state = 'suspended';
        await synth.resume(); assert.equal(synth.isRunning(), true);
        console.log('PASS audio resume:', mode);
    }
    const { chromium } = require(process.env.KALIMBA_PLAYWRIGHT || '/Users/haokunhu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    try {
        const page = await browser.newPage();
        const engine = compile('assets/scripts/manager/SynthKalimbaEngine.ts');
        const managerSource = fs.readFileSync(path.join(root, 'assets/scripts/manager/AudioManager.ts'), 'utf8');
        const manager = managerSource.slice(managerSource.indexOf('applySynthParams() {'));
        const presets = ['BRIGHT', 'POP', 'DEEP', 'CRISP', 'AMBIENT'].map(name => {
            const found = manager.match(new RegExp('case SynthStylePreset\\.' + name + ':[\\s\\S]*?p = (\\{[\\s\\S]*?\\});'));
            assert.ok(found, name);
            return { name, params: vm.runInNewContext('(' + found[1] + ')') };
        });
        const results = await page.evaluate(async ({engine, presets}) => {
            const results = [];
            for (const variant of ['previous-dsp', 'updated', 'updated-no-compressor', 'updated-48k', 'updated-all-keys']) for (const preset of presets) {
                const sampleRate = variant === 'updated-48k' ? 48000 : 44100;
                const ctx = new OfflineAudioContext(1, sampleRate * 9, sampleRate);
                if (variant === 'updated-no-compressor') ctx.createDynamicsCompressor = undefined;
                let scheduledTime = 0;
                Object.defineProperty(ctx, 'currentTime', {get: () => scheduledTime});
                Object.defineProperty(ctx, 'state', {get: () => 'running'});
                if (variant === 'previous-dsp') {
                    const create = ctx.createBiquadFilter.bind(ctx);
                    ctx.createBiquadFilter = () => {
                        const node = create();
                        const set = node.Q.setValueAtTime.bind(node.Q);
                        node.Q.setValueAtTime = (v, t) => set(v === Math.SQRT1_2 ? 1 : v, t);
                        return node;
                    };
                }
                const exports = {};
                new Function('exports', 'require', engine)(exports, id => id.endsWith('WeChatNative')
                    ? { getWx: () => ({createWebAudioContext: () => ctx}) }
                    : {kalimbaAudioLog() {}, kalimbaAudioWarn() {}});
                const synth = new exports.SynthKalimbaEngine();
                synth.setParams(preset.params); synth.ensureContext(); synth.setVolume(1.15);
                if (variant === 'previous-dsp') {
                    synth.limiterInput.gain.value = 1;
                    const curve = new Float32Array(2048);
                    for (let i = 0; i < curve.length; i++) {
                        const x = i * 2 / (curve.length - 1) - 1, a = Math.abs(x);
                        curve[i] = a <= .76 ? x : Math.sign(x) * (.76 + .19 * Math.tanh((a - .76) / .19));
                    }
                    synth.softLimiter.curve = curve;
                    synth.stopVoice = voice => {
                        voice.releaseGain.gain.setValueAtTime(0, scheduledTime);
                        voice.fundamentalOsc.stop(scheduledTime);
                        synth.activeVoices.delete(voice);
                    };
                }
                assertValid(synth.playKey(NaN) === false, 'NaN key');
                assertValid(synth.playKalimbaNote(261.63, NaN) === false, 'NaN velocity');
                function assertValid(ok, message) { if (!ok) throw Error(message); }
                // C4 solo, C4/E4 double stop, then repeated bass to force voice stealing.
                const notes = [[0,8], [2,8], [2,9]];
                for (let i = 0; i < 20; i++) notes.push([4 + i * .065, i % 2 ? 7 : 8]);
                if (variant === 'updated-all-keys') {
                    notes.length = 0;
                    for (let key = 0; key < 17; key++) notes.push([key * .28, key]);
                }
                for (const [time, key] of notes) { scheduledTime = time; assertValid(synth.playKey(key), 'play key'); }
                scheduledTime = 5.6; synth.stopAll();
                const buffer = await ctx.startRendering();
                const data = buffer.getChannelData(0);
                let peak = 0, sum = 0, maxStep = 0;
                for (let i = 0; i < data.length; i++) {
                    assertValid(Number.isFinite(data[i]), 'nonfinite audio sample');
                    peak = Math.max(peak, Math.abs(data[i])); sum += data[i] * data[i];
                    if (i > sampleRate * 4) maxStep = Math.max(maxStep, Math.abs(data[i] - data[i-1]));
                }
                assertValid(peak <= .951, 'output exceeds ceiling');
                assertValid(peak > .1, 'silent render');
                if (variant !== 'previous-dsp') {
                    let closed = 0;
                    ctx.close = () => { closed++; };
                    synth.dispose();
                    assertValid(closed === 1 && synth.audioContext === null && synth.masterGain === null, 'context cleanup');
                }
                results.push({variant, preset: preset.name, peak, rms: Math.sqrt(sum / data.length), maxStep,
                    data: Array.from(data), sampleRate});
            }
            return results;
        }, {engine, presets});
        const out = path.join(root, 'output/audio-review-s2'); fs.mkdirSync(out, {recursive:true});
        for (const row of results) {
            fs.writeFileSync(path.join(out, `${row.preset.toLowerCase()}-${row.variant}.wav`), wav(row.data, row.sampleRate));
            delete row.data;
        }
        fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(results, null, 2));
        console.table(results);
    } finally { await browser.close(); }
}
(async () => { await testReleaseCompatibility(); await testShare(); if (!process.argv.includes('--share-only')) await testAudio(); })()
    .catch(e => {console.error(e); process.exitCode = 1;});
