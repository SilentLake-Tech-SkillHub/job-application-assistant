import test from 'node:test';
import assert from 'node:assert/strict';
import {locationFor,firstEntryConfig,EntryConfigs,collectEntryConfigReports,FIRST_ENTRY_RULE,FIRST_ENTRY_MODE} from '../shared/entry-config-supplement.mjs';
import {observeFirstEntry,FIRST_ENTRY} from '../shared/first-entry.mjs';
import {resolveEntry} from '../shared/entry-recipe.mjs';
import {transitionLocationMatches} from '../shared/entry-transition.mjs';
import {RoleFlow} from '../shared/role-flow.mjs';
import {pyJson} from '../shared/company-directory.mjs';
import {inventoryEntryPage} from '../shared/first-entry.mjs';
import {safeControlErrorDetails} from '../shared/control-error-details.mjs';
import {FALLBACK_ENTRY_RULE} from '../shared/entry-config-supplement.mjs';
import {executeTransition} from '../shared/entry-transition.mjs';
// C39（2026-11-16，用户“2.同意 3A”）：站点没有入口配置时，组件读出岗位标题和投递按钮、点一次入口，按落地的申请页写入首版入口配置。

const UUID='5f3c1a2b-7d4e-4c6f-9a8b-0c1d2e3f4a5b';
test('location rules write the role id as $roleId or a named group wherever it sits, and anchor the rest literally',()=>{
 const q=locationFor(`https://ke.example/campus/detail?jobAdId=${UUID}&utm=x`,UUID);
 assert.deepEqual(q,{location:{pathnamePattern:'^/campus/detail$',query:{jobAdId:'$roleId'}},identity:{source:'query',parameter:'jobAdId'}});
 const p=locationFor('https://jobs.example/campus/position/7697164161813334282/detail','7697164161813334282');
 assert.equal(p.identity.source,'pathname');assert.ok(new RegExp(p.location.pathnamePattern).test('/campus/position/123/detail'));assert.equal(new RegExp(p.identity.pattern).exec('/campus/position/123/detail').groups.roleId,'123');
 const h=locationFor(`https://moka.example/campus_apply/37/58016#/job/${UUID}`,UUID);
 assert.equal(h.location.pathnamePattern,'^/campus_apply/37/58016$');assert.equal(h.identity.source,'hashPath');assert.equal(new RegExp(h.location.hashPathPattern).exec('/job/abc').groups.roleId,'abc');
 const hq=locationFor('https://spa.example/app/#/apply?id=99881','99881');assert.deepEqual(hq.location.hashQuery,{id:'$roleId'});assert.equal(hq.identity.source,'hashQuery');
 assert.equal(locationFor('https://x.example/form','42').identity,null);
 // 编号是更长数字的一部分、或在路径里出现两次：不当作岗位编号所在处。
 assert.equal(locationFor('https://x.example/job/1234567','4567').identity,null);
 assert.equal(locationFor('https://x.example/77/job/77','77').identity,null);
});

