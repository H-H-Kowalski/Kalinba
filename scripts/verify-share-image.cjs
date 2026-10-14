// node scripts/verify-share-image.cjs [--check-build]
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {loadSource,loadBuilt}=require('./verify-release-compat.cjs');
const load=process.argv.includes('--check-build')?loadBuilt:loadSource;
const noop=()=>{},tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function clock(){let next=0;const pending=new Map();return {setTimeout:(fn,ms)=>{pending.set(++next,{fn,ms});return next;},clearTimeout:id=>pending.delete(id),
    fire:ms=>{for(const [id,t] of Array.from(pending))if(t.ms===ms){pending.delete(id);t.fn();}},size:()=>pending.size};}
function Dummy(){this.isValid=true;this.node={};}
const cc=new Proxy({Component:Dummy,Color:Dummy,cclegacy:{_RF:{push:noop,pop:noop}},isValid:v=>!!v&&v.isValid!==false,
    _decorator:{ccclass:()=>v=>v,property:(...args)=>typeof args[1]==='string'?undefined:noop}},{get:(o,k)=>o[k]??Dummy});
const empty=new Proxy({},{get:()=>Dummy});
const png=Buffer.from('89504e470d0a1a0a0000000049454e44','hex').toString('base64');

async function albumCases(){
    let api,privacy,privacyClosed=0,saved=0,saveOptions;const time=clock();
    const helper=load('assets/scripts/manager/PerformanceImageExport.ts',id=>id==='cc'?cc
        :id.endsWith('WeChatNative')?{getWx:()=>api}
        :{requestImagePrivacyAuthorization:(success,fail,purpose)=>{assert.equal(purpose,'save');privacy={success,fail};return ()=>privacyClosed++;}},time);
    api={saveImageToPhotosAlbum:o=>{saved++;saveOptions=o;}};
    let operation=helper.saveShareImageToAlbum('card.jpg',()=>true);
    assert.equal(saved,0,'no album save before actual platform privacy confirmation');
    privacy.success();assert.equal(saved,1);assert.equal(saveOptions.filePath,'card.jpg');saveOptions.success();saveOptions.fail({errMsg:'late failure'});
    await operation.promise;assert.equal(time.size(),0);assert.equal(privacyClosed,1);
    operation=helper.saveShareImageToAlbum('card.jpg',()=>true);let rejection=assert.rejects(operation.promise,/未完成隐私授权/);
    privacy.fail();await rejection;assert.equal(saved,1);
    operation=helper.saveShareImageToAlbum('card.jpg',()=>true);rejection=assert.rejects(operation.promise,e=>e.cancelled);
    operation.cancel();privacy.success();await rejection;assert.equal(saved,1,'cancelled privacy cannot save later');
    operation=helper.saveShareImageToAlbum('card.jpg',()=>true);privacy.success();rejection=assert.rejects(operation.promise,/相册权限/);
    saveOptions.fail({errMsg:'saveImageToPhotosAlbum:fail auth deny'});await rejection;
    operation=helper.saveShareImageToAlbum('card.jpg',()=>true);privacy.success();rejection=assert.rejects(operation.promise,/暂未开放/);
    saveOptions.fail({errno:112,errMsg:'saveImageToPhotosAlbum:fail api scope is not declared in the privacy agreement'});await rejection;
    operation=helper.saveShareImageToAlbum('card.jpg',()=>true);privacy.success();rejection=assert.rejects(operation.promise,/隐私授权/);
    saveOptions.fail({errMsg:'saveImageToPhotosAlbum:fail privacy permission is not authorized'});await rejection;
    operation=helper.saveShareImageToAlbum('card.jpg',()=>true);privacy.success();rejection=assert.rejects(operation.promise,/超时/);
    time.fire(120000);saveOptions.success();await rejection;
    let current=true;operation=helper.saveShareImageToAlbum('card.jpg',()=>current);rejection=assert.rejects(operation.promise,e=>e.cancelled);
    const before=saved;current=false;privacy.success();await rejection;assert.equal(saved,before);
    api={saveImageToPhotosAlbum:()=>Promise.resolve()};operation=helper.saveShareImageToAlbum('card.jpg',()=>true);privacy.success();await operation.promise;
    api={saveImageToPhotosAlbum:()=>{throw Error('disk full');}};operation=helper.saveShareImageToAlbum('card.jpg',()=>true);
    rejection=assert.rejects(operation.promise,/保存图片失败/);privacy.success();await rejection;
    api={};operation=helper.saveShareImageToAlbum('card.jpg',()=>true);await assert.rejects(operation.promise,/手机微信/);assert.equal(time.size(),0);
    console.log('PASS album: platform consent, callbacks/Promise, denial, cancellation, timeout, stale page and unsupported clients');
}

