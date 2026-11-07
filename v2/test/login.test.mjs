import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir,readdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {LoginEngine} from '../login/engine.mjs';
import {validateCompany} from '../login/contracts.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from '../shared/leases.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),company=JSON.parse(await readFile(path.join(root,'test/fixtures/insta360.login.json'),'utf8'));
const phone='13800001234',auth={login:true,evidence:'synthetic_user_authorization'};
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'login-v2-')),profileFile=path.join(dir,'profile.json');
 await writeFile(profileFile,JSON.stringify({schemaVersion:1,entities:{},sources:{synthetic:{}},facts:{'contact.phone.cn':{status:'known',value:phone,sourceIds:['synthetic']}}}));
 const o={url:company.origin+company.loginPath,readAt:new Date().toISOString(),account:null,form:true,country:'+65',phone:'',otpPresent:true,sendLabel:'获取验证码',sendDisabled:false,submitLabel:'登录',consent:false,dialogs:0,challenges:0,errors:0,popupTitle:null,popupBody:null},actions=[];
 const browser={locate:async()=>o.url,observe:async()=>({...o}),inventory:async()=>[{type:'text',placeholder:'手机号码',selector:'input'}],act:async(c,url,a,value)=>{actions.push({method:a.method,selector:a.selector});if(a.method==='dropdown')o.country='+86';if(a.selector===c.fields.phone)o.phone=value;if(a.selector===c.consent.openSelector){o.dialogs=1;o.popupTitle='隐私声明';o.popupBody='生效日期：2024年2月5日\n测试声明';}if(a.selector===c.popups[0].closeSelector){o.dialogs=0;o.popupTitle=null;o.popupBody=null;}if(a.selector===c.fields.consent)o.consent=value;if(a.selector===c.fields.send){o.sendLabel='59 秒后重试';o.sendDisabled=true;}if(a.selector===c.fields.submit){o.account='1380****234';o.form=false;o.errors=0;o.url=c.origin+'/campus/position/list';}}};
 const engine=new LoginEngine({companyRoot:path.join(root,'test/fixtures'),privateRoot:path.join(dir,'runtime'),profileFile,browser,leaseRoot:path.join(dir,'leases')});
 try{await fn({dir,profileFile,engine,o,actions});}finally{await rm(dir,{recursive:true,force:true});}
}
test('company cannot replace login with application-submit action',()=>{const c=structuredClone(company);c.fields.submitLabel='提交简历';assert.throws(()=>validateCompany(c),/LOGIN_ACTION_NOT_ALLOWED/);});
test('compile is offline and changed account invalidates plan before browser writes',()=>fixture(async({engine,profileFile,actions})=>{const p=await engine.compile({companyId:'insta360',pageUrl:company.origin+company.loginPath});const profile=JSON.parse(await readFile(profileFile));profile.facts['contact.phone.cn'].value='13900001234';await writeFile(profileFile,JSON.stringify(profile));await assert.rejects(engine.prepare({...p,authorization:auth}),/LOGIN_ACCOUNT_CHANGED/);assert.equal(actions.length,0);}));
test('unknown popup is blocked without input or dismiss',()=>fixture(async({engine,o,actions})=>{o.dialogs=1;o.popupTitle='未知权限';const p=await engine.compile({companyId:'insta360',pageUrl:o.url});await assert.rejects(engine.prepare({...p,authorization:auth}),/UNKNOWN_LOGIN_POPUP/);assert.equal(actions.length,0);}));
test('existing authenticated session is reused without matching personal identity',()=>fixture(async({engine,o,actions})=>{o.account='1390****888';o.form=false;const p=await engine.compile({companyId:'insta360',pageUrl:o.url});assert.equal((await engine.prepare({...p,authorization:auth})).status,'authenticated');assert.equal(actions.length,0);}));
test('successful session reuse does not send SMS',()=>fixture(async({engine,o,actions})=>{o.account='1380****234';o.form=false;const p=await engine.compile({companyId:'insta360',pageUrl:o.url});const r=await engine.prepare({...p,authorization:auth});assert.equal(r.status,'authenticated');assert.equal(r.smsSent,false);assert.equal(actions.length,0);}));
test('an undecided switch leaves the login consent to the user before any write',()=>fixture(async({engine,o,actions})=>{o.dialogs=1;o.popupTitle='隐私声明';const p=await engine.compile({companyId:'insta360',pageUrl:o.url});const r=await engine.prepare({...p,authorization:auth});assert.equal(r.status,'needs_user_login');assert.equal(r.method,'user_operated_consent');assert.equal(r.handoff.nextTool,'role_resume');assert.equal(r.businessAuthorization.reason,'BUSINESS_AUTHORIZATION_SWITCH_REQUIRED');assert.equal(actions.length,0);await assert.rejects(engine.send({...p,authorization:auth}),/PRIVACY_ACCEPTANCE_REQUIRED/);}));
test('switch 1 handles the open declaration, selects the country and ticks consent without opening the policy',()=>fixture(async({engine,o,profileFile,actions})=>{const profile=JSON.parse(await readFile(profileFile));profile.policy={businessAuthorization:1};await writeFile(profileFile,JSON.stringify(profile));o.dialogs=1;o.popupTitle='隐私声明';const p=await engine.compile({companyId:'insta360',pageUrl:o.url});const r=await engine.prepare({...p,authorization:auth});assert.equal(r.status,'ready_to_request_sms');assert.equal(o.dialogs,0);assert.equal(o.country,'+86');assert.equal(o.phone,phone);assert.equal(o.consent,true);assert.equal(actions.filter(a=>a.selector===company.consent.openSelector).length,0);assert.equal(actions.filter(a=>a.selector===company.fields.send).length,0);const saved=JSON.parse(await readFile(profileFile));assert.deepEqual(saved.policy,{businessAuthorization:1});}));
test('actual origin lock shared with application engine prevents login mutation',()=>fixture(async({engine,o,actions})=>{const p=await engine.compile({companyId:'insta360',pageUrl:o.url});const release=await acquireLease(leasePath(engine.leaseRoot,'recruiting-origin:'+company.origin));try{await assert.rejects(engine.prepare({...p,authorization:auth}),/COMPANY_ALREADY_RUNNING/);assert.equal(actions.length,0);}finally{await release();}}));
test('full synthetic login under switch 1 limits sends and never stores OTP',()=>fixture(async({engine,o,dir,profileFile})=>{
 const profile=JSON.parse(await readFile(profileFile));profile.policy={businessAuthorization:1};await writeFile(profileFile,JSON.stringify(profile));const p=await engine.compile({companyId:'insta360',pageUrl:o.url});const prepared=await engine.prepare({...p,authorization:auth});
 const accepted={acceptanceId:prepared.acceptanceId};assert.ok(accepted.acceptanceId);
 const sent=await engine.send({...p,authorization:auth,acceptanceId:accepted.acceptanceId});assert.equal(sent.status,'waiting_user_otp');
 await assert.rejects(engine.send({...p,authorization:auth,acceptanceId:accepted.acceptanceId}),/SMS_CONTROL_NOT_READY|SMS_PRECONDITION_CHANGED|SMS_COOLDOWN_ACTIVE/);
 const r=await engine.verify({...p,authorization:auth,challengeId:sent.challengeId,code:'123456'});assert.equal(r.readyForApplication,true);assert.equal(r.status,'authenticated');
 for(const group of await readdir(path.join(dir,'runtime'))){for(const file of await readdir(path.join(dir,'runtime',group))){const text=await readFile(path.join(dir,'runtime',group,file),'utf8');assert.equal(text.includes('123456'),false);assert.equal(text.includes(phone),false);}}
}));
test('real stdio MCP lists login tools and reports unavailable shared host without reconnect',()=>fixture(async({dir,profileFile})=>{const c=new Client({name:'login-protocol-test',version:'1'});try{await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'login/server.mjs')],env:{PATH:process.env.PATH,RECRUITING_PROFILE_JSON:profileFile,RECRUITING_LOGIN_PRIVATE_DIR:path.join(dir,'runtime'),RECRUITING_BROWSER_SOCKET:path.join(dir,'absent.sock'),RECRUITING_HANDOFF_DIR:path.join(dir,'handoff')},stderr:'pipe'}));const listed=await c.listTools();assert.ok(listed.tools.some(t=>t.name==='login_verify_otp'));assert.ok(listed.tools.some(t=>t.name==='login_batch_prepare'));assert.ok(listed.tools.some(t=>t.name==='login_resume_verification'));assert.equal(listed.tools.some(t=>/verification_(prepare|execute)$/.test(t.name)),false);const r=await c.callTool({name:'login_browser_status',arguments:{}});const status=JSON.parse(r.content[0].text);assert.equal(status.channels.chrome.state,'unavailable');assert.equal(status.channels.chrome.error,'BROWSER_HOST_NOT_AVAILABLE');assert.equal(status.channels.iab.state,'host_bridge_required');}finally{await c.close();}}));

