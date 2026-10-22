import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {RoleQueue,digest} from '../shared/role-queue.mjs';import {RoleFlow} from '../shared/role-flow.mjs';
const catalog=[{id:'sample',origin:'https://example.com'}];
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'role-entry-'));const evidence=path.join(dir,'confirmed.txt');await writeFile(evidence,'Synthetic user confirmed roles in this exact order.');const roles=[{companyId:'sample',roleId:'B',title:'Role B',url:'https://example.com/campus/role/B',selected:true,order:2,applicationStatus:'not_submitted'},{companyId:'sample',roleId:'A',title:'Role A',url:'https://example.com/campus/role/A',selected:true,order:1,applicationStatus:'not_submitted'}];const input={schemaVersion:1,batchId:'synthetic',version:1,confirmation:{status:'confirmed',reference:'synthetic-user-confirmation'},companies:[{companyId:'sample',order:1,roles}]};const file=path.join(dir,'roles.json');const save=async()=>{await writeFile(file,JSON.stringify(input));};await save();const queues=new RoleQueue({root:path.join(dir,'queue'),catalog});try{await fn({dir,file,evidence,input,save,queues});}finally{await rm(dir,{recursive:true,force:true});}}
test('queue uses user order rather than JSON array order and blocks jumping ahead',()=>fixture(async({file,queues})=>{const q=await queues.import({rolesFile:file});assert.deepEqual(q.tasks.map(t=>t.roleId),['A','B']);await assert.rejects(queues.task({...q,taskId:q.tasks[1].taskId}),/CONFIRMED_ROLE_ORDER_BLOCKED/);await queues.put(q.tasks[0].taskId,{status:'ready_for_user_review'});assert.equal((await queues.task({...q,taskId:q.tasks[1].taskId})).t.roleId,'B');}));
test('changed confirmation and input block a previously frozen task',()=>fixture(async({file,input,save,queues})=>{const q=await queues.import({rolesFile:file});input.confirmation.reference='changed';await save();await assert.rejects(queues.get(q),/ROLE_INPUT_CHANGED/);await writeFile(file,'{}');await assert.rejects(queues.get(q),/ROLE_INPUT_CHANGED/);}));
test('duplicate order, cross-origin link and ambiguous application state fail before browser',()=>fixture(async({file,input,save,queues})=>{input.companies[0].roles[0].order=1;await save();await assert.rejects(queues.import({rolesFile:file}),/INVALID_CONFIRMED_ROLE_ORDER/);input.companies[0].roles[0].order=2;input.companies[0].roles[0].url='https://other.example/role';await save();await assert.rejects(queues.import({rolesFile:file}),/INVALID_CONFIRMED_ROLE_URL/);input.companies[0].roles[0].url='https://example.com/campus/role/B';input.companies[0].roles[0].applicationStatus='unknown';await save();await assert.rejects(queues.import({rolesFile:file}),/ROLE_APPLICATION_STATE_UNRESOLVED/);}));
test('submitted roles are protected; object interface needs no workbook or test mode',()=>fixture(async({file,input,save,queues})=>{input.companies[0].roles[0].applicationStatus='已提交';await save();const q=await queues.import({rolesFile:file});assert.equal(q.tasks.length,1);assert.equal(q.protectedRoles.length,1);const direct=await queues.import({companyPlan:input});assert.equal(direct.tasks.length,1);await assert.rejects(queues.import({rolesFile:file,companyPlan:input}),/ONE_COMPANY_PLAN_INPUT_REQUIRED/);input.confirmation.status='draft';await assert.rejects(queues.import({companyPlan:input}),/COMPANY_PLAN_CONFIRMATION_REQUIRED/);}));
test('first navigation is role URL, login redirect preserves task and resume restores original tab',()=>fixture(async({file,input,save,queues})=>{
 input.companies[0].roles=input.companies[0].roles.filter(r=>r.roleId==='A');await save();const q=await queues.import({rolesFile:file}),args={...q,taskId:q.tasks[0].taskId};let loggedIn=false,wrongTitle=false,closed=false;let pageUrl='about:blank';const calls=[];
 const c={companyId:'sample',origin:'https://example.com',allowedPaths:['/campus/'],fields:{root:'.login'},account:{selector:'.account',source:'phone',countryCode:'+86'}};
 const profile={facts:{phone:{status:'known',value:'13800001234',sourceIds:['synthetic']}}};
 const browser={request:async(method,a)=>{calls.push({method,...a});if(method==='tabs'){if(closed)throw Error('ROLE_BROWSER_PAGE_LOST');return [{id:'same-tab',url:pageUrl}];}if(method==='openPage'){pageUrl=loggedIn?a.pageUrl:'https://example.com/campus/login';return {pageId:'same-tab',pageUrl};}if(method==='roleSnapshot'){if(closed)throw Error('ROLE_BROWSER_PAGE_LOST');return {pageUrl,roleTitle:loggedIn?(wrongTitle?'Wrong role':'Role A'):null,account:loggedIn?'1380****234':null,loginFormPresent:!loggedIn,readAt:new Date().toISOString()};}}};
 const login={company:async()=>c,locked:async(c,fn)=>fn(),profile:async()=>profile,compile:async a=>{assert.equal(a.taskContext.returnUrl,input.companies[0].roles[0].url);return {planId:'synthetic',planHash:'h'};}};
 const flow=new RoleFlow({queues,login,browser,templates:async()=>({pages:[{pathPrefix:'/campus/role/',roleTitle:'Role A',roleSelector:'.title',readySelector:'.form'}]})});
 const opened=await flow.open(args);assert.equal(opened.status,'needs_login');assert.equal(calls.find(x=>x.method==='openPage').pageUrl,input.companies[0].roles[0].url);
 loggedIn=true;pageUrl='https://example.com/campus/';const restored=await flow.resume(args);assert.equal(restored.status,'ready_to_fill');assert.equal(restored.originalRoleRestored,true);assert.equal(calls.filter(x=>x.method==='openPage').at(-1).pageId,'same-tab');
 wrongTitle=true;await assert.rejects(flow.resume(args),/LOGIN_RETURN_ROLE_VERIFICATION_FAILED/);
 closed=true;await assert.rejects(flow.resume(args),/ROLE_BROWSER_PAGE_LOST/);
}));