const current={schemaVersion:1,companyId:'C00105',version:1,origin:'https://ke.example',loginMethod:'user_operated',loginPath:'/campus/detail?jobAdId='+UUID,allowedPaths:['/campus/'],success:{noApplicationSubmission:true,requiresLoginFormAbsent:true},evidence:{sourceUrl:'https://ke.example/campus/detail?jobAdId='+UUID,capturedAt:'2026-10-26',method:'m'}};
const observed=(o={})=>({pageId:'p1',target:'same',detailUrl:`https://ke.example/campus/detail?jobAdId=${UUID}`,pageUrl:`https://ke.example/form?fromPage=job&jobAdId=${UUID}`,detailTitle:{heading:'h1',path:'body > div:nth-of-type(1) > h1:nth-of-type(1)'},entryLocator:{role:'button',name:'立即投递',label:'立即投递'},formFieldsVisible:true,formTitle:{heading:null,path:null},formFieldSelector:FIRST_ENTRY.formFieldSelector,...o});
const now=()=>'2026-11-16T01:00:00.000Z';
test('the first entry config is a valid declarative entry; an off-scope form widens allowed paths by the first-login-config rule',()=>{
 const next=firstEntryConfig({current,observed:observed(),roleId:UUID,siteUrls:[current.evidence.sourceUrl],now});
 const e=resolveEntry(next);
 assert.equal(e.kind,'declarative_transition');assert.equal(e.target,'same');assert.equal(e.detail.roleSelector,'h1');assert.deepEqual(e.detail.roleIdentity,{source:'query',parameter:'jobAdId'});
 assert.deepEqual(e.form.location,{pathnamePattern:'^/form$',query:{jobAdId:'$roleId'}});assert.equal(e.form.roleSelector,undefined);assert.equal(e.allowProvenanceIdentity,undefined);
 assert.deepEqual(e.entryLocator,{role:'button',name:'立即投递',label:'立即投递'});assert.equal(e.form.readySelector,FIRST_ENTRY.formFieldSelector);
 assert.deepEqual(next.allowedPaths,['/']);assert.equal(next.version,2);assert.deepEqual(next.confirmation,{mode:FIRST_ENTRY_MODE,rule:FIRST_ENTRY_RULE,confirmedAt:now()});
 assert.ok(transitionLocationMatches(e.form.location,`https://ke.example/form?fromPage=job&jobAdId=${UUID}`,UUID));assert.ok(!transitionLocationMatches(e.detail.location,`https://ke.example/form?jobAdId=${UUID}`,UUID));
 const inScope=firstEntryConfig({current:{...current,allowedPaths:['/']},observed:observed(),roleId:UUID,now});assert.deepEqual(inScope.allowedPaths,['/']);
});
test('a shared form retains optional title evidence and continues without a job ID or title',()=>{
 const noId={pageUrl:'https://ke.example/apply/form'};
 const titled=firstEntryConfig({current,observed:observed({...noId,formTitle:{heading:null,path:'body > div:nth-of-type(2) > span:nth-of-type(1)'}}),roleId:UUID,now});
 assert.equal(titled.entry.form.roleSelector,'body > div:nth-of-type(2) > span:nth-of-type(1)');assert.equal(titled.entry.allowProvenanceIdentity,undefined);
 // C48 K7：真实入口点击已到可见表单，无岗位标题/编号也继续。
 const shared=firstEntryConfig({current,observed:observed(noId),roleId:UUID,now});
 assert.equal(shared.entry.allowProvenanceIdentity,true);assert.equal(shared.entry.form.roleSelector,undefined);
 // 地址能核对岗位编号时，结构路径（随版式变）不写进配置。
 assert.equal(firstEntryConfig({current,observed:observed({formTitle:{heading:null,path:'body > p:nth-of-type(1)'}}),roleId:UUID,now}).entry.form.roleSelector,undefined);
});
test('the first entry config refuses unusable observations instead of guessing',()=>{
 assert.throws(()=>firstEntryConfig({current,observed:observed({detailUrl:'https://ke.example/campus/detail'}),roleId:UUID,now}),/APPLICATION_ENTRY_FIRST_ROLE_ID_NOT_IN_LINK/);
 assert.throws(()=>firstEntryConfig({current,observed:observed({pageUrl:'https://other.example/form?jobAdId='+UUID}),roleId:UUID,now}),/APPLICATION_ENTRY_FIRST_LANDING_SCOPE_CHANGED/);
 assert.throws(()=>firstEntryConfig({current,observed:observed({pageUrl:`https://ke.example/campus/detail?jobAdId=${UUID}&apply=1`}),roleId:UUID,now}),/APPLICATION_ENTRY_FIRST_LOCATION_AMBIGUOUS/);
 assert.throws(()=>firstEntryConfig({current:{...current,entry:{recipe:'x'}},observed:observed(),roleId:UUID,now}),/APPLICATION_ENTRY_FIRST_CONFIG_EXISTS/);
 assert.throws(()=>firstEntryConfig({current,observed:observed({pageUrl:'https://ke.example/form/123456789012',formTitle:{heading:'h2',path:null}}),roleId:UUID,now}),/APPLICATION_ENTRY_FIRST_CONFIG_INVALID/);
});

function directory(config){
 const state={config,writes:[]};
 return {state,loginConfig:async()=>structuredClone(state.config),roles:async()=>[{siteId:'S0050',url:current.evidence.sourceUrl},{siteId:'S0099',url:'https://other.example/x'}]};
}
test('EntryConfigs writes once through the master script, reads back and reports what it wrote',async()=>{
 const d=directory(structuredClone(current));
 const configs=new EntryConfigs({directory:d,leaseRoot:'/tmp/c39-leases-'+process.pid,now,write:async item=>{d.state.writes.push(item);d.state.config=item.config;}});
 const result=await collectEntryConfigReports(async()=>({status:'ready_to_fill',...await configs.create({companyId:'C00105',siteId:'S0050',roleId:UUID,observed:observed()})}));
 assert.equal(result.created,true);assert.equal(d.state.writes.length,1);
 const [w]=d.state.writes;assert.equal(w.quote,FIRST_ENTRY_RULE);assert.equal(w.company,'C00105');assert.equal(w.site,'S0050');
 const {createHash}=await import('node:crypto');assert.equal(w.expectedSha,createHash('sha256').update(pyJson(current)).digest('hex'));
 assert.equal(result.entryConfigsCreated.length,1);const [r]=result.entryConfigsCreated;
 assert.deepEqual([r.companyId,r.siteId,r.target,r.entryLabel,r.roleIdInFormUrl,r.version],['C00105','S0050','same','立即投递',true,2]);assert.deepEqual(r.allowedPaths,{from:['/campus/'],to:['/']});
 const again=await configs.create({companyId:'C00105',siteId:'S0050',roleId:UUID,observed:observed()});assert.equal(again.created,false);assert.equal(d.state.writes.length,1);
});
test('a write that does not read back identically is not reported and does not continue',async()=>{
 const d=directory(structuredClone(current));
 const configs=new EntryConfigs({directory:d,leaseRoot:'/tmp/c39-leases-'+process.pid,now,write:async item=>{d.state.config={...item.config,version:9};}});
 const result=collectEntryConfigReports(()=>configs.create({companyId:'C00105',siteId:'S0050',roleId:UUID,observed:observed()}));
 await assert.rejects(result,/APPLICATION_ENTRY_FIRST_CONFIG_READBACK_FAILED/);
});