async function decodeCases(){
    const time=clock();let write,image,removed=0;
    const api={env:{USER_DATA_PATH:'wxfile://usr'},getFileSystemManager:()=>({writeFile:o=>write=o,unlink:()=>removed++}),
        createImage:()=>{image={width:430,height:430};return image;}};
    const helper=load('assets/scripts/manager/PerformanceImageExport.ts',id=>id==='cc'?cc:id.endsWith('WeChatNative')?{getWx:()=>api}:empty,time);
    let action=helper.loadShareCodeImage(png);assert.equal(write.encoding,'base64');assert.equal(write.data,png);
    write.success();assert.equal(image.src,write.filePath);image.onload();const result=await action;
    assert.equal(removed,0,'image file must survive until canvas finishes exporting');result.dispose();assert.equal(removed,1);
    action=helper.loadShareCodeImage(png);let failed=assert.rejects(action,/加载失败/);write.success();image.onerror();await failed;
    action=helper.loadShareCodeImage(png);failed=assert.rejects(action,/加载失败/);const lateWrite=write;time.fire(10000);await failed;
    const before=removed;lateWrite.success();assert.equal(removed,before+1,'late file writes still remove abandoned temp images');
    assert.equal(time.size(),0);
    console.log('PASS code image: actual filesystem/base64 route, decoder failure, temp cleanup and late write timeout');
}