test('human verification resumes without any browser mutation and excludes CAPTCHA waiting time',()=>fixture(async({engine,o,actions})=>{
 const p=await engine.compile({companyId:'insta360',pageUrl:o.url});
 const challenge={id:'synthetic-human',planId:p.planId,companyId:'insta360',sentAt:new Date(Date.now()-600000).toISOString(),attempts:1,otpAttempts:0,status:'needs_user_verification'};
 await engine.store.put('challenges','insta360',challenge);
 o.challenges=1;
 const waiting=await engine.resumeVerification({...p,challengeId:challenge.id});assert.equal(waiting.status,'needs_user_verification');assert.equal(waiting.handoff.automaticSolve,false);
 o.challenges=0;
 const uncertain=await engine.resumeVerification({...p,challengeId:challenge.id});assert.equal(uncertain.status,'verification_completed_sms_unverified');assert.equal(uncertain.smsSent,false);
 o.sendLabel='55 秒后重试';o.sendDisabled=true;
 const sent=await engine.resumeVerification({...p,challengeId:challenge.id});assert.equal(sent.status,'waiting_user_otp');
 const stored=await engine.store.get('challenges','insta360');assert.ok(Date.now()-Date.parse(stored.smsConfirmedAt)<10000);
 await engine.resumeVerification({...p,challengeId:challenge.id});assert.equal((await engine.store.get('challenges','insta360')).smsConfirmedAt,stored.smsConfirmedAt);
 assert.equal(actions.length,0);
 await assert.rejects(engine.resumeVerification({...p,challengeId:'another'}),/VERIFICATION_CHALLENGE_CHANGED/);
}));