// 浏览器侧：只读标题、找唯一按钮、点一次，报告落地页。
function fakeTab({id,url,title='后端开发工程师',buttons=[],fields=false,frames=0,hit={covered:false,disabled:false,coverTag:null,coverDialog:false},dialogs=0}){
 const tab={id,url,title,buttons,fields,frames,hit,dialogs,clicks:0};
 const loc=(count,{text='',visible=true,click,hits=[]}={})=>({count:async()=>count,innerText:async()=>text,isVisible:async()=>visible,evaluate:async fn=>String(fn).includes('elementFromPoint')?tab.hit:String(fn).includes('dialog')?tab.dialogs:'body > h1:nth-of-type(1)',filter:()=>loc(count,{text,visible,click,hits}),first:()=>loc(count,{text,visible,click,hits}),
  nth:i=>({...loc(1,{text,visible,click:hits[i]?.click}),evaluate:async fn=>String(fn).includes('elementFromPoint')?tab.hit:hits[i]?.top??0}),
  waitFor:async()=>{if(!count||!visible)throw Error('timeout');},click:async()=>{tab.clicks++;await click?.();}});
 tab.page={url:async()=>tab.url,
  locator:s=>{if(s==='body')return loc(1);if(s==='h1:visible'||s==='h1'||s==='body > h1:nth-of-type(1)')return loc(tab.title?1:0,{text:tab.title});if(s===FIRST_ENTRY.formFieldSelector)return loc(tab.fields?1:0);if(s==='iframe')return loc(tab.frames);return loc(0);},
  getByRole:(role,{name})=>{const hits=tab.buttons.filter(b=>b.role===role&&b.label===name);return loc(hits.length,{text:name,click:hits[0]?.click,hits});},
  getByText:(label)=>loc(0,{text:label})};
 return tab;
}
function fakeHost(tabs){let t=0;return {tabs,getPage:async id=>tabs.find(x=>x.id===id).page,listPages:async()=>tabs.map(x=>({id:x.id,url:x.url})),pause:async()=>{t+=100;},now:()=>t};}
test('the first entry click is observed in the same tab, with the title and the unique entry button recorded',async()=>{
 const detail=fakeTab({id:'d',url:`https://ke.example/campus/detail?jobAdId=${UUID}`});
 detail.buttons=[{role:'button',label:'立即投递',click:async()=>{detail.url=`https://ke.example/form?jobAdId=${UUID}`;detail.fields=true;}}];
 const r=await observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([detail]));
 assert.deepEqual([r.pageId,r.target,r.pageUrl,r.formFieldsVisible,r.detailTitle.heading],['d','same',`https://ke.example/form?jobAdId=${UUID}`,true,'h1']);
 assert.deepEqual(r.entryLocator,{role:'button',name:'立即投递',label:'立即投递'});assert.equal(detail.clicks,1);assert.equal(r.configurationWritten,false);
});
test('a click that opens a new tab reports that tab; zero or several entry buttons are never clicked',async()=>{
 const tabs=[];const detail=fakeTab({id:'d',url:`https://ke.example/campus/detail?jobAdId=${UUID}`});tabs.push(detail);
 detail.buttons=[{role:'link',label:'申请职位',click:async()=>{tabs.push(fakeTab({id:'n',url:`https://ke.example/apply?jobAdId=${UUID}`,fields:true}));}}];
 const r=await observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost(tabs));
 assert.deepEqual([r.pageId,r.target],['n','new']);assert.deepEqual(r.entryLocator,{role:'link',name:'申请职位',label:'申请职位'});
 const two=fakeTab({id:'d',url:detail.url,buttons:[{role:'button',label:'申请职位',top:900},{role:'button',label:'申请职位',top:100}]});
 await assert.rejects(observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([two])),e=>e.message==='APPLICATION_ENTRY_FIRST_BUTTON_NOT_UNIQUE'&&safeControlErrorDetails(e.details).candidates[0].count===2);assert.equal(two.clicks,0);
 const none=fakeTab({id:'d',url:detail.url});
 await assert.rejects(observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([none])),/APPLICATION_ENTRY_FIRST_BUTTON_NOT_FOUND/);
 const still=fakeTab({id:'d',url:detail.url,buttons:[{role:'button',label:'投递'}]});
 await assert.rejects(observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([still])),e=>e.message==='APPLICATION_ENTRY_FIRST_NO_NAVIGATION'&&e.details.check==='navigation');assert.equal(still.clicks,1);
 // 读不到岗位标题：不点（2026-11-16 追加）。
 const untitled=fakeTab({id:'d',url:detail.url,title:'',buttons:[{role:'button',label:'投递'}]});
 await assert.rejects(observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([untitled])),/APPLICATION_ENTRY_FIRST_ROLE_TITLE_NOT_FOUND/);assert.equal(untitled.clicks,0);
});
test('the read-only inventory gives each same-text button its top-to-bottom order without clicking',async()=>{
 const tab=fakeTab({id:'d',url:`https://moka.example/apply/step/1#/job/${UUID}`,buttons:[{role:'button',label:'申请职位',top:900},{role:'button',label:'申请职位',top:100}]});
 const r=await inventoryEntryPage({pageId:'d',expectedTitle:'后端开发工程师'},fakeHost([tab]));
 assert.deepEqual(r.candidates,[{role:'button',label:'申请职位',count:2,domOrder:[1,0]}]);assert.equal(r.detailTitle.heading,'h1');assert.equal(tab.clicks,0);
});
test('first-entry error details keep only generic labels, counts and page facts',()=>{
 assert.deepEqual(safeControlErrorDetails({phase:'first_entry',check:'button',candidates:[{role:'button',label:'申请职位',count:2}]}),{phase:'first_entry',check:'button',candidates:[{role:'button',label:'申请职位',count:2}]});
 assert.deepEqual(safeControlErrorDetails({phase:'first_entry',check:'landing',target:'same',inputs:1,frames:2}),{phase:'first_entry',check:'landing',target:'same',inputs:1,frames:2});
 assert.equal(safeControlErrorDetails({phase:'first_entry',check:'button',candidates:[{label:'后端开发工程师',count:1}]}),null);
 assert.equal(safeControlErrorDetails({phase:'first_entry',check:'landing',url:'https://x.example/form'}),null);
});