async function cloudCases(){
    let reply,expectedEnvironment='release',account={miniProgram:{envVersion:'develop'}};
    const module=load('assets/scripts/manager/PerformanceCloudService.ts',id=>id==='cc'?cc
        :id.endsWith('WeChatNative')?{getWx:()=>({getAccountInfoSync:()=>account})}
        :id.endsWith('WeChatCloudFunction')?{callWxCloudFunction:async(name,data)=>{assert.equal(name,'getPerformanceShareCode');assert.equal(data.recordId,'song1');assert.equal(data.envVersion,expectedEnvironment);return reply;}}:empty);
    const service=module.PerformanceCloudService;
    for(const env of ['release','trial','develop']){account={miniProgram:{envVersion:env}};assert.equal(module.getPerformanceShareEnvironment(),env);}
    for(const value of [{},{miniProgram:{envVersion:'unknown'}},undefined]){account=value;assert.throws(()=>module.getPerformanceShareEnvironment(),/无法确认/);}
    reply={recordId:'song1',codeVersion:2,envVersion:'release',imageBase64:png};assert.equal(await service.getShareCode('song1'),png);
    for(const value of [{...reply,recordId:'other'},{...reply,codeVersion:1},{...reply,envVersion:'develop'},
        {...reply,imageBase64:'error JSON'},{...reply,imageBase64:'iVBORw0KGgo'+'A'.repeat(350000)}]){
        reply=value;await assert.rejects(service.getShareCode('song1'),/生成失败/);
    }
    expectedEnvironment='develop';reply={recordId:'song1',codeVersion:2,envVersion:'develop',imageBase64:png};assert.equal(await service.getShareCode('song1','develop'),png);
    reply={...reply,envVersion:'release'};await assert.rejects(service.getShareCode('song1','develop'),/生成失败/);
    await assert.rejects(service.getShareCode('song1','arbitrary'),/版本无效/);await assert.rejects(service.getShareCode('x'.repeat(29)),/编号无效/);
    const source=fs.readFileSync('cloudfunctions/getPerformanceShareCode/index.js','utf8');
    let row,openid='owner',calls=0,updated=0,recent=0,apiResult={buffer:Buffer.from(png,'base64')},apiEnvironment='release';
    const cloud={DYNAMIC_CURRENT_ENV:'env',init:noop,getWXContext:()=>({OPENID:openid}),
        database:()=>({command:{gte:noop},collection:()=>({where:query=>({limit:()=>({get:async()=>({data:row&&query.ownerOpenId===row.ownerOpenId?[row]:[]})}),count:async()=>({total:recent})}),
            doc:()=>({update:async({data})=>{updated++;Object.assign(row,data);}})})}),
        openapi:{wxacode:{getUnlimited:async options=>{calls++;assert.equal(options.scene,'rid=song1');assert.equal(options.width,430);assert.equal(options.envVersion,apiEnvironment);assert.equal(options.page,undefined);return apiResult;}}}};
    const exports={};vm.runInNewContext(source,{require:()=>cloud,exports,Buffer,Date,console});
    const validRow=()=>({_id:'db1',recordId:'song1',ownerOpenId:'owner',contentSecurityVersion:1,expireAtMs:Date.now()+900000});
    row=validRow();let result=await exports.main({recordId:'song1'});assert.equal(result.imageBase64,png);assert.equal(result.codeVersion,1);assert.equal(calls,1);assert.equal(updated,2);
    assert.equal(row.shareCodeVersion,2);assert.equal(row.shareCodeEnvVersion,'release');
    result=await exports.main({recordId:'song1',envVersion:'release'});assert.equal(result.codeVersion,2);assert.equal(result.envVersion,'release');assert.equal(calls,1,'same-environment cache avoids extra official calls');
    row.shareCodeRequestedAtMs=0;apiEnvironment='develop';result=await exports.main({recordId:'song1',envVersion:'develop'});
    assert.equal(calls,2,'a release code cannot be reused as a development code');assert.equal(result.envVersion,'develop');
    await exports.main({recordId:'song1',envVersion:'develop'});assert.equal(calls,2);
    await assert.rejects(exports.main({recordId:'song1',envVersion:'release'}),/retry later/,'changing environments cannot bypass record cooldown');
    row.shareCodeRequestedAtMs=0;apiEnvironment='trial';result=await exports.main({recordId:'song1',envVersion:'trial'});assert.equal(result.envVersion,'trial');assert.equal(calls,3);
    row=validRow();row.shareCodeVersion=1;row.shareCodeBase64=png;result=await exports.main({recordId:'song1',envVersion:'release'});assert.equal(calls,3,'legacy cache is known to target release');
    apiEnvironment='develop';result=await exports.main({recordId:'song1',envVersion:'develop'});assert.equal(calls,4,'legacy release cache must not silently open an old released client');
    const safeCalls=calls;
    for(const env of ['invalid',null,2,'RELEASE'])await assert.rejects(exports.main({recordId:'song1',envVersion:env}),/envVersion/);
    assert.equal(calls,safeCalls);
    openid='other';await assert.rejects(exports.main({recordId:'song1'}),/unavailable/);assert.equal(calls,safeCalls);
    openid='';await assert.rejects(exports.main({recordId:'song1'}),/OPENID/);openid='owner';
    row=validRow();row.contentSecurityVersion=0;await assert.rejects(exports.main({recordId:'song1'}),/reviewed/);
    row=validRow();row.expireAtMs=Date.now()-1;await assert.rejects(exports.main({recordId:'song1'}),/unavailable/);
    row=validRow();row.shareCodeRequestedAtMs=Date.now();await assert.rejects(exports.main({recordId:'song1'}),/retry later/);
    row=validRow();recent=5;await assert.rejects(exports.main({recordId:'song1'}),/too many/);recent=0;
    row=validRow();apiEnvironment='release';apiResult={buffer:Buffer.from('{"errcode":40001}')};await assert.rejects(exports.main({recordId:'song1'}),/invalid code/);
    assert.equal(row.shareCodeVersion,undefined,'official errors cannot become a cached QR image');
    assert.deepEqual(JSON.parse(fs.readFileSync('cloudfunctions/getPerformanceShareCode/config.json')).permissions.openapi,['wxacode.getUnlimited']);
    console.log('PASS cloud boundary: actual client environment, release/trial/develop cache isolation, legacy migration, mixed-deployment refusal, ownership, quota and binary failures');
}

