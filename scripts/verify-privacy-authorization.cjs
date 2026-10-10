const assert = require('node:assert/strict');
const vm = require('node:vm');
const {compileForWechat} = require('./verify-release-compat.cjs');
const noop = () => {};
function load(file, imports, extras = {}) {
    const exports = {};
    vm.runInNewContext(compileForWechat(file), {exports, require: imports, console: {log:noop,warn:noop}, ...extras});
    return exports;
}
function privacyCases() {
    let api, need, auth, setting, dialog, shown = 0, closed = 0, registered = 0, passed = 0, failed = 0;
    let next = 0; const timers = new Map(), events = [];
    const clock = {setTimeout: fn => {timers.set(++next, fn); return next;}, clearTimeout: id => timers.delete(id)};
    const fire = () => {for (const [id, fn] of Array.from(timers)) {timers.delete(id); fn();}};
    let show = (name, actions) => {
        assert.equal(name, '《拇指琴隐私保护指引》'); shown++; dialog = actions;
        return () => {closed++;};
    };
    const {requestImagePrivacyAuthorization: request} = load('assets/scripts/manager/WeChatPrivacyAuthorization.ts',
        id => id.endsWith('WeChatNative') ? {getWx: () => api} : {showPrivacyConsentDialog: (...args) => show(...args)}, clock);
    api = {
        onNeedPrivacyAuthorization: fn => {registered++; need=fn;},
        getPrivacySetting: o => {setting=o;},
        requirePrivacyAuthorize: o => {auth=o; need(res => events.push(res.event));},
    };
    const start = () => request(() => passed++, () => failed++);
    let cancel = start();
    assert.equal(events.length,0); assert.equal(shown,0); assert.equal(passed,0);
    setting.success({privacyContractName:'《拇指琴隐私保护指引》'});
    assert.equal(shown,1); assert.equal(events.length,0,'constructing a dialog is not reporting it displayed');
    dialog.agree(); assert.equal(events.length,0,'cannot agree before first render');
    dialog.exposed(); dialog.exposed(); assert.deepEqual(events,['exposureAuthorization']);
    need(res=>events.push('second:'+res.event)); assert.equal(shown,1,'concurrent platform requests share the visible dialog');
    dialog.agree(); dialog.agree();
    assert.equal(events.filter(e=>e==='agree').length,1); assert.equal(passed,0,'wait for platform confirmation after tap');
    auth.success(); auth.success(); cancel(); assert.equal(passed,1); assert.equal(failed,0); assert.equal(timers.size,0);
    const previousDialog = dialog;
    cancel = start(); assert.equal(registered,1,'one listener per wx instance');
    setting.success({privacyContractName:'《拇指琴隐私保护指引》'}); dialog.exposed(); dialog.disagree();
    assert.equal(failed,1); auth.success(); previousDialog.agree(); assert.equal(passed,1);
    cancel = start(); const lateSetting = setting; cancel(); lateSetting.success({privacyContractName:'《拇指琴隐私保护指引》'});
    assert.equal(shown,2,'late settings do not reopen cancelled dialog');
    start(); fire(); assert.equal(timers.size,0,'settings timeout ends request');
    for (const result of [{}, {privacyContractName:''}, {privacyContractName:123}]) {start(); setting.success(result);}
    start(); setting.fail({errno:1026});
    start(); setting.success({privacyContractName:'《拇指琴隐私保护指引》'});
    const timedOut = dialog; cancel = request(noop, () => failed++);
    timedOut.disagree(); timedOut.agree(); cancel(); assert.equal(passed,1);
    show = () => {throw Error('scene no longer available');};
    start(); setting.success({privacyContractName:'《拇指琴隐私保护指引》'});
    const before = events.length; need(res => events.push(res.event));
    assert.equal(events[before],'disagree','unsolicited events cannot auto-authorize');
    api = {requirePrivacyAuthorize:o=>o.success()}; start(); assert.equal(passed,2,'already-authorized/official fallback uses platform success');
    api = {}; start(); assert.equal(passed,3,'old runtime delegates permission enforcement to picker');
    assert.equal(timers.size,0); assert.ok(closed>=3); assert.ok(failed>=8);
    console.log('PASS custom privacy: real render before exposure, explicit tap, platform confirmation, refusal, duplicate events, timeout, missing policy and stale callbacks');
}

function dialogCases() {
    class Node {
        static EventType={NODE_DESTROYED:'destroyed'};
        constructor(name) {this.name=name;this.children=[];this.components=new Map();this.events=new Map();this.isValid=true;}
        setParent(parent) {parent.children.push(this);}
        setSiblingIndex() {} setPosition() {}
        addComponent(Type) {const c=new Type();this.components.set(Type,c);return c;}
        getComponent(Type) {return this.components.get(Type);}
        on(name, fn) {this.events.set(name,fn);}
        destroy() {this.isValid=false;this.events.get('destroyed')?.();}
    }
    class UITransform {setContentSize(w,h) {this.width=w;this.height=h;}}
    class Graphics {rect(){} roundRect(){} fill(){}}
    class Button {static EventType={CLICK:'click'}; static Transition={SCALE:1}; interactable=true;}
    class Label {static HorizontalAlign={CENTER:1};static VerticalAlign={CENTER:1};static Overflow={SHRINK:1};}
    const canvas=new Node('Canvas');canvas.addComponent(UITransform).setContentSize(1280,720);
    let render, contract, agree=0, disagree=0, exposed=0;
    const cc={Node,UITransform,Graphics,Button,Label,Color:class {},BlockInputEvents:class {},
        Director:{EVENT_AFTER_DRAW:'draw'},director:{getScene:()=>({getChildByName:()=>canvas}),
            once:(event,fn)=>{render=fn;},off:(event,fn)=>{if(render===fn)render=null;}},isValid:n=>n?.isValid};
    const view=load('assets/scripts/view/PrivacyConsentDialog.ts',id=>id==='cc'?cc:{getWx:()=>({openPrivacyContract:o=>{contract=o;}})});
    let close=view.showPrivacyConsentDialog('《隐私保护指引》',{exposed:()=>exposed++,agree:()=>agree++,disagree:()=>disagree++});
    assert.equal(exposed,0); render(); assert.equal(exposed,1);
    const root=canvas.children[0], panel=root.children[0];
    const click=name=>{const n=panel.children.find(n=>n.name===name);if(n.getComponent(Button).interactable)n.events.get('click')();};
    click('ReadPrivacyContract'); assert.equal(agree,0); contract.fail(); click('Agree'); assert.equal(agree,0,'failed policy read blocks agreement');
    click('ReadPrivacyContract'); contract.success(); assert.equal(agree,0,'opening contract never grants consent');
    click('Agree'); assert.equal(agree,1); close(); click('Agree'); assert.equal(agree,1,'closed dialog cannot authorize');
    assert.equal(disagree,0,'programmatic close does not impersonate refusal');
    view.showPrivacyConsentDialog('《隐私保护指引》',{exposed:noop,agree:noop,disagree:()=>disagree++});
    canvas.children[1].destroy(); assert.equal(disagree,1,'scene destruction cancels pending authorization');
    console.log('PASS privacy dialog: policy link, blocked/failed reads, actual consent button and scene destruction');
}
module.exports = async () => {privacyCases();dialogCases();};
if (require.main === module) module.exports().catch(error=>{console.error(error);process.exitCode=1;});
