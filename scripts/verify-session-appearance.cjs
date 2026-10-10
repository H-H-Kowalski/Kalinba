// Run real transpiled modules with deterministic timers and explicit UI/cloud boundaries.
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {compileForWechat} = require('./verify-release-compat.cjs');
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function load(file, imports, extra={}) {
    if(!process.argv[2]) {
        const exports={};vm.runInNewContext(compileForWechat(file),{exports,require:imports,console,setTimeout,clearTimeout,...extra});return exports;
    }
    const definitions=new Map(),cache=new Map();
    const context=vm.createContext({console,setTimeout,clearTimeout,...extra,System:{register(name,deps,declare){
        if(Array.isArray(name)) deps(noop,{}).execute();else definitions.set(name,{deps,declare});
    }}});
    const build=path.resolve(process.argv[2]);
    for(const relative of ['assets/main/index.js','src/chunks/bundle.js']) vm.runInContext(fs.readFileSync(path.join(build,relative),'utf8'),context);
    function built(key) {
        if(cache.has(key))return cache.get(key);
        const def=definitions.get(key);assert.ok(def,`missing built module ${key}`);
        const result={};cache.set(key,result);
        const mod=def.declare((name,value)=>{if(typeof name==='object')Object.assign(result,name);else result[name]=value;return value;});
        (mod.setters||[]).forEach((set,i)=>{
            const dep=def.deps[i];
            set(dep === 'cc' ? cc : dep.includes('Helpers') || dep.includes('decoratorHelper') ? built(`chunks:///_virtual/${path.basename(dep)}`) : imports(dep.replace(/\.ts$/,'')));
        });mod.execute();return result;
    }
    return built(`chunks:///_virtual/${path.basename(file)}`);
}

let now=0, next=0; const pending=new Map();
const clock={Date:{now:()=>now},setTimeout:(fn,ms)=>{pending.set(++next,{fn,at:now+ms});return next;},clearTimeout:id=>pending.delete(id)};
function advance(ms) {
    now+=ms;
    for(const [id,t] of [...pending].sort((a,b)=>a[1].at-b[1].at)) if(t.at<=now && pending.delete(id)) t.fn();
}
function Component(){this.isValid=true;this.node={isValid:true};this.scheduleOnce=noop;}
function Dummy(){this.isValid=true;this.enabled=true;}
const cc=new Proxy({cclegacy:{_RF:{push:noop,pop:noop}},Component,isValid:x=>!!x&&x.isValid!==false&&!x.destroying,
    _decorator:{ccclass:()=>x=>x,property:(...a)=>typeof a[1]==='string'?undefined:noop}}, {get:(o,k)=>o[k]??Dummy});