function entryCases(){
    let onShow;const launch=load('assets/scripts/manager/PerformanceShareLaunch.ts',id=>id==='cc'?{...cc,sys:{localStorage:{removeItem:noop}}}
        :id.endsWith('WeChatNative')?{getWx:()=>({getEnterOptionsSync:()=>({query:{scene:'rid%3Dcold-song'}}),getLaunchOptionsSync:()=>({query:{rid:'old'}}),onShow:fn=>onShow=fn})}
        :{ChallengeLaunchStore:{take:noop,request:noop}},{});
    launch.installShareLaunchCapture();assert.equal(launch.takePendingSharedRecordId(),'cold-song');let events=0;launch.onPendingGameLaunch(()=>events++);
    onShow({scene:1047,query:{scene:'rid=warm-song'}});assert.equal(launch.takePendingSharedRecordId(),'warm-song');assert.equal(events,1);
    for(const scene of ['%broken','rid=x&challenge=c1-01','rid='+ 'x'.repeat(29),'unrelated']){onShow({query:{scene}});assert.equal(launch.takePendingSharedRecordId(),'');}
    onShow({query:{rid:'friend-song',scene:'rid=code-song'}});assert.equal(launch.takePendingSharedRecordId(),'friend-song');
    assert.equal(launch.takePendingSharedRecordId(),'');
    console.log('PASS QR entry: encoded/plain scene, current entry priority, cold/warm dispatch, malformed input and single consumption');
}

async function flowCases(){
    let approval=deferred(),upload=deferred(),code=deferred(),saved=deferred(),uploads=0,codes=0,saves=0,loading=0,cancelled=0,confirmation=deferred(),renderPreview,card='poster.jpg';const notices=[];
    const security=load('assets/scripts/manager/ContentSecurityService.ts',id=>id==='cc'?cc:empty);
    const Game=load('assets/scripts/view/GameScene.ts',id=>id==='cc'?cc
        :id.endsWith('WeChatNative')?{getWx:()=>({})}
        :id.endsWith('ContentSecurityService')?{...security,ContentSecurityService:{requireText:()=>approval.promise}}
        :id.endsWith('PerformanceCloudService')?{getPerformanceShareEnvironment:()=> 'develop',PerformanceCloudService:{createRecord:()=>{uploads++;return upload.promise;},getShareCode:(_rid,env)=>{assert.equal(env,'develop');codes++;return code.promise;}}}
        :id.endsWith('PerformanceImageExport')?{ImageExportError:Error,saveShareImageToAlbum:(path,isCurrent)=>{assert.equal(path,card);assert.equal(isCurrent(),true);saves++;return {promise:saved.promise,cancel:()=>{cancelled++;saved.reject(Error('cancel'));}};}}
        :id.endsWith('AppearanceFeedback')?{showBusyIndicator:()=>{loading++;return {close:()=>loading--,update:noop}},
            confirmShareImageSave:(_node,path,style,render,current,env)=>{assert.equal(env,'develop');assert.equal(path,card);assert.equal(current(),true);renderPreview=render;return {promise:confirmation.promise,cancel:()=>confirmation.resolve(null)};}}
        :id.endsWith('PerformanceSharePoster')?{DEFAULT_SHARE_POSTER_STYLE:{color:'cream',art:'cover'}}
        :id.endsWith('SimpleToast')?{showToast:(_,text)=>notices.push(text)}
        :id.endsWith('PerformancePlayer')?{PerformancePlayer:{stop:noop}}:empty).GameScene;
    const scene=new Game();scene.lastRecord={title:'歌名',durationMs:100,events:[{t:0,k:8}]};scene.canShareRecordedResult=true;
    scene.promptPerformanceShareMessage=async()=> '送你一首歌';scene.createPerformanceShareImage=async(_a,_b,b64,_style,env)=>{assert.equal(b64,png);assert.equal(env,'develop');return card;};
    let request=scene.onShareRecordClick('image');await tick();await scene.onShareRecordClick('image');assert.equal(uploads,0);
    approval.resolve();await tick();assert.equal(uploads,1);assert.equal(codes,0);upload.resolve('song1');await tick();assert.equal(codes,1);assert.equal(saves,0);
    code.resolve(png);await tick();assert.equal(saves,0,'opening a preview never saves to album');
    assert.equal(loading,0,'generation loading ends before user chooses styles');
    await renderPreview({color:'sage',art:'garden'});assert.equal(uploads,1);assert.equal(codes,1,'styles reuse the same code and reviewed text');
    confirmation.resolve({filePath:card,style:{color:'sage',art:'garden'}});await tick();assert.equal(saves,1);assert.equal(notices.length,0,'calling save is not proof it succeeded');
    saved.resolve();await request;assert.match(notices.pop(),/已保存到相册/);assert.equal(loading,0);assert.equal(scene.shareBusy,false);
    approval=deferred();code=deferred();saved=deferred();confirmation=deferred();request=scene.onShareRecordClick('image');await tick();approval.resolve();await tick();
    assert.equal(uploads,1,'retry same recording reuses cloud record');code.resolve(png);await tick();confirmation.resolve({filePath:card,style:{color:'sage',art:'garden'}});await tick();saved.reject(Error('failure'));await request;
    assert.equal(notices.some(text=>/已保存/.test(text)),false);notices.length=0;
    approval=deferred();code=deferred();saved=deferred();confirmation=deferred();request=scene.onShareRecordClick('image');await tick();approval.resolve();await tick();code.resolve(png);await tick();confirmation.resolve({filePath:card,style:{color:'sage',art:'garden'}});await tick();
    scene.onDisable();await request;assert.equal(cancelled,1);assert.equal(loading,0);assert.equal(notices.length,0,'late save cannot notify a different page');
    scene.sceneActive=true;approval=deferred();request=scene.onShareRecordClick('image');await tick();approval.reject(new security.ContentSecurityError(true));await request;
    assert.equal(uploads,1);assert.match(notices.pop(),/不符合规范/);
    approval=deferred();code=deferred();request=scene.onShareRecordClick('image');await tick();approval.resolve();await tick();const before=saves;scene.onDisable();code.resolve(png);await request;
    assert.equal(saves,before,'leaving before QR response cannot open the album');assert.equal(loading,0);
    console.log('PASS image flow: review -> record -> QR -> preview -> explicit save -> album, dedup/retry, refusal, loading cleanup and scene cancellation');
}

