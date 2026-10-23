import test from 'node:test';import assert from 'node:assert/strict';
import {RoleFlow} from '../shared/role-flow.mjs';import {executeTransition} from '../shared/entry-transition.mjs';
const origin='https://example.test',detail=origin+'/portal/details?jobAdId=observed-job&locale=en',form=origin+'/portal/resume?job=100';
function fixture({tabs=[{id:'original',url:detail}],title='Example Role',account='person',prior={},receipt}={}){
 const task={taskId:'task',companyId:'sample',roleId:'100',title:'Example Role',url:origin+'/legacy/job/100'},q={id:'queue'},calls=[],saved=[];
 const entry={kind:'declarative_transition',target:'same_or_new',detail:{location:{pathnamePattern:'^/portal/details$',query:{jobAdId:'observed-job'}},roleSelector:'.title'},form:{location:{pathnamePattern:'^/portal/resume$',query:{job:'$roleId'}},readySelector:'.form',roleIdentity:{source:'query',parameter:'job'}},entryLocator:{selector:'.apply',label:'Apply'},evidence:{detailUrl:detail,formUrl:form,capturedAt:'2026-10-24',method:'observed_rendered_navigation'}};
 const company={origin,entry,loginMethod:'user_operated',account:{selector:'.account',source:'account',mask:'exact'}};
 const pages=new Map(tabs.map(row=>{const id=row.browserChannel&&!row.id.startsWith(row.browserChannel+':')?row.browserChannel+':'+row.id:row.id;return [id,{id,current:row.url}];}));
 const host={getPage:async id=>{const page=pages.get(id);return {url:()=>page.current,locator:selector=>({filter(options){assert.deepEqual(options,{visible:true});return this;},first(){return this;},waitFor:async()=>{},count:async()=>1,innerText:async()=>selector==='.account'?account:selector==='.title'?title:selector==='.apply'?'Apply':'',click:async()=>{calls.push({method:'cta'});page.current=form;}})};},listPages:async()=>[...pages.values()].map(p=>({id:p.id,url:p.current})),pause:async()=>{}};
 const browser={request:async(method,args)=>{calls.push({method,...args});
  if(method==='tabs')return structuredClone(tabs);
  if(method==='openPage'){
   assert.equal(args.reuseOnly,true);const matches=[...pages.values()].filter(p=>args.pageId?p.id===args.pageId&&p.current===args.pageUrl:p.current===args.pageUrl);assert.equal(matches.length,1);
   return receipt||{pageId:matches[0].id,pageUrl:matches[0].current,reused:true};
  }
  if(method==='roleSnapshot')return {pageUrl:pages.get(args.pageId).current,account,loginFormPresent:false};
  if(method==='roleEnterApplication')return executeTransition(args,host);
  throw Error('UNEXPECTED_METHOD');
 }};
 const flow=new RoleFlow({queues:{task:async()=>({q,t:task}),read:async()=>structuredClone(prior),put:async(id,value)=>saved.push({id,value})},login:{company:async()=>company,locked:async(c,fn)=>fn(),state:async()=>({account,form:false}),profile:async()=>({facts:{account:{status:'known',value:'person',sourceIds:['fixture']}}})},browser});
 return {flow,task,q,calls,saved,entry};
}
test('enter reuses the observed modern detail URL and original page while preserving the frozen role/link',async()=>{
 const f=fixture({tabs:[{id:'retained',browserChannel:'chrome',url:detail}],prior:{queueId:'queue',pageId:'stale'}}),frozen=structuredClone(f.task),r=await f.flow.enter({});
 const opened=f.calls.find(c=>c.method==='openPage');assert.equal(opened.pageUrl,detail);assert.equal(opened.pageId,'chrome:retained');assert.equal(opened.reuseOnly,true);assert.equal(r.pageUrl,form);
 assert.equal(f.calls.find(c=>c.method==='roleEnterApplication').expectedRoleId,'100');assert.equal(f.saved[0].value.originalRoleUrl,frozen.url);assert.deepEqual(f.task,frozen);assert.equal(f.calls.filter(c=>c.method==='cta').length,1);
});
test('a unique existing form wins over multiple detail tabs and stale stored links',async()=>{
 const f=fixture({tabs:[{id:'detail-one',url:detail},{id:'detail-two',url:detail},{id:'existing-form',url:form}],prior:{queueId:'queue',applicationUrl:origin+'/stale',pageId:'stale'}});
 await f.flow.enter({});const opened=f.calls.find(c=>c.method==='openPage');assert.equal(opened.pageId,'existing-form');assert.equal(opened.pageUrl,form);assert.equal(f.calls.some(c=>c.method==='cta'),false);
});
test('cross-origin, wrong detail query and duplicate matching pages are rejected before open',async()=>{
 for(const [tabs,error]of [
  [[{id:'foreign',url:detail.replace(origin,'https://other.test')}],/EXISTING_PAGE_NOT_FOUND/],
  [[{id:'wrong',url:detail.replace('observed-job','another-job')}],/EXISTING_PAGE_NOT_FOUND/],
  [[{id:'duplicate-query',url:detail+'&jobAdId=observed-job'}],/EXISTING_PAGE_NOT_FOUND/],
  [[{id:'one',url:detail},{id:'two',url:detail}],/AMBIGUOUS_ROLE_DETAIL/],
  [[{id:'one',url:form},{id:'two',url:form}],/AMBIGUOUS_ROLE_FORM/],
  [[],/EXISTING_PAGE_NOT_FOUND/]
 ]){const f=fixture({tabs});await assert.rejects(f.flow.enter({}),error);assert.equal(f.calls.some(c=>c.method==='openPage'),false);assert.equal(f.saved.length,0);}
});
test('the unique full observed URL can rebind an older tab inventory with no page ID',async()=>{
 const f=fixture({tabs:[{url:detail}]});
 // This fixture models the older inventory response; a current broker returns
 // the actual retained page ID in its reuse receipt.
 const original=f.flow.browser.request;f.flow.browser.request=async(method,args)=>{
  if(method==='openPage'){f.calls.push({method,...args});assert.equal(args.pageId,undefined);assert.equal(args.reuseOnly,true);return {pageId:'retained',pageUrl:detail,reused:true};}
  if(method==='roleSnapshot')return {pageUrl:detail,account:'person',loginFormPresent:false};
  if(method==='roleEnterApplication')return {pageId:'retained',pageUrl:form,roleIdentity:{parameter:'job',value:'100'},accountMatched:true};
  return original(method,args);
 };
 const r=await f.flow.enter({});assert.equal(r.pageId,'retained');
});
test('reuse receipt cannot silently navigate, create a page or switch its ID',async()=>{
 for(const receipt of [{pageId:'original',pageUrl:detail,reused:false},{pageId:'original',pageUrl:origin+'/other',reused:true},{pageId:'new',pageUrl:detail,reused:true}]){
  const f=fixture({receipt});await assert.rejects(f.flow.enter({}),/ROLE_EXISTING_PAGE_REBIND_FAILED/);assert.equal(f.calls.some(c=>c.method==='roleEnterApplication'),false);assert.equal(f.saved.length,0);
 }
});
test('detail reuse preserves strict downstream account, title and configured identity checks',async()=>{
 const badAccount=fixture({account:'other'});await assert.rejects(badAccount.flow.enter({}),/SHARED_LOGIN_SESSION_REQUIRED/);assert.equal(badAccount.saved.length,0);
 const badTitle=fixture({title:'Another Role'});await assert.rejects(badTitle.flow.enter({}),/APPLICATION_ENTRY_ROLE_CHANGED/);assert.equal(badTitle.saved.length,0);
 const wrongIdentity=fixture();wrongIdentity.entry.detail.roleIdentity={source:'query',parameter:'jobAdId'};await assert.rejects(wrongIdentity.flow.enter({}),/APPLICATION_ENTRY_RESULT_ROLE_CHANGED/);assert.equal(wrongIdentity.saved.length,0);
 const invalid=fixture();delete invalid.entry.detail.roleSelector;await assert.rejects(invalid.flow.enter({}),/ENTRY_ROLE_EVIDENCE_REQUIRED/);assert.equal(invalid.calls.length,0);
});