test('global ordinary recruiting privacy survives a new login plan without requesting another acceptance',()=>fixture(async({engine,o,profileFile,actions})=>{
 const profile=JSON.parse(await readFile(profileFile));profile.policy={businessAuthorization:1};await writeFile(profileFile,JSON.stringify(profile));
 for(let i=0;i<2;i++){o.consent=false;const plan=await engine.compile({companyId:'insta360',pageUrl:o.url}),result=await engine.prepare({...plan,authorization:auth});assert.equal(result.status,'ready_to_request_sms');assert.equal(result.businessAuthorization.decision,'allow');assert.equal(result.businessAuthorization.permanent,true);assert.equal(result.privacyReused,true);}
 assert.equal(actions.filter(a=>a.selector===company.fields.consent).length,2);assert.equal(actions.filter(a=>a.selector===company.fields.send).length,0);
}));
test('switch 0 never ticks the login consent and hands this login to the user without asking again',()=>fixture(async({engine,o,profileFile,actions})=>{
 const profile=JSON.parse(await readFile(profileFile));profile.policy={businessAuthorization:0};await writeFile(profileFile,JSON.stringify(profile));
 const plan=await engine.compile({companyId:'insta360',pageUrl:o.url}),result=await engine.prepare({...plan,authorization:auth});assert.equal(result.status,'needs_user_login');assert.equal(result.businessAuthorization.reason,'BUSINESS_AUTHORIZATION_OFF');assert.equal(result.handoff.nextTool,'role_resume');assert.equal(actions.length,0);
}));

test('withdrawal after preparation invalidates an old acceptance before sending SMS or consuming an OTP',async()=>{
 for(const stage of ['sms','otp'])await fixture(async({engine,o,profileFile,actions})=>{
  const profile=JSON.parse(await readFile(profileFile));profile.policy={businessAuthorization:1};await writeFile(profileFile,JSON.stringify(profile));
  const plan=await engine.compile({companyId:'insta360',pageUrl:o.url}),prepared=await engine.prepare({...plan,authorization:auth});let sent;
  if(stage==='otp')sent=await engine.send({...plan,authorization:auth,acceptanceId:prepared.acceptanceId});
  const latest=JSON.parse(await readFile(profileFile));latest.policy.businessAuthorization=0;await writeFile(profileFile,JSON.stringify(latest));const writes=actions.length;
  await assert.rejects(stage==='sms'?engine.send({...plan,authorization:auth,acceptanceId:prepared.acceptanceId}):engine.verify({...plan,authorization:auth,challengeId:sent.challengeId,code:'123456'}),/BUSINESS_AUTHORIZATION_OFF/);assert.equal(actions.length,writes);
 });
});