// 任务流程：没有入口配置 → 点一次、写首版、按新配置进入；落到登录页 → 交登录、不写；落地不是申请表 → 原错误、不写。
function flow({landing='form',pageTools=['newPage','reload','closePage','firstEntry'],loggedOut=false}={}){
 const calls=[],config={...structuredClone(current)},t={taskId:'task',companyId:'C00105',siteId:'S0050',roleId:'J000231',officialId:UUID,title:'后端开发工程师',url:`https://ke.example/campus/detail?jobAdId=${UUID}`};
 let state={queueId:'q',taskId:'task',pageId:'chrome:d',status:'authenticated_at_role',returnUrl:t.url,originalRoleUrl:t.url,expectedTitle:t.title};
 const formUrl=`https://ke.example/form?jobAdId=${UUID}`;let url=t.url;
 const browser={request:async(method,args)=>{calls.push(method);
  if(method==='status')return {pageTools};
  if(method==='tabs')return [{id:'chrome:d',url}];
  if(method==='roleFirstEntry'){url=landing==='login'?'https://ke.example/login':formUrl;return observed({pageId:'chrome:d',detailUrl:t.url,pageUrl:url,formFieldsVisible:landing!=='none'});}
  if(method==='roleSnapshot')return {pageUrl:url,loginFormPresent:/\/login/.test(url)||(args.pageId==='chrome:d'&&loggedOut)};
  if(method==='roleEnterApplication'){assert.equal(args.entry.kind,'declarative_transition');return {pageId:'chrome:d',pageUrl:url,roleIdentity:{parameter:'jobAdId',value:UUID,source:'query'},roleTitle:null,entryClicked:false};}
  throw Error('unexpected '+method);}};
 const queues={task:async()=>({q:{id:'q',queueHash:'h'},t}),read:async()=>structuredClone(state),put:async(id,v)=>{state=structuredClone(v);}};
 const login={company:async()=>structuredClone(config),locked:async(c,fn)=>fn(),compile:async()=>({planId:'p',planHash:'h'})};
 const entryConfigs={create:async({observed})=>{calls.push('write');config.entry=firstEntryConfig({current:config,observed,roleId:UUID,now}).entry;}};
 const f=new RoleFlow({queues,login,browser,entryConfigs});
 return {f,calls,state:()=>state,config};
}
test('a site without an entry config gets one written from the first click and the same task enters with it',async()=>{
 const {f,calls,state,config}=flow();
 const r=await f.enter({queueId:'q',queueHash:'h',taskId:'task'});
 assert.equal(r.status,'ready_to_fill');assert.ok(config.entry);
 assert.deepEqual(calls.filter(c=>['roleFirstEntry','write','roleEnterApplication'].includes(c)),['roleFirstEntry','write','roleEnterApplication']);
 assert.equal(state().status,'ready_to_fill');assert.equal(state().entryStarted,undefined);
});
test('a first click that lands on the login page hands off to login and writes nothing',async()=>{
 const {f,calls,config}=flow({landing:'login'});
 const r=await f.enter({queueId:'q',queueHash:'h',taskId:'task'});
 assert.equal(r.status,'needs_login');assert.equal(config.entry,undefined);assert.ok(!calls.includes('write'));
});
test('a first click that lands on neither a form nor a login page keeps the original error handling and writes nothing',async()=>{
 const {f,calls,config}=flow({landing:'none'});
 await assert.rejects(f.enter({queueId:'q',queueHash:'h',taskId:'task'}),/APPLICATION_ENTRY_FIRST_LANDING_NOT_FORM/);assert.equal(config.entry,undefined);assert.ok(!calls.includes('write'));
});
// C42：岗位页上已经有登录入口或登录框（没登录时不跳登录页的站点）：先交登录，不点入口。
test('a role page that already shows a login entry hands off to login before any entry click',async()=>{
 const {f,calls,config}=flow({loggedOut:true});
 const r=await f.enter({queueId:'q',queueHash:'h',taskId:'task'});
 assert.equal(r.status,'needs_login');assert.ok(!calls.includes('roleFirstEntry'));assert.equal(config.entry,undefined);
});
test('a browser host that predates the first-entry tool asks for a host restart before any click',async()=>{
 const {f,calls}=flow({pageTools:['newPage','reload','closePage']});
 await assert.rejects(f.enter({queueId:'q',queueHash:'h',taskId:'task'}),/BROWSER_HOST_RESTART_REQUIRED/);assert.ok(!calls.includes('roleFirstEntry'));
});
test('without an entry config, the confirmed role-link page is read as the detail page by the read-only entry inspection',async()=>{
 const {f}=flow();let inspected;
 f.browser={request:async(method,args)=>{if(method==='pageIdentity')return {pageUrl:`https://ke.example/campus/detail?jobAdId=${UUID}`};if(method==='entryInspection'){inspected=args;return {stage:args.stage,candidates:[{roleSelector:'h1:visible'}]};}throw Error('unexpected '+method);}};
 const r=await f.inspectEntry({queueId:'q',queueHash:'h',taskId:'task'});assert.equal(r.stage,'detail');assert.equal(inspected.stage,'detail');
});