test('explicit parallel roles skip only same-company predecessor; default still serial',()=>fixture(async({input,queues})=>{input.execution={mode:'parallel_roles',authorizationRef:'synthetic explicit parallel authorization'};const q=await queues.import({companyPlan:input});assert.equal((await queues.task({...q,taskId:q.tasks[1].taskId})).t.roleId,'B');delete input.execution.authorizationRef;await assert.rejects(queues.import({companyPlan:input}),/PARALLEL_ROLE_AUTHORIZATION_REQUIRED/);}));

test('observed application entry is persisted and reuses its original tab without an input applyUrl',()=>fixture(async({input,queues})=>{
 input.companies[0].roles=input.companies[0].roles.filter(r=>r.roleId==='A');
 const q=await queues.import({companyPlan:input}),task=q.tasks[0],args={...q,taskId:task.taskId};
 await queues.put(task.taskId,{queueId:q.queueId,pageId:'original-tab',status:'authenticated_at_role'});
 const c={companyId:'sample',origin:'https://example.com',fields:{root:'.login'},account:{selector:'.account',source:'phone',countryCode:'+86'}};
 const calls=[],login={company:async()=>c,locked:async(c,fn)=>fn(),profile:async()=>({facts:{phone:{status:'known',value:'13800001234',sourceIds:['synthetic']}}})};
 const apply='https://example.com/campus/resume/123/apply';
 const browser={request:async(method,a)=>{calls.push({method,...a});if(method==='openPage')return {pageId:'original-tab',pageUrl:a.pageUrl};if(method==='roleSnapshot')return {account:'1380****234',loginFormPresent:false};if(method==='roleEnterApplication')return {pageId:'original-tab',pageUrl:apply,roleTitle:'Role A',accountMatched:true};}};
 const r=await new RoleFlow({queues,login,browser}).enter(args);assert.equal(r.status,'ready_to_fill');
 const saved=await queues.read(task.taskId);assert.equal(saved.applicationUrl,apply);assert.equal(saved.returnUrl,apply);assert.equal(calls.find(c=>c.method==='openPage').pageId,'original-tab');
 await new RoleFlow({queues,login,browser}).enter(args);assert.equal(calls.filter(x=>x.method==='openPage').at(-1).pageUrl,apply);
}));