async function cardCases(){
    const time=clock();let canvas,options,disposed=0;const drawn=[],texts=[];
    const context=new Proxy({drawImage:(...args)=>drawn.push(args),fillText:text=>texts.push(text)},{get:(o,k)=>o[k]??noop,set:(o,k,v)=>(o[k]=v,true)});
    const api={createCanvas:()=>{canvas={getContext:()=>context,toTempFilePath:o=>options=o};return canvas;}};
    const codeImage={},artImage={};const poster=load('assets/scripts/manager/PerformanceSharePoster.ts',()=>cc);const Game=load('assets/scripts/view/GameScene.ts',id=>id==='cc'?cc
        :id.endsWith('WeChatNative')?{getWx:()=>api}
        :id.endsWith('PerformanceImageExport')?{loadShareCodeImage:async()=>({image:codeImage,dispose:()=>disposed++})}
        :id.endsWith('PerformanceSharePoster')?{...poster,loadSharePosterArt:async()=>({image:artImage,dispose:noop})}:empty,time).GameScene;
    const scene=new Game();let action=scene.createPerformanceShareImage('歌名','送你一首歌',png);await tick();
    assert.equal(canvas.width,900);assert.equal(canvas.height,1200);assert.equal(options.destHeight,1200);
    assert.equal(drawn[0][0],artImage);assert.deepEqual(drawn[0].slice(1),[0,0,900,600]);
    assert.equal(drawn[1][0],codeImage);assert.deepEqual(drawn[1].slice(1),[82,902,220,220]);assert.equal(disposed,0);
    assert.ok(texts.includes('微信扫码听演奏'));assert.ok(texts.includes('演奏保留90天'));options.success({tempFilePath:'poster.jpg'});
    assert.equal(await action,'poster.jpg');assert.equal(disposed,1);
    action=scene.createPerformanceShareImage('歌名','送你一首歌',png);await tick();time.fire(10000);assert.equal(await action,undefined);assert.equal(disposed,2);
    texts.length=0;action=scene.createPerformanceShareImage('歌名','送你一首歌',png,{color:'cream',art:'cover'},'trial');await tick();
    assert.ok(texts.some(text=>text.includes('体验版测试码')));options.success({tempFilePath:'trial.jpg'});await action;
    texts.length=0;action=scene.createPerformanceShareImage('歌名','送你一首歌',png);await tick();
    assert.equal(texts.some(text=>text.includes('测试码')),false);options.success({tempFilePath:'release.jpg'});await action;
    action=scene.createPerformanceShareImage('歌名','送你一首歌');assert.equal(canvas.height,480);options.success({tempFilePath:'friend.jpg'});assert.equal(await action,'friend.jpg');
    console.log('PASS generated card: 3:4 QR poster, expiry copy, decoder retained until export, failure cleanup and existing 5:4 friend card');
}
(async()=>{await albumCases();await decodeCases();await cloudCases();entryCases();await flowCases();await cardCases();})().catch(error=>{console.error(error);process.exitCode=1;});
