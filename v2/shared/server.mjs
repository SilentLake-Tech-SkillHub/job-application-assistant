import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Store, Engine, validateTemplate, hash } from './engine.mjs';
import { BrowserAdapter } from './browser.mjs';
import { BrokerBrowserAdapter } from './browser-rpc.mjs';
import { loadProfile, updateProfile, registerObservedQuestions, registerPlannedQuestions, registerTemplateContract, assertQuestionsMapped, resolveProfile, profileStatus, recordProfileAnswers, mapProfileQuestions } from './profile.mjs';
import {queueFromEnv} from './queue-config.mjs';
import {accountMatches,resolveAccount} from '../login/contracts.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalog=JSON.parse(await readFile(path.join(root,'catalog/companies.json'),'utf8'));
const store=new Store(process.env.RECRUITING_PRIVATE_DIR||path.join(root,'.private'));
const browser=process.env.RECRUITING_BROWSER_SOCKET?new BrokerBrowserAdapter(process.env.RECRUITING_BROWSER_SOCKET):new BrowserAdapter(process.env.RECRUITING_CDP_URL);
const profileFile=process.env.RECRUITING_PROFILE_JSON;
const queues=profileFile?queueFromEnv(catalog.companies):null;
async function boundRole(args){
  if(!queues)throw Error('PRIVATE_PROFILE_REQUIRED');
  const {q,t}=await queues.task(args),state=await queues.read(t.taskId);
  if(state.queueId!==q.id||!['ready_to_fill','ready_for_user_review'].includes(state.status)||state.returnUrl!==(t.applyUrl||t.url)||state.expectedTitle!==t.title)throw Error('ROLE_NOT_READY_FOR_FILL');
  const c=catalog.companies.find(c=>c.id===t.companyId);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
  const template=await store.get('templates',c.roleTemplates?.[t.roleId]||c.templateId),plan=template.pages.find(p=>new URL(state.returnUrl).pathname.startsWith(p.pathPrefix));
  if(!plan||plan.roleTitle!==t.title)throw Error('CONFIRMED_ROLE_TITLE_TEMPLATE_MISMATCH');
  const login=JSON.parse(await readFile(path.join(root,'companies',t.companyId+'.login.json'),'utf8'));
  const snapshot=await browser.request('roleSnapshot',{pageId:state.pageId,roleSelector:plan.roleSelector,accountSelector:login.account.selector,loginRoot:login.fields.root});
  if(snapshot.pageUrl!==state.returnUrl||snapshot.roleTitle!==t.title||snapshot.loginFormPresent||!accountMatches(snapshot.account,resolveAccount(await loadProfile(profileFile),login).phone))throw Error('ROLE_OR_ACCOUNT_CHANGED_BEFORE_FILL');
  return {q,t,state,template};
}
const defaultBindings=Object.fromEntries(catalog.companies.map(c=>[c.id,c.templateId]));
async function refreshBindings(){
  let bindings={};try{bindings=await store.get('templates','company-bindings');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bindings||Array.isArray(bindings)||typeof bindings!=='object'||Object.values(bindings).some(v=>v!==null&&(typeof v!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v))))throw Error('INVALID_COMPANY_BINDINGS');
  let roleBindings={};try{roleBindings=await store.get('templates','role-bindings');}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const [companyId,map]of Object.entries(roleBindings)){if(!catalog.companies.some(c=>c.id===companyId)||!map||typeof map!=='object'||Array.isArray(map)||Object.values(map).some(v=>typeof v!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v)))throw Error('INVALID_ROLE_BINDINGS');}
  for(const c of catalog.companies){c.templateId=bindings[c.id]??defaultBindings[c.id];c.roleTemplates=roleBindings[c.id]||{};}
}
const engine=new Engine({store,companies:catalog.companies,browser,refreshCompanies:refreshBindings,resolveTask:async(task,template)=>{
  if(task.roleQueueArgs)await boundRole(task.roleQueueArgs);
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile);assertQuestionsMapped(profile,task.companyId,task.pageUrl);
  return {...task,...resolveProfile(profile,template,task.decisions,task.companyId)};
},onInventory:async(companyId,pageUrl,fields,plan,{discoveryOnly=false}={})=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  await updateProfile(profileFile,p=>registerPlannedQuestions(p,{companyId,pageUrl,fields,observedAt:new Date().toISOString(),coverageRequired:discoveryOnly},plan));
  if(!discoveryOnly)assertQuestionsMapped(await loadProfile(profileFile),companyId,pageUrl);
}});
const server=new McpServer({name:'recruiting-form-batch',version:'0.1.0'});
const output=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
const wrap=(fn,refresh=true)=>async args=>{try{if(refresh)await refreshBindings();return output(await fn(args));}catch(e){return {isError:true,...output({error:/^[A-Z_]+(?::[a-z0-9_-]+)?$/.test(e.message)?e.message:'OPERATION_FAILED'})};}};
const queueTask={queueId:z.string().uuid(),queueHash:z.string().length(64),taskId:z.string().uuid()};
server.registerTool('role_prepare',{description:'从冻结岗位队列取目标；核对登录后已返回原岗位，离线编译全部字段后填写并独立核验。仅返回异常与计数，不提交。',inputSchema:{...queueTask,authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false)})}},wrap(async args=>{
  const {t,state,template}=await boundRole(args),profile=await loadProfile(profileFile);
  assertQuestionsMapped(profile,t.companyId,state.returnUrl);
  const task={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...resolveProfile(profile,template,{},t.companyId),roleQueueArgs:{queueId:args.queueId,queueHash:args.queueHash,taskId:args.taskId}};
  const plan=await engine.preparePlan(task);
  if(!plan.allKnown)throw Error('ROLE_PROFILE_PREPARATION_REQUIRED');
  const fill=await engine.prepare({tasks:[{...task,planId:plan.planId,planHash:plan.planHash}],concurrency:1,authorization:args.authorization});
  if(fill.results[0]?.errorCode)return {status:'needs_attention',fillRunId:fill.id,error:fill.results[0].errorCode,submission:'not_performed'};
  const verification=await engine.verifyCurrent({...task,...resolveProfile(await loadProfile(profileFile),template,{},t.companyId)});
  state.status=verification.status==='verified'?'ready_for_user_review':'needs_attention';state.fillRunId=fill.id;state.verifyRunId=verification.id;state.verifiedAt=verification.readAt;
  await queues.put(t.taskId,state);
  return {status:state.status,taskId:t.taskId,companyId:t.companyId,roleTitle:t.title,pageUrl:state.returnUrl,fillRunId:fill.id,verifyRunId:verification.id,counts:verification.counts,fillElapsedMs:fill.elapsedMs,initialReadbackStatus:fill.status,exceptions:verification.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,label,status,reason})=>({id,label,status,reason})),save:verification.save,submission:'not_performed'};
}));
server.registerTool('roles_prepare_batch',{description:'按已确认并发模式，在共享账号独占批次内并发准备独立岗位页；全部计划先编译、逐岗位核验，不登录、不提交。',inputSchema:{queueId:z.string().uuid(),queueHash:z.string().length(64),taskIds:z.array(z.string().uuid()).min(1).max(5),concurrency:z.number().int().min(1).max(5).default(3),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false)})}},wrap(async args=>{
  if(new Set(args.taskIds).size!==args.taskIds.length)throw Error('DUPLICATE_ROLE_TASK');
  const q=await queues.get(args);if(q.executionMode!=='parallel_roles')throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  const tasks=[],bound=[];
  for(const taskId of args.taskIds){const a={queueId:args.queueId,queueHash:args.queueHash,taskId};const b=await boundRole(a),profile=await loadProfile(profileFile);assertQuestionsMapped(profile,b.t.companyId,b.state.returnUrl);
    const task={companyId:b.t.companyId,roleId:b.t.roleId,pageUrl:b.state.returnUrl,templateHash:hash(b.template),...resolveProfile(profile,b.template,{},b.t.companyId),roleQueueArgs:a};
    const plan=await engine.preparePlan(task);if(!plan.allKnown)throw Error('ROLE_PROFILE_PREPARATION_REQUIRED');tasks.push({...task,planId:plan.planId,planHash:plan.planHash});bound.push(b);
  }
  if(new Set(bound.map(b=>b.state.pageId)).size!==bound.length)throw Error('DUPLICATE_ROLE_PAGE');
  const run=await engine.prepare({tasks,concurrency:args.concurrency,authorization:args.authorization,parallelRoles:true});
  const results=[];
  // The account lease is reacquired for each independent verification after all writers settle.
  for(const [i,b]of bound.entries()){const task=tasks[i],fill=run.results[i];let verification;
    if(!fill.errorCode)verification=await engine.verifyCurrent({...task,...resolveProfile(await loadProfile(profileFile),b.template,{},b.t.companyId)});
    const status=verification?.status==='verified'?'ready_for_user_review':'needs_attention';Object.assign(b.state,{status,fillRunId:run.id,verifyRunId:verification?.id||null,verifiedAt:verification?.readAt||null});await queues.put(b.t.taskId,b.state);
    results.push({taskId:b.t.taskId,roleId:b.t.roleId,roleTitle:b.t.title,pageUrl:b.state.returnUrl,status,startedAt:fill.startedAt,finishedAt:fill.finishedAt,fillElapsedMs:fill.elapsedMs,initialReadbackStatus:fill.status,counts:verification?.counts||{},error:fill.errorCode||verification?.mappingError||null,exceptions:verification?.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,label,status,reason})=>({id,label,status,reason}))||[],verifyRunId:verification?.id||null,save:verification?.save||'not_verified',submission:'not_performed'});
  }
  return {status:results.every(r=>r.status==='ready_for_user_review')?'ready_for_user_review':'needs_attention',batchRunId:run.id,fillElapsedMs:run.elapsedMs,requestedConcurrency:args.concurrency,results,submission:'not_performed'};
}));
server.registerTool('roles_patch_text',{description:'按已冻结岗位和当前私有JSON，仅修正指定普通文本字段；全部计划先编译，旧值有用户改动则阻断，逐岗全表只读复核，不上传不提交。',inputSchema:{queueId:z.string().uuid(),queueHash:z.string().length(64),taskIds:z.array(z.string().uuid()).min(1).max(5),fieldIds:z.array(z.string()).min(1).max(20),expectedPrevious:z.string(),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false)})}},wrap(async args=>{
 if(new Set(args.taskIds).size!==args.taskIds.length)throw Error('DUPLICATE_ROLE_TASK');
 const jobs=[];for(const taskId of args.taskIds){const b=await boundRole({...args,taskId}),task={companyId:b.t.companyId,roleId:b.t.roleId,pageUrl:b.state.returnUrl,templateHash:hash(b.template),...resolveProfile(await loadProfile(profileFile),b.template,{},b.t.companyId)};
  const compiled=await engine.preparePlan(task);if(!compiled.allKnown)throw Error('ROLE_PROFILE_PREPARATION_REQUIRED');const saved=await store.get('plans',compiled.planId),fields=saved.pages.flatMap(p=>p.fields).filter(f=>args.fieldIds.includes(f.id));
  if(fields.length!==args.fieldIds.length||fields.some(f=>f.kind!=='text'||f.disposition!=='fill'||f.actions.some(a=>a.method!=='fill')))throw Error('TEXT_PATCH_SCOPE_INVALID');if(fields.some(f=>f.sensitive&&!args.authorization.sensitiveFields))throw Error('SENSITIVE_FIELD_AUTHORIZATION_REQUIRED');jobs.push({b,task,fields});
 }
 const release=await engine.acquireCompanies(jobs.map(j=>catalog.companies.find(c=>c.id===j.b.t.companyId)));
 try{
  // Read every target before any write, preserving user edits and current role identity.
  for(const j of jobs){await boundRole({...args,taskId:j.b.t.taskId});j.page=await browser.existingPage(j.task.pageUrl);const o=await j.page.observe({...j.b.template.pages[0],fields:j.fields});if(j.fields.some(f=>o.fields[f.id]?.value!==args.expectedPrevious))throw Error('TEXT_PATCH_PREVIOUS_VALUE_CHANGED');}
  const workers=await Promise.allSettled(jobs.map(async j=>{for(const f of j.fields)for(const a of f.actions)await j.page.act(a,f.value,{});return j.b.t.taskId;}));
  const results=[];for(const [i,j]of jobs.entries()){const v=await engine.verifyCurrentLocked(j.task);Object.assign(j.b.state,{status:v.status==='verified'?'ready_for_user_review':'needs_attention',verifyRunId:v.id,verifiedAt:v.readAt});await queues.put(j.b.t.taskId,j.b.state);results.push({taskId:j.b.t.taskId,roleTitle:j.b.t.title,status:j.b.state.status,patchedFieldIds:j.fields.map(f=>f.id),workerStatus:workers[i].status,counts:v.counts,verifyRunId:v.id,exceptions:v.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,status,reason})=>({id,status,reason})),save:v.save,submission:'not_performed'});}
  return {status:results.every(r=>r.status==='ready_for_user_review')?'ready_for_user_review':'needs_attention',results,submission:'not_performed'};
 }finally{await release();}
}));
server.registerTool('role_verify',{description:'只读核验冻结队列中的当前岗位和全部字段，保存独立报告，不改写表单。',inputSchema:queueTask,annotations:{readOnlyHint:true}},wrap(async args=>{
  const {t,state,template}=await boundRole(args),resolved=resolveProfile(await loadProfile(profileFile),template,{},t.companyId);
  const r=await engine.verifyCurrent({companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...resolved});
  state.status=r.status==='verified'?'ready_for_user_review':'needs_attention';state.verifyRunId=r.id;state.verifiedAt=r.readAt;await queues.put(t.taskId,state);
  return {status:r.status,verifyRunId:r.id,counts:r.counts,readAt:r.readAt,save:r.save,submission:r.submission};
}));
server.registerTool('coverage_check',{description:'检查现有公司与表单资产覆盖，不重新采集已覆盖公司。',inputSchema:{companyIds:z.array(z.string()).min(1).max(20)},annotations:{readOnlyHint:true}},wrap(({companyIds})=>engine.coverage(companyIds)));
server.registerTool('browser_tabs',{description:'读取显式连接的本地浏览器页面，不打开、重载或关闭页面。',annotations:{readOnlyHint:true}},wrap(()=>browser.tabs()));
server.registerTool('browser_status',{description:'读取当前连接生命周期和实际连接次数，不发起连接；失败或断开不自动重连。',annotations:{readOnlyHint:true}},wrap(()=>browser.status(),false));
server.registerTool('browser_open',{description:'在共用的 MCP Chrome 中打开已建库公司的表单页；必须匹配该公司的 origin 和模板路径。不会填写或提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url()}},wrap(async({companyId,pageUrl})=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
  const t=await store.get('templates',c.templateId),u=new URL(pageUrl);
  if(u.origin!==c.origin||!t.pages.some(p=>u.pathname.startsWith(p.pathPrefix)))throw Error('COMPANY_FORM_SCOPE_MISMATCH');
  return engine.withCompanyLease(companyId,()=>browser.request('openPage',{pageUrl}));
}));
server.registerTool('probe_conditions',{description:'仅内部建库维护：按已捕获的条件选项通过真实控件展开分支，强制登记新问题，恢复并核对原表单。不写个人事实、不上传、不提交；缺少探测授权或无法恢复原选择时拒绝。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),templateHash:z.string(),authorization:z.object({probe:z.literal(true),evidence:z.string().min(1)})}},wrap(({authorization,...task})=>engine.probeCompany(task,authorization)));
server.registerTool('capture_controls',{description:'建库阶段读取控件，并强制把未映射的新问题持久化到个人JSON；含选填项，禁止遗漏。不读取验证码或Cookie。',inputSchema:{companyId:z.string(),pageUrl:z.string().url()}},wrap(async ({companyId,pageUrl})=>engine.withCompanyLease(companyId,async()=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c||new URL(pageUrl).origin!==c.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const candidates=await Promise.all([...new Set([c.templateId,...Object.values(c.roleTemplates||{})].filter(Boolean))].map(id=>store.get('templates',id)));
  const matches=candidates.filter(t=>t.pages.some(p=>new URL(pageUrl).pathname.startsWith(p.pathPrefix)));if(matches.length>1)throw Error('AMBIGUOUS_ROLE_TEMPLATE');
  const template=matches[0]||null,plan=template?.pages.find(p=>new URL(pageUrl).pathname.startsWith(p.pathPrefix));
  const p=await browser.existingPage(pageUrl), controls=await p.inventory(plan), observedAt=new Date().toISOString();
  const registration=await updateProfile(profileFile,profile=>registerPlannedQuestions(profile,{companyId,pageUrl,fields:controls,observedAt},plan));
  return {companyId,pageUrl,observedAt,controls,registration,coverageLimit:'当前渲染文档；未展开选项、多步骤、iframe与shadow root另行建库'};
})));
server.registerTool('template_register',{description:'持久化已采集并人工确定的操作方案；不把建库等同于实测通过。',inputSchema:{companyId:z.string(),template:z.record(z.unknown())}},wrap(async ({companyId,template})=>engine.withCompanyLease(companyId,async()=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c)throw Error('UNKNOWN_COMPANY');
  validateTemplate(template);if(new URL(template.evidence.sourceUrl).origin!==c.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  const t={...template,validation:{livePassed:false}};
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  await store.update('templates',t.id,async previous=>{
    if(previous.evidence?.sourceUrl&&new URL(previous.evidence.sourceUrl).origin!==c.origin)throw Error('SHARED_TEMPLATE_ORIGIN_MISMATCH');
    await updateProfile(profileFile,p=>registerTemplateContract(p,{companyId,template:t,templateHash:hash(t)}));
    return t;
  });
  // Persist company-to-template binding privately; shipped catalog contains no user answers.
  await store.update('templates','company-bindings',bindings=>({...bindings,[companyId]:t.id}));
  await refreshBindings();
  return {templateId:t.id,templateHash:hash(t),status:'captured_not_live_verified'};
})));
server.registerTool('prepare_plan',{description:'正式填写前编译并保存全部字段的类型、位置、动作、依赖、选项和预期读回。严格校验个人JSON类型与本地附件；不访问浏览器。返回冻结计划ID与Hash，未通过不得开始填写。',inputSchema:{tasks:z.array(z.object({companyId:z.string(),pageUrl:z.string().url(),templateHash:z.string(),decisions:z.record(z.unknown()).optional()})).min(1).max(20)}},wrap(async({tasks})=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile),plans=[];
  for(const task of tasks){
    assertQuestionsMapped(profile,task.companyId,task.pageUrl);
    const company=catalog.companies.find(c=>c.id===task.companyId);if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
    const template=await store.get('templates',company.templateId);
    plans.push(await engine.preparePlan({...task,...resolveProfile(profile,template,task.decisions,task.companyId)}));
  }
  return {plans,browserAccess:false};
}));
server.registerTool('batch_prepare',{description:'仅执行填写前已编译冻结的计划；没有计划ID/Hash或资料、类型、附件版本发生变化时，接触浏览器前拒绝。集中实际读回，不含最终提交。',inputSchema:{tasks:z.array(z.object({companyId:z.string(),pageUrl:z.string().url(),templateHash:z.string(),planId:z.string(),planHash:z.string(),decisions:z.record(z.unknown()).optional()})).min(1).max(20),concurrency:z.number().int().min(1).max(5).default(3),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false)})}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile),tasks=[];
  for(const task of args.tasks){
    assertQuestionsMapped(profile,task.companyId,task.pageUrl);
    const c=catalog.companies.find(c=>c.id===task.companyId);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
    const t=await store.get('templates',c.templateId), resolved=resolveProfile(profile,t,task.decisions,task.companyId);
    tasks.push({...task,...resolved});
  }
  return engine.prepare({...args,tasks});
}));
server.registerTool('run_status',{description:'读取已保存的集中核对、缺失、差异与耗时；不以已计划或已调用推断完成。',inputSchema:{runId:z.string()},annotations:{readOnlyHint:true}},wrap(({runId})=>store.get('runs',runId)));
server.registerTool('profile_status',{description:'返回公司问题登记、映射、已知/缺失和明确省略状态；不返回个人答案原文。',inputSchema:{companyId:z.string().optional(),pageUrl:z.string().url().optional()},annotations:{readOnlyHint:true}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');return profileStatus(await loadProfile(profileFile),args.companyId,args.pageUrl);
}));
server.registerTool('profile_record_answers',{description:'将用户本轮明确回答或无/不提供写入私有JSON，保留来源和旧版本；只允许已登记事实，不存认证秘密。',inputSchema:{evidence:z.string().min(1),answers:z.array(z.object({factKey:z.string(),status:z.enum(['known','not_applicable']),value:z.unknown().optional(),omissionKind:z.enum(['confirmed_absent','user_declined','not_applicable']).optional()})).min(1)}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');return updateProfile(profileFile,p=>recordProfileAnswers(p,args));
}));
server.registerTool('profile_map_questions',{description:'内部建库：将已捕获问题映射到既有原子事实；保留新问题定义与映射证据，不允许改写用户本人操作项。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),evidence:z.string().min(1),mappings:z.array(z.object({questionId:z.string(),factKey:z.string()})).min(1)}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');return updateProfile(profileFile,p=>mapProfileQuestions(p,args));
}));
server.registerTool('verify_current',{description:'代码直接读取当前页面并核对个人JSON、选中状态、日期、重复条数、上传和错误；强制登记新增问题，保存差异报告，不填写或提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),templateHash:z.string(),decisions:z.record(z.unknown()).optional()}},wrap(async task=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const c=catalog.companies.find(c=>c.id===task.companyId);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
  const template=await store.get('templates',c.templateId),profile=await loadProfile(profileFile);
  return engine.verifyCurrent({...task,...resolveProfile(profile,template,task.decisions,task.companyId)});
}));
await server.connect(new StdioServerTransport());