// C39 追加（2026-11-16，用户“按B。推进”）：首版入口同一失败第二次交 Agent 浏览器兜底。
import {recordOutcome} from '../shared/stop-loss.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
test('the same first-entry failure a second time offers the registered Agent entry fallback, a third time asks the user',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'entry-fallback-')),file=path.join(d,'登记.json');
 try{
  await writeFile(file,JSON.stringify({schemaVersion:1,浏览器:{chrome_clone_extension:'分身插件'},agents:[{agent:'Claude Code',hostId:'claude-code',浏览器:['chrome_clone_extension']}]}));
  const env={RECRUITING_STOP_LOSS_DIR:path.join(d,'stop'),RECRUITING_HOST_ID:'claude-code',RECRUITING_AGENT_FALLBACK_REGISTRY:file};
  const failed=(code='APPLICATION_ENTRY_FIRST_BUTTON_NOT_UNIQUE')=>({error:code,continuation:{owner:'agent',nextTools:['workflow_next']}});
  const args={queueId:'q',queueHash:'h',taskId:'task-entry'};
  const first=await recordOutcome({tool:'role_enter_application',phase:'construct',args,result:failed(),env});assert.equal(first.repeatedFailure,undefined);
  const second=await recordOutcome({tool:'role_enter_application',phase:'construct',args,result:failed(),env});
  assert.equal(second.continuation.state,'agent_fallback');assert.deepEqual(second.continuation.nextTools,['role_entry_fallback']);assert.deepEqual(second.continuation.fallback,{context:'entry',agent:'Claude Code'});
  assert.equal((await recordOutcome({tool:'role_enter_application',phase:'construct',args,result:failed(),env})).continuation.state,'ask_user');
  // 写入读回这类不是页面操作的问题、表外执行端：不交兜底，第二次问用户。
  const readback={...env,RECRUITING_STOP_LOSS_DIR:path.join(d,'stop2')};
  await recordOutcome({tool:'role_advance',phase:'route',args,result:failed('APPLICATION_ENTRY_FIRST_CONFIG_READBACK_FAILED'),env:readback});
  assert.equal((await recordOutcome({tool:'role_advance',phase:'route',args,result:failed('APPLICATION_ENTRY_FIRST_CONFIG_READBACK_FAILED'),env:readback})).continuation.state,'ask_user');
  const other={...env,RECRUITING_STOP_LOSS_DIR:path.join(d,'stop3'),RECRUITING_HOST_ID:'dsh'};
  await recordOutcome({tool:'role_advance',phase:'route',args,result:failed(),env:other});
  assert.equal((await recordOutcome({tool:'role_advance',phase:'route',args,result:failed(),env:other})).continuation.state,'ask_user');
 }finally{await rm(d,{recursive:true,force:true});}
});

