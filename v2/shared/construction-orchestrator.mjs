// C33：建库两段编排（2026-11-13／14 用户要求与决定）。
// 第一段（采集）：整页截图 → Agent 看截图列一级控件（独立于 REA，不先给 Agent 看 REA）→ REA 与实时控件采集 → 返回一级对照候选。
// 第二段（建库）：一级对照、栏目展开、复核、已知事实映射、正式模板更新、交互测试与重测在组件内连续推进，
// 只在需要 Agent、用户或浏览器兜底时集中返回一次；详细记录留在组件内，按记录引用按需读取。
// D1：栏目展开后由组件真实点击核出的子控件直接算已复核。D2：唯一候选且主档已有事实的问题自动对应，其余集中给 Agent。
// D3：同一控件交互测试两次同因失败，先交 Agent 浏览器兜底（执行端与页面浏览器在组件外登记表里），否则问用户。
import {controlSources} from './control-anatomy.mjs';
import {inferredRoleIdentity} from './role-identity.mjs';
export const MAX_CONSTRUCTION_STEPS=40;
const PAGE_KEYS=['roleSelector','rolePrefix','roleIdentity','readySelector','provider','sections','sectionDiscovery'];
export const D1_EVIDENCE='组件编排：一级视觉与 REA 对照已通过；栏目子控件由组件真实点击及栏目范围核对证明（2026-11-14 用户决定 D1）。';
export const D2_EVIDENCE='组件编排：唯一候选且主档已有事实，自动对应（2026-11-14 用户决定 D2）。';

// 已建过的公司沿用正式模板里的页面定义；新公司由 Agent 在第二段调用时提供 page。
export function pageFromTemplate(template,task={}){
 const p=template?.pages?.[0];if(!p?.readySelector||!p.sections?.length)return null;
 const page=Object.fromEntries(PAGE_KEYS.filter(k=>p[k]!==undefined).map(k=>[k,structuredClone(p[k])]));
 // V2 shared pages omit role-specific values. The current confirmed task, rather
 // than the previous role, can supply the optional observed URL identity.
 if(page.roleIdentity&&(template.companyTemplateVersion===2||!page.roleIdentity.value)){
  const observed=task.pageUrl&&task.officialId?inferredRoleIdentity(task.pageUrl,task.officialId):null;
  if(observed)page.roleIdentity=observed;
  else delete page.roleIdentity;
 }
 return page;
}

// D2：只有一个候选、问题已登记、且主档事实已知（或是已确认的交接材料）才自动对应。
export function splitMappings(candidates,profile){
 const auto=[],agent=[];
 for(const c of candidates||[]){
  if(c.currentFactKey)continue;
  const options=(c.candidates||[]).filter(x=>x?.factKey);
  const only=options.length===1?options[0]:null,fact=only?profile?.facts?.[only.factKey]:null;
  const known=only&&(only.status==='confirmed_handoff_material'||fact?.status==='known');
  if(c.questionId&&known)auto.push({questionId:c.questionId,factKey:only.factKey});
  else agent.push({kind:'question_mapping',selector:c.selector,label:c.label,section:c.section||null,questionId:c.questionId||null,candidates:options.slice(0,5).map(x=>x.factKey),reason:!c.questionId?'QUESTION_NOT_REGISTERED':options.length?'MULTIPLE_CANDIDATES_OR_FACT_MISSING':'NO_CANDIDATE'});
 }
 return {auto,agent};
}

