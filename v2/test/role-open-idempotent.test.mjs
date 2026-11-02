import test from 'node:test';import assert from 'node:assert/strict';
import {RoleFlow} from '../shared/role-flow.mjs';
const detail='https://example.test/detail?id=role',form='https://example.test/form?id=role#application';
function fixture({prior,tabs,actualUrl,wrongAccount=false,wrongTitle=false}={}){
 const task={taskId:'task',companyId:'sample',roleId:'role',url:detail,title:'Example Role'},q={id:'queue'},calls=[],writes=[];
 let state=prior===null?null:structuredClone(prior||{queueId:q.id,taskId:task.taskId,originalRoleUrl:task.url,expectedTitle:task.title,applicationUrl:form,returnUrl:form,pageId:'chrome:retained',status:'ready_to_fill',openedAt:'original-open-time',unsavedEvidence:'retained'}),locks=0,maxLocks=0;
 const company={origin:'https://example.test',allowedPaths:['/'],loginMethod:'user_operated',account:{selector:'.account',source:'account',mask:'exact'}};
 const browser={request:async(method,args)=>{calls.push({method,...args});
  if(method==='tabs')return tabs||[{id:'retained',browserChannel:'chrome',url:actualUrl||form}];
  if(method==='openPage'){
   if(!args.reuseOnly&&state)throw Error('MUST_NOT_NAVIGATE_BOUND_TASK');
   return {pageId:'chrome:retained',pageUrl:args.pageUrl,reused:args.reuseOnly===true};
  }
  if(method==='roleSnapshot')return {pageUrl:actualUrl||(state?.applicationUrl?form:detail),roleTitle:wrongTitle?'Another Role':task.title,account:wrongAccount?'other':'person',loginFormPresent:false,readAt:'now'};
  if(method==='wait')return {};
  throw Error('UNEXPECTED_METHOD');
 }};
 const flow=new RoleFlow({queues:{task:async()=>({q,t:task}),read:async()=>{if(!state)throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(state);},put:async(id,value)=>{state=structuredClone(value);writes.push(state);}},login:{company:async()=>company,locked:async(c,fn)=>{locks++;maxLocks=Math.max(maxLocks,locks);assert.equal(locks,1,'same task must not acquire a nested login lock');try{return await fn();}finally{locks--;}},profile:async()=>({facts:{account:{status:'known',value:'person',sourceIds:['fixture']}}}),state:async()=>({account:wrongAccount?'other':'person',form:false})},templates:async()=>({pages:[{pathPrefix:'/detail',roleTitle:task.title,roleSelector:'.title',readySelector:'.detail'},{pathPrefix:'/form',roleTitle:task.title,roleSelector:'.title',readySelector:'.form'}]}),browser});
 return {flow,task,calls,writes,state:()=>state,maxLocks:()=>maxLocks};
}
test('repeated role_open preserves the retained application, unsaved state and original task without navigation',async()=>{
 const f=fixture(),before=structuredClone(f.state());
 for(let i=0;i<2;i++)assert.equal((await f.flow.open({})).status,'ready_to_fill');
 assert.equal(f.calls.some(c=>c.method==='openPage'),false);assert.equal(f.state().applicationUrl,before.applicationUrl);assert.equal(f.state().returnUrl,before.returnUrl);assert.equal(f.state().openedAt,before.openedAt);assert.equal(f.state().unsavedEvidence,'retained');assert.equal(f.state().originalRoleUrl,detail);assert.equal(f.maxLocks(),1);
});
for(const legacy of [false,true])test('lost application pageId rebinds only the exact unique retained form, legacy='+legacy,async()=>{
 const state=fixture().state(),f=fixture({prior:{...state,pageId:'chrome:lost'},tabs:[{url:form,browserChannel:'chrome',...(legacy?{}:{id:'retained'})}]});
 assert.equal((await f.flow.open({})).status,'ready_to_fill');assert.equal(f.state().pageId,'chrome:retained');assert.equal(f.state().returnUrl,form);assert.equal(f.state().applicationUrl,form);
 const opens=f.calls.filter(c=>c.method==='openPage');assert.equal(opens.length,legacy?1:0);if(legacy){assert.equal(opens[0].reuseOnly,true);assert.equal(opens[0].pageUrl,form);}
});
test('lost, ambiguous, foreign or query-altered application pages never fall back to frozen detail',async()=>{
 const original=fixture().state();
 for(const tabs of [[],[{id:'a',url:form},{id:'b',url:form}],[{id:'a',url:form.replace('example.test','other.test')}],[{id:'a',url:detail}],[{id:'a',url:form.replace('?id=role','?id=role&extra=1')} ]]){
  const f=fixture({prior:{...original,pageId:'lost'},tabs});await assert.rejects(f.flow.open({}),/ROLE_EXISTING_PAGE_NOT_(?:UNIQUE|FOUND)/);assert.equal(f.calls.some(c=>c.method==='openPage'),false);assert.equal(f.writes.length,0);
 }
});
test('an existing bound page at another location is refused rather than navigated',async()=>{
 const f=fixture({actualUrl:detail});await assert.rejects(f.flow.open({}),/ROLE_BOUND_PAGE_LOCATION_CHANGED/);assert.equal(f.calls.some(c=>c.method==='openPage'),false);assert.equal(f.writes.length,0);assert.equal(f.state().applicationUrl,form);
});
test('queue, task, original URL, title and return binding changes are rejected before browser actions',async()=>{
 const state=fixture().state();
 for(const patch of [{queueId:'other'},{taskId:'other'},{originalRoleUrl:'https://example.test/other'},{expectedTitle:'Another Role'},{returnUrl:detail},{returnUrl:''}]){
  const f=fixture({prior:{...state,...patch}});await assert.rejects(f.flow.open({}),/ROLE_TASK_STATE_CHANGED/);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
 }
});
test('prepared review remains protected and actual account/title checks still run',async()=>{
 const f=fixture({prior:{...fixture().state(),status:'ready_for_user_review'}});await assert.rejects(f.flow.open({}),/ROLE_ALREADY_PREPARED_FOR_REVIEW/);assert.equal(f.calls.length,0);
 const account=fixture({wrongAccount:true});await assert.rejects(account.flow.open({}),/LOGIN_ACCOUNT_MISMATCH/);assert.equal(account.writes.length,0);
 const title=fixture({wrongTitle:true});await assert.rejects(title.flow.open({}),/LOGIN_RETURN_ROLE_VERIFICATION_FAILED/);assert.equal(title.writes.length,0);
});
test('a genuinely new task still opens the frozen original role first',async()=>{
 const f=fixture({prior:null});await f.flow.open({});const opened=f.calls.find(c=>c.method==='openPage');assert.equal(opened.pageUrl,detail);assert.equal(opened.pageId,undefined);assert.equal(f.state().originalRoleUrl,detail);
});
