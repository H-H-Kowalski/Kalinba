// Additional boundary tests using real client/service functions with mocked WeChat I/O.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {compileForWechat, loadBuilt} = require('./verify-release-compat.cjs');
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
const png = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
function timers() {
    let next = 0; const pending = new Map();
    return {setTimeout: (fn, ms) => {pending.set(++next, {fn,ms}); return next;}, clearTimeout: id => pending.delete(id),
        fire(ms) {for (const [id,t] of Array.from(pending)) if (t.ms === ms) {pending.delete(id); t.fn();}},
        size: () => pending.size};
}
function load(file, imports, extra = {}) {
    if (process.argv.includes('--check-build')) return loadBuilt(file, id => id === 'cc'
        ? new Proxy({...cc, ...imports(id), cclegacy:{_RF:{push:noop,pop:noop}}}, {get:(object,key)=>object[key]??Dummy})
        : imports(id), extra);
    const exports = {};
    vm.runInNewContext(compileForWechat(file), {exports, require: imports, console: {log:noop,warn:noop,error:noop}, setTimeout,clearTimeout,...extra});
    return exports;
}
function server(file, cloud, security) {
    const exports = {};
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {exports, console: {warn:noop}, require: id => id === 'wx-server-sdk' ? cloud : id === './images' ? require('../cloudfunctions/checkContentSecurity/images') : security});
    return exports.main;
}
function Component() {this.isValid=true; this.node={}; this.scheduleOnce=noop;}
function Dummy() {this.isValid=true;}
Dummy.prototype.addRef = function() {this.refCount=(this.refCount||0)+1;return this;};
Dummy.prototype.decRef = function() {this.refCount=(this.refCount||0)-1;if(this.refCount<=0)this.destroy();return this;};
Dummy.prototype.destroy = function() {this.isValid=false;};
const cc = new Proxy({Component, Color:Dummy, Vec3:Dummy, SpriteFrame:Dummy, Enum:x=>x,
    isValid: x => !!x && x.isValid !== false && !x.destroying,
    _decorator: {ccclass: () => x=>x, property: (...args) => typeof args[1] === 'string' ? undefined : noop},
}, {get: (target,key) => target[key] ?? Dummy});
const emptyModule = new Proxy({}, {get:()=>Dummy});

async function transportCases() {
    let api, options, calls=0; const clock=timers();
    const helper=load('assets/scripts/manager/WeChatCloudFunction.ts', () => ({getWx:()=>api}), clock);
    const {ContentSecurityService:gate}=load('assets/scripts/manager/ContentSecurityService.ts', id => id.endsWith('WeChatNative') ? {getWx:()=>api} : helper, clock);
    await assert.rejects(gate.requireText('标题'), /暂时不可替换/);
    for (const mode of ['callback','promise','both']) {
        api={cloud:{callFunction(o) {calls++; options=o; assert.equal(this,api.cloud);
            assert.equal(o.config.env,'cloud1-2gvremt83958d276','explicit environment must override any default');
            if (mode!=='promise') o.success({result:{status:'pass'}});
            if (mode!=='callback') return Promise.resolve({result:{status:'pass'}});
        }}};
        await gate.requireText('标题');
        assert.equal(clock.size(),0);
    }
    for (const result of [null, {}, {status:'review'}, {status:'reject'}, {status:'unavailable'}]) {
        api.cloud.callFunction=o=>o.success({result});
        await assert.rejects(gate.requireText('标题'));
    }
    for (const code of [45009,40001,-9003]) {
        api.cloud.callFunction=o=>o.fail({errCode:code});
        await assert.rejects(gate.requireText('标题'), /暂时不可替换/);
    }
    api.cloud.callFunction=()=>{throw Error('sync failure');};
    await assert.rejects(gate.requireText('标题'), /暂时不可替换/);
    api.cloud.callFunction=o=>{calls++; options=o;};
    const before=calls, pending=gate.requireText('标题'), rejected=assert.rejects(pending,/暂时不可替换/);
    clock.fire(20000); await rejected;
    options.success({result:{status:'pass'}}); options.fail({errCode:87014});
    assert.equal(calls,before+1,'timeout never retries'); assert.equal(clock.size(),0);
    console.log('PASS cloud transport: callback/Promise/both, missing API, empty/error/quota/offline, timeout and late callbacks');
}