test('entered application page is handed to the write-back hook; a stored applyUrl without a covering form still enters from the role page',()=>fixture(async({input,queues})=>{
 const apply='https://example.com/campus/resume/123/apply';
 input.companies[0].roles=input.companies[0].roles.filter(r=>r.roleId==='A');input.companies[0].roles[0].applyUrl=apply;
 const q=await queues.import({companyPlan:input}),task=q.tasks[0],args={...q,taskId:task.taskId};
 const c={companyId:'sample',origin:'https://example.com',allowedPaths:['/campus/'],fields:{root:'.login'},account:{selector:'.account',source:'phone',countryCode:'+86'}};
 const login={company:async()=>c,locked:async(c,fn)=>fn(),profile:async()=>({facts:{phone:{status:'known',value:'13800001234',sourceIds:['synthetic']}}})};
 let url;const opened=[];const browser={request:async(method,a)=>{if(method==='openPage'){url=a.pageUrl;opened.push(url);return {pageId:'tab',pageUrl:url};}if(method==='roleEnterApplication')return {pageId:'tab',pageUrl:apply,roleTitle:'Role A',accountMatched:true};return {pageUrl:url,account:'1380****234',loginFormPresent:false};}};
 const recorded=[];const flow=new RoleFlow({queues,login,browser,templates:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},onApplicationEntered:async a=>{recorded.push(a);return {status:'recorded'};}});
 const r=await flow.open(args);assert.equal(r.status,'authenticated_at_role');assert.equal(opened[0],'https://example.com/campus/role/A');
 const e=await flow.enter(args);assert.equal(e.applicationUrlRecord,'recorded');
 assert.deepEqual(recorded,[{companyId:'sample',roleId:'A',roleUrl:'https://example.com/campus/role/A',applicationUrl:apply}]);
 const failing=new RoleFlow({queues,login,browser,onApplicationEntered:async()=>{throw Error('UNKNOWN_COMPANY');}});
 await queues.put(task.taskId,{queueId:q.queueId,status:'authenticated_at_role'});
 assert.equal((await failing.enter(args)).applicationUrlRecord,'write_failed:UNKNOWN_COMPANY');
}));

test('a new company form is not a prerequisite for opening its confirmed role',()=>fixture(async({input,queues})=>{
 input.companies[0].roles=input.companies[0].roles.filter(r=>r.roleId==='A');const q=await queues.import({companyPlan:input}),args={...q,taskId:q.tasks[0].taskId};
 const c={companyId:'sample',origin:'https://example.com',allowedPaths:['/campus/'],fields:{root:'.login'},account:{selector:'.account',source:'phone',countryCode:'+86'}};
 const login={company:async()=>c,locked:async(c,fn)=>fn(),profile:async()=>({facts:{phone:{status:'known',value:'13800001234',sourceIds:['synthetic']}}})};
 let url;const browser={request:async(method,a)=>{if(method==='openPage'){url=a.pageUrl;return {pageId:'existing',pageUrl:url};}return {pageUrl:url,account:'1380****234',loginFormPresent:false};}};
 const flow=new RoleFlow({queues,login,browser,templates:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}});
 const r=await flow.open(args);assert.equal(r.status,'authenticated_at_role');assert.deepEqual(r.nextTools,['role_enter_application']);assert.equal(r.formAssetRequiredBeforeFill,true);
}));
