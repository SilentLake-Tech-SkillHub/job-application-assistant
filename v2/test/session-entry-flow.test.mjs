import test from 'node:test';
import assert from 'node:assert/strict';
import {LoginEngine} from '../login/engine.mjs';
// C32：登录阶段只认登录页是否消失；账号文本不参与，真正是否已登录由岗位入口点击证明。
test('the login stage completes when the login page is gone, without any account fact or account text',async()=>{
 let observed={form:false,dialogs:0};
 const e=new LoginEngine({privateRoot:'/unused-session-test',browser:{locate:async()=> 'https://example.test/form',observe:async()=>observed}});
 e.profile=async()=>({facts:{}});
 const c={origin:'https://example.test',allowedPaths:['/'],loginMethod:'user_operated',account:{source:'missing'}};
 assert.equal(e.publicState(await e.state(c,'https://example.test/form')).status,'authenticated');
 observed={form:true,account:'me',authenticated:true,dialogs:0};
 assert.equal(e.publicState(await e.state(c,'https://example.test/form')).status,'logged_out');
});
import {RoleFlow} from '../shared/role-flow.mjs';
function flowFixture(prior){
 const calls=[],f=new RoleFlow({queues:{task:async()=>({t:{taskId:'task'}}),read:async()=>prior||{},put:async()=>{}},login:{prepare:async()=>{calls.push('login');return {status:'needs_user_login'};}}});
 f.open=async()=>{calls.push('open');return {status:'authenticated_at_role'};};
 f.resume=async()=>{calls.push('resume');return {status:'authenticated_at_role'};};
 f.enter=async()=>{calls.push('enter');return {status:'ready_to_fill'};};return {f,calls};
}
const authorization={login:true,evidence:'User requests preparation'};
test('one entry request opens and enters without intermediate agent dispatch',async()=>{const {f,calls}=flowFixture();assert.equal((await f.advance({authorization})).status,'ready_to_fill');assert.deepEqual(calls,['open','enter']);});
test('user confirmation resumes the same task before entering',async()=>{const {f,calls}=flowFixture({pageId:'bound'});await f.advance({authorization});assert.deepEqual(calls,['resume','enter']);});
test('logged-out result waits for user and never enters',async()=>{const {f,calls}=flowFixture();f.open=async()=>({status:'needs_login',pageId:'bound',loginPlan:{planId:'p',planHash:'h'}});const r=await f.advance({authorization});assert.equal(r.status,'needs_user_login');assert.equal(r.continuation.requiresUser,true);assert.deepEqual(calls,['login']);});
test('entry click landing on login hands off to login, then the same task resumes and clicks again',async()=>{
 const {f,calls}=flowFixture();let entries=0;f.enter=async()=>{calls.push('enter');return ++entries===1?{status:'needs_login',pageId:'bound',loginPlan:{planId:'p',planHash:'h'}}:{status:'ready_to_fill'};};
 f.login.prepare=async()=>{calls.push('login');return {status:'authenticated'};};
 assert.equal((await f.advance({authorization})).status,'ready_to_fill');assert.deepEqual(calls,['open','enter','login','resume','enter']);
});
test('entry click landing on login with the user still to log in waits for the user',async()=>{
 const {f,calls}=flowFixture();f.enter=async()=>{calls.push('enter');return {status:'needs_login',pageId:'bound',loginPlan:{planId:'p',planHash:'h'}};};
 const r=await f.advance({authorization});assert.equal(r.status,'needs_user_login');assert.equal(r.continuation.requiresUser,true);assert.deepEqual(calls,['open','enter','login']);
});
test('ready review is returned without touching the form',async()=>{const {f,calls}=flowFixture({status:'ready_for_user_review',pageId:'bound',verifyRunId:'v'});const r=await f.advance({authorization});assert.equal(r.verifyRunId,'v');assert.deepEqual(calls,[]);});
test('entry requires preparation login authority before using a queue',async()=>{const {f,calls}=flowFixture();await assert.rejects(f.advance({}),/LOGIN_AUTHORIZATION_REQUIRED/);assert.deepEqual(calls,[]);});
import vm from 'node:vm';import {loginStateDOM} from '../shared/login-state.mjs';
function domState({url='/job',selectors={},buttons=[],texts=[],dialogs=[]}){
 const el=o=>{o=typeof o==='string'?{text:o}:o;return {textContent:o.text||'',childNodes:[{nodeType:3,textContent:o.own??o.text??''}],getClientRects:()=>o.hidden?[]:[{}],hasAttribute:k=>!!o.attrs?.[k],cursor:o.cursor||'auto',type:o.type||'text',autocomplete:o.autocomplete||'',placeholder:o.placeholder||'',querySelectorAll:s=>s==='input'?(o.inputs||[]).map(el):[]};};
 const document={querySelectorAll:s=>s==='a,button,[role="button"],[role="link"]'?buttons.map(el):s==='span,div,li,p,em,strong'?texts.map(el):s==='[role="dialog"],[aria-modal="true"],dialog[open]'?dialogs.map(el):(selectors[s]||[]).map(el)};
 return JSON.parse(JSON.stringify(vm.runInNewContext('('+loginStateDOM.toString()+')({loginRoot:".login"})',{document,location:{pathname:url},getComputedStyle:n=>({visibility:'visible',cursor:n.cursor})})));
}
// C32：只识别登录页；退出登录按钮、账号文本都不再被当成“已登录”的证据。
test('a logout control is not login evidence; only login-page identification is returned',()=>{assert.deepEqual(domState({buttons:['退出登录']}),{loginFormPresent:false});});
test('login URL marks the login page',()=>{assert.deepEqual(domState({url:'/campus/login'}),{loginFormPresent:true});});
test('a visible login control or configured login root marks the login page',()=>{assert.equal(domState({buttons:['登录/注册']}).loginFormPresent,true);assert.equal(domState({selectors:{'.login':['x']}}).loginFormPresent,true);});
test('an empty page is not a login page and carries no login claim',()=>{assert.deepEqual(domState({}),{loginFormPresent:false});});
// C42（2026-11-16）：没登录时不跳登录页的站点——页头可点的“登录”文字、登录对话框也算；申请表上的手机号与普通文字不算。
test('a clickable header text login entry that is not a button marks the page as needing login',()=>{
 assert.equal(domState({texts:[{text:'登录',cursor:'pointer'}]}).loginFormPresent,true);
 assert.equal(domState({texts:[{text:'请登录',attrs:{onclick:true}}]}).loginFormPresent,true);
 assert.equal(domState({texts:[{text:'登录'}]}).loginFormPresent,false);
 assert.equal(domState({texts:[{text:'已有账号？登录',cursor:'pointer'}]}).loginFormPresent,false);
 assert.equal(domState({texts:[{text:'登录',cursor:'pointer',hidden:true}]}).loginFormPresent,false);
 assert.equal(domState({buttons:['登录 | 注册']}).loginFormPresent,true);
});
test('a login dialog with phone or code inputs marks the page as needing login; a form dialog without login wording does not',()=>{
 assert.equal(domState({dialogs:[{text:'手机号登录 获取验证码',inputs:[{type:'tel'}]}]}).loginFormPresent,true);
 assert.equal(domState({dialogs:[{text:'验证码登录',inputs:[{placeholder:'请输入验证码'}]}]}).loginFormPresent,true);
 assert.equal(domState({dialogs:[{text:'编辑简历 手机号',inputs:[{type:'tel'}]}]}).loginFormPresent,false);
 assert.equal(domState({dialogs:[{text:'手机号登录',inputs:[{type:'tel',hidden:true}],hidden:true}]}).loginFormPresent,false);
});

import {continuationFor} from '../shared/workflow-continuation.mjs';
test('ready compiled plan does not request an inactive optional branch answer',()=>{const result=continuationFor({plan:{readyForExecution:true,counts:{needs_user:0,inactive:1}},template:{pages:[{fields:[{id:'inactive',source:'missing.answer',when:{source:'choice',equals:'other'}}]}]},profile:{facts:{}}});assert.equal(result.requiresUser,false);assert.deepEqual(result.nextTools,['role_prepare']);});