async function fileCases() {
    let api; const clock=timers();
    const {ContentSecurityService:gate}=load('assets/scripts/manager/ContentSecurityService.ts', id => id.endsWith('WeChatNative')
        ? {getWx:()=>api} : {}, clock);
    const pngHeader=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]).buffer;
    let reads=0;
    const setup=(data=pngHeader,file={size:10000000}) => {
        const fileSystem={getFileInfo:o=>o.success(file),readFile:o=>{
            reads++;assert.equal(o.position,0);assert.equal(o.length,Math.min(12,file.size));assert.equal(o.encoding,undefined);
            o.success({data});
        }};
        // Deliberately no getImageInfo: this is the supported mini-game surface.
        api={getFileSystemManager:()=>fileSystem};return fileSystem;
    };
    setup(); assert.equal(await gate.readImage('wxfile://one'),'png');
    api.getImageInfo=()=>{throw Error('must not call mini-program-only API');};
    assert.equal(await gate.readImage('wrong-extension.jpg'),'png','identify bytes, not the path extension');
    for(const [data,type] of [[pngHeader,'png'],[Uint8Array.from([255,216,255]),'jpg'],
        [Buffer.from('GIF87a'),'gif'],[Buffer.from('GIF89a'),'gif'],[Buffer.from('BM'),'bmp'],
        [Buffer.from('RIFF0000WEBP'),'webp'],[Uint8Array.from([73,73,42,0]),'tiff'],[Uint8Array.from([77,77,0,42]),'tiff']]) {
        setup(data);assert.equal(await gate.readImage('wxfile://no-suffix'),type);
    }
    for (const input of [null,[],[''],[null],'image',Array(6).fill('x')]) await assert.rejects(gate.requireImages(input));
    for(const data of [null,{},'',new ArrayBuffer(0),Buffer.from('<svg>not an image</svg>'),Buffer.from('RIFF0000WAVE')]) {
        setup(data);await assert.rejects(gate.readImage('x'),e=>e.stage==='file_header'&&e.reason==='unsupported_format');
    }
    for (const file of [null,{}, {size:0},{size:-1},{size:10000001},{size:NaN},{size:1.2},{size:'10'}]) {
        setup(pngHeader,file);const before=reads;await assert.rejects(gate.readImage('x'));assert.equal(reads,before,'invalid size must not read image bytes');
    }
    for (const stage of ['getFileInfo','readFile']) {
        const fileSystem=setup();
        fileSystem[stage]=o=>o.fail({errCode:10004,errMsg:'denied: wxfile://private-user-image'});
        await assert.rejects(gate.readImage('x'),e=>e.errorCode===10004 && e.reason==='api_error' && !e.message.includes('private'));
        setup();let late;
        const waiting=api.getFileSystemManager();waiting[stage]=o=>{late=o;};
        const pending=gate.readImage('x'), rejected=assert.rejects(pending,e=>e.reason==='timeout');
        clock.fire(10000);await rejected;const before=reads;
        late.success(stage==='getFileInfo'?{size:128}:{data:pngHeader});assert.equal(reads,before);assert.equal(clock.size(),0);
    }
    for(const missing of ['getFileInfo','readFile']){const fs=setup();delete fs[missing];await assert.rejects(gate.readImage('x'),e=>e.reason==='api_unavailable');}
    api=undefined;await assert.rejects(gate.readImage('x'));
    assert.equal(clock.size(),0);
    console.log('PASS mini-game image reads without getImageInfo: 12-byte header, magic formats, 10 MB boundary, spoofed extension, permissions and timeout');
}