function uniqueItems(items){
 const seen=new Set();
 return items.filter(item=>{
  const key=JSON.stringify([item.kind,item.selector,item.questionId,item.id,item.reason,item.record]);
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
}

const failureKey=f=>(f.id||'')+'\n'+(f.reason||f.status||'');
const compact=r=>({status:r?.status??null,error:r?.error??null});

// deps：call(tool,args) 调用已登记工具本身（不经 Agent）；cycle()、pendingExpansions()、captureSelectors()、profile()、template()、update() 只读；
// fallbackSurface() 按组件外登记表判断当前执行端与页面浏览器能否兜底。
export async function runConstructionBuild({deps,task,authorization,primary=null,evidence=null,page=null,maxSteps=MAX_CONSTRUCTION_STEPS}){
 if(page&&deps.savePage)await deps.savePage(page);
 page||=(await deps.update?.())?.pageDefinition||null;
 const {companyId,captureId,pageUrl,queue}=task,steps=[],agentItems=[],userItems=[],fallbackItems=[];
 let primaryUsed=false,retests=0,lastFailure=null,localRepairs=0;
 const started=performance.now(),attemptedRepeats=new Set(),attemptedChoices=new Set();
 const call=async(tool,args)=>{
  const at=performance.now(),r=await deps.call(tool,args);
  if(r.error)lastFailure=r;
  steps.push({tool,...compact(r),wallMs:Math.round(performance.now()-at)});
  return r;
 };
 const prepareRepeats=async()=>{
  if(!deps.repeatPlans)return null;
  let changed=false;
  for(const plan of await deps.repeatPlans()){
   if(attemptedRepeats.has(plan.groupSelector))continue;
   attemptedRepeats.add(plan.groupSelector);
   const result=await call('capture_repeat_slots',{...plan,companyId,pageUrl,reusePrimaryOnly:true,authorization:{prepare:true,evidence:authorization.evidence}});
   if(result.error)return {error:result.error};
   if(result.status==='repeat_slots_waiting_current_primary')return {reobserve:true,reason:result.reason,nextTools:['form_construct_acquire']};
   if(result.added&&result.status!=='repeat_slots_observed')return {reobserve:true,reason:result.reason||'REPEAT_SLOT_CAPTURE_REOBSERVATION_REQUIRED'};
   if(result.added&&result.status==='repeat_slots_observed'){changed=true;localRepairs++;}
  }
  return changed?{changed:true}:null;
 };
 const fillChoiceEvidence=async goals=>{
  const capture=new Set();
  const resolved=[];
  for(const goal of goals||[]){
   if(!goal.selector||goal.captureId!==captureId||attemptedChoices.has(goal.nextTool+'\0'+goal.selector))continue;
   // Capabilities and provenance are checked within each fixed operation.
   if(goal.nextTool==='capture_choice_options')capture.add(goal.selector);
   if(goal.nextTool==='form_search_choices')resolved.push(goal.selector);
  }
  let changed=false;
  if(capture.size){
   for(const selector of capture)attemptedChoices.add('capture_choice_options\0'+selector);
   const r=await call('capture_choice_options',{companyId,pageUrl,captureId,selectors:[...capture]});
   if(!r.error&&!r.requiresUser&&(r.choices?.length>0||r.status==='captured')){
    changed=true;localRepairs+=r.choices?.length||1;
   }
  }
  for(const selector of new Set(resolved)){
   attemptedChoices.add('form_search_choices\0'+selector);
   const r=await call('form_search_choices',{companyId,captureId,selector});
   if(r.status==='choice_resolved'&&!r.evidenceReuse){changed=true;localRepairs++;}
  }
  return changed?{changed:true}:null;
 };
 const done=(status,extra={})=>({status,companyId,steps:steps.length,lastSteps:steps.slice(-8),agentItems:uniqueItems(agentItems),userItems:uniqueItems(userItems),fallbackItems:uniqueItems(fallbackItems),
  stageMetrics:{wallMs:Math.round(performance.now()-started),localRepairs,operationCounts:steps.reduce((out,step)=>(out[step.tool]=(out[step.tool]||0)+1,out),{}),agentItems:uniqueItems(agentItems).length},
  records:{capture:'capture-'+companyId,structure:'form-structure-'+companyId,visual:'form-visual-'+companyId,coverage:'form-coverage-'+companyId,update:'form-update-'+companyId,template:companyId},
  ...(extra.error&&lastFailure?{failureEvidenceId:lastFailure.failureEvidenceId,details:lastFailure.details,nextTools:lastFailure.nextTools?.length?lastFailure.nextTools:['run_status','workflow_handoff']}:{}),...extra,progress:{stage:extra.stage||status,internalSteps:steps.length,completed:status==='company_template_ready'},submission:'not_performed'});
 const testAuth={prepare:true,evidence:authorization.evidence,uploads:authorization.uploads===true,sensitiveFields:authorization.sensitiveFields===true};
 for(let i=0;i<maxSteps;i++){
  const cycle=await deps.cycle();
  if(cycle.error)return done('blocked',{error:cycle.error});
  switch(cycle.stage){
   case 'visual_inventory':case 'parse':
    return done('needs_acquisition',{stage:cycle.stage,nextTools:['form_construct_acquire']});
   case 'primary_review':{
    if(!primary||primaryUsed)return done('needs_primary_pairs',{stage:cycle.stage,nextTools:['form_construct_acquire']});
    primaryUsed=true;
    const r=await call('form_review_completeness',{companyId,captureId,reviewedSelectors:await deps.captureSelectors(),primary,findings:[],evidence});
    if(r.error)return done('blocked',{stage:cycle.stage,error:r.error});
    if(r.status==='needs_backfill'){
     const gaps=r.primary?.findings||r.findings||[];
     agentItems.push(...gaps.map(gap=>({kind:'primary_gap',...gap})));
     return done('needs_acquisition',{stage:cycle.stage,reason:'PRIMARY_REVIEW_GAPS',gaps,nextTools:['form_construct_acquire']});
    }
    continue;
   }
   case 'section_expansion':{
    for(const entranceId of await deps.pendingExpansions()){
     const r=await call('form_expand_sections',{...queue,entranceId,authorization:{prepare:true,evidence:authorization.evidence}});
     if(r.error||r.status==='needs_backfill')return done('needs_acquisition',{stage:cycle.stage,entranceId,reason:r.reason||r.error,nextTools:['form_construct_acquire']});
    }
    continue;
   }
   case 'agent_completeness':{
    const r=await call('form_review_completeness',{companyId,captureId,reviewedSelectors:await deps.captureSelectors(),findings:[],evidence:D1_EVIDENCE});
    if(r.error)return done('needs_acquisition',{stage:cycle.stage,error:r.error,nextTools:['form_construct_acquire']});
    if(r.status!=='passed')return done('needs_acquisition',{stage:cycle.stage,reason:'COMPLETENESS_GAPS',nextTools:['form_construct_acquire']});
    continue;
   }
   case 'build':{
    const m=await call('form_mapping_candidates',{companyId,captureId});
    if(m.error)return done('blocked',{stage:cycle.stage,error:m.error});
    const {auto,agent}=splitMappings(m.candidates,await deps.profile());
    if(auto.length){const r=await call('profile_map_questions',{companyId,pageUrl,evidence:D2_EVIDENCE,mappings:auto});if(r.error)return done('blocked',{stage:cycle.stage,error:r.error});}
    const definition=page||pageFromTemplate(await deps.template(),task);
    if(!definition){agentItems.push(...agent,{kind:'page_definition',reason:'NEW_COMPANY_PAGE_REQUIRED'});return done('needs_agent',{stage:cycle.stage,nextTools:['form_construct_build']});}
    const b=await call('form_build_template',{companyId,captureId,page:definition,compact:true});
    if(b.error)return done('blocked',{stage:cycle.stage,error:b.error});
    const local=await prepareRepeats();
    if(local?.error)return done('blocked',{stage:cycle.stage,error:local.error});
    if(local?.reobserve)return done('needs_acquisition',{stage:cycle.stage,reason:local.reason,nextTools:local.nextTools||['capture_rea_structure','form_construct_build']});
    if(local?.changed)continue;
    if(!b.readyToRegister){
     const collected=await fillChoiceEvidence(b.nextGoals);
     if(collected?.changed)continue;
     const pending=(b.pending||[]).map(p=>({kind:p.kind==='answer'?'user_answer':'template_gap',id:p.id||null,label:p.label||null,source:p.source||null,reason:p.reason||p.kind||null}));
     agentItems.push(...agent,...pending.filter(p=>p.kind!=='user_answer'));userItems.push(...pending.filter(p=>p.kind==='user_answer'));
     return done(agentItems.length?'needs_agent':'needs_user',{stage:cycle.stage,blockers:b.blockers||[],blockerCount:(b.blockers||[]).length,nextTools:agentItems.length?['profile_map_questions','form_construct_build']:['profile_record_answers','form_construct_build']});
    }
    const reg=await call('template_register',{companyId,templateId:b.templateId,templateHash:b.templateHash});
    if(reg.error)return done('blocked',{stage:cycle.stage,error:reg.error});
    continue;
   }
   case 'interaction_test':{
    const local=await prepareRepeats();
    if(local?.error)return done('blocked',{stage:cycle.stage,error:local.error});
    if(local?.reobserve)return done('needs_acquisition',{stage:cycle.stage,reason:local.reason,nextTools:local.nextTools||['capture_rea_structure','form_construct_build']});
    if(local?.changed)continue;
    const r=await call('form_test_interactions',{...queue,templateHash:cycle.templateHash,authorization:testAuth});
    if(r.error)return done('blocked',{stage:cycle.stage,error:r.error});
    if(r.status==='needs_record_content_mapping'){agentItems.push(...(r.recordContentFindings||[]).map(f=>({kind:'record_content_mapping',...f})));return done('needs_agent',{stage:cycle.stage,nextTools:['capture_repeat_slots','profile_map_questions','form_construct_build']});}
    if(r.status==='needs_backfill')return done('needs_acquisition',{stage:cycle.stage,reason:'CONDITION_PROBE_BACKFILL',probeRunId:r.probeRunId,nextTools:['form_construct_acquire']});
    // 未通过：交互结果已落盘，下一轮进入 backfill 按同一原因重测一次。
    continue;
   }
   case 'backfill':{
    // 交互测试未通过：按原因重测一次；同一控件同一原因第二次失败才算组件操作不了（D3）。
    const first=new Set(((await deps.update())?.construction?.interaction?.failures||[]).map(failureKey));
    const r=await call('form_test_interactions',{...queue,templateHash:cycle.templateHash,authorization:testAuth});
    if(r.error)return done('blocked',{stage:cycle.stage,error:r.error});
    if(r.status==='verified')continue;
    if(r.status==='needs_record_content_mapping'||r.status==='needs_backfill')continue;
    retests++;
    const failures=r.failures||[],twice=failures.filter(f=>first.has(failureKey(f)));
    // 原因每次都不同：最多重测两次，仍未通过就按本次失败交出。
    if(!twice.length&&retests<2)continue;
    const surface=await deps.fallbackSurface(),items=(twice.length?twice:failures).map(f=>({kind:'control_operation',fieldId:f.id,reason:f.reason||f.status}));
    if(surface.allowed){fallbackItems.push(...items);return done('needs_fallback',{stage:cycle.stage,fallback:surface,nextTools:['form_gui_fallback']});}
    userItems.push(...items);return done('needs_user',{stage:cycle.stage,fallback:surface,reason:'SAME_FAILURE_TWICE'});
   }
   case 'confirm':{
    const update=await deps.update(),probeRunId=update?.construction?.conditionProbeId;
    const r=await call('template_finalize',{companyId,templateHash:cycle.templateHash,probeRunId});
    if(r.error)return done('blocked',{stage:cycle.stage,error:r.error});
    // 建库结果列出每个控件由哪一层做出来：通用、控件库、兜底（C33，2026-11-15）。
    return done('company_template_ready',{templateHash:r.templateHash,controlSources:controlSources(await deps.template()),nextTools:['role_prepare']});
   }
   case 'ready':return done('company_template_ready',{templateHash:cycle.templateHash,controlSources:controlSources(await deps.template()),nextTools:['role_prepare']});
   default:return done('blocked',{stage:cycle.stage,error:'UNKNOWN_CONSTRUCTION_STAGE'});
  }
 }
 return done('blocked',{error:'CONSTRUCTION_STEP_LIMIT'});
}