const empty=new Proxy({}, {get:()=>Dummy});
const types=load('assets/scripts/manager/PerformanceTypes.ts',()=>empty);
const recorder=load('assets/scripts/manager/PerformanceRecorder.ts',()=>types);
let failNote=false, played=0;
const am={playKeySound(){if(failNote)throw Error('simulated audio failure');played++;},resumeWebAudio:async()=>true,setSynthStylePreset:noop,stopAllSounds:noop};
const audio={AudioManager:{getInstance:()=>am}};
const player=load('assets/scripts/manager/PerformancePlayer.ts', id=>id.endsWith('PerformanceRecorder')?recorder:id.endsWith('AudioManager')?audio:{KalimbaKey:{getByIndex:noop}},clock).PerformancePlayer;
const record={title:'好友歌曲',durationMs:180000,stylePreset:1,events:[{t:0,k:8},{t:100,k:9}]};
async function main(){
    let done=0,errors=0;
    assert.equal(player.play(record,()=>done++,()=>errors++),true);
    advance(1599);assert.equal(done,0);advance(1);assert.equal(done,1);
    assert.equal(player.isPlaying(),false);assert.equal(played,2);assert.equal(pending.size,0);
    // A cancelled timer already queued by the platform must not end a new playback.
    player.play(record,()=>done++);const stale=[...pending.values()].map(x=>x.fn);player.stop();
    player.play(record,()=>done++);stale.forEach(fn=>fn());assert.equal(player.isPlaying(),true);assert.equal(done,1);
    now+=1600; player.update();assert.equal(done,2,'frame fallback completes even without tail timer delivery');
    player.update();assert.equal(done,2);
    failNote=true;player.play(record,()=>done++,()=>errors++);advance(0);
    assert.equal(errors,1);assert.equal(player.isPlaying(),false);assert.equal(pending.size,0);failNote=false;
    console.log('PASS playback timing: trailing silence, natural completion, audio failure, stale timer isolation, frame fallback');

    let response, noticeStop, feedback=0, restoredCaption=0, restoredBackground=0, restoredStyle=0, modal;
    const feedbackUI={showBusyIndicator:()=>({close:noop,update:noop}),showPlaybackNotice:(_n,stop)=>{
        noticeStop=stop;feedback++;let closed=false;return ()=>{if(!closed){closed=true;feedback--;}};
    }};
    const Game=load('assets/scripts/view/GameScene.ts',id=>id==='cc'?cc
        :id.endsWith('PerformancePlayer')?{PerformancePlayer:player}
        :id.endsWith('PerformanceRecorder')?recorder
        :id.endsWith('PerformanceCloudService')?{PerformanceCloudService:{getRecord:()=>response.promise}}
        :id.endsWith('AudioManager')?audio
        :id.endsWith('ChallengeLaunchStore')?{ChallengeLaunchStore:{take:noop}}
        :id.endsWith('AudioSettingsStore')?{AudioSettingsStore:{applyToAudioManager:()=>restoredStyle++}}
        :id.endsWith('AppearanceFeedback')?feedbackUI
        :id.endsWith('SimpleToast')?{showToast:noop}
        :id.endsWith('WeChatNative')?{getWx:()=>({showModal:o=>{modal=o;}})}:empty,clock).GameScene;
    const scene=new Game();scene.audioManager=am;
    scene.settingsButton={interactable:false};scene.backButton={interactable:false};scene.recordStartButton={interactable:true};
    scene.kalimbaManager={node:{addComponent:()=>new Dummy()}};
    scene.editableCaption={setText:noop,restoreSessionCaption:()=>restoredCaption++};
    scene.sheetMusicBackground={switchToSharePlaybackBg:noop,resetToDefault:()=>restoredBackground++};
    scene.practiceOverlay={hideRecordingFlow:noop,hideFreeTutorialForSharedPlayback:noop,setChallengeIdle:noop};
    async function start(){response=deferred();scene.sharedPlaybackLaunch=true;const req=++scene.sharedPlaybackRequest;
        const promise=scene.loadAndPlaySharedRecord('rid',req);response.resolve(record);await promise;}
    const unlocked=()=>{
        assert.equal(scene._playbackLocked,false);assert.equal(scene.playbackInputBlocker.enabled,false);
        assert.equal(scene.recordStartButton.interactable,true);assert.equal(scene.backButton.interactable,true);
        assert.equal(scene.settingsButton.interactable,true);assert.equal(feedback,0);assert.equal(player.isPlaying(),false);
    };
    await start();assert.equal(scene._playbackLocked,true);assert.equal(scene.recordStartButton.interactable,false);
    assert.equal(scene.backButton.interactable,true);assert.equal(scene.settingsButton.interactable,true);assert.equal(feedback,1);
    advance(1600);unlocked();assert.equal(restoredCaption,1);assert.equal(restoredBackground,1);assert.equal(restoredStyle,1);
    const Key=load('assets/scripts/KalimbaKey.ts',id=>id==='cc'?cc
        :id.endsWith('AudioManager')?audio
        :id.endsWith('PerformanceRecorder')?recorder
        :{vibrateKeyTap:noop}).KalimbaKey;
    const key=new Key();key.keyIndex=8;
    const beforeTouches=played;
    for(let i=0;i<6;i++) {key.onTouchStart({getUILocation:()=>({x:100,y:100})});key.onTouchEnd();}
    assert.equal(played-beforeTouches,6,'six real key touch handlers must still reach audio after shared playback');unlocked();
    console.log('PASS after friend playback: six consecutive key presses reach audio and controls remain unlocked');
    await start();const blocker=scene.playbackInputBlocker;noticeStop();unlocked();
    const previousStop=noticeStop;
    await start();previousStop();
    assert.equal(scene._playbackLocked,true,'a previous share stop button cannot cancel the current share');
    assert.equal(player.isPlaying(),true);noticeStop();unlocked();
    await start();const disabledStop=noticeStop;
    scene.sceneStarted=true;scene.onDisable();assert.equal(player.isPlaying(),false);assert.equal(feedback,0);
    scene.onEnable();unlocked();
    await start();disabledStop();assert.equal(player.isPlaying(),true);noticeStop();unlocked();
    await start();assert.equal(scene.playbackInputBlocker,blocker);scene.onGameHide();unlocked();
    await start();failNote=true;advance(0);failNote=false;unlocked();assert.ok(modal);
    // Returning to free play invalidates a cloud response still in flight.
    response=deferred();scene.sharedPlaybackLaunch=true;const request=++scene.sharedPlaybackRequest;
    const late=scene.loadAndPlaySharedRecord('late',request);scene.finishSharedPlayback();response.resolve(record);await late;unlocked();
    // Latest friend link wins even when the older cloud call resolves later.
    const oldFetch=deferred(),newFetch=deferred();response=oldFetch;scene.sharedPlaybackLaunch=true;
    const older=scene.loadAndPlaySharedRecord('older',++scene.sharedPlaybackRequest);
    response=newFetch;const newer=scene.loadAndPlaySharedRecord('newer',++scene.sharedPlaybackRequest);
    const newerRecord={...record,title:'第二条分享'};newFetch.resolve(newerRecord);await newer;
    oldFetch.resolve({...record,title:'第一条分享'});await older;
    assert.equal(scene.lastRecord.title,'第二条分享');assert.equal(feedback,1);scene.finishSharedPlayback();unlocked();
    // WebAudio that never wakes must fail within the existing 3-second deadline and unlock.
    const wake=deferred();am.resumeWebAudio=()=>wake.promise;
    response=deferred();scene.sharedPlaybackLaunch=true;
    const waiting=scene.loadAndPlaySharedRecord('wake-timeout',++scene.sharedPlaybackRequest);response.resolve(record);await tick();
    advance(3000);await waiting;unlocked();wake.resolve(true);await tick();unlocked();am.resumeWebAudio=async()=>true;
    const oldModal=modal;
    response=deferred();scene.sharedPlaybackLaunch=true;
    const failed=scene.loadAndPlaySharedRecord('expired',++scene.sharedPlaybackRequest);response.reject(Error('record expired'));await failed;unlocked();
    modal=oldModal;
    let retries=0;scene.beginSharedRecordPlayback=()=>retries++;modal.success({confirm:true});assert.equal(retries,0,'old error dialog cannot restart after a newer launch/exit');
    scene.setPlaybackLock(true);scene.setPlaybackLock(false);scene.setPlaybackLock(true);
    assert.equal(scene.playbackInputBlocker.enabled,true);scene.setPlaybackLock(false);unlocked();
    console.log('PASS shared entry: natural end/manual stop/background/audio error restore controls + caption/background/style; late fetch and retry ignored; same-frame re-lock');
    assert.equal(pending.size,0);
    const scheduled=[];let tutorial=0;
    scene.scheduleOnce=fn=>scheduled.push(fn);scene.sharedPlaybackLaunch=false;
    scene.practiceOverlay.showFreeTutorialIfNeeded=()=>tutorial++;
    scene.consumeChallengeLaunchSoon();scheduled.shift()();scene.sharedPlaybackLaunch=true;scheduled.shift()();
    assert.equal(tutorial,0,'a share arriving between tutorial schedules cannot leave a full-screen blocker');
    console.log('PASS consecutive share links, late responses, wake timeout, expired record and late share entry cannot open an already scheduled free-play tutorial');
}

main().catch(e=>{console.error(e);process.exitCode=1;});
