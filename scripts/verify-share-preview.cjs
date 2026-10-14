// Exercise async preview rendering, style switching and explicit-save boundaries, in source or real WeChat bundle.
const assert=require('node:assert/strict');
const {loadSource,loadBuilt}=require('./verify-release-compat.cjs');
const load=process.argv.includes('--check-build')?loadBuilt:loadSource;
const noop=()=>{},tick=()=>new Promise(r=>setImmediate(r));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};}
class Node {
    static EventType={NODE_DESTROYED:'destroyed',TOUCH_END:'touchend'};
    constructor(name){this.name=name;this.children=[];this.components=new Map();this.events=new Map();this.isValid=true;this.layer=1;}
    setParent(parent){this.parent=parent;parent.children.push(this)} setPosition(x,y){this.x=x;this.y=y}
    addComponent(Type){const c=new Type();c.node=this;this.components.set(Type,c);return c}
    getComponent(Type){return this.components.get(Type)} getChildByName(name){return this.children.find(c=>c.name===name)}
    on(name,fn){this.events.set(name,fn)} once(name,fn){this.on(name,fn)} off(name,fn){if(this.events.get(name)===fn)this.events.delete(name)}
    destroy(){if(!this.isValid)return;this.isValid=false;this.events.get('destroyed')?.()}
}
class UITransform {setContentSize(w,h){this.width=w;this.height=h}}
class Graphics {rect(){}roundRect(){}fill(){}}
class Button {static EventType={CLICK:'click'};static Transition={SCALE:1};interactable=true}
class Label {static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};static Overflow={SHRINK:1}}
class Sprite {static SizeMode={CUSTOM:1}}
let framesDestroyed=0,texturesDestroyed=0,released=0,loads=[],api,preview;
class SpriteFrame {destroy(){framesDestroyed++}}
class Texture2D {destroy(){texturesDestroyed++}}
const assetManager={loadRemote:(path,opts,callback)=>{assert.equal(opts.ext,'.jpg');loads.push({path,callback})},releaseAsset:()=>released++};
const cc={Node,UITransform,Graphics,Button,Label,Color:class{},BlockInputEvents:class{},Sprite,SpriteFrame,Texture2D,assetManager,
    isValid:n=>!!n?.isValid,cclegacy:{_RF:{push:noop,pop:noop}}};
let next=0;const timers=new Map();const time={setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next},clearTimeout:id=>timers.delete(id)};
const fire=ms=>{for(const [id,t]of Array.from(timers))if(t.ms===ms){timers.delete(id);t.fn()}};
const poster=load('assets/scripts/manager/PerformanceSharePoster.ts',id=>id==='cc'?cc:{ImageExportError:Error},time);
const view=load('assets/scripts/view/AppearanceFeedback.ts',id=>id==='cc'?cc:id.endsWith('WeChatNative')?{getWx:()=>api}
    :id.endsWith('PerformanceSharePoster')?poster:{ImageExportError:Error},time);
function owner(){const c=new Node('Canvas');c.addComponent(UITransform).setContentSize(1280,720);return c}
function controls(canvas){const panel=canvas.children.find(n=>n.name==='ShareImageConfirmation').children[0];
    return {panel,click:name=>{const n=panel.getChildByName(name);if(n.getComponent(Button).interactable)n.events.get('click')()},
        enabled:name=>panel.getChildByName(name).getComponent(Button).interactable};}