function fallbackFlow({allowed=true}={}){
 const calls=[],config=structuredClone(current),created=[];
 const t={taskId:'task',companyId:'C00105',siteId:'S0050',roleId:'J000231',officialId:UUID,title:'后端开发工程师',url:`https://ke.example/campus/detail?jobAdId=${UUID}`};
 const formUrl=`https://ke.example/form?jobAdId=${UUID}`;
 let state={queueId:'q',taskId:'task',pageId:'chrome:d',status:'authenticated_at_role',returnUrl:t.url,originalRoleUrl:t.url,expectedTitle:t.title};
 const tabs=[{id:'chrome:d',url:'https://ke.example/campus/index'}];let landing={formFieldsVisible:true,inputs:5,frames:0,formTitle:{heading:null,path:null}},login=false;
 const urlOf=id=>tabs.find(x=>x.id===id)?.url;
 const browser={request:async(method,args)=>{calls.push(method);
  if(method==='status')return {pageTools:['newPage','reload','closePage','firstEntry','entryFallback']};
  if(method==='tabs')return structuredClone(tabs);
  if(method==='openPage'){tabs.find(x=>x.id===args.pageId).url=args.pageUrl;return {pageId:args.pageId,pageUrl:args.pageUrl};}
  if(method==='roleEntryInventory')return {pageId:args.pageId,pageUrl:urlOf(args.pageId),detailTitle:{heading:'h1',path:null},candidates:args.labels?[{role:'link',label:args.labels[0],count:1,domOrder:[0]}]:[{role:'button',label:'申请职位',count:2,domOrder:[1,0]}]};
  if(method==='roleSnapshot')return {pageUrl:urlOf(args.pageId),loginFormPresent:login};
  if(method==='roleEntryLanding')return {pageId:args.pageId,pageUrl:urlOf(args.pageId),...landing,...(urlOf(args.pageId)==='https://ke.example/campus/index'?{formFieldsVisible:false}:{}),formFieldSelector:FIRST_ENTRY.formFieldSelector};
  throw Error('unexpected '+method);}};
 const queues={task:async()=>({q:{id:'q',queueHash:'h'},t}),read:async()=>structuredClone(state),put:async(id,v)=>{state=structuredClone(v);}};
 const loginEngine={company:async()=>structuredClone(config),locked:async(c,fn)=>fn(),compile:async()=>({planId:'p',planHash:'h'})};
 const entryConfigs={create:async a=>{created.push(a);config.entry=firstEntryConfig({current:config,observed:a.observed,roleId:UUID,now,rule:a.rule,method:a.method,recordedBy:a.recordedBy}).entry;}};
 const f=new RoleFlow({queues,login:loginEngine,browser,entryConfigs,fallbackSurface:async()=>allowed?{allowed:true,agent:'Claude Code',hostId:'claude-code',surface:'chrome_clone_extension',surfaceLabel:'分身插件'}:{allowed:false,reason:'HOST_NOT_IN_FALLBACK_REGISTRY'}});
 return {f,calls,tabs,t,formUrl,config,created,state:()=>state,setLanding:v=>{landing={...landing,...v};},setLogin:v=>{login=v;}};
}
const task={queueId:'q',queueHash:'h',taskId:'task'};
test('entry fallback outside the registry goes to the user without touching the page',async()=>{
 const {f,calls}=fallbackFlow({allowed:false});
 const r=await f.entryFallback({...task,mode:'start'});assert.equal(r.status,'needs_user');assert.equal(r.reason,'HOST_NOT_IN_FALLBACK_REGISTRY');assert.ok(!calls.includes('roleEntryInventory'));
});
test('a screenshot-confirmed shared application editor continues without another entry click',async()=>{
 const x=fallbackFlow();x.tabs[0].url='https://ke.example/profile/edit';
 await x.f.entryFallback({...task,mode:'start',preserveCurrentPage:true});
 assert.equal(x.tabs[0].url,'https://ke.example/profile/edit');
 const r=await x.f.entryFallback({...task,mode:'report',report:{alreadyForm:true}});
 assert.equal(r.status,'ready_to_fill');assert.deepEqual(r.continuation.nextTools,['workflow_next']);assert.equal(x.created.length,0);assert.equal(x.calls.includes('roleEntryClick'),false);
});
test('already-form fallback still distinguishes an actual login screen',async()=>{
 const x=fallbackFlow();await x.f.entryFallback({...task,mode:'start'});x.setLogin(true);
 assert.equal((await x.f.entryFallback({...task,mode:'report',report:{alreadyForm:true}})).status,'needs_login');
});
test('entry fallback returns to the role link, inventories it, and records the Agent click with the same-text order',async()=>{
 const x=fallbackFlow();
 const start=await x.f.entryFallback({...task,mode:'start'});
 assert.equal(start.status,'agent_fallback_ready');assert.equal(x.tabs[0].url,x.t.url);assert.deepEqual(start.candidates,[{role:'button',label:'申请职位',count:2}]);assert.deepEqual(start.continuation.nextTools,['role_entry_fallback']);
 assert.equal(x.state().entryStarted.agentFallback,true);assert.ok(x.state().entryFallback);
 x.tabs[0].url=x.formUrl; // Agent 在同一标签点了页面上面那个“申请职位”
 const r=await x.f.entryFallback({...task,mode:'report',report:{label:'申请职位',position:1}});
 assert.equal(r.status,'entry_config_ready');assert.deepEqual(r.continuation.nextTools,['role_advance']);assert.equal(r.target,'same');
 assert.deepEqual(x.config.entry.entryLocator,{role:'button',name:'申请职位',label:'申请职位',count:2,index:1});
 assert.equal(x.created[0].rule,FALLBACK_ENTRY_RULE);assert.equal(x.created[0].recordedBy.agent,'Claude Code');assert.equal(x.config.entry.evidence.method,'agent_gui_fallback_observed_click');
 assert.equal(x.state().entryFallback,undefined);
});
test('entry fallback follows a site-opened tab and re-counts an unlisted button text on the role page',async()=>{
 const x=fallbackFlow();await x.f.entryFallback({...task,mode:'start'});
 x.tabs.push({id:'chrome:n',url:x.formUrl});
 const r=await x.f.entryFallback({...task,mode:'report',report:{label:'我要申请',position:1}});
 assert.equal(r.status,'entry_config_ready');assert.equal(r.target,'new');assert.deepEqual(x.config.entry.entryLocator,{role:'link',name:'我要申请',label:'我要申请'});assert.equal(x.config.entry.target,'new');
});
test('entry fallback asks the user when nothing changed or the landing is not this role\'s form, and hands a login page to the user',async()=>{
 let x=fallbackFlow();await x.f.entryFallback({...task,mode:'start'});
 assert.equal((await x.f.entryFallback({...task,mode:'report',report:{label:'申请职位',position:1}})).reason,'ENTRY_FALLBACK_NO_NAVIGATION');
 x=fallbackFlow();await x.f.entryFallback({...task,mode:'start'});x.tabs[0].url='https://ke.example/campus/index';
 const notForm=await x.f.entryFallback({...task,mode:'report',report:{label:'申请职位',position:1}});assert.equal(notForm.reason,'ENTRY_FALLBACK_LANDING_NOT_FORM');assert.equal(x.config.entry,undefined);
 x=fallbackFlow();await x.f.entryFallback({...task,mode:'start'});x.tabs[0].url='https://ke.example/login';x.setLogin(true);
 assert.equal((await x.f.entryFallback({...task,mode:'report',report:{label:'申请职位',position:1}})).status,'needs_login');assert.equal(x.config.entry,undefined);
 x=fallbackFlow();await assert.rejects(x.f.entryFallback({...task,mode:'report',report:{label:'申请职位',position:1}}),/ENTRY_FALLBACK_SESSION_REQUIRED/);
});
test('a recorded same-text entry button is clicked by its recorded order after the count is re-checked',async()=>{
 const next=firstEntryConfig({current,observed:observed({entryLocator:{role:'button',name:'申请职位',label:'申请职位',count:2,index:1}}),roleId:UUID,now});
 const run=async total=>{let clicked=null;const detailUrl=`https://ke.example/campus/detail?jobAdId=${UUID}`,formUrl=`https://ke.example/form?jobAdId=${UUID}`;
  const page={current:detailUrl,url(){return this.current;},
   locator(s){const self=this;const one={filter(){return one;},first(){return one;},async waitFor(){},async count(){return 1;},async innerText(){return s==='h1'?'后端开发工程师':'';}};return one;},
   getByRole(role,{name}){return {async count(){return total;},nth:i=>({async waitFor(){},async innerText(){return name;},async click(){clicked=i;page.current=formUrl;}}),async waitFor(){throw Error('strict mode violation');}};}};
  const host={getPage:async()=>page,listPages:async()=>[{id:'d',url:page.current}],pause:async()=>{},preserve:async()=>{}};
  const r=await executeTransition({entry:next.entry,pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},host);return {r,clicked};};
 const ok=await run(2);assert.equal(ok.clicked,1);assert.equal(ok.r.entryClicked,true);
 await assert.rejects(run(3),/APPLICATION_ENTRY_BUTTON_CHANGED/);
 assert.throws(()=>firstEntryConfig({current,observed:observed({entryLocator:{role:'button',name:'申请职位',label:'申请职位',count:2,index:2}}),roleId:UUID,now}),/APPLICATION_ENTRY_FIRST_CONFIG_INVALID/);
});