async function pickerCases() {
    let api, options; const clock=timers();
    const privacyGate=load('assets/scripts/manager/WeChatPrivacyAuthorization.ts', id=>id.endsWith('WeChatNative')
        ? {getWx:()=>api} : {showPrivacyConsentDialog:()=>{throw Error('unexpected custom dialog');}},clock);
    const picker=load('assets/scripts/manager/ChooseImageHelper.ts',id=>id.endsWith('WeChatPrivacyAuthorization')
        ? privacyGate : {getWx:()=>api},clock);
    api={chooseImage:o=>{options=o;}};
    let promise=picker.chooseImagesUpTo(5); options.success({tempFilePaths:['a','b']});
    assert.deepEqual(Array.from((await promise).urls),['a','b']); assert.equal(clock.size(),0);
    for (const response of [null,{}, {tempFilePaths:[]},{tempFilePaths:['x',null]}]) {
        promise=picker.chooseImagesUpTo(); options.success(response); assert.equal((await promise).ok,false);
    }
    promise=picker.chooseImagesUpTo(); options.fail({errMsg:'chooseImage:fail cancel'});
    assert.match((await promise).errMsg,/cancel/);
    promise=picker.chooseImagesUpTo(); clock.fire(120000); assert.equal((await promise).ok,false);
    options.success({tempFilePaths:['late']}); assert.equal(clock.size(),0);
    api={chooseMedia:o=>o.success({tempFiles:[{tempFilePath:'fallback'}]})};
    assert.equal((await picker.chooseImagesUpTo()).urls[0],'fallback');
    api={chooseImage:()=>{throw Error('privacy failure');}}; assert.equal((await picker.chooseImagesUpTo()).ok,false);
    let privacy, opens=0;
    api={requirePrivacyAuthorize:o=>{privacy=o;}, chooseImage:o=>{options=o; opens++;}};
    promise=picker.chooseImagesUpTo(); assert.equal(opens,0,'must not access album before privacy consent');
    privacy.success(); privacy.success(); assert.equal(opens,1,'duplicate consent opens exactly one picker');
    options.success({tempFilePaths:['approved']}); assert.equal((await promise).ok,true);
    for (const error of [{errMsg:'privacy disagree'},{errno:1026,errMsg:'privacy configuration required'}]) {
        promise=picker.chooseImagesUpTo(); privacy.fail(error);
        assert.equal((await promise).ok,false); privacy.success(); assert.equal(opens,1,'no picker after privacy refusal');
    }
    promise=picker.chooseImagesUpTo(); clock.fire(120000);
    assert.equal((await promise).ok,false); privacy.success(); assert.equal(opens,1,'no picker after consent timeout');
    api.requirePrivacyAuthorize=()=>{throw Error('privacy unavailable');};
    assert.equal((await picker.chooseImagesUpTo()).ok,false); assert.equal(opens,1);
    api=undefined; assert.equal((await picker.chooseImagesUpTo()).ok,false);
    assert.equal(clock.size(),0);
    console.log('PASS image picker: consent before album, privacy refusal/configuration/timeout, duplicate and late consent, picker errors');
}

