// node scripts/verify-timeline-share.cjs [--check-build]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {loadSource, loadBuilt} = require('./verify-release-compat.cjs');
const load = process.argv.includes('--check-build') ? loadBuilt : loadSource;
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject};}
function Dummy() {this.isValid=true;this.node={};}
const cc = new Proxy({Component:Dummy, Color:Dummy, cclegacy:{_RF:{push:noop,pop:noop}},
    isValid:value=>!!value&&value.isValid!==false&&!value.destroying,
    _decorator:{ccclass:()=>value=>value,property:(...args)=>typeof args[1]==='string'?undefined:noop}},
    {get:(object,key)=>object[key]??Dummy});
const empty = new Proxy({}, {get:()=>Dummy});
function host() {
    const state={menus:[],friendRegistrations:0,timelineRegistrations:0,friendCalls:0,guides:[]};
    const api={canIUse:()=>true,getAppBaseInfo:()=>({SDKVersion:'3.17.0'}),
        onShareAppMessage:fn=>{state.friend=fn;state.friendRegistrations++;},
        onShareTimeline:fn=>{state.timeline=fn;state.timelineRegistrations++;},
        showShareMenu:options=>state.menus.push(options),
        shareAppMessage:options=>{state.friendCalls++;state.friendSent=options;},
        showModal:options=>options.editable?options.success({confirm:true,content:'送你一首歌'}):state.guides.push(options)};
    return {api,state};
}
function managerFor(getApi) {
    return load('assets/scripts/manager/PerformanceShareMenu.ts',id=>id==='cc'?cc:{getWx:getApi});
}
function menuCases() {
    let current;const menu=managerFor(()=>current);
    menu.installPerformanceShareMenu();assert.equal(menu.isTimelineShareAvailable(),false);
    const first=host();current=first.api;menu.installPerformanceShareMenu();menu.installPerformanceShareMenu();
    assert.equal(first.state.friendRegistrations,1);assert.equal(first.state.timelineRegistrations,1);
    assert.equal(first.state.menus.length,1);
    assert.deepEqual(Array.from(first.state.menus[0].menus),['shareAppMessage','shareTimeline']);
    const generic=first.state.timeline();
    assert.equal(generic.query,'','explicit empty query prevents inheriting a received recording ID');
    assert.equal(generic.imagePreviewUrl,generic.imageUrl,'fallback must never use a screenshot of an input draft');
    assert.equal(generic.title,'拇指琴演奏家');
    if(process.argv.includes('--check-build')) assert.ok(fs.existsSync(path.join('build/wechatgame',generic.imageUrl)),'safe built-in preview image must be packaged');
    menu.setPreparedPerformanceShare({title:'送你一首歌',recordId:'song +&=',imageUrl:'safe.jpg'});
    const friend=first.state.friend(),timeline=first.state.timeline();
    assert.equal(timeline.query,'rid=song%20%2B%26%3D');assert.equal(timeline.query,friend.query);
    assert.equal(timeline.imageUrl,'safe.jpg');assert.equal(timeline.imagePreviewUrl,'safe.jpg');
    assert.equal(timeline.title,'送你一首歌');assert.equal(typeof timeline.then,'undefined');
    timeline.title='unapproved';assert.equal(first.state.timeline().title,'送你一首歌','callers cannot mutate the approved snapshot');
    assert.equal(menu.showTimelineShareGuide(),true);assert.equal(first.state.guides.length,1);
    assert.match(first.state.guides[0].content,/右上角/);assert.equal(first.state.friendCalls,0);
    menu.clearPreparedPerformanceShare();assert.equal(first.state.timeline().query,'');
    assert.throws(()=>menu.setPreparedPerformanceShare({title:'ok',recordId:'',imageUrl:'safe.jpg'}));
    assert.equal(first.state.timeline().query,'');
    const second=host();current=second.api;menu.installPerformanceShareMenu();
    first.state.menus[0].fail();assert.equal(menu.isTimelineShareAvailable(),true,'stale SDK callbacks cannot disable the new menu');
    second.state.menus[0].fail();assert.equal(menu.isTimelineShareAvailable(),false);
    assert.deepEqual(Array.from(second.state.menus[1].menus),['shareAppMessage']);
    assert.equal(menu.showTimelineShareGuide(),false);
    const old=host();old.api.canIUse=()=>false;current=old.api;menu.installPerformanceShareMenu();
    assert.equal(old.state.timelineRegistrations,0);assert.equal(menu.isTimelineShareAvailable(),false);
    const throwing=host();throwing.api.onShareTimeline=()=>{throw Error('unsupported');};
    current=throwing.api;menu.installPerformanceShareMenu();assert.equal(menu.isTimelineShareAvailable(),false);
    assert.equal(throwing.state.friendRegistrations,1);
    for(const version of ['2.11.3','2.14.2','',undefined]) {
        const outdated=host();outdated.api.getAppBaseInfo=()=>({SDKVersion:version});current=outdated.api;
        menu.installPerformanceShareMenu();assert.equal(menu.isTimelineShareAvailable(),false,'clients without explicit safe preview support stay on friend sharing');
        assert.equal(outdated.state.timelineRegistrations,0);
    }
    const minimum=host();minimum.api.getAppBaseInfo=()=>({SDKVersion:'2.14.3'});current=minimum.api;
    menu.installPerformanceShareMenu();assert.equal(menu.isTimelineShareAvailable(),true);
    const systemFallback=host();systemFallback.api.getAppBaseInfo=()=>{throw Error('old API surface');};
    systemFallback.api.getSystemInfoSync=()=>({SDKVersion:'3.0.0'});current=systemFallback.api;
    menu.installPerformanceShareMenu();assert.equal(menu.isTimelineShareAvailable(),true);
    console.log('PASS timeline menus: registration, explicit safe previews/query, approved snapshots, unsupported clients and stale callbacks');
}
async function flowCases() {
    const {api,state}=host();const menu=managerFor(()=>api);
    const security=load('assets/scripts/manager/ContentSecurityService.ts',id=>id==='cc'?cc:{});
    let approval=deferred(),upload=deferred(),checks=0,uploads=0,loading=0,card='safe.jpg';const notices=[];
    const Game=load('assets/scripts/view/GameScene.ts',id=>id==='cc'?cc
        :id.endsWith('PerformanceShareMenu')?menu
        :id.endsWith('WeChatNative')?{getWx:()=>api}
        :id.endsWith('ContentSecurityService')?{...security,ContentSecurityService:{requireText:()=>{checks++;return approval.promise;}}}
        :id.endsWith('PerformanceCloudService')?{PerformanceCloudService:{createRecord:()=>{uploads++;return upload.promise;},
            getRecord:async()=>({title:'收到的歌',durationMs:100,stylePreset:1,events:[{t:0,k:8}]})}}
        :id.endsWith('AppearanceFeedback')?{showBusyIndicator:()=>{loading++;return {close:()=>loading--};},showPlaybackNotice:()=>noop}
        :id.endsWith('SimpleToast')?{showToast:(_,message)=>notices.push(message)}
        :id.endsWith('PerformancePlayer')?{PerformancePlayer:{stop:noop,play:()=>true}}
        :id.endsWith('PerformanceRecorder')?{PerformanceRecorder:{start:noop,isRecording:()=>false}}
        :id.endsWith('PerformanceTypes')?{PERFORMANCE_MAX_DURATION_MS:180000}:empty).GameScene;
    const scene=new Game();scene.lastRecord={title:'歌名',durationMs:100};scene.canShareRecordedResult=true;
    scene.createPerformanceShareImage=async()=>card;
    let request=scene.onShareRecordClick('timeline');await tick();
    assert.equal(checks,1);assert.equal(uploads,0);assert.equal(state.timeline().query,'');
    approval.resolve();await tick();assert.equal(uploads,1);assert.equal(state.timeline().query,'');
    upload.resolve('timeline-song');await request;
    assert.equal(state.timeline().query,'rid=timeline-song');assert.equal(state.timeline().imagePreviewUrl,'safe.jpg');
    assert.equal(state.friendCalls,0,'timeline preparation cannot open the friend picker');
    assert.equal(state.guides.length,1);assert.equal(scene.shareBusy,false);assert.equal(loading,0);
    const beforeChecks=checks,beforeUploads=uploads;
    state.timeline();state.friend();assert.equal(checks,beforeChecks);assert.equal(uploads,beforeUploads,'menu callbacks do not wait for cloud calls');
    menu.clearPreparedPerformanceShare();approval=deferred();upload=deferred();
    request=scene.onShareRecordClick('timeline');await tick();approval.reject(new security.ContentSecurityError(true));await request;
    assert.equal(uploads,beforeUploads);assert.equal(state.timeline().query,'');assert.equal(loading,0);
    assert.match(notices.pop(),/不符合规范/);
    approval=deferred();upload=deferred();request=scene.onShareRecordClick('timeline');await tick();approval.resolve();await tick();
    scene.onDisable();upload.resolve('late-song');await request;
    assert.equal(state.timeline().query,'','leaving before cloud response cannot publish a stale song');assert.equal(loading,0);
    scene.sceneActive=true;approval=deferred();upload=deferred();card=undefined;
    const noCardUploads=uploads;request=scene.onShareRecordClick('timeline');await tick();approval.resolve();await request;
    assert.equal(uploads,noCardUploads);assert.equal(state.timeline().query,'','image generation failure cannot fall back to a draft screenshot');
    card='safe.jpg';approval=deferred();upload=deferred();request=scene.onShareRecordClick();await tick();approval.resolve();await tick();upload.resolve('friend-song');await request;
    assert.equal(state.friendCalls,1);assert.equal(state.friendSent.query,'rid=friend-song');
    assert.equal(state.timeline().query,'rid=friend-song','friend shares also prepare the same song for timeline');
    scene.startNewRecording();assert.equal(state.timeline().query,'','new recordings invalidate the previous share snapshot');
    scene.audioManager={isValid:true,setSynthStylePreset:noop,resumeWebAudio:async()=>true};
    scene.setPlaybackLock=noop;
    await scene.loadAndPlaySharedRecord('received-song',scene.sharedPlaybackRequest);
    assert.equal(state.timeline().query,'rid=received-song','received songs can be forwarded with their original validated ID');
    assert.equal(state.timeline().imagePreviewUrl,state.timeline().imageUrl,'received songs use safe built-in artwork');
    scene.lastRecord={title:'新歌',durationMs:100};scene.canShareRecordedResult=true;
    state.menus[0].fail();const unavailableChecks=checks;
    await scene.onShareRecordClick('timeline');assert.equal(checks,unavailableChecks);assert.equal(scene.shareBusy,false);
    assert.match(notices.pop(),/暂不支持朋友圈/);
    console.log('PASS recording flow: review/upload before timeline, safe image, stale/cancel/error handling, friend fallback and no phantom publication');
}
function entryCases() {
    let query={rid:'cold-timeline'},onShow;
    const api={getLaunchOptionsSync:()=>({query}),getEnterOptionsSync:()=>({query}),onShow:fn=>{onShow=fn;}};
    const launch=load('assets/scripts/manager/PerformanceShareLaunch.ts',id=>id==='cc'?{...cc,sys:{localStorage:{removeItem:noop,getItem:noop,setItem:noop}}}
        :id.endsWith('WeChatNative')?{getWx:()=>api}
        :id.endsWith('WeChatCloudFunction')?{WECHAT_CLOUD_ENV:'cloud1-2gvremt83958d276'}
        :{ChallengeLaunchStore:{take:noop,request:noop}});
    launch.installShareLaunchCapture();assert.equal(launch.takePendingSharedRecordId(),'cold-timeline');
    let notices=0;launch.onPendingGameLaunch(()=>notices++);
    onShow({query:{rid:'warm-timeline'}});assert.equal(notices,1);assert.equal(launch.takePendingSharedRecordId(),'warm-timeline');
    assert.equal(launch.takePendingSharedRecordId(),'','one entry is consumed exactly once');
    console.log('PASS timeline launch query: cold/warm entry reaches the existing shared-song playback route');
}
function resultCardCases() {
    const Overlay=load('assets/scripts/view/PracticeOverlay.ts',id=>id==='cc'?cc:empty).PracticeOverlay;
    const overlay=new Overlay(),buttons=[];let friend=0,timeline=0,saved=0,closed=0,height;
    overlay.makeRecordingFlowBase=(_,h)=>{height=h;return {};};overlay.makeCard=()=>({});overlay.makePanelLabel=()=>({});
    overlay.makePanelButton=(_,name,text,x,y,fill,color,action)=>{buttons.push({name,text,x,y,action});return {node:{},label:{}};};
    overlay.hideRecordingFlow=()=>closed++;
    overlay.showRecordingResult('歌名',1,2,{onPreview:noop,onRerecord:noop,onClose:noop,onShare:()=>friend++,onShareTimeline:()=>timeline++,onSaveImage:()=>saved++});
    assert.equal(buttons.length,5);assert.equal(height,432);
    for(const button of buttons) {assert.ok(Math.abs(button.x)+95<=320);assert.ok(Math.abs(button.y)+28<=height/2);}
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++) {
        assert.ok(Math.abs(buttons[i].x-buttons[j].x)>=190 || Math.abs(buttons[i].y-buttons[j].y)>=56,'result buttons cannot overlap');
    }
    buttons.find(button=>button.text==='分享到朋友圈').action();assert.equal(timeline,1);assert.equal(friend,0);assert.equal(closed,1);
    buttons.find(button=>button.text==='分享给好友').action();assert.equal(friend,1);
    buttons.find(button=>button.text==='保存分享图片').action();assert.equal(saved,1);assert.equal(friend,1);assert.equal(timeline,1);
    console.log('PASS result card: separate friend/timeline/image actions and five buttons fit without overlapping');
}
(async()=>{menuCases();await flowCases();entryCases();resultCardCases();})().catch(error=>{console.error(error);process.exitCode=1;});