// C41（2026-11-16，用户选择“A 作为第三种方式”“入口和表单控件都加”）：组件代点。
import {fallbackSurface,fallbackOperator,fallbackInstruction,COMPONENT_SURFACE,COMPONENT_FALLBACK_INSTRUCTION} from '../shared/gui-fallback.mjs';
import {clickEntryCandidate} from '../shared/first-entry.mjs';
test('the registry offers the component click as a third way next to the Agent\'s own browser',()=>{
 const registry={schemaVersion:1,浏览器:{chrome_clone_extension:'分身插件',component_playwright:'组件代点'},agents:[{agent:'Claude Code',hostId:'claude-code',浏览器:['chrome_clone_extension','component_playwright']},{agent:'Codex',hostId:'codex',浏览器:['builtin_browser','component_playwright']},{agent:'Kimi Work',hostId:'kimi-work',浏览器:['builtin_browser']}]};
 const both=fallbackSurface({registry,hostId:'claude-code',pageId:'chrome:1'});assert.deepEqual([both.allowed,both.surface,both.componentClick],[true,'chrome_clone_extension',true]);
 const only=fallbackSurface({registry,hostId:'codex',pageId:'chrome:1'});assert.deepEqual([only.allowed,only.surface,only.componentClick],[true,null,true]);
 assert.equal(fallbackSurface({registry,hostId:'kimi-work',pageId:'chrome:1'}).reason,'PAGE_BROWSER_NOT_IN_FALLBACK_REGISTRY');
 assert.equal(fallbackOperator(both,'report'),'chrome_clone_extension');assert.equal(fallbackOperator(both,'component'),COMPONENT_SURFACE);
 assert.throws(()=>fallbackOperator(only,'report'),/GUI_FALLBACK_SURFACE_CHANGED/);assert.throws(()=>fallbackOperator({allowed:true,surface:'builtin_browser',componentClick:false},'component'),/GUI_FALLBACK_SURFACE_CHANGED/);
 assert.equal(fallbackInstruction(only),COMPONENT_FALLBACK_INSTRUCTION);assert.ok(fallbackInstruction(both).includes('组件代点'));
});
test('the component clicks only the chosen entry candidate, after re-checking the same-text count',async()=>{
 const url=`https://moka.example/apply/step/1#/job/${UUID}`;
 const tab=fakeTab({id:'d',url,buttons:[{role:'button',label:'申请职位',top:100},{role:'button',label:'申请职位',top:900,click:async()=>{tab.url=`https://moka.example/apply/step/1#/job/${UUID}/apply`;}}]});
 await assert.rejects(clickEntryCandidate({pageId:'d',label:'申请职位',role:'button',count:3,index:1},fakeHost([tab])),/ENTRY_FALLBACK_BUTTON_CHANGED/);assert.equal(tab.clicks,0);
 const r=await clickEntryCandidate({pageId:'d',label:'申请职位',role:'button',count:2,index:1},fakeHost([tab]));assert.deepEqual([r.pageId,r.target],['d','same']);assert.equal(tab.clicks,1);
 const still=fakeTab({id:'d',url,buttons:[{role:'button',label:'申请职位',top:100}]});
 await assert.rejects(clickEntryCandidate({pageId:'d',label:'申请职位',role:'button',count:1,index:0},fakeHost([still])),/ENTRY_FALLBACK_NO_NAVIGATION/);
});
function componentFlow(surface){
 const x=fallbackFlow();
 x.f.fallbackSurface=async()=>surface;
 const base=x.f.browser.request;
 x.f.browser={request:async(method,args)=>{
  if(method==='status')return {pageTools:['newPage','reload','closePage','firstEntry','entryFallback','componentClick']};
  if(method==='roleEntryClick'){x.calls.push(method);x.clickArgs=args;if(x.clickError)throw Error(x.clickError);x.tabs[0].url=x.formUrl;return {pageId:args.pageId,target:'same',entryClicked:true};}
  return base(method,args);}};
 return x;
}
const componentOnly={allowed:true,agent:'Claude Code',hostId:'claude-code',surface:null,surfaceLabel:null,componentClick:true,componentLabel:'组件代点'};
test('entry fallback with only the component click instructs the Agent to choose from the screenshot and lets the component click',async()=>{
 const x=componentFlow(componentOnly);
 const start=await x.f.entryFallback({...task,mode:'start'});
 assert.equal(start.fallback.componentClick,true);assert.equal(start.fallback.surface,null);assert.ok(start.instruction.startsWith('组件代点'));assert.ok(start.instruction.includes('role_report_link_failure'));
 await assert.rejects(x.f.entryFallback({...task,mode:'report',report:{label:'申请职位',position:1}}),/GUI_FALLBACK_SURFACE_CHANGED/);
 const r=await x.f.entryFallback({...task,mode:'component',report:{label:'申请职位',position:1}});
 assert.equal(r.status,'entry_config_ready');assert.equal(r.operator,COMPONENT_SURFACE);
 assert.deepEqual(x.clickArgs,{pageId:'chrome:d',expectedTitle:'后端开发工程师',label:'申请职位',role:'button',count:2,index:1});
 assert.deepEqual(x.config.entry.entryLocator,{role:'button',name:'申请职位',label:'申请职位',count:2,index:1});
 assert.equal(x.created[0].recordedBy.surface,COMPONENT_SURFACE);assert.equal(x.config.entry.evidence.method,'agent_choice_component_click');
});
test('component click asks the user when the page moved, the button changed, or the landing is not this role\'s form',async()=>{
 let x=componentFlow(componentOnly);await x.f.entryFallback({...task,mode:'start'});x.tabs[0].url='https://ke.example/campus/index';
 assert.equal((await x.f.entryFallback({...task,mode:'component',report:{label:'申请职位',position:1}})).reason,'ENTRY_FALLBACK_PAGE_MOVED');assert.ok(!x.calls.includes('roleEntryClick'));
 x=componentFlow(componentOnly);await x.f.entryFallback({...task,mode:'start'});x.clickError='ENTRY_FALLBACK_BUTTON_CHANGED';
 assert.equal((await x.f.entryFallback({...task,mode:'component',report:{label:'申请职位',position:1}})).reason,'ENTRY_FALLBACK_BUTTON_CHANGED');assert.equal(x.config.entry,undefined);
 x=componentFlow(componentOnly);await x.f.entryFallback({...task,mode:'start'});
 assert.equal((await x.f.entryFallback({...task,mode:'component',report:{label:'申请职位',position:3}})).reason,'ENTRY_FALLBACK_BUTTON_NOT_VERIFIED');
 x=componentFlow({...componentOnly,componentClick:false,surface:'chrome_clone_extension'});await x.f.entryFallback({...task,mode:'start'});
 await assert.rejects(x.f.entryFallback({...task,mode:'component',report:{label:'申请职位',position:1}}),/GUI_FALLBACK_SURFACE_CHANGED/);
});
// C42：按钮被挡住或不可用时不点并带详情；点了没换页时带对话框个数。
test('a covered or disabled entry button is never clicked and the cover is recorded; no navigation reports visible dialogs',async()=>{
 const url=`https://ke.example/campus/detail?jobAdId=${UUID}`;
 const covered=fakeTab({id:'d',url,buttons:[{role:'button',label:'投递'}],hit:{covered:true,disabled:false,coverTag:'div',coverDialog:true}});
 await assert.rejects(observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([covered])),e=>e.message==='APPLICATION_ENTRY_FIRST_BUTTON_COVERED'&&JSON.stringify(safeControlErrorDetails(e.details))===JSON.stringify({phase:'first_entry',check:'button',covered:true,coverDialog:true,coverTag:'div'}));assert.equal(covered.clicks,0);
 const disabled=fakeTab({id:'d',url,buttons:[{role:'button',label:'申请职位',top:1},{role:'button',label:'申请职位',top:2}],hit:{covered:false,disabled:true,coverTag:null,coverDialog:false}});
 await assert.rejects(clickEntryCandidate({pageId:'d',label:'申请职位',role:'button',count:2,index:0},fakeHost([disabled])),/ENTRY_FALLBACK_BUTTON_DISABLED/);assert.equal(disabled.clicks,0);
 const quiet=fakeTab({id:'d',url,buttons:[{role:'button',label:'投递'}],dialogs:1});
 await assert.rejects(observeFirstEntry({pageId:'d',expectedTitle:'后端开发工程师',expectedRoleId:UUID},fakeHost([quiet])),e=>e.message==='APPLICATION_ENTRY_FIRST_NO_NAVIGATION'&&safeControlErrorDetails(e.details).dialogs===1);
});

test('entry fallback does not start when the role page shows a login entry; it hands off to login instead',async()=>{
 const x=fallbackFlow();x.setLogin(true);
 const r=await x.f.entryFallback({...task,mode:'start'});assert.equal(r.status,'needs_login');assert.ok(!x.calls.includes('roleEntryInventory'));assert.equal(x.state().entryFallback,undefined);
});