async function cases(){
    api={previewImage:o=>{preview=o}};let canvas=owner(),current=true,render=deferred(),renders=0;
    const style={color:'cream',art:'cover'};
    let operation=view.confirmShareImageSave(canvas,'first.jpg',style,s=>{renders++;assert.equal(s.color,'sage');return render.promise},()=>current);
    let ui=controls(canvas),settled=false;operation.promise.then(()=>settled=true);
    ui.click('SaveImage');assert.equal(settled,false);assert.equal(ui.enabled('SaveImage'),false,'no save before visible image loads');
    loads.shift().callback(null,{});assert.equal(ui.enabled('SaveImage'),true);assert.equal(settled,false,'preview does not save');
    ui.click('PreviewImage');assert.equal(preview.current,'first.jpg');assert.equal(preview.showmenu,false);preview.success();await tick();assert.equal(settled,false,'native zoom success is not consent to save');
    ui.click('Color-sage');assert.equal(renders,1);assert.equal(ui.enabled('SaveImage'),false);ui.click('Color-peach');assert.equal(renders,1,'block repeated changes during rendering');
    render.resolve('green.jpg');await tick();assert.equal(ui.enabled('SaveImage'),false,'wait for new image decoder');
    const before=released;loads.shift().callback(null,{});assert.equal(released,before+1,'switch disposes superseded preview');
    ui.click('SaveImage');const saved=await operation.promise;assert.equal(saved.filePath,'green.jpg');assert.equal(saved.style.color,'sage');assert.equal(saved.style.art,'cover');assert.equal(timers.size,0);
    assert.ok(framesDestroyed>=2&&texturesDestroyed>=2,'preview textures are released on switch and close');
    canvas=owner();operation=view.confirmShareImageSave(canvas,'first.jpg',style,async()=>{throw Error('decode')},()=>true);ui=controls(canvas);
    loads.shift().callback(null,{});ui.click('Art-garden');await tick();assert.equal(ui.enabled('SaveImage'),true,'failed change keeps old valid preview');
    ui.click('SaveImage');assert.equal((await operation.promise).filePath,'first.jpg');
    canvas=owner();render=deferred();operation=view.confirmShareImageSave(canvas,'first.jpg',style,()=>render.promise,()=>true);ui=controls(canvas);
    loads.shift().callback(null,{});ui.click('Art-garden');ui.click('Cancel');assert.equal(await operation.promise,null);render.resolve('late.jpg');await tick();assert.equal(loads.length,0,'cancelled generation cannot recreate a preview');
    canvas=owner();operation=view.confirmShareImageSave(canvas,'first.jpg',style,noop,()=>true);const late=loads.shift();operation.cancel();assert.equal(await operation.promise,null);
    const releasedBefore=released;late.callback(null,{});assert.equal(released,releasedBefore+1,'late decoder result is released');
    canvas=owner();operation=view.confirmShareImageSave(canvas,'first.jpg',style,noop,()=>true);loads.shift();const rejection=assert.rejects(operation.promise,/超时/);fire(10000);await rejection;
    canvas=owner();operation=view.confirmShareImageSave(canvas,'first.jpg',style,noop,()=>true);loads.shift().callback(null,{});canvas.destroy();assert.equal(await operation.promise,null);
    canvas=owner();current=true;operation=view.confirmShareImageSave(canvas,'first.jpg',style,noop,()=>current);ui=controls(canvas);loads.shift().callback(null,{});current=false;ui.click('SaveImage');assert.equal(await operation.promise,null);
    assert.equal(timers.size,0);assert.equal(poster.SHARE_POSTER_COLORS.length,4);assert.equal(poster.SHARE_POSTER_ART.length,2);
    console.log('PASS preview: visible before save, four colors, built-in artwork, latest path, failed change retains valid image, cancel/stale/timeout and texture cleanup');
}
async function artCases(){
    let callback,refs=0;
    assetManager.loadAny=(uuid,done)=>{assert.equal(uuid,poster.SHARE_POSTER_ART[1].uuid);callback=done};
    let action=poster.loadSharePosterArt('garden');const data={};
    callback(null,{data,width:688,height:384,addRef:()=>refs++,decRef:()=>refs--});
    const loaded=await action;assert.equal(loaded.image,data);assert.equal(refs,1);loaded.dispose();loaded.dispose();assert.equal(refs,0);
    action=poster.loadSharePosterArt('garden');const failure=assert.rejects(action,/超时/);fire(10000);await failure;
    callback(null,{data,width:688,height:384,addRef:()=>refs++});assert.equal(refs,0,'late callback cannot borrow an image after timeout');
    action=poster.loadSharePosterArt('garden');const invalid=assert.rejects(action,/失败/);callback(null,{data:null,width:0,height:0});await invalid;
    assert.equal(timers.size,0);console.log('PASS artwork: UUID lookup supports hashed builds, one temporary reference, idempotent dispose, missing image and late timeout');
}
(async()=>{await cases();await artCases()})().catch(error=>{console.error(error);process.exitCode=1});
