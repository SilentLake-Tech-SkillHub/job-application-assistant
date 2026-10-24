import {runtimeIdentity} from './runtime-identity.mjs';
import {observeUserOperatedSession} from '../login/browser.mjs';
import {safeControlErrorDetails} from './control-error-details.mjs';
import {recordMaterialDestinationException,revokeMaterialDestinationException,withMaterialDispositions} from './material-disposition.mjs';
const residentRuntime=await runtimeIdentity('application');
import {prepareRoleMaterials} from './prepare-role-materials.mjs';
import {submitReviewedRole} from './role-submit.mjs';
import {discoverMappedChoice} from './choice-discovery.mjs';
import {inspectCapturedChoice} from './choice-capture.mjs';
import {assertPreparedPlan} from './execution-plan.mjs';
import {authorizedProfileContext,applyAuthorizedProfileFields} from './profile-fill-authorization.mjs';
import {ongoingDateUserWait} from './user-input-contract.mjs';
import {captureLockedChoice} from './locked-control.mjs';
import {confirmedMaterialContext} from './role-material-context.mjs';
import {normalizeControlPolicy,humanActionReason} from './field-policy.mjs';
import {technicalHandoffReasons} from './workflow-contract.mjs';
import {assertStoredExecutionContract} from './profile.mjs';
import {rankChoices,resolveObservedChoice,mergeObservedChoices,assertStoredChoiceResolutions} from './choice-resolution.mjs';
import {assertStoredChoiceGoals} from './choice-goal-contract.mjs';
import {controlCapabilities,canonicalControlSpec} from './control-registry.mjs';
import {normalizeWecruitDefinition,registerDefinitionQuestions} from './wecruit-definition.mjs';
import {assertDefinitionMapped,matchesPageIdentity} from './definition-coverage.mjs';
import {matchesRole,bindRoleTitleProof} from './role-identity.mjs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import { Store, Engine, validateTemplate, hash } from './engine.mjs';
import { BrowserAdapter } from './browser.mjs';
import { BrokerBrowserAdapter } from './browser-rpc.mjs';
import { loadProfile, updateProfile, registerObservedQuestions, registerPlannedQuestions, registerTemplateContract, assertQuestionsMapped, resolveProfile, profileStatus, recordProfileAnswers, mapProfileQuestions } from './profile.mjs';
import {queueFromEnv} from './queue-config.mjs';
import {assertBoundRoleState} from './role-state.mjs';
import {outcomeSchema} from './application-outcome.mjs';
import {enrichControlContext,liveControls} from './control-context.mjs';
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
import {normalizeReaStructure,bindStructureControls} from './rea-structure.mjs';
import {mappingCandidates,buildFormTemplate} from './form-construction.mjs';
import {templateConstructionIssues,classifyPending} from './field-policy.mjs';
import {formLocation,lookupCompanyForm} from './profile.mjs';
import {continuationFor,advanceCompanies} from './workflow-continuation.mjs';
import {CompanyDirectory} from './company-directory.mjs';
import {acquisitionPlan,detectedAcquisitionPlan,assertCollectionProvider,captureContentId,isChoiceControl,isDateControl,capturedChoiceOptions,compactConstructionResult,templateFromDraft} from './form-acquisition.mjs';
import {scriptCoverage,searchCapturedScripts} from './page-structure.mjs';
import {auditStoredContract,contractAuditSummary,workflowEnvelope,registerWorkflowTool} from './workflow-contract.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 公司目录只来自工作区 岗位交接/公司/（见 company-directory.mjs），组件包内不带公司目录。
const directory=new CompanyDirectory();
const catalog={companies:await directory.load()};
const store=new Store(process.env.RECRUITING_PRIVATE_DIR||path.join(root,'.private'));
const browser=process.env.RECRUITING_BROWSER_SOCKET?new RoutedBrowserAdapter({chromeSocket:process.env.RECRUITING_BROWSER_SOCKET,iabSocket:process.env.RECRUITING_IAB_SOCKET,store}):new BrowserAdapter(process.env.RECRUITING_CDP_URL);
const profileFile=process.env.RECRUITING_PROFILE_JSON;
const queues=profileFile?queueFromEnv(catalog.companies):null;
const companyBatches=queues?new CompanyBatch({store,queues,catalog:catalog.companies}):null;
async function resolveInputs(profile,template,decisions,companyId,task={}){
 await assertStoredChoiceGoals(template,{store,companyId,profile});
 const rawMaterialContext=await confirmedMaterialContext({handoffDir:directory.handoffDir,companyId,roleId:task.roleId,pageUrl:task.pageUrl||template.evidence.sourceUrl,catalog:catalog.companies});
 const materialContext=withMaterialDispositions(profile,rawMaterialContext,{pageUrl:task.pageUrl||template.evidence.sourceUrl,templateHash:hash(template)});
 const resolved=resolveProfile(profile,template,decisions,companyId,materialContext),pageUrl=task.pageUrl||template.evidence.sourceUrl,company=catalog.companies.find(c=>c.id===companyId);
 return {...resolved,profileFillContext:authorizedProfileContext(profile,template,{materialContext,companyId,roleId:materialContext.roleId,pageUrl,officialOrigin:company?.origin})};
}
async function boundRole(args){
  if(!queues)throw Error('PRIVATE_PROFILE_REQUIRED');
  const {q,t}=await queues.task(args),state=await queues.read(t.taskId);
  assertBoundRoleState(q,t,state);
  const c=catalog.companies.find(c=>c.id===t.companyId),templateId=c?.roleTemplates?.[t.roleId]||c?.templateId;if(!templateId)throw Error('COMPANY_NOT_COVERED');
  const template=await store.get('templates',templateId),plan=template.pages.find(p=>new URL(state.returnUrl).pathname.startsWith(p.pathPrefix));
  if(!plan||plan.roleTitle!==t.title)throw Error('CONFIRMED_ROLE_TITLE_TEMPLATE_MISMATCH');
  const login=JSON.parse(await readFile(directory.loginFile(t.companyId),'utf8'));
  const snapshot=await browser.request('roleSnapshot',{pageId:state.pageId,roleSelector:plan.roleSelector,accountSelector:login.account.selector,loginRoot:login.fields?.root,roleIdentity:plan.roleIdentity});
  if(plan.rolePrefix!==undefined){
    if(snapshot.pageUrl!==state.returnUrl)throw Error('ROLE_OR_ACCOUNT_CHANGED_BEFORE_FILL');
    await bindRoleTitleProof(browser,plan,state.pageId,snapshot);
  }
  if(login.loginMethod==='user_operated'){const identity=await observeUserOperatedSession(browser,login,snapshot.pageUrl,{currentSnapshot:snapshot});snapshot.account=identity.account;snapshot.loginFormPresent=identity.form;}
  if(snapshot.pageUrl!==state.returnUrl||!matchesRole(plan,snapshot)||snapshot.loginFormPresent||!matchesAccount(snapshot.account,resolveAccount(await loadProfile(profileFile),login)))throw Error('ROLE_OR_ACCOUNT_CHANGED_BEFORE_FILL');
  return {q,t,state,template};
}
async function reconcileSelectorMappings(companyId,t,probe){
 if(probe.operation!=='internal_condition_probe'||probe.companyId!==companyId||probe.templateHash!==hash(t)||probe.status!=='verified'||probe.restoration!=='verified')throw Error('VERIFIED_MIGRATION_PROOF_REQUIRED');
 const profile=await loadProfile(profileFile),form=lookupCompanyForm(profile,companyId,t.evidence.sourceUrl).form;
 const alternatives=[...new Set(Object.values(form?.mappings||{}).filter(m=>m.active===false&&m.coverageRequired&&m.selector).map(m=>m.selector))];
 if(!alternatives.length)return probe;
 const references=[...new Set(t.pages.flatMap(p=>p.fields.flatMap(f=>f.inventorySelectors||[f.read.selector])))];
 const page=await browser.existingPage(t.evidence.sourceUrl),proof=await page.act({method:'wait',operation:'compare_control_aliases',selector:t.pages[0].readySelector,alternatives,references},null,{});
 probe.selectorEquivalences={companyId,pageUrl:t.evidence.sourceUrl,templateHash:hash(t),pairs:proof.pairs.map(({alternativeIndex,referenceIndex})=>({selector:alternatives[alternativeIndex],reference:references[referenceIndex]})),valuesRead:false};
 await store.put('runs',probe.id,probe);return probe;
}
const defaultBindings=Object.fromEntries(catalog.companies.map(c=>[c.id,c.templateId]));
async function refreshBindings(){
  let bindings={};try{bindings=await store.get('templates','company-bindings');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bindings||Array.isArray(bindings)||typeof bindings!=='object'||Object.values(bindings).some(v=>v!==null&&(typeof v!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v))))throw Error('INVALID_COMPANY_BINDINGS');
  let roleBindings={};try{roleBindings=await store.get('templates','role-bindings');}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const [companyId,map]of Object.entries(roleBindings)){if(!catalog.companies.some(c=>c.id===companyId)||!map||typeof map!=='object'||Array.isArray(map)||Object.values(map).some(v=>typeof v!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(v)))throw Error('INVALID_ROLE_BINDINGS');}
  for(const c of catalog.companies){c.templateId=bindings[c.id]??defaultBindings[c.id];c.roleTemplates=roleBindings[c.id]||{};}
}
const engine=new Engine({store,companies:catalog.companies,browser,refreshCompanies:refreshBindings,profileFields:async({task,template,page,prepare})=>{
 if(prepare){if(!task.roleQueueArgs)throw Error('PROFILE_FILL_ROLE_BINDING_REQUIRED');await boundRole(task.roleQueueArgs);}
 const profile=await loadProfile(profileFile),materialContext=await confirmedMaterialContext({handoffDir:directory.handoffDir,companyId:task.companyId,roleId:task.roleId,pageUrl:task.pageUrl,catalog:catalog.companies}),company=catalog.companies.find(c=>c.id===task.companyId);
 return applyAuthorizedProfileFields({page,profile,template,scope:{materialContext,companyId:task.companyId,roleId:task.roleId,pageUrl:task.pageUrl,officialOrigin:company?.origin},expected:task.profileFillContext,prepare});
},resolveTask:async(task,template)=>{
  if(task.roleQueueArgs)await boundRole(task.roleQueueArgs);
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile);assertQuestionsMapped(profile,task.companyId,task.pageUrl);
  return {...task,...await resolveInputs(profile,template,task.decisions,task.companyId,task)};
},onInventory:async(companyId,pageUrl,fields,plan,{discoveryOnly=false}={})=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const currentPage=await browser.existingPage(pageUrl);await assertCollectionProvider(currentPage,plan);
  if(!fields.length)throw Error('FORM_CONTROLS_NOT_OBSERVED');
  if(plan?.provider!=='feishu')fields=await enrichControlContext(currentPage,fields);
  fields=normalizeControlPolicy(fields);
  await updateProfile(profileFile,p=>registerPlannedQuestions(p,{companyId,pageUrl,fields,observedAt:new Date().toISOString(),coverageRequired:discoveryOnly},plan));
  if(!discoveryOnly)assertQuestionsMapped(await loadProfile(profileFile),companyId,pageUrl);
}});
const packageInfo=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const server=new McpServer({name:'recruiting-form-batch',version:packageInfo.version});
const materials=new MaterialImport({store,browser,profileFile,companies:catalog.companies,withCompanyLease:(companyId,fn)=>engine.withCompanyLease(companyId,fn)});
const registerTool=(name,definition,handler)=>registerWorkflowTool(server,name,definition,handler);
const output=data=>({content:[{type:'text',text:JSON.stringify(data)}]});
const wrap=(fn,refresh=true)=>async args=>{try{if(refresh)await refreshBindings();return output(workflowEnvelope(await fn(args)));}catch(e){const error=/^[A-Z_]+(?::[a-z0-9_-]+)?$/.test(e.message)?e.message:e.code==='ENOENT'?'PRIVATE_ASSET_NOT_FOUND':'OPERATION_FAILED',failureEvidenceId=randomUUID();await store.put('runs',failureEvidenceId,{id:failureEvidenceId,operation:'mcp_error',companyId:args.companyId||null,taskId:args.taskId||null,error,...(e.details?{details:e.details}:{}),observedAt:new Date().toISOString()});return {isError:true,...output(workflowEnvelope({error,failureEvidenceId,...(e.details?{details:e.details}:{})}))};}};
registerTool('workflow_wait_for_user',{description:'仅凭当前已捕获的必填日期、完整面板无至今选项及主档同一记录仍在进行的事实，登记等待用户决定网站日期表达；普通建库/映射未完成不能据此停下。不填表、不提交、不写用户答案。',inputSchema:{companyId:z.string(),captureId:z.string(),choicesId:z.string(),selectors:z.array(z.string()).min(1).max(20),question:z.string().min(1)}},wrap(async a=>{const capture=await store.get('runs',a.captureId),choices=await store.get('runs',a.choicesId),profile=await loadProfile(profileFile),result=ongoingDateUserWait({...a,capture,choices,profile});const id='workflow-user-wait-'+a.companyId;await store.put('runs',id,{id,...result});return {id,...result};},false));
registerTool('workflow_handoff',{description:'把组件已记录的真实技术错误或驱动建库缺口交给监督者修复；MCP重新核实证据，不接受Agent自称完成。返回complete=false，不改变投递/填写状态；后续从原页面恢复。普通语义映射待办不能据此结束。',inputSchema:{companyId:z.string().optional(),evidenceId:z.string()}},wrap(async a=>{
 const source=await store.get('runs',a.evidenceId);if(a.companyId&&source.companyId&&source.companyId!==a.companyId)throw Error('HANDOFF_SCOPE_MISMATCH');
 const reasons=technicalHandoffReasons(source);
 if(!reasons.length)throw Error('VERIFIED_TECHNICAL_BLOCK_REQUIRED');
 const id='workflow-handoff-'+(a.companyId||source.companyId||'runtime'),result={id,companyId:a.companyId||source.companyId||null,evidenceId:a.evidenceId,reasons:[...new Set(reasons)],status:'blocked_for_supervisor',completion:{complete:false,status:'blocked_for_supervisor'},continuation:{state:'technical_block',owner:'supervisor',requiresUser:false,shouldContinue:false,handoffVerified:true,nextTools:[]},submission:'not_performed'};
 await store.put('runs',id,result);return result;
},false));
registerTool('application_closeout',{description:'固定事件收尾：校验官网证据后把本岗位最新结果覆盖写入 岗位交接/投递回传.json（每岗位一条，不留历史和备份）；同事件幂等。记录“已投递”前，本岗位必须在本批队列中由 MCP 按已封存的公司表单模板填写并核验通过，手工填写的岗位拒绝记录。不改主表状态：由搜索端反向评审、用户确认后才写入。不提交网站。',inputSchema:{outcome:outcomeSchema}},wrap(async args=>{await refreshBindings();return closeApplication({...args,assertPrepared:outcome=>assertSubmissionPrepared({queues,store,catalog:catalog.companies,outcome})});},false));
registerTool('form_assets_status',{description:'只读：按当前投递批次（或指定公司）列出每家公司的登录配置、表单模板是否封存、各岗位申请页链接是否已存；缺口须先按建库路线补齐，不得手工填表代替。',inputSchema:{companyIds:z.array(z.string()).min(1).max(50).optional()},annotations:{readOnlyHint:true}},wrap(async({companyIds})=>{await refreshBindings();const batch=await readBatchFile(directory.handoffDir);return formAssetStatus({directory,catalog:catalog.companies,store,batch,companyIds});}));
const queueTask={queueId:z.string().uuid(),queueHash:z.string().length(64),taskId:z.string().uuid()};
registerTool('role_confirm_material_no_destination',{description:'仅在用户明确确认本岗位不使用某项已有码材料后登记例外。核对原岗位/账号、已封存模板、本次捕获及当前实际完整控件均无对应入口；任一入口存在则拒绝。仅对该岗位、表单和材料摘要生效，不删除主表代码，不影响其他岗位；mode=revoke明确撤回例外；两种操作都使旧冻结计划失效，不提交。',inputSchema:{...queueTask,captureId:z.string().optional(),mode:z.enum(['confirm','revoke']).default('confirm'),key:z.enum(['referralCode']),authorization:z.object({confirm:z.literal(true),evidence:z.string().min(1)})}},wrap(async a=>{
 const queued=await queues.task(a);return engine.withCompanyLease(queued.t.companyId,async()=>{
  const {t,state,template}=await boundRole(a);
  const context=await confirmedMaterialContext({handoffDir:directory.handoffDir,companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,catalog:catalog.companies});
  if(a.mode==='revoke'){
   const result=await updateProfile(profileFile,p=>revokeMaterialDestinationException(p,{context,pageUrl:state.returnUrl,key:a.key,evidence:a.authorization.evidence}));
   const {planId,planHash,fillRunId,verifyRunId,...rest}=state;await queues.put(t.taskId,{...rest,status:'ready_to_fill'});
   return {...result,companyId:t.companyId,roleId:t.roleId,fullFormVerified:false,continuation:{state:'prepare',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['prepare_plan']}};
  }
  if(!a.captureId)throw Error('MATERIAL_EXCEPTION_CAPTURE_REQUIRED');
  const route=await engine.formRoute({companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl});if(route.route!=='reuse')throw Error('SEALED_FORM_REQUIRED_FOR_MATERIAL_EXCEPTION');
  const capture=await store.get('runs',a.captureId),page=await browser.existingPage(state.returnUrl,{pageId:state.pageId,readOnly:true});
  const plan=template.pages.find(p=>new URL(state.returnUrl).pathname.startsWith(p.pathPrefix)),controls=await page.inventory(plan);
  const result=await updateProfile(profileFile,p=>recordMaterialDestinationException(p,{context,pageUrl:state.returnUrl,template,templateHash:hash(template),capture,controls,key:a.key,evidence:a.authorization.evidence}));
  const {planId,planHash,fillRunId,verifyRunId,...rest}=state;await queues.put(t.taskId,{...rest,status:'ready_to_fill'});
  return {...result,companyId:t.companyId,roleId:t.roleId,fullFormVerified:false,continuation:{state:'prepare',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['prepare_plan','role_prepare']}};
 });
}));
// Expose the page contract to the agent in the tool schema. An opaque record
// made ordinary construction gaps look like unexplained runtime failures.
const constructionPage=z.object({
 roleTitle:z.string().min(1),roleSelector:z.string().min(1).optional(),rolePrefix:z.string().refine(value=>value.trim().length>0&&!/[\r\n\u2028\u2029]/u.test(value),'ROLE_PREFIX_CONTRACT_REQUIRED').optional(),roleIdentity:z.record(z.unknown()).optional(),
 readySelector:z.string().min(1),provider:z.enum(['feishu','ant','phoenix']).optional(),
 sections:z.array(z.union([z.string().min(1),z.object({title:z.string().min(1)}).passthrough()])).min(1),
 sectionDiscovery:z.object({selector:z.string().min(1),titleSelector:z.string().min(1),selectors:z.array(z.string()).optional()}).passthrough()
}).passthrough().superRefine((page,ctx)=>{if(page.rolePrefix!==undefined&&(typeof page.roleSelector!=='string'||!page.roleSelector.trim()))ctx.addIssue({code:z.ZodIssueCode.custom,path:['roleSelector'],message:'ROLE_PREFIX_CONTRACT_REQUIRED'});});
registerTool('form_search_choices',{description:'通用控件目标闭环：只传已捕获字段引用，内核从该字段当前主档映射取真实值与已确认别名，逐次搜索、等实际候选或明确无结果、恢复页面并匹配。Agent不能传搜索词。唯一已知别名自动保存实际选项映射；模糊或歧义返回真实候选。只建库，不替代冻结后的填写及选中核验，不提交。',inputSchema:{companyId:z.string(),captureId:z.string(),selector:z.string()}},wrap(async a=>engine.withCompanyLease(a.companyId,async()=>{
 const capture=await store.get('runs',a.captureId);if(capture.companyId!==a.companyId)throw Error('CHOICE_CAPTURE_SCOPE_MISMATCH');
 const field=capture.controls.find(c=>c.selector===a.selector);if(!field||!isChoiceControl(field))throw Error('ORDINARY_CAPTURED_CHOICE_REQUIRED');
 const id='choices-'+a.companyId+'-'+hash({pageUrl:capture.pageUrl,captureId:a.captureId}).slice(0,16);let prior=[];try{prior=(await store.get('runs',id)).choices||[];}catch(e){if(e.code!=='ENOENT')throw e;}
 const page=await browser.existingPage(capture.pageUrl),result=await discoverMappedChoice({profile:await loadProfile(profileFile),capture,selector:a.selector,prior,choicesId:id,inspect:(field,query)=>inspectCapturedChoice(page,capture,field,query)});
 await store.put('runs',id,{id,companyId:a.companyId,pageUrl:capture.pageUrl,captureId:a.captureId,choices:result.choices,readAt:new Date().toISOString()});
 const {choices,...summary}=result;return {choicesId:id,...summary,continuation:{state:'construct',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:result.resolution?['form_build_template']:['form_resolve_choices','form_build_template']},submission:'not_performed'};
})),false);
registerTool('role_submit',{description:'仅凭用户对具体岗位及当前表单的最终提交授权执行一次官网提交。绑定模板和已通过核验的reviewRunId，点击前独立重核全部字段、主档来源和附件；先落提交尝试再点击真实按钮，官网回执才算成功。返回固定回传供application_closeout，不改主表；不确定禁止自动重试。',inputSchema:{...queueTask,authorization:z.object({submit:z.literal(true),templateHash:z.string().length(64),reviewRunId:z.string().uuid(),evidence:z.string().min(1)})}},wrap(async a=>{
 const {t}=await queues.task(a);return engine.withCompanyLease(t.companyId,()=>submitReviewedRole({args:a,boundRole,engine,browser,queues,store,resolveTask:async(task,state,template)=>({companyId:task.companyId,roleId:task.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...await resolveInputs(await loadProfile(profileFile),template,{},task.companyId,{roleId:task.roleId,pageUrl:state.returnUrl}),roleQueueArgs:{queueId:a.queueId,queueHash:a.queueHash,taskId:a.taskId}})}));
}));
registerTool('role_prepare_materials',{description:'在完整已封存表单及原岗位账号下，仅冻结并填写已确认岗位材料（例如已有推荐码），独立读回并保存字段截图；不改其余履历、不把本回执算作全表完成，不提交。来源和值由MCP从确认批次读取，Agent不能传值或任意字段。',inputSchema:{...queueTask,authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1)})}},wrap(async a=>{const {t}=await queues.task(a);return engine.withCompanyLease(t.companyId,()=>prepareRoleMaterials({args:a,boundRole,resolveContext:(task,state)=>confirmedMaterialContext({handoffDir:directory.handoffDir,companyId:task.companyId,roleId:task.roleId,pageUrl:state.returnUrl,catalog:catalog.companies}),engine,queues,store,browser}));}));
registerTool('role_prepare_profile_fields',{description:'按私有主档的global填写授权，在已确认原岗位、账号和已封存表单内补齐已授权主档字段。来源、字段和值由内核确定；冻结记录只存来源Hash，双次独立比对且不回传证件号。不上传、不提交，不以局部结果代替整表核验。',inputSchema:{...queueTask,authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1)})}},wrap(async a=>{
 const {t}=await queues.task(a);return engine.withCompanyLease(t.companyId,async()=>{
  const {state,template}=await boundRole(a),resolved=await resolveInputs(await loadProfile(profileFile),template,{},t.companyId,{roleId:t.roleId,pageUrl:state.returnUrl});
  if(!resolved.profileFillContext)throw Error('GLOBAL_PROFILE_FILL_NOT_AUTHORIZED');
  const task={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...resolved,roleQueueArgs:{queueId:a.queueId,queueHash:a.queueHash,taskId:a.taskId}};
  const plan=await engine.preparePlan(task);if(!plan.readyForExecution)throw Error('PROFILE_FILL_PREFLIGHT_REQUIRED');
  await assertPreparedPlan(await store.get('plans',plan.planId),template,{...task,planId:plan.planId,planHash:plan.planHash},a.authorization,{scope:'authorized_profile_fields'});
  const current=await boundRole(a);if(hash(current.template)!==hash(template)||current.state.pageId!==state.pageId)throw Error('PROFILE_FILL_ROLE_OR_TEMPLATE_CHANGED');
  const page=await browser.existingPage(state.returnUrl);await engine.profileProofs(task,template,page,true);const proofs=await engine.profileProofs(task,template,page);
  const id='profile-fill-'+t.taskId,result={id,operation:'prepare_authorized_profile_fields',companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),planId:plan.planId,planHash:plan.planHash,authorizationContextHash:resolved.profileFillContext.contextHash,proofs,status:Object.values(proofs).every(proof=>proof.status==='verified')?'verified':'needs_attention',fullFormVerified:false,save:'not_verified',submission:'not_performed',completion:{complete:false,status:'profile_fields_prepared'},continuation:{state:'prepare',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['role_verify']}};
  await store.put('runs',id,result);delete state.verifyRunId;delete state.verifiedAt;state.status='ready_to_fill';await queues.put(t.taskId,state);return result;
 });
}));
registerTool('runtime_info',{description:'只读返回当前实际运行版本与能力，识别旧安装端；不连接浏览器。',annotations:{readOnlyHint:true}},wrap(()=>({runtime:residentRuntime,version:packageInfo.version,compilerVersion:3,controlCapabilities:controlCapabilities(),pipelineRevision:'rea-contract-5',capabilities:['goal_bound_choice_search','retrieval_identity_separation','mandatory_choice_goals','current_autocomplete_entity_proof','global_profile_fill','profile_reference_only_freeze','captured_date_ranges','authorized_attachment_removal','locked_enum_presentation','canonical_live_inventory','scoped_material_preparation','external_material_mapping_gate','business_material_first','selector_identity_reconciliation','scoped_ongoing_asof','collector_mapping_guard','verified_user_decision_wait','readiness_presence','captured_date_options','major_real_first','disabled_selected_readback','empty_search_evidence','sourced_ongoing_dates','string_array_fact_ingestion','mandatory_role_materials','material_amendment_preserves_pages','business_required_referral','company_batch','form_route','workflow_next','role_bindings','frozen_plan','independent_readback','fixed_closeout','official_form_definition','semantic_question_locators','rea_form_structure','generic_form_construction','typed_continuation','explicit_construction_provider','rendered_choice_options','draft_reference_registration','mandatory_workflow_contract','persisted_field_contract','observed_choice_resolution','incremental_choice_evidence','choice_resolution_pending_diagnostics','field_bound_choice_audit','dropdown_reopen_selection_proof'],browserAccess:false}),false));
registerTool('workflow_next',{description:'确定性调用路由：先判断公司资产，复用则离线映射与编译；缺失或失效才返回增量建库接口。只返回下一调用及真实阻塞，不替模型宣称完成。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional()},annotations:{readOnlyHint:true}},wrap(async task=>{
 const route=await engine.formRoute(task);
 if(route.route==='acquire'){let hasDefinitionRecipe=false;try{hasDefinitionRecipe=!!directory.definitionFile(task.companyId);}catch(e){if(e.message!=='UNKNOWN_COMPANY')throw e;}return {...route,definitionFirst:hasDefinitionRecipe,continuation:continuationFor({route}),nextTools:[...(hasDefinitionRecipe?['capture_form_definition']:[]),'capture_rea_structure','capture_controls','form_mapping_candidates','profile_map_questions','form_search_choices','capture_choice_options','form_build_template','template_register','probe_conditions','template_finalize','prepare_plan'],submission:'not_performed'};}
 const profile=await loadProfile(profileFile),company=engine.companyForTask(task),template=await store.get('templates',company.templateId);
 try{assertQuestionsMapped(profile,task.companyId,task.pageUrl);}catch{return {...route,nextStage:'local_mapping',continuation:{state:'map',owner:'agent',requiresUser:false,shouldContinue:true},nextTools:['form_mapping_candidates','profile_map_questions'],submission:'not_performed'};}
 const plan=await engine.preparePlan({...task,templateHash:hash(template),...await resolveInputs(profile,template,{},task.companyId,task)});
 return {...route,...plan,continuation:continuationFor({route,plan,template,profile}),nextTools:plan.constructionBlockers?.length?['capture_controls','template_register']:plan.counts?.needs_user?['profile_status','profile_record_answers']:['batch_prepare','verify_current'],submission:'not_performed'};
}));
registerTool('form_route',{description:'先做本地IF判断：公司已有覆盖当前页面的可用表单则复用并转资料预检；没有、未完成或路径不匹配才进入增量建库。不打开网页、不重新采集已有表单、不填写。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional()},annotations:{readOnlyHint:true}},wrap(a=>engine.formRoute(a)));
registerTool('capture_repeat_slots',{description:'内部建库：按已观察的重复栏目容器和添加按钮准备目标总条数的空白条目（count不是新增条数），不填写个人数据、不上传或提交；随后须重新采集全部字段。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),groupSelector:z.string().describe('只匹配该栏目每一条记录，不匹配其他栏目；可使用已观察标题绑定的phoenixq repeatRecords'),addSelector:z.string(),addLabel:z.string().optional(),count:z.number().int().min(1).max(20).describe('本栏目期望的最终总条数，不是新增条数'),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1)})}},wrap(a=>engine.withCompanyLease(a.companyId,async()=>{const p=await browser.existingPage(a.pageUrl),before=await p.observe({fields:[],groups:[{id:'records',selector:a.groupSelector}]});const currentEntries=before.groups?.records;if(currentEntries>a.count){const error=Error('EXCESS_REPEAT_ENTRIES_REQUIRE_REVIEW');error.details={currentEntries,expectedEntries:a.count,countMeaning:'target_total_records',reason:'observed_selector_matches_more_records_than_target'};throw error;}await p.ensureGroups([{id:'construction-slots',selector:a.groupSelector,addSelector:a.addSelector,addLabel:a.addLabel,count:a.count}]);return {status:'slots_created_require_recapture',count:a.count,submission:'not_performed'};})),false);
registerTool('capture_choice_options',{description:'内部建库：读取已采集单选/原生select的真实选项，对已采集的UD、Ant及ATS下拉逐个展开读取并恢复，不更改原选择；保存私有选项资产。selectors限定本次需补采的已捕获控件，不改变完整问题登记。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),captureId:z.string(),selectors:z.array(z.string()).min(1).optional(),searchQueries:z.record(z.string()).optional()}},wrap(args=>engine.withCompanyLease(args.companyId,async()=>{
 const capture=await store.get('runs',args.captureId);if(capture.companyId!==args.companyId||capture.pageUrl!==args.pageUrl)throw Error('CHOICE_CAPTURE_SCOPE_MISMATCH');
 const checkpointId='choices-'+args.companyId+'-'+hash({pageUrl:args.pageUrl,captureId:args.captureId}).slice(0,16);let accumulated=[];try{const prior=await store.get('runs',checkpointId);if(prior.companyId===args.companyId&&prior.captureId===args.captureId)accumulated=prior.choices||[];}catch(e){if(e.code!=='ENOENT')throw e;}
 const page=await browser.existingPage(args.pageUrl),choices=[];if(capture.provider==='feishu')await page.inventory({provider:'feishu'});
 const candidates=capture.controls.filter(f=>isChoiceControl(f)||args.selectors?.includes(f.selector)&&isDateControl(f));
 if(args.selectors?.some(s=>!candidates.some(f=>f.selector===s)))throw Error('CHOICE_SELECTOR_NOT_CAPTURED');
 for(const f of candidates.filter(f=>!args.selectors||args.selectors.includes(f.selector))){
  const root=f.questionSelector||`.ud-formily-item:has(:is(${f.selector})):not(:has(.ud-formily-item :is(${f.selector})))`;
  const result=isDateControl(f)?await page.act({method:f.renderer==='phoenix_date_picker'?'phoenix_date':'ant_day',operation:'inspect',selector:f.selector,labelSelector:f.labelSelector,...(f.inlineOngoing?{ongoingSelector:f.inlineOngoing.selector}:{})},null,{}):await inspectCapturedChoice(page,capture,f,args.searchQueries?.[f.selector]);
  choices.push({query:args.searchQueries?.[f.selector]||null,selector:f.selector,label:f.label,fieldKey:f.fieldKey,group:f.group,repeatIndex:f.repeatIndex,...result});
  accumulated=mergeObservedChoices(accumulated,[choices.at(-1)]);await store.put('runs',checkpointId,{id:checkpointId,...args,choices:accumulated,readAt:new Date().toISOString(),status:'in_progress'});
  if(!result.restored)throw Error('CHOICE_INSPECTION_NOT_RESTORED');
 }
 const id=checkpointId;await store.put('runs',id,{id,...args,choices:accumulated,readAt:new Date().toISOString()});return {captureId:args.captureId,choicesId:id,choices,capturedTotal:accumulated.length};
})),false);
registerTool('inspect_choice',{description:'按真实捕获字段直接核验下拉：分别读取搜索input值和已选span文字，打开绑定菜单采真实候选、实际值和选中标记，再恢复原状态。默认保存该字段的截图。只作核验，不点选候选、不填写或提交，不将搜索文字当成已选结果。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),captureId:z.string(),selector:z.string(),query:z.string().optional(),screenshot:z.boolean().default(true)},annotations:{readOnlyHint:true}},wrap(a=>engine.withCompanyLease(a.companyId,async()=>{
 const capture=await store.get('runs',a.captureId);if(capture.companyId!==a.companyId||capture.pageUrl!==a.pageUrl)throw Error('CHOICE_CAPTURE_SCOPE_MISMATCH');
 const c=capture.controls.find(c=>c.selector===a.selector);if(!c||!isChoiceControl(c)||humanActionReason(c))throw Error('ORDINARY_CAPTURED_CHOICE_REQUIRED');
 const page=await browser.existingPage(a.pageUrl);if(capture.provider==='feishu')await page.inventory({provider:'feishu'});
 const plan={fields:[{id:'selected',read:{selector:c.selectedSelector||c.questionSelector||c.selector,kind:'text'}},{id:'search',read:{selector:c.actionSelector||c.selector,kind:'value'}}]};
 const before=await page.observe(plan),result=await inspectCapturedChoice(page,capture,c,a.query),after=await page.observe(plan);
 const restored=result.restored&&hash(before.fields)===hash(after.fields),selectedLabel=after.fields.selected?.value,selectedOptions=(result.optionRecords||[]).filter(o=>o.selected&&!o.disabled),confirmed=restored&&after.fields.selected?.present===true&&selectedOptions.length===1&&selectedOptions[0].label===selectedLabel;
 let screenshot=null,screenshotError=null;if(a.screenshot)try{if(!capture.pageId)throw Error('CAPTURED_PAGE_ID_REQUIRED');screenshot=await browser.request('screenshot',{pageId:capture.pageId,selector:c.questionSelector||c.selector});}catch(e){screenshotError=/^[A-Z_]+$/.test(e.message)?e.message:'FIELD_SCREENSHOT_UNAVAILABLE';}
 const id='choice-audit-'+a.companyId+'-'+hash(a.selector).slice(0,16),audit={id,companyId:a.companyId,captureId:a.captureId,pageUrl:a.pageUrl,selector:a.selector,label:c.label,readAt:new Date().toISOString(),before:before.fields,after:after.fields,options:result.options,optionRecords:result.optionRecords||[],restored,selectionConfirmed:confirmed,status:confirmed?'choice_selected_verified':'choice_selection_unverified',screenshot,screenshotError,submission:'not_performed'};await store.put('runs',id,audit);return audit;
}),false));
registerTool('form_resolve_choices',{description:'离线按已捕获真实选项进行别名与模糊候选匹配，结果覆盖保存到该次选项资产。已确认主档别名可自动映射；模糊结果只排序，不直接硬选。指定实际选项须提供语义等价证据，未知或歧义不得伪造用户答案。',inputSchema:{companyId:z.string(),choicesId:z.string(),resolutions:z.array(z.object({selector:z.string(),factKey:z.string(),selectedOption:z.string().optional(),evidence:z.string().optional()})).min(1)}},wrap(async a=>{
 const asset=await store.get('runs',a.choicesId);if(asset.companyId!==a.companyId)throw Error('CHOICE_CAPTURE_SCOPE_MISMATCH');
 const profile=await loadProfile(profileFile),form=lookupCompanyForm(profile,a.companyId,asset.pageUrl).form;const results=[],pending=[];
 for(const item of a.resolutions){const choice=asset.choices.find(c=>c.selector===item.selector),mapping=Object.values(form?.mappings||{}).find(m=>m.selector===item.selector&&m.active!==false);
  if(!choice){pending.push({selector:item.selector,status:'needs_option_capture',nextTool:'capture_choice_options'});continue;}
  if(mapping?.factKey!==item.factKey){pending.push({selector:item.selector,status:'needs_question_mapping',requestedFactKey:item.factKey,currentFactKey:mapping?.factKey||null,questionId:Object.entries(form?.mappings||{}).find(([,m])=>m.selector===item.selector&&m.active!==false)?.[0]||null,nextTool:'profile_map_questions'});continue;}
  const ranked=rankChoices(profile,item.factKey,choice.options||[]);
  if(item.selectedOption||ranked.selection){const resolution=resolveObservedChoice({profile,factKey:item.factKey,choice:{...choice,choicesId:a.choicesId,captureId:asset.captureId},...item});choice.resolutions={...(choice.resolutions||{}),[item.factKey]:resolution};results.push({selector:item.selector,resolution});}
  else {pending.push({selector:item.selector,status:'needs_choice_semantic_review',nextTool:'form_resolve_choices'});results.push({selector:item.selector,...ranked});}
 }
 await store.put('runs',a.choicesId,asset);return {choicesId:a.choicesId,resolutions:results,pending,continuation:{state:pending.some(p=>p.status==='needs_question_mapping')?'map':'construct',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:[...new Set([...pending.map(p=>p.nextTool),'form_build_template'])]},executionVerified:false};
}));
registerTool('material_import_prepare',{description:'首次建库：对已捕获简历上传控件与用户已批准PDF离线预检，冻结文件Hash和目标；不访问网页。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),captureId:z.string(),selector:z.string(),containerSelector:z.string()}},wrap(a=>materials.prepare(a),false));
registerTool('material_import_run',{description:'执行已冻结的简历导入，真实上传前核对控件、简历容器和文件Hash；尝试先落账，不自动重试。结果仍须重新采集并核验网站解析。',inputSchema:{planId:z.string().uuid(),planHash:z.string().length(64),authorization:z.object({uploads:z.literal(true),evidence:z.string().min(1)})}},wrap(a=>materials.run(a),false));
const batchRef={batchId:z.string().uuid(),batchHash:z.string().length(64)};
registerTool('company_batch_refresh_materials',{description:'仅消费已由用户确认的同批岗位材料补充；强制核对原批次摘要及岗位/顺序完全不变，保留任务ID和浏览器，撤销旧材料核验结果并返回新队列Hash。',inputSchema:{...batchRef,authorizationRef:z.string().min(1)}},wrap(a=>companyBatches.refreshMaterials(a),false));
registerTool('company_batch_restrict_channels',{description:'按用户明确要求收窄本批浏览器通道；保留页面和事实，移除迁移岗位的旧页面绑定，要求在新通道重新核实原岗位与账号。',inputSchema:{...batchRef,channels:z.array(z.enum(['chrome','iab'])).min(1).max(2),authorizationRef:z.string().min(1)}},wrap(a=>companyBatches.restrictChannels(a),false));
registerTool('company_batch_create',{description:'离线从用户正向评审确认后的 岗位交接/投递批次.json 取公司，保存双浏览器批次（不接受旧公司方案文件）；默认 Chrome/IAB 各10家公司，同公司多岗位只占一个公司名额。不转换Excel、不打开网页。',inputSchema:{rolesFile:z.string().optional(),companyPlan:z.record(z.unknown()).optional(),companyOrder:z.array(z.string()).optional(),authorizationRef:z.string().min(1),companiesPerChannel:z.number().int().min(1).max(10).default(10),parallelRoles:z.boolean().default(false)}},wrap(async a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');const created=await companyBatches.create(a);await refreshBindings();const assets=await formAssetStatus({directory,catalog:catalog.companies,store,batch:await readBatchFile(directory.handoffDir)});return {...created,formAssets:{ready:assets.ready,incomplete:assets.incomplete,rule:'缺表单模板的公司先按建库路线 capture→template_register→probe_conditions→template_finalize 补齐，再 prepare；不得手工填表代替'}};},false));
registerTool('company_batch_take',{description:'原子领取并切分公司到 Chrome/IAB，默认每通道最多10家；保留公司/平台登录范围亲和性与已确认岗位顺序。返回宿主实际执行任务，不把派发当成功。',inputSchema:batchRef},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.take(a);},false));
registerTool('company_batch_record',{description:'按公司租约收回实际运行状态；可独立等待用户，准备完成必须提供所有岗位的真实填写核验运行证据。',inputSchema:{...batchRef,companyId:z.string(),channel:z.enum(['chrome','iab']),leaseToken:z.string().uuid(),status:z.enum(['running','waiting_for_user','ready_for_user_review','blocked']),reason:z.string().optional(),runIds:z.array(z.string()).optional()}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.record(a);},false));
registerTool('company_batch_status',{description:'只读双通道公司批次的等待、阻塞及核验结果，不返回租约令牌。',inputSchema:batchRef,annotations:{readOnlyHint:true}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.status(a);},false));
registerTool('company_batch_resume',{description:'显式恢复原公司租约，保留原通道、岗位和浏览器；须提供恢复证据及原令牌。接口不重开页面、不重发验证码。',inputSchema:{...batchRef,companyId:z.string(),channel:z.enum(['chrome','iab']),leaseToken:z.string().uuid(),recoveryRef:z.string().min(1)}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.resume(a);},false));
registerTool('company_batch_close_preparation',{description:'用户明确重测后结束旧准备批次并释放调度占用；保留浏览器、页面和所有证据，不触碰网站或业务投递状态。',inputSchema:{...batchRef,authorizationRef:z.string().min(1),reason:z.string().min(1)}},wrap(a=>{if(!companyBatches)throw Error('PRIVATE_PROFILE_REQUIRED');return companyBatches.closePreparation(a);},false));
async function prepareRole(args){
  const queued=await queues.task(args),queuedState=await queues.read(queued.t.taskId);
  if(!queuedState.returnUrl)throw Error('ROLE_NOT_READY_FOR_FILL');
  const formRoute=await engine.formRoute({companyId:queued.t.companyId,roleId:queued.t.roleId,pageUrl:queuedState.returnUrl});
  if(formRoute.route==='acquire')return {status:'needs_form_acquisition',...formRoute,submission:'not_performed'};
  const {t,state,template}=await boundRole(args),profile=await loadProfile(profileFile);
  assertQuestionsMapped(profile,t.companyId,state.returnUrl);
  const task={companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...await resolveInputs(profile,template,{},t.companyId,{roleId:t.roleId,pageUrl:state.returnUrl}),roleQueueArgs:{queueId:args.queueId,queueHash:args.queueHash,taskId:args.taskId}};
  const plan=await engine.preparePlan(task);
  if(!plan.readyForExecution&&!(args.authorization.allowPartialPreparation&&plan.status==='needs_answers'&&!plan.constructionBlockers?.length))return {...plan,status:plan.status,continuation:continuationFor({plan,template,profile}),submission:'not_performed'};
  const fill=await engine.prepare({tasks:[{...task,planId:plan.planId,planHash:plan.planHash}],concurrency:1,authorization:args.authorization});
  if(fill.results[0]?.errorCode){
   state.status='needs_attention';state.fillRunId=fill.id;state.verifyRunId=null;state.verifiedAt=null;await queues.put(t.taskId,state);
   return {status:'needs_attention',fillRunId:fill.id,error:fill.results[0].errorCode,errorDetails:safeControlErrorDetails(fill.results[0].errorDetails),failedField:fill.results[0].failedField||null,deferredControls:fill.results[0].deferredControls||[],fillElapsedMs:fill.elapsedMs,continuation:continuationFor({error:fill.results[0].errorCode}),submission:'not_performed'};
  }
  const verification=await engine.verifyCurrent({...task,...await resolveInputs(await loadProfile(profileFile),template,{},t.companyId,{roleId:t.roleId,pageUrl:state.returnUrl})});
  state.status=verification.status==='verified'?'ready_for_user_review':'needs_attention';state.fillRunId=fill.id;state.verifyRunId=verification.id;state.verifiedAt=verification.readAt;
  await queues.put(t.taskId,state);
  return {status:state.status,taskId:t.taskId,companyId:t.companyId,roleTitle:t.title,pageUrl:state.returnUrl,fillRunId:fill.id,verifyRunId:verification.id,counts:verification.counts,summary:verification.summary,deferredControls:fill.results[0]?.deferredControls||[],continuation:continuationFor({verification,template,profile:await loadProfile(profileFile)}),fillElapsedMs:fill.elapsedMs,initialReadbackStatus:fill.status,exceptions:verification.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,label,status,reason})=>({id,label,status,reason})),save:verification.save,submission:'not_performed'};
}
registerTool('role_prepare',{description:'从冻结岗位队列取目标；核对登录后已返回原岗位，离线编译全部字段后填写并独立核验。仅返回异常与计数，不提交。',inputSchema:{...queueTask,authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(prepareRole));
registerTool('workflow_advance',{description:'连续推进已确认队列中多个公司，每家公司调用完整岗位准备和读回链；一家公司待用户不会停止其它公司。只执行已封存模板，不自动重试失败写入，不提交。',inputSchema:{tasks:z.array(z.object(queueTask)).min(1).max(20),concurrency:z.number().int().min(1).max(5).default(2),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async a=>{const identities=await Promise.all(a.tasks.map(t=>queues.task(t)));if(new Set(identities.map(x=>x.t.companyId)).size!==identities.length)throw Error('ONE_CURRENT_ROLE_PER_COMPANY_REQUIRED');return advanceCompanies(a.tasks,async task=>{
 const queued=await queues.task(task),state=await queues.read(queued.t.taskId),route=await engine.formRoute({companyId:queued.t.companyId,roleId:queued.t.roleId,pageUrl:state.returnUrl||queued.t.url});
 if(route.route==='acquire')return {status:'needs_form_acquisition',route,continuation:continuationFor({route})};
 return prepareRole({...task,authorization:a.authorization});
},{concurrency:a.concurrency,affinity:task=>catalog.companies.find(c=>c.id===identities.find(x=>x.t.taskId===task.taskId).t.companyId).origin});}));
registerTool('roles_prepare_batch',{description:'按已确认并发模式，在共享账号独占批次内并发准备独立岗位页；全部计划先编译、逐岗位核验，不登录、不提交。',inputSchema:{queueId:z.string().uuid(),queueHash:z.string().length(64),taskIds:z.array(z.string().uuid()).min(1).max(5),concurrency:z.number().int().min(1).max(5).default(3),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
  if(new Set(args.taskIds).size!==args.taskIds.length)throw Error('DUPLICATE_ROLE_TASK');
  const q=await queues.get(args),selectedTasks=args.taskIds.map(id=>q.tasks.find(t=>t.taskId===id));
  const sameCompanyMultiRole=new Set(selectedTasks.filter(Boolean).map(t=>t.companyId)).size!==selectedTasks.filter(Boolean).length;
  if(sameCompanyMultiRole&&(q.executionMode!=='parallel_roles'&&!q.parallelRoles))throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  if(!sameCompanyMultiRole&&!['parallel_roles','parallel_companies'].includes(q.executionMode)&&!q.parallelRoles)throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  const tasks=[],bound=[];
  for(const taskId of args.taskIds){const a={queueId:args.queueId,queueHash:args.queueHash,taskId};const queued=await queues.task(a),state=await queues.read(taskId);const route=await engine.formRoute({companyId:queued.t.companyId,roleId:queued.t.roleId,pageUrl:state.returnUrl||queued.t.applyUrl||queued.t.url});if(route.route==='acquire')return {status:'needs_form_acquisition',...route,taskId,submission:'not_performed'};const b=await boundRole(a),profile=await loadProfile(profileFile);assertQuestionsMapped(profile,b.t.companyId,b.state.returnUrl);
    const task={companyId:b.t.companyId,roleId:b.t.roleId,pageUrl:b.state.returnUrl,templateHash:hash(b.template),...await resolveInputs(profile,b.template,{},b.t.companyId,{roleId:b.t.roleId,pageUrl:b.state.returnUrl}),roleQueueArgs:a};
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
        if(!fill.errorCode)verification=await engine.verifyCurrent({...task,...await resolveInputs(await loadProfile(profileFile),b.template,{},b.t.companyId,{roleId:b.t.roleId,pageUrl:b.state.returnUrl})});
        const status=verification?.status==='verified'?'ready_for_user_review':'needs_attention';Object.assign(b.state,{status,fillRunId:run.id,verifyRunId:verification?.id||null,verifiedAt:verification?.readAt||null});await queues.put(b.t.taskId,b.state);
        results[i]={taskId:b.t.taskId,roleId:b.t.roleId,roleTitle:b.t.title,pageUrl:b.state.returnUrl,status,startedAt:fill.startedAt,finishedAt:fill.finishedAt,fillElapsedMs:fill.elapsedMs,initialReadbackStatus:fill.status,counts:verification?.counts||{},error:fill.errorCode||verification?.mappingError||null,exceptions:verification?.checks.filter(x=>!['match','confirmed_omission'].includes(x.status)).map(({id,label,status,reason})=>({id,label,status,reason}))||[],verifyRunId:verification?.id||null,save:verification?.save||'not_verified',submission:'not_performed'};
      }
    }
  }));
  return {status:results.every(r=>r.status==='ready_for_user_review')?'ready_for_user_review':'needs_attention',batchRunId:run.id,fillElapsedMs:run.elapsedMs,requestedConcurrency:args.concurrency,results,submission:'not_performed'};
}));
registerTool('roles_patch_text',{description:'按已冻结岗位和当前私有JSON，仅修正指定普通文本字段；全部计划先编译，旧值有用户改动则阻断，逐岗全表只读复核，不上传不提交。',inputSchema:{queueId:z.string().uuid(),queueHash:z.string().length(64),taskIds:z.array(z.string().uuid()).min(1).max(5),fieldIds:z.array(z.string()).min(1).max(20),expectedPrevious:z.string(),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
 if(new Set(args.taskIds).size!==args.taskIds.length)throw Error('DUPLICATE_ROLE_TASK');
 const jobs=[];for(const taskId of args.taskIds){const b=await boundRole({...args,taskId}),task={companyId:b.t.companyId,roleId:b.t.roleId,pageUrl:b.state.returnUrl,templateHash:hash(b.template),...await resolveInputs(await loadProfile(profileFile),b.template,{},b.t.companyId,{roleId:b.t.roleId,pageUrl:b.state.returnUrl})};
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
registerTool('role_verify',{description:'只读核验冻结队列中的当前岗位和全部字段，保存独立报告，不改写表单。',inputSchema:queueTask,annotations:{readOnlyHint:true}},wrap(async args=>{
  const {t,state,template}=await boundRole(args),resolved=await resolveInputs(await loadProfile(profileFile),template,{},t.companyId,{roleId:t.roleId,pageUrl:state.returnUrl});
  const r=await engine.verifyCurrent({companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,templateHash:hash(template),...resolved});
  state.status=r.status==='verified'?'ready_for_user_review':'needs_attention';state.verifyRunId=r.id;state.verifiedAt=r.readAt;await queues.put(t.taskId,state);
  return {status:r.status,verifyRunId:r.id,counts:r.counts,summary:r.summary,continuation:continuationFor({verification:r,template,profile:await loadProfile(profileFile)}),readAt:r.readAt,save:r.save,submission:r.submission};
}));
registerTool('coverage_check',{description:'检查现有公司与表单资产覆盖，不重新采集已覆盖公司。',inputSchema:{companyIds:z.array(z.string()).min(1).max(20)},annotations:{readOnlyHint:true}},wrap(({companyIds})=>engine.coverage(companyIds)));
registerTool('browser_tabs',{description:'读取显式连接的本地浏览器页面，不打开、重载或关闭页面。',annotations:{readOnlyHint:true}},wrap(()=>browser.tabs()));
registerTool('browser_status',{description:'读取当前连接生命周期和实际连接次数，不发起连接；失败或断开不自动重连。',annotations:{readOnlyHint:true}},wrap(()=>browser.status(),false));
registerTool('browser_open',{description:'在共用的 MCP Chrome 中打开已建库公司的表单页；必须匹配该公司的 origin 和模板路径。不会填写或提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url()}},wrap(async({companyId,pageUrl})=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
  const t=await store.get('templates',c.templateId),u=new URL(pageUrl);
  if(u.origin!==c.origin||!t.pages.some(p=>u.pathname.startsWith(p.pathPrefix)))throw Error('COMPANY_FORM_SCOPE_MISMATCH');
  return engine.withCompanyLease(companyId,()=>browser.request('openPage',{pageUrl}));
}));
registerTool('probe_conditions',{description:'仅内部建库维护：按已捕获的条件选项通过真实控件展开分支，强制登记新问题，恢复并核对原表单。不写个人事实、不上传、不提交；缺少探测授权或无法恢复原选择时拒绝。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),authorization:z.object({probe:z.literal(true),evidence:z.string().min(1)})}},wrap(({authorization,...task})=>engine.probeCompany(task,authorization)));
registerTool('capture_form_definition',{description:'内部建库：按公司已核实的官网模板读取接口获取全部栏目、隐藏条件问题和选项字典，强制登记个人JSON；不读取候选人答案，不填写、不提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url()}},wrap(args=>engine.withCompanyLease(args.companyId,async()=>{
 const company=catalog.companies.find(c=>c.id===args.companyId);if(!company||new URL(args.pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
 const recipeFile=directory.definitionFile(args.companyId);if(!recipeFile)throw Error('FORM_DEFINITION_NOT_CONFIGURED');const recipe=JSON.parse(await readFile(recipeFile,'utf8'));
 if(recipe.companyId!==args.companyId||recipe.provider!=='wecruit'||!recipe.evidence?.sourceCodeHash)throw Error('VERIFIED_SCHEMA_RECIPE_REQUIRED');
 const page=await browser.existingPage(args.pageUrl),raw=await page.act({method:'capture_wecruit_schema',endpoint:recipe.endpoint},null,{});if(!raw.template)throw Error('SCHEMA_RESPONSE_NOT_TEMPLATE');
 const definition=normalizeWecruitDefinition(raw.template,raw.dictionary),id='definition-'+args.companyId+'-'+hash({pageUrl:args.pageUrl,definitionHash:definition.sourceDefinitionHash}).slice(0,16);
 await store.put('runs',id,{id,operation:'official_form_definition',companyId:args.companyId,...raw,definition});
 const registration=await updateProfile(profileFile,p=>registerDefinitionQuestions(p,{companyId:args.companyId,definition,sourceId:id,evidenceRef:id}));
 return {definitionId:id,definitionHash:definition.sourceDefinitionHash,...registration,submission:'not_performed'};
})));
async function captureCompanyControls({companyId,pageUrl,pageId,compact,provider}){
  const c=catalog.companies.find(c=>c.id===companyId);if(!c||new URL(pageUrl).origin!==c.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const candidates=await Promise.all([...new Set([c.templateId,...Object.values(c.roleTemplates||{})].filter(Boolean))].map(id=>store.get('templates',id)));
  const matches=candidates.filter(t=>t.pages.some(p=>matchesPageIdentity(p,pageUrl)));if(matches.length>1)throw Error('AMBIGUOUS_ROLE_TEMPLATE');
  let template=matches[0]||null;try{if(template)validateTemplate(template);}catch{template=null;}const plan=template?.pages.find(p=>matchesPageIdentity(p,pageUrl));
  const p=await browser.existingPage(pageUrl,pageId?{pageId,readOnly:true}:undefined);
  const collectionPlan=await detectedAcquisitionPlan(p,plan,provider);
  const controls=await liveControls(p,collectionPlan), observedAt=new Date().toISOString();
  if(!controls.length)throw Error('FORM_CONTROLS_NOT_OBSERVED');
  const registration=await updateProfile(profileFile,profile=>registerPlannedQuestions(profile,{companyId,pageUrl,fields:controls,observedAt},plan));
  const captureIndexId='capture-index-'+companyId+'-'+hash(pageUrl).slice(0,16),captureId=captureContentId(companyId,pageUrl,collectionPlan.provider,controls,hash);
  let previous;try{const index=await store.get('runs',captureIndexId);previous=await store.get('runs',index.latestCaptureId);}catch(error){if(error.code!=='ENOENT')throw error;}
  const structure=compareControlStructures(controls,previous?.controls||[]);
  const roleSelector=(plan||candidates[0]?.pages?.[0])?.roleSelector;
  const identity=roleSelector?await p.observe({fields:[],roleSelector}):null;
  const result={companyId,pageUrl,...(pageId?{pageId,readOnly:true}:{}),provider:collectionPlan.provider||null,roleTitle:identity?.roleTitle||null,observedAt,controls,scopeExclusions:controls.scopeExclusions||[],registration,structure,captureId,coverageLimit:'当前渲染文档；未展开选项、多步骤、静态问题、iframe与shadow root另行核对'};
  await store.put('runs',captureId,result);await store.put('runs',captureIndexId,{latestCaptureId:captureId,previousCaptureId:previous?.captureId||null});
  if(!compact)return result;
  const summarize=rows=>rows.map(({selectors,...row})=>row);
  return {...result,controls:undefined,structure:{...structure,added:summarize(structure.added),removed:summarize(structure.removed)}};
}
registerTool('capture_controls',{description:'建库阶段批量读取控件，强制登记新问题并保存完整私有快照；compact=true 仅返回结构差异和证据ID。可用带通道前缀的pageId定向只读采集重复URL中的原页面，必须与当前完整URL匹配，不能用于填写。结构匹配不代表执行通过。不读取验证码或Cookie。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),pageId:z.string().regex(/^(iab|chrome):.+$/).optional(),provider:z.enum(['feishu','ant','phoenix']).optional(),compact:z.boolean().optional()}},wrap(args=>engine.withCompanyLease(args.companyId,()=>captureCompanyControls(args))));
registerTool('form_remove_attachment',{description:'仅按用户针对本岗位某一已上传文件的明确移除决定执行；绑定原队列、岗位账号、原页和真实采集上传条目，逐文件精确核对删除按钮并读回剩余文件，不删除本地文件、不提交。不能进入普通表单模板。',inputSchema:{...queueTask,captureId:z.string(),selector:z.string().regex(/^uploadq:/),filename:z.string().min(1),authorization:z.object({remove:z.literal(true),evidence:z.string().min(1)})}},wrap(async a=>{
 const {t}=await queues.task(a);return engine.withCompanyLease(t.companyId,async()=>{
  const {state,template}=await boundRole(a),capture=await store.get('runs',a.captureId);
  if(capture.companyId!==t.companyId||capture.pageUrl!==state.returnUrl||capture.pageId!==state.pageId)throw Error('ATTACHMENT_CAPTURE_SCOPE_MISMATCH');
  const control=capture.controls.find(c=>c.selector===a.selector&&c.type==='file'),item=control?.uploadedItems?.find(f=>f.filename===a.filename);
  if(!item?.removeSelector||!control.uploadContainerSelector||!control.filenameSelector)throw Error('ATTACHMENT_REMOVE_ACTION_NOT_CAPTURED');
  const plan=template.pages.find(p=>new URL(state.returnUrl).pathname.startsWith(p.pathPrefix)),page=await browser.existingPage(state.returnUrl);
  const live=(await liveControls(page,plan)).find(c=>c.selector===a.selector),current=live?.uploadedItems?.filter(f=>f.filename===a.filename);
  if(current?.length!==1||current[0].removeSelector!==item.removeSelector)throw Error('ATTACHMENT_PREVIOUS_FILE_CHANGED');
  const result=await page.act({method:'remove_uploaded_file',selector:a.selector,containerSelector:control.uploadContainerSelector,filenameSelector:control.filenameSelector,removeSelector:item.removeSelector,expectedFilename:a.filename,authorized:true},null,{});
  const check=()=>page.observe({fields:[{id:'attachment',kind:'file',read:{selector:control.uploadContainerSelector,kind:'files',filenameSelector:control.filenameSelector,uploadedSelector:control.uploadedSelector}}]});
  const first=await check(),second=await check();
  if(first.fields.attachment?.present!==true||second.fields.attachment?.present!==true||hash(first.fields)!==hash(second.fields)||second.fields.attachment.value.includes(a.filename))throw Error('ATTACHMENT_REMOVAL_READBACK_FAILED');
  const id='attachment-remove-'+t.taskId;let screenshot=null;try{screenshot=await browser.request('screenshot',{pageId:state.pageId,selector:control.uploadContainerSelector});}catch{}
  const receipt={id,operation:'remove_uploaded_attachment',companyId:t.companyId,roleId:t.roleId,pageUrl:state.returnUrl,selector:a.selector,filename:a.filename,authorization:a.authorization,...result,readbackStable:true,screenshot,fullFormVerified:false,submission:'not_performed'};
  await store.put('runs',id,receipt);delete state.verifyRunId;delete state.verifiedAt;state.status='ready_to_fill';await queues.put(t.taskId,state);return receipt;
 });
}));
registerTool('capture_rea_structure',{description:'内部建库：REA只读采集选定原页面，再用同一浏览器实时控件清单交叉核对。只使用当前宿主能力，不启动、导航或切换浏览器；不填写。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),pageId:z.string().regex(/^(iab|chrome):.+$/),provider:z.enum(['ant','feishu','phoenix']).optional(),authorization:z.object({acquire:z.literal(true),evidence:z.string().min(1)})}},wrap(a=>engine.withCompanyLease(a.companyId,async()=>{
 const company=catalog.companies.find(c=>c.id===a.companyId);if(!company||new URL(a.pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
 const expectedChannel=typeof browser.channel==='function'?await browser.channel({pageUrl:a.pageUrl}):'chrome';
 if(!a.pageId.startsWith(expectedChannel+':'))throw Error('BROWSER_PAGE_CHANNEL_MISMATCH');
 const result=await browser.request('reaInspect',a);
 if(result.binding?.pageId!==a.pageId.slice(expectedChannel.length+1))throw Error('REA_TARGET_MISMATCH');
 const binding={...result.binding,pageId:a.pageId};
 const structure=normalizeReaStructure(result.evidence,binding,{nativeStructure:result.nativeStructure});
 const capture=await captureCompanyControls({companyId:a.companyId,pageUrl:a.pageUrl,pageId:a.pageId,provider:a.provider});
 const joined=bindStructureControls(structure,capture),id='form-structure-'+a.companyId+'-'+hash(a.pageUrl).slice(0,16);
 const scripts=scriptCoverage(result.evidence);
 await store.put('runs',id,{...joined,structure,nativeStructure:result.nativeStructure||null,scriptInventory:result.evidence.normalized_result.scripts||null,scriptCoverage:scripts,operation:'rea_form_structure',observedAt:structure.observedAt});
 return {structureId:id,captureId:capture.captureId,controls:joined.controls.length,reaEvidenceId:structure.evidenceId,nativeStructure:result.nativeStructure?{documents:result.nativeStructure.documents.length,nodes:result.nativeStructure.documents.reduce((n,d)=>n+d.nodes.length,0),structureHash:result.nativeStructure.structureHash}:null,scripts,limitations:structure.limitations,nextTools:['form_mapping_candidates','capture_choice_options','form_build_template'],submission:'not_performed'};
})));
registerTool('form_mapping_candidates',{description:'离线给每个已捕获问题列出个人主档语义候选；同名重复记录或多候选不自动选择，不向用户重复询问已知事实。',inputSchema:{companyId:z.string(),captureId:z.string()}},wrap(async a=>{
 const capture=await store.get('runs',a.captureId);if(capture.companyId!==a.companyId)throw Error('CAPTURE_COMPANY_MISMATCH');
 const profile=await loadProfile(profileFile),form=lookupCompanyForm(profile,a.companyId,capture.pageUrl).form;
 return {captureId:a.captureId,candidates:mappingCandidates(capture.controls,profile).map(c=>{const entry=Object.entries(form?.mappings||{}).find(([,m])=>m.selector===c.selector&&m.active!==false);return {...c,questionId:entry?.[0]||null,currentFactKey:entry?.[1]?.factKey||null};}),nextTools:['profile_map_questions','form_search_choices','form_build_template'],requiresUser:false};
}));
registerTool('form_script_search',{description:'只读检索本次REA已采到并保存在私有结构资产中的页面脚本，返回有限片段和来源Hash；用于定位表单定义、字段约束和依赖线索，不执行脚本、不访问网页、不把线索当成已核验控件。',inputSchema:{companyId:z.string(),structureId:z.string(),queries:z.array(z.string().min(1).max(100)).min(1).max(8),limit:z.number().int().min(1).max(20).default(12)},annotations:{readOnlyHint:true}},wrap(async a=>{
 const asset=await store.get('runs',a.structureId);if(asset.companyId!==a.companyId||asset.operation!=='rea_form_structure')throw Error('REA_CONTROL_CAPTURE_SCOPE_MISMATCH');
 return {structureId:a.structureId,scriptCoverage:asset.scriptCoverage,...searchCapturedScripts(asset.scriptInventory,a.queries,{limit:a.limit}),browserAccess:false,executionVerified:false};
}));
registerTool('form_build_template',{description:'统一控件合集按真实采集、已确认语义映射及选项证据生成未封存模板。page各项必须来自本次实际页面，不能用通用form/h1猜测。默认仅返回缺口、计数与draftId/draftHash，由template_register直接读取私有草稿，避免模型往返抄写整份模板；compact=false才返回完整模板。技术缺口不能转成userOnly，无公司/字段编号分支。',inputSchema:{companyId:z.string(),captureId:z.string().optional(),structureId:z.string(),choiceIds:z.array(z.string()).default([]),templateId:z.string(),version:z.number().int().min(1).default(1),page:constructionPage,compact:z.boolean().default(true),reaReconciliation:z.array(z.object({nodeId:z.string(),selector:z.string().optional(),exclusion:z.enum(['outside_application_form','duplicate_accessibility_node']).optional(),evidence:z.string().min(1)})).default([])}},wrap(async a=>{
 const reaStructure=await store.get('runs',a.structureId),captureId=a.captureId||reaStructure.captureId;
 const capture=await store.get('runs',captureId);if(!capture.controls?.length)throw Error('FORM_CONTROLS_NOT_OBSERVED');if(capture.companyId!==a.companyId)throw Error('CAPTURE_COMPANY_MISMATCH');
 const profile=await loadProfile(profileFile),form=lookupCompanyForm(profile,a.companyId,capture.pageUrl).form;
 if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');const choices=[];
 const canonicalChoicesId='choices-'+a.companyId+'-'+hash({pageUrl:capture.pageUrl,captureId}).slice(0,16),choiceIds=new Set([...a.choiceIds,canonicalChoicesId]);
 let canonical;try{canonical=await store.get('runs',canonicalChoicesId);}catch(e){if(e.code!=='ENOENT')throw e;}
 // Native options are already actual evidence from this capture. Save them in
 // the same choice asset; do not ask the model to copy labels or invent IDs.
 const native=capture.controls.filter(c=>!canonical?.choices?.some(x=>x.selector===c.selector)).map(c=>({selector:c.selector,label:c.label,...capturedChoiceOptions(c)})).filter(c=>c.status==='captured');
 if(native.length)await store.put('runs',canonicalChoicesId,{...(canonical||{}),id:canonicalChoicesId,companyId:a.companyId,pageUrl:capture.pageUrl,captureId,choices:[...(canonical?.choices||[]),...native],readAt:new Date().toISOString()});
 for(const id of choiceIds){let asset;try{asset=await store.get('runs',id);}catch(e){if(id===canonicalChoicesId&&e.code==='ENOENT')continue;throw e;}if(asset.companyId!==a.companyId||asset.pageUrl!==capture.pageUrl||asset.captureId!==captureId)throw Error('CHOICE_CAPTURE_SCOPE_MISMATCH');choices.push(...asset.choices.map(c=>({...c,choicesId:id,captureId})));}
 if(reaStructure.operation!=='rea_form_structure'||reaStructure.structure?.provider!=='rea'||reaStructure.reaEvidenceHash!==reaStructure.structure.evidenceHash)throw Error('REA_STRUCTURE_EVIDENCE_REQUIRED');
 if(reaStructure&&reaStructure.captureId!==capture.captureId)throw Error('REA_CONTROL_CAPTURE_SCOPE_MISMATCH');
 const built=buildFormTemplate({capture,profile,mappings:Object.values(form.mappings),choices,page:a.page,templateId:a.templateId,version:a.version,reaStructure,reaReconciliation:a.reaReconciliation});
 for(const id of new Set(built.choices.map(c=>c.choicesId).filter(Boolean)))await store.update('runs',id,asset=>({...asset,choices:asset.choices.map(choice=>{const updated=built.choices.find(c=>c.choicesId===id&&c.selector===choice.selector);return updated?{...choice,...(updated.resolutions?{resolutions:updated.resolutions}:{}),...(updated.goal?{goal:updated.goal}:{})}:choice;})}));
 await updateProfile(profileFile,p=>registerTemplateContract(p,{companyId:a.companyId,template:built.template,templateHash:hash(built.template),stage:'construction'}));
 const draftId='form-draft-'+a.companyId+'-'+hash(capture.pageUrl).slice(0,16);await store.put('runs',draftId,{...built,companyId:a.companyId,captureId});
 const persisted=await store.get('runs',draftId);if(hash(persisted.template)!==hash(built.template))throw Error('TEMPLATE_STORAGE_READBACK_FAILED');assertStoredExecutionContract(await loadProfile(profileFile),a.companyId,persisted.template);
 return {...(a.compact?compactConstructionResult(built):built),draftId,draftHash:hash(built.template),storageReadback:'verified',storageAudit:contractAuditSummary(auditStoredContract(built.template))};
}));
registerTool('form_template_audit',{description:'只读逐字段区分技术建库缺口、语义映射缺口、真实用户答案和本人操作；不会将普通字段userOnly误报为用户缺资料。',inputSchema:{companyId:z.string(),roleId:z.string().optional()}},wrap(async a=>{
 const c=engine.companyForTask(a);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');const t=await store.get('templates',c.templateId),profile=await loadProfile(profileFile);
 return {templateId:t.id,issues:templateConstructionIssues(t),fields:t.pages.flatMap(p=>p.fields.map(f=>({id:f.id,label:f.inventoryLabel||f.label,source:f.source,...classifyPending(f,profile)}))),submission:'not_performed'};
}));
registerTool('template_finalize',{description:'只接受匹配当前资产Hash、全部声明分支通过并恢复的真实探测回执；代码检查实际控件覆盖和类型后封存公司资产。不把资料缺失或页面填写当作完成。',inputSchema:{companyId:z.string(),roleId:z.string().optional(),templateHash:z.string(),probeRunId:z.string().uuid()}},wrap(args=>engine.withCompanyLease(args.companyId,async()=>{
 const c=engine.companyForTask(args),t=await store.get('templates',c.templateId);if(hash(t)!==args.templateHash)throw Error('TEMPLATE_VERSION_CHANGED');
 const probe=await reconcileSelectorMappings(args.companyId,t,await store.get('runs',args.probeRunId));await updateProfile(profileFile,p=>retireLegacyQuestionMappings(p,{companyId:args.companyId,template:t,probe}));const profile=await loadProfile(profileFile);assertQuestionsMapped(profile,args.companyId,t.evidence.sourceUrl);assertDefinitionMapped(profile,args.companyId,t);
 const channel=await browser.channel({pageUrl:t.evidence.sourceUrl});const sealed=sealFormTemplate(t,probe,{companyId:args.companyId,profileMapped:true,channel});validateTemplate(sealed);
 await updateProfile(profileFile,p=>registerTemplateContract(p,{companyId:args.companyId,template:sealed,templateHash:hash(sealed)}));await store.put('templates',sealed.id,sealed);
 assertStoredExecutionContract(await loadProfile(profileFile),args.companyId,await store.get('templates',sealed.id));
 return {templateId:sealed.id,templateHash:hash(sealed),status:'asset_sealed_require_profile_preflight',probeRunId:probe.id,browserAccess:false,submission:'not_performed'};
})));
registerTool('template_rebind_role',{description:'建库阶段离线复用同公司表单：核对真实采集、字段一一对应及冻结岗位标题，生成岗位独立资产；不重新试填，不宣称建库缺口已通过。',inputSchema:{...queueTask,baselineCaptureId:z.string(),captureId:z.string(),sourceTemplateId:z.string()}},wrap(async args=>{
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
registerTool('template_register',{description:'持久化已采集并确定的操作方案。优先传form_build_template返回的draftId和draftHash，MCP核对归属、缺口与Hash后直接读取完整草稿，无须模型抄写模板；也兼容inline template，两种输入互斥。不把建库等同于实测通过。',inputSchema:{companyId:z.string(),roleId:z.string().optional(),template:z.record(z.unknown()).optional(),draftId:z.string().optional(),draftHash:z.string().length(64).optional()}},wrap(async ({companyId,roleId,template,draftId,draftHash})=>engine.withCompanyLease(companyId,async()=>{
  const c=catalog.companies.find(c=>c.id===companyId);if(!c)throw Error('UNKNOWN_COMPANY');
  if(template&&(draftId||draftHash)||!template&&!draftId||draftId&&!draftHash||draftHash&&!draftId)throw Error('EXACTLY_ONE_TEMPLATE_INPUT_REQUIRED');
  if(draftId)template=templateFromDraft(await store.get('runs',draftId),{companyId,draftHash},hash);
  template=canonicalControlSpec(template);validateTemplate(template);if(new URL(template.evidence.sourceUrl).origin!==c.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
  const t=unsealedTemplate(template);
  await assertStoredChoiceGoals(t,{store,companyId,profile:await loadProfile(profileFile),required:true});
  await assertStoredChoiceResolutions(t,{store,companyId,profile:await loadProfile(profileFile)});
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
  const [saved,personal]=await Promise.all([store.get('templates',t.id),loadProfile(profileFile)]);
  if(hash(saved)!==hash(t))throw Error('TEMPLATE_STORAGE_READBACK_FAILED');
  for(const page of t.pages){const original=new URL(t.evidence.sourceUrl),pageUrl=original.pathname.startsWith(page.pathPrefix)?original.href:new URL(page.pathPrefix,original).href,contract=lookupCompanyForm(personal,companyId,pageUrl).form?.executionContract;
   if(contract?.templateHash!==hash(t)||hash((contract.fields||[]).map(({index,...f})=>f))!==hash(page.fields))throw Error('PROFILE_CONTRACT_STORAGE_READBACK_FAILED');}
  return {templateId:t.id,templateHash:hash(t),status:'captured_not_live_verified',storageAudit:contractAuditSummary(auditStoredContract(saved)),storageReadback:'verified'};
})));
registerTool('prepare_plan',{description:'正式填写前编译并保存全部字段的类型、位置、动作、依赖、选项和预期读回。严格校验个人JSON类型与本地附件；不访问浏览器。返回冻结计划ID与Hash，未通过不得开始填写。',inputSchema:{tasks:z.array(z.object({companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),decisions:z.record(z.unknown()).optional()})).min(1).max(20)}},wrap(async({tasks})=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile),plans=[];
  for(const task of tasks){
    const formRoute=await engine.formRoute(task);
    if(formRoute.route==='acquire'){plans.push({...formRoute,status:'needs_form_acquisition',readyForExecution:false});continue;}
    assertQuestionsMapped(profile,task.companyId,task.pageUrl);
    const company=engine.companyForTask(task);if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
    const template=await store.get('templates',company.templateId);
    plans.push(await engine.preparePlan({...task,...await resolveInputs(profile,template,task.decisions,task.companyId,task)}));
  }
  return {plans,browserAccess:false};
}));
registerTool('batch_prepare',{description:'仅执行填写前已编译冻结的计划；没有计划ID/Hash或资料、类型、附件版本发生变化时，接触浏览器前拒绝。集中实际读回，不含最终提交。',inputSchema:{tasks:z.array(z.object({companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),planId:z.string(),planHash:z.string(),decisions:z.record(z.unknown()).optional()})).min(1).max(20),concurrency:z.number().int().min(1).max(5).default(3),authorization:z.object({prepare:z.literal(true),evidence:z.string().min(1),sensitiveFields:z.boolean().default(false),uploads:z.boolean().default(false),allowPartialPreparation:z.boolean().default(false)})}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const profile=await loadProfile(profileFile),tasks=[];
  for(const task of args.tasks){
    assertQuestionsMapped(profile,task.companyId,task.pageUrl);
    const c=engine.companyForTask(task);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
    const t=await store.get('templates',c.templateId), resolved=await resolveInputs(profile,t,task.decisions,task.companyId,task);
    tasks.push({...task,...resolved});
  }
  return engine.prepare({...args,tasks});
}));
registerTool('run_status',{description:'读取已保存的集中核对、缺失、差异与耗时；不以已计划或已调用推断完成。',inputSchema:{runId:z.string()},annotations:{readOnlyHint:true}},wrap(({runId})=>store.get('runs',runId)));
registerTool('profile_status',{description:'返回公司问题登记、映射、已知/缺失和明确省略状态；不返回个人答案原文。',inputSchema:{companyId:z.string().optional(),pageUrl:z.string().url().optional()},annotations:{readOnlyHint:true}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');return profileStatus(await loadProfile(profileFile),args.companyId,args.pageUrl);
}));
registerTool('profile_record_answers',{description:'将用户本轮明确回答或无/不提供写入私有JSON，覆盖当前答案并保留来源；只允许已登记事实，不存认证秘密。',inputSchema:{evidence:z.string().min(1),answers:z.array(z.object({factKey:z.string(),status:z.enum(['known','not_applicable']),value:z.unknown().optional(),omissionKind:z.enum(['confirmed_absent','user_declined','not_applicable']).optional()})).min(1)}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');return updateProfile(profileFile,p=>recordProfileAnswers(p,args));
}));
registerTool('profile_map_questions',{description:'内部建库：优先将已捕获问题映射到主档既有原子事实；确认是新增语义时可define登记类型及名称，答案保持missing，不推断个人取值；保留新问题定义与映射证据，不允许改写用户本人操作项。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),evidence:z.string().min(1),mappings:z.array(z.object({questionId:z.string(),factKey:z.string(),define:z.object({label:z.string().min(1),canonicalType:z.enum(['string','number','boolean','string[]']),precision:z.enum(['year','month','day']).optional()}).optional()})).min(1)}},wrap(async args=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');return updateProfile(profileFile,p=>mapProfileQuestions(p,args));
}));
registerTool('verify_current',{description:'代码直接读取当前页面并核对个人JSON、选中状态、日期、重复条数、上传和错误；强制登记新增问题，保存差异报告，不填写或提交。',inputSchema:{companyId:z.string(),pageUrl:z.string().url(),roleId:z.string().optional(),templateHash:z.string(),decisions:z.record(z.unknown()).optional()}},wrap(async task=>{
  if(!profileFile)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');
  const c=engine.companyForTask(task);if(!c?.templateId)throw Error('COMPANY_NOT_COVERED');
  const template=await store.get('templates',c.templateId),profile=await loadProfile(profileFile);
  return engine.verifyCurrent({...task,...await resolveInputs(profile,template,task.decisions,task.companyId,task)});
}));
await server.connect(new StdioServerTransport());
