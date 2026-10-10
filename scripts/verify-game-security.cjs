// Contract tests for the two official mini-game APIs and temporary image uploads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {compileForWechat} = require('./verify-release-compat.cjs');
const safety = require('../cloudfunctions/checkContentSecurity/security');
const images = require('../cloudfunctions/checkContentSecurity/images');
const tick = () => new Promise(resolve => setImmediate(resolve));
const noop = () => {};
const pass = {errcode:0, result:{suggest:'pass',label:100}, detail:[{errcode:0,suggest:'pass',label:100}]};
const png = Buffer.from([137,80,78,71,13,10,26,10]);
function timers() {
    let next=0; const pending=new Map();
    return {setTimeout:(fn,ms)=>{pending.set(++next,{fn,ms});return next;},clearTimeout:id=>pending.delete(id),
        fire(ms) {for(const [id,t] of [...pending]) if(t.ms===ms) {pending.delete(id);t.fn();}},size:()=>pending.size};
}
async function apiCases() {
    let textArgs, imageArgs, response=pass, thrown;
    const cloud={openapi:{wxa:{game:{contentSpam:{
        msgSecCheck:async args=>{textArgs=args;if(thrown) throw thrown;return response;},
        mediaCheckSync:async args=>{imageArgs=args;if(thrown) throw thrown;return response;},
    }}}}};
    assert.equal((await safety.checkText(cloud,'trusted','标题')).status,'pass');
    assert.deepEqual(textArgs,{openid:'trusted',scene:1,version:2,content:'标题'});
    assert.equal((await safety.checkImage(cloud,'trusted','https://signed.example/p.png')).status,'pass');
    assert.deepEqual(imageArgs,{openid:'trusted',scene:1,version:2,media_type:2,media_url:'https://signed.example/p.png'});
    for(const code of [40001,40003,40129,43104,43002,44002,47001,750030,750031,750032,750033,750034]) {
        response={...pass,errcode:code};
        assert.equal((await safety.checkText(cloud,'trusted','标题')).status,'unavailable');
        assert.equal((await safety.checkImage(cloud,'trusted','https://example.com/p.png')).status,'unavailable');
        thrown={errCode:code};
        assert.equal((await safety.checkText(cloud,'trusted','标题')).status,'unavailable');
        assert.equal((await safety.checkImage(cloud,'trusted','https://example.com/p.png')).status,'unavailable');
        thrown=undefined;
    }
    for(const value of [undefined,null,{}, {errcode:0}, {result:{}}, {errcode:'0',result:{suggest:'pass'}},
        {errcode:0,errCode:750031,result:{suggest:'pass'}}, {errcode:0,result:{suggest:'review'}},
        {...pass,detail:{}}, {...pass,detail:[{errcode:750031,suggest:'pass'}]}, {...pass,detail:[{errcode:0,suggest:'unknown'}]}]) {
        assert.equal(safety.verdict(value).status,'unavailable');
    }
    assert.equal(safety.verdict({result:{suggest:'pass'}}).status,'pass','explicit pass allows omitted success code');
    assert.equal(safety.verdict({...pass,result:{suggest:'risky',replaced_content:'***'}}).status,'reject');
    assert.equal(safety.verdict({...pass,detail:[{errcode:0,suggest:'risky'}]}).status,'reject');
    assert.equal((await safety.checkText(cloud,'trusted','x'.repeat(2501))).status,'unavailable');
    response=pass; assert.equal((await safety.checkText(cloud,'trusted','x'.repeat(2500))).status,'pass');
    const clock=timers(), module={exports:{}};
    vm.runInNewContext(fs.readFileSync('cloudfunctions/checkContentSecurity/security.js','utf8'),{module,...clock});
    for(const [kind,ms] of [['msgSecCheck',1000],['mediaCheckSync',5000]]) {
        let finish; cloud.openapi.wxa.game.contentSpam[kind]=()=>new Promise(resolve=>{finish=resolve;});
        const pending=kind==='msgSecCheck'?module.exports.checkText(cloud,'trusted','标题'):module.exports.checkImage(cloud,'trusted','https://example.com/a.png');
        await tick();clock.fire(ms); assert.equal((await pending).status,'unavailable');finish(pass);await tick();assert.equal(clock.size(),0);
    }
    console.log('PASS game API contract: exact methods/arguments, 2500-char boundary, explicit pass, every documented error, 1s/5s timeout');
}
async function serverImageCases() {
    const ready=images.prepareImage('owner','env','png');
    assert.equal(ready.status,'ready');assert.notEqual(ready.cloudPath,images.prepareImage('owner','env','png').cloudPath);
    const fileID=`cloud://env.bucket/${ready.cloudPath}`;
    let removed=[],reviewed=0,urls=0,copies=0,downloads=0,stage,bytes=png,reply={status:'pass'},badUrl=false;
    const copyID='cloud://env.bucket/content-security-review/private.png';
    const cloud={
        downloadFile:async args=>{downloads++;assert.equal(args.fileID,fileID);if(stage==='download')throw Error('down');return {fileContent:bytes};},
        uploadFile:async args=>{copies++;assert.match(args.cloudPath,/^content-security-review\/[a-f0-9]{48}\.png$/);assert.equal(args.fileContent,bytes);if(stage==='upload')throw Error('up');return {fileID:copyID};},
        getTempFileURL:async args=>{urls++;assert.equal(args.fileList[0].fileID,copyID);if(stage==='url')throw Error('url');return {fileList:[{fileID:copyID,status:badUrl?-1:0,tempFileURL:'https://signed.example/private.png'}]};},
        deleteFile:async args=>{removed.push(...args.fileList);if(stage==='delete')throw Error('delete');return {fileList:args.fileList.map(fileID=>({fileID,status:0}))};},
    };
    const check=async (_,openid,url)=>{reviewed++;assert.equal(openid,'owner');assert.equal(url,'https://signed.example/private.png');if(stage==='review')throw Error('review');return reply;};
    for(const invalid of [null,'https://example.com/evil.png',fileID.replace('env.bucket','other.bucket'),fileID.replace('content-security/','content-security-review/'),fileID+'/../victim',fileID+'?x=1']) {
        assert.equal((await images.inspectImage(cloud,'owner','env',invalid,check)).status,'unavailable');
    }
    assert.equal((await images.inspectImage(cloud,'another','env',fileID,check)).status,'unavailable');
    assert.equal(downloads,0);assert.equal(removed.length,0,'invalid requests must not delete files');
    for(const status of ['pass','reject','unavailable']) {
        removed=[];reply={status};assert.equal((await images.inspectImage(cloud,'owner','env',fileID,check)).status,status);
        assert.deepEqual(removed,[fileID,copyID]);
    }
    for(stage of ['download','upload','url','review']) {
        removed=[];assert.equal((await images.inspectImage(cloud,'owner','env',fileID,check)).status,'unavailable');
        assert.ok(removed.includes(fileID));if(['url','review'].includes(stage))assert.ok(removed.includes(copyID));
    }
    stage=undefined;badUrl=true;const before=reviewed;
    assert.equal((await images.inspectImage(cloud,'owner','env',fileID,check)).status,'unavailable');assert.equal(reviewed,before);
    badUrl=false;
    for(bytes of [Buffer.alloc(0),Buffer.from('not an image'),Buffer.alloc(10000001)]) {
        assert.equal((await images.inspectImage(cloud,'owner','env',fileID,check)).status,'unavailable');assert.equal(reviewed,before);
    }
    const large=Buffer.alloc(10000000);png.copy(large);assert.equal(images.imageExtension(large),'png');
    for(const [data,ext] of [[png,'png'],[Buffer.from([255,216,255]),'jpg'],[Buffer.from('GIF89a'),'gif'],[Buffer.from('BM'),'bmp'],[Buffer.from('RIFF0000WEBP'),'webp'],[Buffer.from([73,73,42,0]),'tiff'],[Buffer.from([77,77,0,42]),'tiff']]) assert.equal(images.imageExtension(data),ext);
    bytes=png;stage='delete';reply={status:'reject'};
    assert.equal((await images.inspectImage(cloud,'owner','env',fileID,check)).status,'reject','cleanup error never changes rejection to pass');
    for(const args of [['owner','','png'],['','env','png'],['owner','env','svg']])assert.equal(images.prepareImage(...args).status,'unavailable');
    // Exercise the deployable entry point, not just the image helper.
    const entry={}; stage=undefined;reply={status:'pass'};
    cloud.init=noop;cloud.getWXContext=()=>({OPENID:'owner',ENV:'env'});
    vm.runInNewContext(fs.readFileSync('cloudfunctions/checkContentSecurity/index.js','utf8'),{
        exports:entry,console:{warn:noop},require:id=>id==='wx-server-sdk'?cloud:id==='./images'?images:{checkImage:check},
    });
    const prepared=await entry.main({kind:'prepareImage',extension:'png',openid:'spoofed',env:'other'});
    assert.equal(prepared.env,'env');assert.ok(images.ownedUpload('owner','env',`cloud://env.bucket/${prepared.cloudPath}`));
    assert.equal((await entry.main({kind:'image',fileID,openid:'spoofed',env:'other'})).status,'pass');
    assert.equal((await entry.main({kind:'image',base64:png.toString('base64')})).status,'unavailable','old binary protocol cannot accidentally pass');
    console.log('PASS server images: trusted owner/environment, immutable review URL, size/magic, every storage failure and cleanup');
}
async function clientUploadCases() {
    const ready=images.prepareImage('owner','env','png');
    const fileID=`cloud://env.bucket/${ready.cloudPath}`;
    const clock=timers();let api,mode='callback',uploadArgs,deleted=[],checks=0,verdict={status:'pass'},preparation=ready;
    const exports={};
    vm.runInNewContext(compileForWechat('assets/scripts/manager/ContentSecurityService.ts'),{exports,...clock,
        require:id=>id.endsWith('WeChatNative')?{getWx:()=>api}:{callWxCloudFunction:async (_,data)=>{
            if(data.kind==='prepareImage')return preparation;
            assert.equal(data.kind,'image');assert.equal(data.fileID,fileID);assert.equal(data.base64,undefined);checks++;return verdict;
        }}});
    const gate=exports.ContentSecurityService;
    const setup=()=>{api={getFileSystemManager:()=>({getFileInfo:o=>o.success({size:10000000}),readFile:o=>o.success({data:Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]).buffer})}),cloud:{
        uploadFile(o) {assert.equal(this,api.cloud);uploadArgs=o;assert.equal(o.filePath,'wxfile://original');assert.equal(o.cloudPath,ready.cloudPath);assert.equal(o.config.env,'env');
            if(mode==='error')return o.fail({errCode:-1});
            if(mode==='empty')return o.success({});
            if(mode==='wait')return;
            if(mode!=='promise')o.success({fileID});
            if(mode!=='callback')return Promise.resolve({fileID});
        },deleteFile:o=>{deleted.push(...o.fileList);return Promise.resolve({});},
    }};};
    for(mode of ['callback','promise','both']) {setup();deleted=[];await gate.requireImages(['wxfile://original']);assert.deepEqual(deleted,[fileID]);assert.equal(clock.size(),0);}
    for(const status of ['reject','unavailable']) {setup();deleted=[];verdict={status};await assert.rejects(gate.requireImages(['wxfile://original']));assert.deepEqual(deleted,[fileID]);}
    verdict={status:'pass'};const before=checks;
    for(mode of ['error','empty']){setup();await assert.rejects(gate.requireImages(['wxfile://original']));assert.equal(checks,before);}
    for(preparation of [null,{}, {status:'pass'}, {...ready,env:''},{...ready,cloudPath:'other/file.png'}]) {setup();await assert.rejects(gate.requireImages(['wxfile://original']));assert.equal(checks,before);}
    preparation=ready;mode='wait';setup();deleted=[];
    const pending=gate.requireImages(['wxfile://original']),rejected=assert.rejects(pending,/暂时不可替换/);await tick();clock.fire(20000);await rejected;
    uploadArgs.success({fileID});assert.deepEqual(deleted,[fileID],'late successful upload is deleted');assert.equal(checks,before);assert.equal(clock.size(),0);
    setup();const missing=gate.requireImages(['wxfile://original']);delete api.cloud.uploadFile;await assert.rejects(missing);
    console.log('PASS client images: upload callback/Promise/both, original file, no base64 payload, cleanup on rejection/lost reply/late upload');
}
module.exports=async()=>{await apiCases();await serverImageCases();await clientUploadCases();};
if(require.main===module)module.exports().catch(error=>{console.error(error);process.exitCode=1;});