async function restoreAndCarouselCases() {
    const storage=new Map(); let approval=deferred(), checked, notices=0;
    const sys={localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
    const appearance=load('assets/scripts/manager/PerformanceAppearanceStore.ts',()=>({...cc,sys}));
    const state=appearance.PerformanceAppearanceStore;
    const feedback={showBusyIndicator:()=>({update:noop,close:noop})};
    const gate={requireText:v=>{checked=v; return approval.promise;}, requireImages:v=>{checked=v; return approval.promise;},message:()=> 'blocked'};
    const Caption=load('assets/scripts/view/EditableCaption.ts',id=>id==='cc'?{...cc,sys,EditBox:{InputMode:{SINGLE_LINE:0},EventType:{}}}
        :id.endsWith('PerformanceAppearanceStore')?appearance:id.endsWith('AppearanceFeedback')?feedback
        :id.endsWith('ContentSecurityService')?{ContentSecurityService:gate}:id.endsWith('SimpleToast')?{showToast:()=>notices++}:{getWx:()=>undefined}).EditableCaption;
    const caption=new Caption(); caption.alignInnerLabels=noop;
    caption.editBox={isValid:true,node:{on:noop},string:'',enabled:true}; storage.set('user_caption','旧版未审文字');
    storage.set('kalinba_selected_images_v1',JSON.stringify(['old-a','old-b']));
    caption.onLoad(); assert.equal(caption.text,'《生日快乐》'); assert.equal(checked,undefined);
    assert.equal(storage.size,0,'cold start removes legacy content without restoring or moderating it');
    state.setCaption('本次已审文字'); caption.onLoad(); assert.equal(caption.text,'本次已审文字');
    state.setCaption(''); caption.onLoad(); assert.equal(caption.text,'','empty caption survives scene recreation');
    assert.equal(checked,undefined); assert.equal(notices,0);

    const clock=timers(); let remote;
    const sheetCC={...cc,sys,assetManager:{loadRemote:(...args)=>{remote=args[args.length-1];}}};
    const Sheet=load('assets/scripts/view/SheetMusicBackground.ts', id=>id==='cc'?sheetCC
        :id.endsWith('PerformanceAppearanceStore')?appearance:id.endsWith('AppearanceFeedback')?feedback
        :id.endsWith('SheetRuntimeStore')?{SheetRuntimeStore:{setLongImageActive:noop}}
        :id.endsWith('ContentSecurityService')?{ContentSecurityService:gate}:id.endsWith('SimpleToast')?{showToast:()=>notices++}:emptyModule,clock).SheetMusicBackground;
    const sheet=new Sheet();
    const cached=Object.assign(new Dummy(),{width:400,height:400});
    state.setImages([cached]); sheet.restoreSelectedImages();
    assert.equal(sheet.carouselTextures[0],cached); assert.equal(cached.refCount,2);
    sheet.clearCarouselTexturesOnly(); assert.equal(cached.isValid,true,'session reference survives scene destroy');
    sheet.restoreSelectedImages(); assert.equal(sheet.carouselTextures[0],cached); assert.equal(checked,undefined);
    const birthday=Object.assign(new Dummy(),{rect:{width:1280,height:1567},texture:new Dummy()});
    const shared=Object.assign(new Dummy(),{rect:{width:688,height:384},texture:new Dummy()});
    sheet.defaultSpriteFrames=[birthday];sheet.sharePlaybackFrame=shared;
    state.selectBuiltIn('share'); sheet.restoreSelectedImages();
    assert.equal(sheet.getActiveFrames()[0],shared,'second default must be the actual friend playback image');
    assert.equal(cached.isValid,false,'clear releases both texture owners');
    assert.equal(sheet.carouselTextures.length,0); assert.equal(state.getImages().length,0);
    const recreated=new Sheet();recreated.defaultSpriteFrames=[birthday];recreated.sharePlaybackFrame=shared;
    recreated.restoreSelectedImages();assert.equal(recreated.getActiveFrames()[0],shared,'selected default survives a settings round trip');
    const originalMethods=new Map();
    for(const method of ['rebuildSlides','applyCurrentSlideInternal','updateNavAndPageLabel','alignSingleTallImageToTop']) {
        originalMethods.set(method,sheet[method]);sheet[method]=noop;
    }
    sheet.configureSingleImageLayout();assert.equal(sheet._singleTallScrollActive,false);
    assert.equal(sheet.getSlideCountForUI(),1,'shared background stays one full-height slide');
    const custom=Object.assign(new Dummy(),{width:400,height:400});
    state.setImages([custom]);sheet.restoreSelectedImages();
    assert.equal(sheet.getActiveFrames()[0].texture,custom,'custom images override the selected default');
    sheet.selectBuiltInBackground(state.getBackground());
    assert.equal(custom.isValid,false);assert.equal(sheet.getActiveFrames()[0],shared,'clearing custom images restores selected share background');
    sheet.selectBuiltInBackground('birthday');assert.equal(sheet.getActiveFrames()[0],birthday);
    sheet.switchToSharePlaybackBg();assert.equal(sheet.getActiveFrames()[0],shared);
    sheet.resetToDefault();assert.equal(sheet.getActiveFrames()[0],birthday,'friend playback cannot change the user selected default');
    sheet.selectBuiltInBackground('share');sheet.switchToSharePlaybackBg();sheet.resetToDefault();
    assert.equal(sheet.getActiveFrames()[0],shared,'friend playback restores share background when user selected it');
    sheet.sharePlaybackFrame=null;assert.equal(sheet.getActiveFrames()[0],birthday,'missing share asset falls back to birthday, never an empty page');
    sheet.sharePlaybackFrame=shared;
    for(const [method,original] of originalMethods) sheet[method]=original;
    const freshSession=load('assets/scripts/manager/PerformanceAppearanceStore.ts',()=>({...cc,sys})).PerformanceAppearanceStore;
    assert.equal(freshSession.getCaption('default'),'default'); assert.equal(freshSession.getBackground(),'birthday');
    assert.equal(freshSession.getImages().length,0);
    const texture=()=>Object.assign(new Dummy(),{width:400,height:400});
    const old=texture().addRef(); sheet.carouselTextures=[old]; let loaded;
    sheet.loadImageFromUrl=async()=>loaded.shift();
    loaded=[old,null]; await assert.rejects(sheet.loadCarouselFromUrls(['a','b']));
    assert.equal(old.isValid,true,'partial failure must not destroy a reused current texture');
    const fresh=texture(); loaded=[fresh,null]; await assert.rejects(sheet.loadCarouselFromUrls(['a','b']));
    assert.equal(fresh.isValid,false); assert.equal(sheet.carouselTextures[0],old);
    const late=texture(), deferredLoad=deferred(); sheet.loadImageFromUrl=()=>deferredLoad.promise;
    const loading=sheet.loadCarouselFromUrls(['a']); sheet.onDisable(); deferredLoad.resolve(late);
    assert.equal(await loading,false); assert.equal(late.isValid,false); assert.equal(old.isValid,true);
    const newA=texture(),newB=texture(); loaded=[newA,newB]; sheet.loadImageFromUrl=async()=>loaded.shift();
    for(const method of ['updateSingleTallScrollBounds','rebuildSlides','applyCurrentSlideInternal','alignSingleTallImageToTop','updateNavAndPageLabel']) sheet[method]=noop;
    let cleanup; sheet.scheduleOnce=fn=>{cleanup=fn;};
    assert.equal(await sheet.loadCarouselFromUrls(['a','b']),true);
    assert.equal(old.isValid,false); assert.equal(sheet.carouselTextures[0],newA); assert.equal(newA.isValid,true);

    delete sheet.loadImageFromUrl;
    let converted=0; sheet.toTexture2D=()=>{converted++; return texture();};
    const missing=sheet.loadImageFromUrl('no-callback'); const firstCallback=remote;
    for(let i=0;i<5;i++) {clock.fire(6000); await tick();}
    assert.equal(await missing,null); firstCallback(null,{}); assert.equal(converted,0); assert.equal(clock.size(),0);
    let navUpdates=0; sheet.sprite={}; sheet.updateNavAndPageLabel=()=>navUpdates++;
    sheet.onEnable(); assert.equal(navUpdates,1,'re-entering restores navigation after cancelled pending selection');
    console.log('PASS session appearance: no disk restore, synchronous approved/empty captions and textures, scene references, clear, cold restart; carousel stale/error rollback');
}

async function backendAndDeploymentCases() {
    const safety=require('../cloudfunctions/checkContentSecurity/security');
    for(const result of [{errCode:0,errcode:87014,result:{suggest:'pass'}},{errCode:0,result:null},{errCode:0,result:{}},{errCode:0,result:{suggest:'unknown'}}]) {
        assert.equal(safety.verdict(result,false).status,'unavailable');
    }
    let identity='trusted-openid', writeCount=0, count=0, response={errCode:0,result:{suggest:'pass'}}, written;
    let row={title:'旧版内容',eventsEncoded:'{"events":[]}',expireAtMs:Date.now()+60000};
    const cloud={init:noop,getWXContext:()=>({OPENID:identity}),openapi:{wxa:{game:{contentSpam:{msgSecCheck:async args=>{
        assert.equal(args.openid,'trusted-openid'); return response;
    }}}}},database:()=>({command:{gte:x=>x},serverDate:()=>0,collection:()=>({
        where:()=>({count:async()=>({total:count}),limit:()=>({get:async()=>({data:[row]})})}),
        add:async args=>{writeCount++; written=args.data;},
    })})};
    const check=server('cloudfunctions/checkContentSecurity/index.js',cloud,safety);
    const create=server('cloudfunctions/createPerformanceRecord/index.js',cloud,safety);
    const get=server('cloudfunctions/getPerformanceRecord/index.js',cloud,safety);
    const data={title:'已审标题',durationMs:100,eventCount:1,stylePreset:1,eventsEncoded:'{"events":[]}',openid:'spoofed'};
    assert.equal((await check({kind:'text',content:'标题',openid:'spoofed'})).status,'pass');
    for(const event of [null,{}, {kind:'unknown'}]) assert.equal((await check(event)).status,'unavailable');
    identity=''; assert.equal((await check({kind:'image',base64:png})).status,'unavailable');
    await assert.rejects(create(data),/OPENID/); identity='trusted-openid';
    count=5; await assert.rejects(create(data),/too many/); count=0;
    for(const result of [{errCode:45009},{errCode:0,result:{suggest:'review'}},{errCode:0,result:{suggest:'risky'}},{}]) {
        response=result; assert.notEqual((await create(data)).securityStatus,'pass'); assert.equal(writeCount,0);
    }
    response={errCode:0,result:{suggest:'pass'}};
    assert.equal((await create(data)).contentSecurityVersion,1); assert.equal(writeCount,1);
    assert.equal(written.ownerOpenId,'trusted-openid'); assert.equal(written.contentSecurityVersion,1);
    assert.equal((await get({recordId:'id'})).record.title,'《分享演奏》');
    row={...row,contentSecurityVersion:1,title:'已审标题'};
    assert.equal((await get({recordId:'id'})).record.title,'已审标题');
    row={...row,title:{unexpected:true}}; assert.equal((await get({recordId:'id'})).record.title,'《分享演奏》');
    const clock=timers(); let reply;
    const types=load('assets/scripts/manager/PerformanceTypes.ts',()=>({}));
    const recorder=load('assets/scripts/manager/PerformanceRecorder.ts',()=>types);
    const clientSafety=load('assets/scripts/manager/ContentSecurityService.ts',()=>({}),clock);
    const Service=load('assets/scripts/manager/PerformanceCloudService.ts',id=>id.endsWith('WeChatCloudFunction')?{callWxCloudFunction:async()=>reply}
        :id.endsWith('PerformanceRecorder')?recorder:id.endsWith('ContentSecurityService')?clientSafety:types).PerformanceCloudService;
    const record={title:'旧端返回的未审文字',durationMs:1000,stylePreset:1,events:[{t:0,k:8}],appVersion:'1.0.0'};
    for(const result of [{recordId:'old'}, {recordId:'id',contentSecurityVersion:2},{recordId:1,contentSecurityVersion:1},{securityStatus:'reject'},{securityStatus:'unavailable'}]) {
        reply=result; await assert.rejects(Service.createRecord(record));
    }
    reply={recordId:'new',contentSecurityVersion:1}; assert.equal(await Service.createRecord(record),'new');
    reply={record}; assert.equal((await Service.getRecord('id')).title,'《分享演奏》');
    reply={record,contentSecurityVersion:1}; assert.equal((await Service.getRecord('id')).title,record.title);
    const permission=JSON.parse(fs.readFileSync('cloudfunctions/checkContentSecurity/config.json')).permissions.openapi;
    assert.ok(permission.includes('wxa.game.contentSpam.msgSecCheck') && permission.includes('wxa.game.contentSpam.mediaCheckSync'));
    cloud.openapi.wxa.game.contentSpam.msgSecCheck=async()=>{throw Error('empty title must not be sent for moderation');};
    assert.equal((await create({...data,title:'  '})).contentSecurityVersion,1);
    row={...row,contentSecurityVersion:1,title:''};
    assert.equal((await get({recordId:'id'})).record.title,'');
    reply={contentSecurityVersion:1,record:{...record,title:''}};
    assert.equal((await Service.getRecord('id')).title,'');
    console.log('PASS server boundary and mixed deployments: trusted OPENID, quota, real helper before DB write, legacy titles, proof required');
}

async function shareCases() {
    const clock=timers(); let api={}, checks=0, uploads=0, shares=0, notices=[], approval, upload, card='safe.jpg', checked;
    const safety=load('assets/scripts/manager/ContentSecurityService.ts',()=>({}),clock);
    const Game=load('assets/scripts/view/GameScene.ts',id=>id==='cc'?cc:id.endsWith('WeChatNative')?{getWx:()=>api}
        :id.endsWith('AppearanceFeedback')?{showBusyIndicator:()=>({update:noop,close:noop})}
        :id.endsWith('PerformancePlayer')?{PerformancePlayer:{stop:noop}}
        :id.endsWith('ContentSecurityService')?{...safety,ContentSecurityService:{requireText:v=>{checks++; checked=v; return approval.promise;}}}
        :id.endsWith('PerformanceCloudService')?{PerformanceCloudService:{createRecord:()=>{uploads++; return upload.promise;}}}
        :id.endsWith('PerformanceTypes')?{PERFORMANCE_MAX_DURATION_MS:180000}
        :id.endsWith('SimpleToast')?{showToast:(node,text)=>notices.push(text)}:emptyModule,clock).GameScene;
    const scene=new Game(); scene.lastRecord={title:'歌名',durationMs:100}; scene.canShareRecordedResult=true;
    scene.promptPerformanceShareMessage=async()=> '祝福'; scene.createPerformanceShareImage=async()=>card;
    api.shareAppMessage=options=>{shares++; assert.ok(options.imageUrl,'cannot use unchecked automatic screenshot');};
    approval=deferred(); upload=deferred();
    let action=scene.onShareRecordClick(); await tick(); await scene.onShareRecordClick();
    assert.equal(checks,1); assert.equal(uploads,0); assert.equal(shares,0);
    assert.ok(checked.includes(scene.buildPerformanceShareTitle('歌名','祝福')));
    approval.reject(new safety.ContentSecurityError(true)); await action;
    assert.equal(uploads,0); assert.match(notices.pop(),/不符合规范/); assert.equal(scene.shareBusy,false);
    approval=deferred(); action=scene.onShareRecordClick(); await tick(); approval.resolve(); await tick();
    assert.equal(uploads,1); assert.equal(shares,0); upload.resolve('rid'); await action; assert.equal(shares,1);
    approval=deferred(); action=scene.onShareRecordClick(); await tick(); scene.onDisable(); approval.resolve(); await action;
    assert.equal(uploads,1,'leaving while pending cannot upload/share');
    approval=deferred(); upload=deferred(); action=scene.onShareRecordClick(); await tick(); approval.resolve(); await tick();
    const newRecord={title:'新录音',durationMs:100}; scene.lastRecord=newRecord;
    upload.resolve('old-rid'); await action; assert.equal(shares,1);
    assert.equal(scene.lastRecord,newRecord,'stale upload cannot replace the new recording');
    card=undefined; approval=deferred(); const before=uploads;
    action=scene.onShareRecordClick(); await tick(); approval.resolve(); await action;
    assert.equal(uploads,before); assert.equal(shares,1,'card failure stops before upload or default screenshot');
    delete scene.createPerformanceShareImage; delete scene.promptPerformanceShareMessage;
    assert.equal(scene.buildPerformanceShareTitle('歌名'),'送你一首歌');
    assert.equal(scene.buildPerformanceShareTitle('歌名','送你一首歌'),'送你一首歌');
    assert.equal(scene.buildPerformanceShareTitle(''),'送你一首歌');
    assert.equal(await scene.promptPerformanceShareMessage('歌名'),'送你一首歌','missing modal API uses the same short default');
    let modal; api.showModal=o=>{modal=o;};
    action=scene.promptPerformanceShareMessage('歌名'); modal.success({confirm:true,content:'祝福\n你好'});
    assert.equal(modal.content,'送你一首歌');assert.equal(modal.placeholderText,'送你一首歌');
    assert.equal(await action,'祝福 你好'); assert.equal(clock.size(),0);
    action=scene.promptPerformanceShareMessage('歌名'); modal.success({confirm:true,content:''});
    assert.equal(await action,'','explicitly cleared share message stays empty');
    action=scene.promptPerformanceShareMessage('歌名'); clock.fire(120000); assert.equal(await action,null);
    modal.success({confirm:true,content:'迟到'}); assert.equal(clock.size(),0);
    const drawn=[];
    const context=new Proxy({fillText:text=>drawn.push(text)}, {get:(o,k)=>o[k]??noop,set:(o,k,v)=>(o[k]=v,true)}); let canvasOptions;
    api.createCanvas=()=>({getContext:()=>context,toTempFilePath:o=>{canvasOptions=o;}});
    action=scene.createPerformanceShareImage('歌名','');canvasOptions.success({tempFilePath:'default.jpg'});
    assert.equal(await action,'default.jpg');assert.ok(drawn.includes('送你一首歌'));
    assert.ok(drawn.includes('《歌名》'),'song title remains visible on the card');
    assert.equal(drawn.some(text=>/点击卡片|音乐心意|拇指琴演奏$/.test(text)),false,'no extra guidance on the default share card');
    action=scene.createPerformanceShareImage('歌名','祝福'); clock.fire(10000); assert.equal(await action,undefined);
    canvasOptions.success({tempFilePath:'late.jpg'}); assert.equal(clock.size(),0);
    console.log('PASS sharing: checked final title, dedup, rejection, stale record/view, card failure, modal/export timeout, no draft screenshots');
}

module.exports=async()=>{
    await transportCases(); await fileCases(); await pickerCases();
    await restoreAndCarouselCases(); await backendAndDeploymentCases(); await shareCases();
};
if(require.main===module) module.exports().catch(error=>{console.error(error);process.exitCode=1;});
