import test from 'node:test';
import assert from 'node:assert/strict';
import {LoginEngine} from '../login/engine.mjs';
test('authenticated session does not need a personal account fact',async()=>{
 const e=new LoginEngine({privateRoot:'/unused-session-test',browser:{locate:async()=> 'https://example.test/form',observe:async()=>({authenticated:true,form:false,dialogs:0})}});
 e.profile=async()=>({facts:{}});
 const c={origin:'https://example.test',allowedPaths:['/'],loginMethod:'user_operated',account:{source:'missing'}};
 assert.equal(e.publicState(await e.state(c,'https://example.test/form')).status,'authenticated');
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
test('ready review is returned without touching the form',async()=>{const {f,calls}=flowFixture({status:'ready_for_user_review',pageId:'bound',verifyRunId:'v'});const r=await f.advance({authorization});assert.equal(r.verifyRunId,'v');assert.deepEqual(calls,[]);});
test('entry requires preparation login authority before using a queue',async()=>{const {f,calls}=flowFixture();await assert.rejects(f.advance({}),/LOGIN_AUTHORIZATION_REQUIRED/);assert.deepEqual(calls,[]);});
import vm from 'node:vm';import {loginStateDOM} from '../shared/login-state.mjs';
function domState({url='/job',selectors={},buttons=[]}){
 const n=text=>({textContent:text,getClientRects:()=>[{}]});
 const document={querySelectorAll:s=>s==='a,button,[role="button"]'?buttons.map(n):(selectors[s]||[]).map(n)};
 return JSON.parse(JSON.stringify(vm.runInNewContext('('+loginStateDOM.toString()+')({accountSelector:".session"})',{document,location:{pathname:url},getComputedStyle:()=>({visibility:'visible'})})));
}
test('logout control proves login even with no account text',()=>{assert.equal(domState({buttons:['退出登录']}).sessionStatus,'authenticated');});
test('login URL takes priority over a stale session marker',()=>{assert.equal(domState({url:'/campus/login',selectors:{'.session':['']}}).sessionStatus,'logged_out');});
test('public page login control yields waiting rather than URL failure',()=>{assert.equal(domState({buttons:['登录/注册']}).sessionStatus,'logged_out');});
test('empty page is unknown and cannot authorize filling',()=>{assert.equal(domState({}).sessionStatus,'unknown');});
