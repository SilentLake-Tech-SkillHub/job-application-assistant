import {controlCapabilities,canonicalControlSpec} from './control-registry.mjs';
import {normalizeWecruitDefinition,registerDefinitionQuestions} from './wecruit-definition.mjs';
import {assertDefinitionMapped,matchesPageIdentity} from './definition-coverage.mjs';
import {matchesRole} from './role-identity.mjs';
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
import {assertBoundRoleState} from './role-state.mjs';
import {outcomeSchema} from './application-outcome.mjs';
import {enrichControlContext} from './control-context.mjs';
import {compareControlStructures} from './control-structure.mjs';
import {CompanyBatch} from './company-batch.mjs';
import {MaterialImport} from './material-import.mjs';
import {RoutedBrowserAdapter} from './routed-browser.mjs';
import {sealFormTemplate,unsealedTemplate} from './form-seal.mjs';
import {rebindTemplate} from './template-rebind.mjs';
import {closeApplication} from './application-closeout.mjs';
import {assertSubmissionPrepared,formAssetStatus} from './form-assets.mjs';
import {readBatchFile} from './form-assets.mjs';
import {accountMatches,matchesAccount,resolveAccount} from '../login/contracts.mjs';
import {retireLegacyQuestionMappings} from './profile-migration.mjs';
import {CompanyDirectory} from './company-directory.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 公司目录只来自工作区 岗位交接/公司/（见 company-directory.mjs），组件包内不带公司目录。
const directory=new CompanyDirectory();
const catalog={companies:await directory.load()};
const store=new Store(process.env.RECRUITING_PRIVATE_DIR||path.join(root,'.private'));
const browser=process.env.RECRUITING_BROWSER_SOCKET?new RoutedBrowserAdapter({chromeSocket:process.env.RECRUITING_BROWSER_SOCKET,iabSocket:process.env.RECRUITING_IAB_SOCKET,store}):new BrowserAdapter(process.env.RECRUITING_CDP_URL);
const profileFile=process.env.RECRUITING_PROFILE_JSON;
const queues=profileFile?queueFromEnv(catalog.companies):null;
const companyBatches=queues?new CompanyBatch({store,queues,catalog:catalog.companies}):null;
async function boundRole(args){
  if(!queues)throw Error('PRIVATE_PROFILE_REQUIRED');
  const {q,t}=await queues.task(args),state=await queues.read(t.taskId);
  assertBoundRoleState(q,t,state);
  const c=catalog.companies.find(c=>c.id===t.companyId),templateId=c?.roleTemplates?.[t.roleId]||c?.templateId;if(!templateId)throw Error('COMPANY_NOT_COVERED');
  const template=await store.get('templates',templateId),plan=template.pages.find(p=>new URL(state.returnUrl).pathname.startsWith(p.pathPrefix));
  if(!plan||plan.roleTitle!==t.title)throw Error('CONFIRMED_ROLE_TITLE_TEMPLATE_MISMATCH');
  const login=JSON.parse(await readFile(directory.loginFile(t.companyId),'utf8'));
  const snapshot=await browser.request('roleSnapshot',{pageId:state.pageId,roleSelector:plan.roleSelector,accountSelector:login.account.selector,loginRoot:login.fields?.root,roleIdentity:plan.roleIdentity});
  if(login.loginMethod==='user_operated'){const accountPage=await browser.existingPage(login.account.pageUrl),account=await accountPage.observe({fields:[{id:'account',read:{selector:login.account.selector,kind:'text'}}]});snapshot.account=account.fields.account?.value;snapshot.loginFormPresent=!account.fields.account?.present;}
  if(snapshot.pageUrl!==state.returnUrl||!matchesRole(plan,snapshot)||snapshot.loginFormPresent||!matchesAccount(snapshot.account,resolveAccount(await loadProfile(profileFile),login)))throw Error('ROLE_OR_ACCOUNT_CHANGED_BEFORE_FILL');
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
  if(plan?.provider!=='feishu')fields=await enrichControlContext(await browser.existingPage(pageUrl),fields);
  await updateProfile(profileFile,p=>registerPlannedQuestions(p,{companyId,pageUrl,fields,observedAt:new Date().toISOString(),coverageRequired:discoveryOnly},plan));
  if(!discoveryOnly)assertQuestionsMapped(await loadProfile(profileFile),companyId,pageUrl);
}});
const packageInfo=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const server=new McpServer({name:'recruiting-form-batch',version:packageInfo.version});
const materials=new MaterialImport({store,browser,profileFile,companies:catalog.companies,withCompanyLease:(companyId,fn)=>engine.withCompanyLease(companyId,fn)});
const output=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
const wrap=(fn,refresh=true)=>async args=>{try{if(refresh)await refreshBindings();return output(await fn(args));}catch(e){return {isError:true,...output({error:/^[A-Z_]+(?::[a-z0-9_-]+)?$/.test(e.message)?e.message:e.code==='ENOENT'?'PRIVATE_ASSET_NOT_FOUND':'OPERATION_FAILED'})};}};
server.registerTool('application_closeout',{description:'固定事件收尾：校验官网证据后把本岗位最新结果覆盖写入 岗位交接/投递回传.json（每岗位一条，不留历史和备份）；同事件幂等。记录“已投递”前，本岗位必须在本批队列中由 MCP 按已封存的公司表单模板填写并核验通过，手工填写的岗位拒绝记录。不改主表状态：由搜索端反向评审、用户确认后才写入。不提交网站。',inputSchema:{outcome:outcomeSchema}},wrap(async args=>{await refreshBindings();return closeApplication({...args,assertPrepared:outcome=>assertSubmissionPrepared({queues,store,catalog:catalog.companies,outcome})});},false));
server.registerTool('form_assets_status',{description:'只读：按当前投递批次（或指定公司）列出每家公司的登录配置、表单模板是否封存、各岗位申请页链接是否已存；缺口须先按建库路线补齐，不得手工填表代替。',inputSchema:{companyIds:z.array(z.string()).min(1).max(50).optional()},annotations:{readOnlyHint:true}},wrap(async({companyIds})=>{await refreshBindings();const batch=await readBatchFile(directory.handoffDir);return formAssetStatus({directory,catalog:catalog.companies,store,batch,companyIds});}));
const queueTask={queueId:z.string().uuid(),queueHash:z.string().length(64),taskId:z.string().uuid()};
server.registerTool('runtime_info',{description:'只读返回当前实际运行版本与能力，识别旧安装端；不连接浏览器。',annotations:{readOnlyHint:true}},wrap(()=>({version:packageInfo.version,compilerVersion:3,controlCapabilities:controlCapabilities(),capabilities:['company_batch','form_route','workflow_next','role_bindings','frozen_plan','independent_readback','fixed_closeout','official_form_definition','semantic_question_locators'],browserAccess:false}),false));
server.registerTool('workflow_next',{description:'确定性调用路由：先判断公司资产，复用则离线映射与编译；缺失或失效才返回增量建库接口。只返回下一调用及真实阻塞，不替模型宣称完成。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional()},annotations:{readOnlyHint:true}},wrap(async task=>{
 const route=await engine.formRoute(task);
 if(route.route==='acquire'){let hasDefinitionRecipe=false;try{hasDefinitionRecipe=!!directory.definitionFile(task.companyId);}catch(e){if(e.message!=='UNKNOWN_COMPANY')throw e;}return {...route,definitionFirst:hasDefinitionRecipe,nextTools:[...(hasDefinitionRecipe?['capture_form_definition']:[]),'capture_controls','capture_choice_options','template_register','probe_conditions','template_finalize','prepare_plan'],submission:'not_performed'};}
 const profile=await loadProfile(profileFile),company=engine.companyForTask(task),template=await store.get('templates',company.templateId);
 try{assertQuestionsMapped(profile,task.companyId,task.pageUrl);}catch{return {...route,nextStage:'local_mapping',nextTools:['profile_status','profile_map_questions'],submission:'not_performed'};}
 const plan=await engine.preparePlan({...task,templateHash:hash(template),...resolveProfile(profile,template,{},task.companyId)});
 return {...route,...plan,nextTools:plan.constructionBlockers?.length?['capture_controls','template_register']:plan.counts?.needs_user?['profile_status','profile_record_answers']:['batch_prepare','verify_current'],submission:'not_performed'};
}));
server.registerTool('form_route',{description:'先做本地IF判断：公司已有覆盖当前页面的可用表单则复用并转资料预检；没有、未完成或路径不匹配才进入增量建库。不打开网页、不重新采集已有表单、不填写。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional()},annotations:{readOnlyHint:true}},wrap(a=>engine.formRoute(a)));
server.registerTool('capture_repeat_slots',{description:'内部建库：按已观察的重复栏目容器和添加按钮准备指定数量空白条目，不填写个人数据、不上传或提交；随后须重新采集全部字段。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),groupSelector:z.string(),addSelector:z.string(),addLabel:z.string().optional(),count:z.number().int().min(1).max(20),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1)})}},wrap(a=>engine.withCompanyLease(a.companyId,async()=>{const p=await browser.existingPage(a.pageUrl);await p.ensureGroups([{id:'construction-slots',selector:a.groupSelector,addSelector:a.addSelector,addLabel:a.addLabel,count:a.count}]);return {status:'slots_created_require_recapture',count:a.count,submission:'not_performed'};})),false);
server.registerTool('capture_choice_options',{description:'内部建库：仅对已采集的 UD 下拉逐个打开读取真实选项并关闭，不更改原选择；保存私有选项资产。selectors可限定本次需补采的已捕获下拉，不改变完整问题登记。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),captureId:z.string(),selectors:z.array(z.string()).min(1).optional(),searchQueries:z.record(z.string()).optional()}},wrap(args=>engine.withCompanyLease(args.companyId,async()=>{
 const capture=await store.get('runs',args.captureId);if(capture.companyId!==args.companyId||capture.pageUrl!==args.pageUrl)throw Error('CHOICE_CAPTURE_SCOPE_MISMATCH');
 const page=await browser.existingPage(args.pageUrl),choices=[];
 const candidates=capture.controls.filter(f=>f.type==='search'&&f.contextProvider==='.ud-formily-item'||f.type==='combobox'&&f.contextProvider==='.ant-form-item');
 if(args.selectors?.some(s=>!candidates.some(f=>f.selector===s)))throw Error('CHOICE_SELECTOR_NOT_CAPTURED');
 for(const f of candidates.filter(f=>!args.selectors||args.selectors.includes(f.selector))){
  const root=f.questionSelector||`.ud-formily-item:has(:is(${f.selector})):not(:has(.ud-formily-item :is(${f.selector})))`;
  const result=f.disabled?{options:[],status:'disabled_by_parent',restored:true}:await page.act({query:args.searchQueries?.[f.selector],method:f.contextProvider==='.ant-form-item'?'ant_dropdown_inspect':'ud_dropdown_inspect',selector:f.selector,labelSelector:f.contextProvider==='.ant-form-item'?f.labelSelector:root+' > .ud-formily-item-label'},null,{});
  choices.push({selector:f.selector,label:f.label,fieldKey:f.fieldKey,group:f.group,repeatIndex:f.repeatIndex,...result});
  const checkpointId='choices-'+args.companyId+'-'+hash({pageUrl:args.pageUrl,captureId:args.captureId}).slice(0,16);await store.put('runs',checkpointId,{id:checkpointId,...args,choices,readAt:new Date().toISOString(),status:'in_progress'});
  if(!result.restored)throw Error('CHOICE_INSPECTION_NOT_RESTORED');
 }
 const id='choices-'+args.companyId+'-'+hash({pageUrl:args.pageUrl,captureId:args.captureId}).slice(0,16);await store.put('runs',id,{id,...args,choices,readAt:new Date().toISOString()});return {captureId:args.captureId,choicesId:id,choices};
})),false);
server.registerTool('material_import_prepare',{description:'首次建库：对已捕获简历上传控件与用户已批准PDF离线预检，冻结文件Hash和目标；不访问网页。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),captureId:z.string(),selector:z.string(),containerSelector:z.string()}},wrap(a=>materials.prepare(a),false));
server.registerTool('material_import_run',{description:'执行已冻结的简历导入，真实上传前核对控件、简历容器和文件Hash；尝试先落账，不自动重试。结果仍须重新采集并核验网站解析。',inputSchema:{planId:z.string().uuid(),planHash:z.string().length(64),authorization:z.object({uploads:z.literal(true),evidence:z.string().min(1)})}},wrap(a=>materials.run(a),false));
const batchRef={batchId:z.string().uuid(),batchHash:z.string().length(64)};
server.registerTool('company_batch_restrict_channels',{description:'按用户明确要求收窄本批浏览器通道；保留页面和事实，移除迁移岗位的旧页面绑定，要求在新通道重新核实原岗位与账号。',inputSchema:{...batchRef,channels:z.array(z.enum(['chrome','iab'])).min(1).max(2),authorizationRef:z.string().min(1)}},wrap(a=>companyBatches.restrictChannels(a),false));
server.registerTool('company_batch_create',{description:'离线从用户正向评审确认后的 岗位交接/投递批次.json 取公司，保存双浏览器批次（不接受旧公司方案文件）；默认 Chrome/IAB 各10家公司，同公司多岗位只占一个公司名额。不转换Excel、不打开网页。',inputSchema:{rolesFile:z.string().optional(),companyPlan:z.record(z.unknown()).optional(),companyOrder:z.array(z.string()).optional(),authorizationRef:z.string().min(1),companiesPerChannel:z.number().int().min(1).max(10).default(10),parallelRoles:z.boolean().default(false)}},wrap(async a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');const created=await companyBatches.create(a);await refreshBindings();const assets=await formAssetStatus({directory,catalog:catalog.companies,store,batch:await readBatchFile(directory.handoffDir)});return {...created,formAssets:{ready:assets.ready,incomplete:assets.incomplete,rule:'缺表单模板的公司先按建库路线 capture→template_register→probe_conditions→template_finalize 补齐，再 prepare；不得手工填表代替'}};},false));
server.registerTool('company_batch_take',{description:'原子领取并切分公司到 Chrome/IAB，默认每通道最多10家；保留公司/平台登录范围亲和性与已确认岗位顺序。返回宿主实际执行任务，不把派发当成功。',inputSchema:batchRef},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.take(a);},false));
server.registerTool('company_batch_record',{description:'按公司租约收回实际运行状态；可独立等待用户，准备完成必须提供所有岗位的真实填写核验运行证据。',inputSchema:{...batchRef,companyId:z.string(),channel:z.enum(['chrome','iab']),leaseToken:z.string().uuid(),status:z.enum(['running','waiting_for_user','ready_for_user_review','blocked']),reason:z.string().optional(),runIds:z.array(z.string()).optional()}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.record(a);},false));
server.registerTool('company_batch_status',{description:'只读双通道公司批次的等待、阻塞及核验结果，不返回租约令牌。',inputSchema:batchRef,annotations:{readOnlyHint:true}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.status(a);},false));
server.registerTool('company_batch_resume',{description:'显式恢复原公司租约，保留原通道、岗位和浏览器；须提供恢复证据及原令牌。接口不重开页面、不重发验证码。',inputSchema:{...batchRef,companyId:z.string(),channel:z.enum(['chrome','iab']),leaseToken:z.string().uuid(),recoveryRef:z.string().min(1)}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.resume(a);},false));
server.registerTool('company_batch_close_preparation',{description:'用户明确重测后结束旧准备批次并释放调度占用；保留浏览器、页面和所有证据，不触碰网站或业务投递状态。',inputSchema:{...batchRef,authorizationRef:z.string().min(1),reason:z.string().min(1)}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.closePreparation(a);},false));
server.registerTool('role_prepare',{description:'从冻结岗位队列取目标；核对登录后已返回原岗位，离线编译全部字段后填写并独立核验。仅返回异常与计数，不提交。',inputSchema:{...queueTask,authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
  const queued=await queues.task(args),queuedState=await queues.read(queued.t.taskId);
  if(!queuedState.returnUrl)throw Error('ROLE_NOT_READY_FOR_FILL');
  const formRoute=await engine.formRoute({companyId:queued.t.companyId,roleId:queued.t.roleId,pageUrl:queuedState.returnUrl});
  if(formRoute.route==='acquire')return {status:'needs_form_acquisition',...formRoute,submission:'not_performed'};
  const {t,state,template}=await boundRole(args),profile=await loadProfile(profileFile);
  assertQuestionsMapped(profile,t.companyId,state.returnUrl);
  const task={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...resolveProfile(profile,template,{},t.companyId),roleQueueArgs:{queueId:args.queueId,queueHash:args.queueHash,taskId:args.taskId}};
  const plan=await engine.preparePlan(task);
  if(!plan.readyForExecution&&!(args.authorization.allowPartialPreparation&&plan.status==='needs_answers'&&!plan.constructionBlockers?.length))return {...plan,status:plan.status,submission:'not_performed'};
  const fill=await engine.prepare({tasks:[{...task,planId:plan.planId,planHash:plan.planHash}],concurrency:1,authorization:args.authorization});
  if(fill.results[0]?.errorCode)return {status:'needs_attention',fillRunId:fill.id,error:fill.results[0].errorCode,submission:'not_performed'};
  const verification=await engine.verifyCurrent({...task,...resolveProfile(await loadProfile(profileFile),template,{},t.companyId)});
  state.status=verification.status==='verified'?'ready_for_user_review':'needs_attention';state.fillRunId=fill.id;state.verifyRunId=verification.id;state.verifiedAt=verification.readAt;
  await queues.put(t.taskId,state);
  return {status:state.status,taskId:t.taskId,companyId:t.companyId,roleTitle:t.title,pageUrl:state.returnUrl,fillRunId:fill.id,verifyRunId:verification.id,counts:verification.counts,fillElapsedMs:fill.elapsedMs,initialReadbackStatus:fill.status,exceptions:verification.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,label,status,reason})=>({id,label,status,reason})),save:verification.save,submission:'not_performed'};
}));
server.registerTool('roles_prepare_batch',{description:'按已确认并发模式，在共享账号独占批次内并发准备独立岗位页；全部计划先编译、逐岗位核验，不登录、不提交。',inputSchema:{queueId:z.string().uuid(),queueHash:z.string().length(64),taskIds:z.array(z.string().uuid()).min(1).max(5),concurrency:z.number().int().min(1).max(5).default(3),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
  if(new Set(args.taskIds).size!==args.taskIds.length)throw Error('DUPLICATE_ROLE_TASK');
  const q=await queues.get(args),selectedTasks=args.taskIds.map(id=>q.tasks.find(t=>t.taskId===id));
  const sameCompanyMultiRole=new Set(selectedTasks.filter(Boolean).map(t=>t.companyId)).size!==selectedTasks.filter(Boolean).length;
  if(sameCompanyMultiRole&&(q.executionMode!=='parallel_roles'&&!q.parallelRoles))throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  if(!sameCompanyMultiRole&&!['parallel_roles','parallel_companies'].includes(q.executionMode)&&!q.parallelRoles)throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  const tasks=[],bound=[];
  for(const taskId of args.taskIds){const a={queueId:args.queueId,queueHash:args.queueHash,taskId};const queued=await queues.task(a),state=await queues.read(taskId);const route=await engine.formRoute({companyId:queued.t.companyId,roleId:queued.t.roleId,pageUrl:state.returnUrl||queued.t.applyUrl||queued.t.url});if(route.route==='acquire')return {status:'needs_form_acquisition',...route,taskId,submission:'not_performed'};const b=await boundRole(a),profile=await loadProfile(profileFile);assertQuestionsMapped(profile,b.t.companyId,b.state.returnUrl);
    const task={companyId:b.t.companyId,roleId:b.t.roleId,pageUrl:b.state.returnUrl,templateHash:hash(b.template),...resolveProfile(profile,b.template,{},b.t.companyId),roleQueueArgs:a};
    const plan=await engine.preparePlan(task);if(!plan.readyForExecution&&!(args.authorization.allowPartialPreparation&&plan.status==='needs_answers'&&!plan.constructionBlockers?.length))return {...plan,status:plan.status,submission:'not_performed'};tasks.push({...task,planId:plan.planId,planHash:plan.planHash});bound.push(b);
  }
  if(new Set(bound.map(b=>b.state.pageId)).size!==bound.length)throw Error('DUPLICATE_ROLE_PAGE');
  const run=await engine.prepare({tasks,concurrency:args.concurrency,authorization:args.authorization,parallelRoles:true});
  const results=new Array(bound.length);
  // Group post-fill verification by origin so distinct companies/channels verify in parallel while same-origin roles serialize cleanly.
  const origins=[...new Set(bound.map(b=>new URL(b.state.returnUrl).origin))],groups=origins.map(origin=>bound.map((b,i)=>({b,i})).filter(({b})=>new URL(b.state.returnUrl).origin===origin));
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(args.concurrency,groups.length)},async()=>{
    while(cursor<groups.length){
      for(const {b,i}of groups[cursor++]){
        const task=tasks[i],fill=run.results[i];let verification;
        if(!fill.errorCode)verification=await engine.verifyCurrent({...task,...resolveProfile(await loadProfile(profileFile),b.template,{},b.t.companyId)});
        const status=verification?.status==='verified'?'ready_for_user_review':'needs_attention';Object.assign(b.state,{status,fillRunId:run.id,verifyRunId:verification?.id||null,verifiedAt:verification?.readAt||null});await queues.put(b.t.taskId,b.state);
        results[i]={taskId:b.t.taskId,roleId:b.t.roleId,roleTitle:b.t.title,pageUrl:b.state.returnUrl,status,startedAt:fill.startedAt,finishedAt:fill.finishedAt,fillElapsedMs:fill.elapsedMs,initialReadbackStatus:fill.status,counts:verification?.counts||{},error:fill.errorCode||verification?.mappingError||null,exceptions:verification?.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,label,status,reason})=>({id,label,status,reason}))||[],verifyRunId:verification?.id||null,save:verification?.save||'not_verified',submission:'not_performed'};
      }
    }
  }));
  return {status:results.every(r=>r.status==='ready_for_user_review')?'ready_for_user_review':'needs_attention',batchRunId:run.id,fillElapsedMs:run.elapsedMs,requestedConcurrency:args.concurrency,results,submission:'not_performed'};
}));
server.registerTool('roles_patch_text',{description:'按已冻结岗位和当前私有JSON，仅修正指定普通文本字段；全部计划先编译，旧值有用户改动则阻断，逐岗全表只读复核，不上传不提交。',inputSchema:{queueId:z.string().uuid(),queueHash:z.string().length(64),taskIds:z.array(z.string().uuid()).min(1).max(5),fieldIds:z.array(z.string()).min(1).max(20),expectedPrevious:z.string(),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
 if(new Set(args.taskIds).size!==args.taskIds.length)throw Error('DUPLICATE_ROLE_TASK');
 const jobs=[];for(const taskId of args.taskIds){const b=await boundRole({...args,taskId}),task={companyId:b.t.companyId,roleId:b.t.roleId,pageUrl:b.state.returnUrl,templateHash:hash(b.template),...resolveProfile(await loadProfile(profileFile),b.template,{},b.t.companyId)};
  const compiled=await engine.preparePlan(task);if(!compiled.readyForExecution)throw Error('ROLE_PROFILE_PREPARATION_REQUIRED');const saved=await store.get('plans',compiled.planId),fields=saved.pages.flatMap(p=>p.fields).filter(f=>args.fieldIds.includes(f.id));
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
server.registerTool('probe_conditions',{description:'仅内部建库维护：按已捕获的条件选项通过真实控件展开分支，强制登记新问题，恢复并核对原表单。不写个人事实、不上传、不提交；缺少探测授权或无法恢复原选择时拒绝。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),authorization:z.object({probe:z.literal(true),evidence:z.string().min(1)})}},wrap(({authorization,...task})=>engine.probeCompany(task,authorization)));
server.registerTool('capture_form_definition',{description:'内部建库：按公司已核实的官网模板读取接口获取全部栏目、隐藏条件问题和选项字典，强制登记个人JSON；不读取候选人答案，不填写、不提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url()}},wrap(args=>engine.withCompanyLease(args.companyId,async()=>{
 const company=catalog.companies.find(c=>c.id===args.companyId);if(!company||new URL(args.pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
 const recipeFile=directory.definitionFile(args.companyId);if(!recipeFile)throw Error('FORM_DEFINITION_NOT_CONFIGURED');const recipe=JSON.parse(await readFile(recipeFile,'utf8'));
 if(recipe.companyId!==args.companyId||recipe.provider!=='wecruit'||!recipe.evidence?.sourceCodeHash)throw Error('VERIFIED_SCHEMA_RECIPE_REQUIRED');
 const page=await browser.existingPage(args.pageUrl),raw=await page.act({method:'capture_wecruit_schema',endpoint:recipe.endpoint},null,{});if(!raw.template)throw Error('SCHEMA_RESPONSE_NOT_TEMPLATE');
 const definition=normalizeWecruitDefinition(raw.template,raw.dictionary),id='definition-'+args.companyId+'-'+hash({pageUrl:args.pageUrl,definitionHash:definition.sourceDefinitionHash}).slice(0,16);
 await store.put('runs',id,{id,operation:'official_form_definition',companyId:args.companyId,...raw,definition});
 const registration=await updateProfile(profileFile,p=>registerDefinitionQuestions(p,{companyId:args.companyId,definition,sourceId:id,evidenceRef:id}));
 return {definitionId:id,definitionHash:definition.sourceDefinitionHash,...registration,submission:'not_performed'};
})));
server.registerTool('capture_controls',{description:'建库阶段批量读取控件，强制登记新问题并保存完整私有快照；compact=true 仅返回结构差异和证据ID。结构匹配不代表执行通过。不读取验证码或Cookie。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),provider:z.enum(['feishu','ant']).optional(),compact:z.boolean().optional()}},wrap(async ({companyId,pageUrl,compact,provider})=>engine.withCompanyLease(companyId,async()=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c||new URL(pageUrl).origin!==c.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const candidates=await Promise.all([...new Set([c.templateId,...Object.values(c.roleTemplates||{})].filter(Boolean))].map(id=>store.get('templates',id)));
  const matches=candidates.filter(t=>t.pages.some(p=>matchesPageIdentity(p,pageUrl)));if(matches.length>1)throw Error('AMBIGUOUS_ROLE_TEMPLATE');
  const template=matches[0]||null,plan=template?.pages.find(p=>matchesPageIdentity(p,pageUrl));
  const p=await browser.existingPage(pageUrl), controls=await enrichControlContext(p,await p.inventory(plan||{provider})), observedAt=new Date().toISOString();
  const registration=await updateProfile(profileFile,profile=>registerPlannedQuestions(profile,{companyId,pageUrl,fields:controls,observedAt},plan));
  const captureIndexId='capture-index-'+companyId+'-'+hash(pageUrl).slice(0,16),captureId='capture-'+companyId+'-'+hash({pageUrl,observedAt,controls}).slice(0,24);
  let previous;try{const index=await store.get('runs',captureIndexId);previous=await store.get('runs',index.latestCaptureId);}catch(error){if(error.code!=='ENOENT')throw error;}
  const structure=compareControlStructures(controls,previous?.controls||[]);
  const roleSelector=(plan||candidates[0]?.pages?.[0])?.roleSelector;
  const identity=roleSelector?await p.observe({fields:[],roleSelector}):null;
  const result={companyId,pageUrl,provider:plan?.provider||provider||null,roleTitle:identity?.roleTitle||null,observedAt,controls,registration,structure,captureId,coverageLimit:'当前渲染文档；未展开选项、多步骤、静态问题、iframe与shadow root另行核对'};
  await store.put('runs',captureId,result);await store.put('runs',captureIndexId,{latestCaptureId:captureId,previousCaptureId:previous?.captureId||null});
  if(!compact)return result;
  const summarize=rows=>rows.map(({selectors,...row})=>row);
  return {...result,controls:undefined,structure:{...structure,added:summarize(structure.added),removed:summarize(structure.removed)}};
})));
server.registerTool('template_finalize',{description:'只接受匹配当前资产Hash、全部声明分支通过并恢复的真实探测回执；代码检查实际控件覆盖和类型后封存公司资产。不把资料缺失或页面填写当作完成。',inputSchema:{companyId:z.string(),roleId:z.string().optional(),templateHash:z.string(),probeRunId:z.string().uuid()}},wrap(args=>engine.withCompanyLease(args.companyId,async()=>{
 const c=engine.companyForTask(args),t=await store.get('templates',c.templateId);if(hash(t)!==args.templateHash)throw Error('TEMPLATE_VERSION_CHANGED');
 const probe=await store.get('runs',args.probeRunId);await updateProfile(profileFile,p=>retireLegacyQuestionMappings(p,{companyId:args.companyId,template:t,probe}));const profile=await loadProfile(profileFile);assertQuestionsMapped(profile,args.companyId,t.evidence.sourceUrl);assertDefinitionMapped(profile,args.companyId,t);
 const channel=await browser.channel({pageUrl:t.evidence.sourceUrl});const sealed=sealFormTemplate(t,probe,{companyId:args.companyId,profileMapped:true,channel});validateTemplate(sealed);
 await updateProfile(profileFile,p=>registerTemplateContract(p,{companyId:args.companyId,template:sealed,templateHash:hash(sealed)}));await store.put('templates',sealed.id,sealed);
 return {templateId:sealed.id,templateHash:hash(sealed),status:'asset_sealed_require_profile_preflight',probeRunId:probe.id,browserAccess:false,submission:'not_performed'};
})));
server.registerTool('template_rebind_role',{description:'建库阶段离线复用同公司表单：核对真实采集、字段一一对应及冻结岗位标题，生成岗位独立资产；不重新试填，不宣称建库缺口已通过。',inputSchema:{...queueTask,baselineCaptureId:z.string(),captureId:z.string(),sourceTemplateId:z.string()}},wrap(async args=>{
 const {t}=await queues.task(args);
 return engine.withCompanyLease(t.companyId,async()=>{
  const [baseline,current,source]=await Promise.all([store.get('runs',args.baselineCaptureId),store.get('runs',args.captureId),store.get('templates',args.sourceTemplateId)]);
  if(current.companyId!==t.companyId)throw Error('REBIND_COMPANY_SCOPE_CHANGED');
  const result=rebindTemplate({template:source,baseline,current,roleId:t.roleId,confirmedTitle:t.title});validateTemplate(result.template);
  await updateProfile(profileFile,p=>{registerTemplateContract(p,{companyId:t.companyId,template:result.template,templateHash:hash(result.template)});return registerPlannedQuestions(p,{companyId:t.companyId,pageUrl:current.pageUrl,fields:current.controls,observedAt:current.observedAt},result.template.pages[0]);});
  const incomplete=['allConditionalBranchesVerified','allControlsMapped','allDriversSupported'].filter(k=>source.coverage?.[k]!==true);
  const unstable=result.template.pages.flatMap(p=>p.fields).filter(f=>[f.read?.selector,...(f.inventorySelectors||[]),...(f.actions||[]).flatMap(a=>[a.selector,a.labelSelector,a.openSelector])].some(s=>/^\s*body\s*>/i.test(s||'')&&/:nth-(?:of-type|child)\(/.test(s))).map(f=>f.id);
  if(incomplete.length||unstable.length){const candidateId='rebind-'+result.template.id;await store.put('runs',candidateId,{operation:'incomplete_rebind_candidate',template:result.template,blockers:incomplete,unstableFields:unstable});return {candidateId,status:'needs_asset_completion',blockers:incomplete,unstableFields:unstable,boundForExecution:false,browserAccess:false};}
  await store.put('templates',result.template.id,result.template);
  await store.update('templates','role-bindings',b=>({...b,[t.companyId]:{...(b[t.companyId]||{}),[t.roleId]:result.template.id}}));await refreshBindings();
  return {templateId:result.template.id,templateHash:hash(result.template),status:'rebound_require_construction_probe',nextTools:['capture_controls','probe_conditions','template_finalize','prepare_plan'],requiresLiveVerification:true,browserAccess:false};
 });
}));
server.registerTool('template_register',{description:'持久化已采集并人工确定的操作方案；不把建库等同于实测通过。',inputSchema:{companyId:z.string(),roleId:z.string().optional(),template:z.record(z.unknown())}},wrap(async ({companyId,roleId,template})=>engine.withCompanyLease(companyId,async()=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c)throw Error('UNKNOWN_COMPANY');
  template=canonicalControlSpec(template);validateTemplate(template);if(new URL(template.evidence.sourceUrl).origin!==c.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  const t=unsealedTemplate(template);
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  await store.update('templates',t.id,async previous=>{
    if(previous.evidence?.sourceUrl&&new URL(previous.evidence.sourceUrl).origin!==c.origin)throw Error('SHARED_TEMPLATE_ORIGIN_MISMATCH');
    await updateProfile(profileFile,p=>registerTemplateContract(p,{companyId,template:t,templateHash:hash(t)}));
    return t;
  });
  // Persist company-to-template binding privately; shipped catalog contains no user answers.
  if(roleId)await store.update('templates','role-bindings',bindings=>({...bindings,[companyId]:{...(bindings[companyId]||{}),[roleId]:t.id}}));
  else await store.update('templates','company-bindings',bindings=>({...bindings,[companyId]:t.id}));
  await refreshBindings();
  return {templateId:t.id,templateHash:hash(t),status:'captured_not_live_verified'};
})));
server.registerTool('prepare_plan',{description:'正式填写前编译并保存全部字段的类型、位置、动作、依赖、选项和预期读回。严格校验个人JSON类型与本地附件；不访问浏览器。返回冻结计划ID与Hash，未通过不得开始填写。',inputSchema:{tasks:z.array(z.object({companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),decisions:z.record(z.unknown()).optional()})).min(1).max(20)}},wrap(async({tasks})=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile),plans=[];
  for(const task of tasks){
    const formRoute=await engine.formRoute(task);
    if(formRoute.route==='acquire'&&formRoute.reason!=='COMPANY_FORM_ASSET_INCOMPLETE'){plans.push({...formRoute,status:'needs_form_acquisition',readyForExecution:false});continue;}
    assertQuestionsMapped(profile,task.companyId,task.pageUrl);
    const company=engine.companyForTask(task);if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
    const template=await store.get('templates',company.templateId);
    plans.push(await engine.preparePlan({...task,...resolveProfile(profile,template,task.decisions,task.companyId)}));
  }
  return {plans,browserAccess:false};
}));
server.registerTool('batch_prepare',{description:'仅执行填写前已编译冻结的计划；没有计划ID/Hash或资料、类型、附件版本发生变化时，接触浏览器前拒绝。集中实际读回，不含最终提交。',inputSchema:{tasks:z.array(z.object({companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),planId:z.string(),planHash:z.string(),decisions:z.record(z.unknown()).optional()})).min(1).max(20),concurrency:z.number().int().min(1).max(5).default(3),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile),tasks=[];
  for(const task of args.tasks){
    assertQuestionsMapped(profile,task.companyId,task.pageUrl);
    const c=engine.companyForTask(task);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
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
server.registerTool('verify_current',{description:'代码直接读取当前页面并核对个人JSON、选中状态、日期、重复条数、上传和错误；强制登记新增问题，保存差异报告，不填写或提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),decisions:z.record(z.unknown()).optional()}},wrap(async task=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const c=engine.companyForTask(task);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
  const template=await store.get('templates',c.templateId),profile=await loadProfile(profileFile);
  return engine.verifyCurrent({...task,...resolveProfile(profile,template,task.decisions,task.companyId)});
}));
await server.connect(new StdioServerTransport());
