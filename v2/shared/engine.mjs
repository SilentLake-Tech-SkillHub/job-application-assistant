import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, realpath } from 'node:fs/promises';
import path from 'node:path';
import { verifyForm } from './verifier.mjs';
import { compileExpected, attachInventory } from './observation.mjs';
import {compileExecutionPlan,assertPreparedPlan} from './execution-plan.mjs';
import {validateControlContract} from './value-contract.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
import {probeConditions} from './condition-probe.mjs';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const idOK = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value);
const blocked = /提交|投递|撤回|删除|同意|签名|验证码|密码|身份证|银行卡|submit|apply now|withdraw|delete|consent|signature|password|otp|captcha/i;
const methods = new Set(['fill','select','check','click','upload','wait','dropdown','radio','feishu_month','feishu_year']);
export function validateTemplate(t) {
  if (!idOK(t.id) || !Number.isInteger(t.version) || t.version < 1) throw Error('INVALID_TEMPLATE_ID_OR_VERSION');
  if (!Array.isArray(t.pages) || !t.pages.length) throw Error('EMPTY_TEMPLATE');
  if (!t.evidence?.sourceUrl || !t.evidence?.observedAt) throw Error('MISSING_CAPTURE_EVIDENCE');
  const fields = new Set();
  for (const p of t.pages) {
    if (!p.pathPrefix?.startsWith('/') || !p.readySelector || !Array.isArray(p.fields) || !p.fields.length) throw Error('INVALID_PAGE');
    if(!p.roleTitle || !p.roleSelector)throw Error('ROLE_IDENTITY_REQUIRED');
    if(!p.sections?.length||!p.sectionDiscovery?.selector||!p.sectionDiscovery?.titleSelector)throw Error('SECTION_COVERAGE_PLAN_REQUIRED');
    for(const g of p.groups||[])if(!idOK(g.id)||!g.selector||!Number.isInteger(g.count)||g.count<0)throw Error('INVALID_REPEAT_GROUP');
    if(p.provider&&!['feishu'].includes(p.provider))throw Error('UNKNOWN_PROVIDER');
    for (const f of p.fields) {
      if (!idOK(f.id) || fields.has(f.id)) throw Error('DUPLICATE_OR_INVALID_FIELD');
      fields.add(f.id);
      if (!f.source || !f.label || !f.read?.selector || !['value','text','checked','files','attribute','month','radio'].includes(f.read.kind)) throw Error('INCOMPLETE_FIELD_MAPPING');
      if(!['text','choice','date','file','boolean'].includes(f.kind))throw Error('FIELD_KIND_REQUIRED');
      if(['choice','date'].includes(f.kind)&&!f.read.selectedSelector&&!f.read.nativeSelect)throw Error('SELECTION_EVIDENCE_REQUIRED');
      if(f.kind==='file'&&(!f.read.filenameSelector||!f.read.uploadedSelector))throw Error('UPLOAD_EVIDENCE_REQUIRED');
      if (f.read.kind === 'attribute' && !['aria-checked','aria-selected','data-value'].includes(f.read.attribute)) throw Error('INVALID_READ_ATTRIBUTE');
      if (f.userOnly || blocked.test(f.label)) {
        if (f.actions?.length) throw Error('USER_ONLY_FIELD_HAS_ACTIONS');
        continue;
      }
      if (!f.actions?.length && !f.readonly) throw Error('FIELD_WITHOUT_ACTIONS');
      for (const a of f.actions||[]) {
        if (!methods.has(a.method) || !a.selector || blocked.test(a.label || '')) throw Error('UNSAFE_OR_UNKNOWN_ACTION');
        if (a.method === 'click' && !a.label) throw Error('CLICK_NEEDS_OBSERVED_LABEL');
        if (Object.hasOwn(a, 'value') || Object.hasOwn(a, 'code')) throw Error('VALUES_AND_CODE_DO_NOT_BELONG_IN_TEMPLATE');
        if(['dropdown','radio'].includes(a.method)&&(!Array.isArray(a.options)||!a.options.length))throw Error('CAPTURED_OPTIONS_REQUIRED');
      }
      validateControlContract(f);
    }
    for (const a of p.after || []) {
      if (!['click','wait'].includes(a.method) || !a.selector || !a.label || blocked.test(a.label)) throw Error('UNSAFE_PAGE_TRANSITION');
    }
  }
  return t;
}

export class Store {
  constructor(root) { this.root = root; }
  async get(group, id) {
    if (!idOK(id) || !['templates','runs','plans'].includes(group)) throw Error('INVALID_STORAGE_KEY');
    return JSON.parse(await readFile(path.join(this.root, group, `${id}.json`), 'utf8'));
  }
  async put(group, id, value) {
    if (!idOK(id) || !['templates','runs','plans'].includes(group)) throw Error('INVALID_STORAGE_KEY');
    const dir = path.join(this.root, group); await mkdir(dir, {recursive:true, mode:0o700});
    const dest = path.join(dir, `${id}.json`), temp = `${dest}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value,null,2), {mode:0o600}); await rename(temp,dest);
  }
  async update(group,id,mutate,{initial={}}={}){
    if(!idOK(id)||!['templates','runs','plans'].includes(group))throw Error('INVALID_STORAGE_KEY');
    const dir=path.join(this.root,group);await mkdir(dir,{recursive:true,mode:0o700});
    const canonical=await realpath(dir),release=await acquireLease(leasePath(defaultLeaseRoot(),'store:'+path.join(canonical,id)),{waitMs:30000,busyCode:'STORE_UPDATE_BUSY'});
    try{
      let previous;try{previous=await this.get(group,id);}catch(error){if(error.code!=='ENOENT')throw error;previous=structuredClone(initial);}
      const next=await mutate(previous);await this.put(group,id,next);return next;
    }finally{await release();}
  }
}

const normalize = value => typeof value === 'string' ? value.replace(/\r\n/g,'\n').trim() : value;
export function compare(actual, expected) {
  if (actual === undefined || actual === null) return 'unverified';
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected)) ? 'match' : 'mismatch';
}

export class Engine {
  constructor({store,companies,browser,onInventory,refreshCompanies,resolveTask,leaseRoot=defaultLeaseRoot()}) { Object.assign(this,{store,companies,browser,onInventory,refreshCompanies,resolveTask,leaseRoot}); this.locks = new Set(); }
  async acquireCompanies(companies){
    const origins=[...new Set(companies.map(c=>new URL(c.origin).origin))].sort(),releases=[];
    try{
      for(const origin of origins)releases.push(await acquireLease(leasePath(this.leaseRoot,'recruiting-origin:'+origin),{busyCode:'COMPANY_ALREADY_RUNNING'}));
    }catch(error){for(const release of releases.reverse())await release();throw error;}
    return async()=>{for(const release of releases.reverse())await release();};
  }
  async withCompanyLease(companyId,operation){
    const c=this.companies.find(c=>c.id===companyId);if(!c)throw Error('UNKNOWN_COMPANY');
    const release=await this.acquireCompanies([c]);
    try{await this.refreshCompanies?.();return await operation();}finally{await release();}
  }
  async probeCompany(task,authorization){
    if(!authorization?.probe||!authorization.evidence?.trim())throw Error('CONDITION_PROBE_AUTHORIZATION_REQUIRED');
    return this.withCompanyLease(task.companyId,async()=>{
      const company=this.companies.find(c=>c.id===task.companyId);
      if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
      if(new URL(task.pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
      const template=validateTemplate(await this.store.get('templates',company.templateId));
      if(hash(template)!==task.templateHash)throw Error('TEMPLATE_VERSION_CHANGED');
      const matches=template.pages.filter(p=>new URL(task.pageUrl).pathname.startsWith(p.pathPrefix));
      if(matches.length!==1)throw Error('AMBIGUOUS_PROBE_PAGE');
      const run={id:randomUUID(),operation:'internal_condition_probe',companyId:company.id,templateHash:hash(template),startedAt:new Date().toISOString(),status:'running',submission:'not_performed',save:'not_verified',authorizationEvidence:authorization.evidence};
      const started=performance.now();
      try{
        await this.store.put('runs',run.id,run);
        const page=await this.browser.existingPage(task.pageUrl);
        Object.assign(run,await probeConditions({page,plan:matches[0],pageUrl:task.pageUrl,origin:company.origin,
          onInventory:async fields=>{if(!this.onInventory)throw Error('PROFILE_REQUIRED_FOR_NEW_QUESTIONS');await this.onInventory(company.id,task.pageUrl,fields,matches[0],{discoveryOnly:true});},
          checkpoint:async partial=>{Object.assign(run,partial);await this.store.put('runs',run.id,run);}}));
      }catch(error){run.status='needs_attention';run.errorCode=/^[A-Z_]+$/.test(error.message)?error.message:'CONDITION_PROBE_FAILED';run.restoration??='not_started';}
      finally{run.elapsedMs=Math.round(performance.now()-started);run.finishedAt=new Date().toISOString();await this.store.put('runs',run.id,run);}
      if(run.status==='verified')await this.store.put('templates',`${template.id}-conditions`,{templateHash:hash(template),runId:run.id,verifiedAt:new Date().toISOString(),branchCount:run.branches.length,scope:'declared_conditional_fields_and_captured_parent_options',restoration:run.restoration});
      return {id:run.id,companyId:company.id,status:run.status,errorCode:run.errorCode||null,restoration:run.restoration,branchCount:run.branches?.length||0,branches:run.branches?.map(({source,value,status,newQuestions})=>({source,value,status,newQuestions})),submission:'not_performed',scope:'internal_declared_conditions_only'};
    });
  }
  async preparePlan(task){
    const company=this.companies.find(c=>c.id===task.companyId);
    if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
    if(new URL(task.pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
    const template=validateTemplate(await this.store.get('templates',company.templateId));
    if(hash(template)!==task.templateHash)throw Error('TEMPLATE_VERSION_CHANGED');
    if(!template.pages.some(p=>new URL(task.pageUrl).pathname.startsWith(p.pathPrefix)))throw Error('PLAN_PAGE_NOT_COVERED');
    const plan=await compileExecutionPlan(template,task);
    await this.store.put('plans',plan.id,plan);
    return {companyId:task.companyId,planId:plan.id,planHash:plan.planHash,templateHash:plan.templateHash,counts:plan.counts,allKnown:plan.allKnown,status:plan.allKnown?'ready':'ready_with_pending_answers',browserAccess:false,pending:plan.pages.flatMap(p=>p.fields).filter(f=>f.disposition==='needs_user').map(f=>({id:f.id,source:f.source,label:f.label,required:!!f.required}))};
  }
  async coverage(ids) {
    return Promise.all(ids.map(async id => {
      const c = this.companies.find(c=>c.id===id);
      if (!c) return {companyId:id,status:'unknown_company'};
      if (!c.templateId) return {companyId:id,status:'missing_template'};
      try { const t=validateTemplate(await this.store.get('templates',c.templateId));
        let probe;try{probe=await this.store.get('templates',`${t.id}-conditions`);}catch{}
        const conditionalFields=t.pages.flatMap(p=>p.fields).some(f=>f.when);
        const conditionCoverage=!conditionalFields?'not_required':probe?.templateHash===hash(t)?'declared_branches_verified':'not_probed';
        let live;try{live=await this.store.get('templates',`${t.id}-live`);}catch{}
        if(live?.templateHash===hash(t))return {companyId:id,status:live.pending?'live_prepared_answers_pending':'live_verified',templateId:t.id,templateHash:hash(t),lastLiveRunId:live.runId,pendingAnswers:live.pending,readAt:live.readAt,branchCoverage:'current_active_fields',conditionCoverage};
        return {companyId:id,status:t.validation?.livePassed===true?'live_verified':'captured_not_live_verified',templateId:t.id,templateHash:hash(t),conditionCoverage};
      } catch { return {companyId:id,status:'invalid_or_missing_template'}; }
    }));
  }
  async prepare({tasks,concurrency=3,authorization}) {
    if (!Array.isArray(tasks)||!tasks.length||tasks.length>20) throw Error('INVALID_BATCH_SIZE');
    if (!Number.isInteger(concurrency)||concurrency<1||concurrency>5) throw Error('INVALID_CONCURRENCY');
    if (!authorization?.prepare || !authorization?.evidence) throw Error('PREPARATION_AUTHORIZATION_REQUIRED');
    const keys=tasks.map(t=>t.companyId);
    if (new Set(keys).size!==keys.length || keys.some(k=>this.locks.has(k))) throw Error('COMPANY_ALREADY_RUNNING');
    const urls=tasks.map(t=>t.pageUrl);
    if (new Set(urls).size!==urls.length) throw Error('DUPLICATE_PAGE');
    const jobs=[];
    // Resolve every plan before any page is changed.
    for (const task of tasks) {
      const company=this.companies.find(c=>c.id===task.companyId);
      if (!company?.templateId) throw Error(`COMPANY_NOT_COVERED:${task.companyId}`);
      if (new URL(task.pageUrl).origin!==company.origin) throw Error('COMPANY_ORIGIN_MISMATCH');
      const template=validateTemplate(await this.store.get('templates',company.templateId));
      if (task.templateHash!==hash(template)) throw Error('TEMPLATE_VERSION_CHANGED');
      if(!task.planId||!task.planHash)throw Error('PREPARED_PLAN_REQUIRED');
      let prepared;try{prepared=await this.store.get('plans',task.planId);}catch{throw Error('PREPARED_PLAN_NOT_FOUND');}
      await assertPreparedPlan(prepared,template,task,authorization);
      jobs.push({task,company,template,prepared});
    }
    const release=await this.acquireCompanies(jobs.map(j=>j.company));
    let run;
    const start=performance.now();
    try{
    await this.refreshCompanies?.();
    // Registration uses the same origin lease. Recheck after acquiring it so an
    // asset changed during local preflight cannot enter the browser unnoticed.
    for(const job of jobs){
      const current=this.companies.find(c=>c.id===job.company.id);
      if(!current?.templateId||current.templateId!==job.template.id||hash(await this.store.get('templates',current.templateId))!==job.task.templateHash)throw Error('TEMPLATE_VERSION_CHANGED');
      if(this.resolveTask){
        const fresh=await this.resolveTask(job.task,job.template);
        await assertPreparedPlan(job.prepared,job.template,fresh,authorization);
        job.task=fresh;
      }
    }
    run={id:randomUUID(),startedAt:new Date().toISOString(),status:'running',results:[],batchPrepareCalls:1,modelRoundTrips:'not_measured'};
    keys.forEach(k=>this.locks.add(k));
      await this.store.put('runs',run.id,run);
      const results=new Array(jobs.length);
      // A shared ATS origin is one account scope, even when catalog company IDs
      // differ. Keep that scope serial; distinct origins retain concurrency.
      const groups=[...new Set(jobs.map(j=>j.company.origin))].map(origin=>jobs.map((job,index)=>({job,index})).filter(({job})=>job.company.origin===origin));
      let cursor=0;
      const workers=await Promise.allSettled(Array.from({length:Math.min(concurrency,groups.length)},async()=>{
        while(cursor<groups.length){for(const {job,index}of groups[cursor++])results[index]=await this.runCompany(job,authorization);}
      }));
      // Never release account leases while another worker is still writing,
      // even if one worker exits through an unexpected exception.
      run.workerErrors=workers.filter(w=>w.status==='rejected').length;
      run.results=jobs.map((job,index)=>results[index]||{companyId:job.company.id,status:'needs_attention',errorCode:'BATCH_WORKER_INTERRUPTED',fields:[],pageChecks:[],submission:'not_performed',save:'not_verified'});
      run.status=run.results.every(r=>r.status==='verified')?'verified':'needs_attention';
      for(const [index,result]of run.results.entries()){
        const checks=result.pageChecks.flatMap(p=>p.verification?.checks||[]);
        if(!result.errorCode&&checks.length&&result.pageChecks.every(p=>p.verification)&&checks.every(c=>['match','confirmed_omission','needs_user','missing_input'].includes(c.status))){
          const template=jobs[index].template;
          await this.store.put('templates',`${template.id}-live`,{templateHash:hash(template),runId:run.id,readAt:result.pageChecks.at(-1).verification.readAt,pending:checks.filter(c=>['needs_user','missing_input'].includes(c.status)).length,source:'actual_batch_prepare_and_live_DOM_verification',scope:'current_active_fields_only'});
        }
      }
    } finally {
      keys.forEach(k=>this.locks.delete(k));
      try{
        if(run){run.elapsedMs=Math.round(performance.now()-start);run.finishedAt=new Date().toISOString();if(run.status==='running')run.status='interrupted';await this.store.put('runs',run.id,run);}
      }finally{await release();}
    }
    return run;
  }
  async verifyCurrent(task) {
    return this.withCompanyLease(task.companyId,()=>this.verifyCurrentLocked(task));
  }
  async verifyCurrentLocked(task) {
    const company=this.companies.find(c=>c.id===task.companyId);
    if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
    if(new URL(task.pageUrl).origin!==company.origin)throw Error('COMPANY_ORIGIN_MISMATCH');
    const template=validateTemplate(await this.store.get('templates',company.templateId));
    if(task.templateHash!==hash(template))throw Error('TEMPLATE_VERSION_CHANGED');
    const matches=template.pages.filter(p=>new URL(task.pageUrl).pathname.startsWith(p.pathPrefix));
    if(matches.length!==1)throw Error('AMBIGUOUS_VERIFICATION_PAGE');
    const plan=matches[0],page=await this.browser.existingPage(task.pageUrl);
    await page.assertLocation(company.origin,plan.pathPrefix);await page.wait(plan.readySelector);
    const inventory=await page.inventory(plan);
    let mappingError=null;
    try{if(this.onInventory)await this.onInventory(company.id,task.pageUrl,inventory,plan);}catch(e){mappingError=/^[A-Z_]+$/.test(e.message)?e.message:'PROFILE_REGISTRATION_FAILED';}
    const observation=attachInventory(await page.observe(plan),plan,inventory),observationRunId=randomUUID();
    await this.store.put('runs',observationRunId,{operation:'live_observation',companyId:company.id,observation});
    const result=verifyForm(compileExpected(plan,task),observation);
    if(mappingError){result.status='needs_attention';result.mappingError=mappingError;}
    const run={id:randomUUID(),operation:'verify_current',companyId:company.id,templateHash:hash(template),profileHash:task.profileHash,observationRunId,...result};
    await this.store.put('runs',run.id,run);return run;
  }
  async runCompany({task,company,template,prepared},authorization) {
    const started=performance.now();
    const result={companyId:company.id,templateHash:hash(template),planId:prepared.id,planHash:prepared.planHash,profileHash:task.profileHash,status:'needs_attention',fields:[],pageChecks:[],submission:'not_performed',save:'not_verified'};
    let activePage,activePlan;
    try {
      const page=await this.browser.existingPage(task.pageUrl);
      activePage=page;
      for (const [pageIndex,plan] of template.pages.entries()) {
        const compiled=prepared.pages[pageIndex],frozenFields=compiled.fields;
        activePlan=plan;
        await page.assertLocation(company.origin,plan.pathPrefix);
        await page.wait(plan.readySelector);
        const live=await page.inventory(plan);
        if(this.onInventory)await this.onInventory(company.id,task.pageUrl,live,plan);
        const mapped=new Set(plan.fields.flatMap(f=>f.inventorySelectors||[f.read.selector]));
        const missing=live.filter(f=>!mapped.has(f.selector));
        result.pageChecks.push({pathPrefix:plan.pathPrefix,unmapped:missing.map(f=>({selector:f.selector,label:f.label,required:f.required}))});
        if(missing.length)throw Error('UNMAPPED_FORM_FIELDS');
        const initial=await page.observe(plan);
        if(initial.pageUrl!==task.pageUrl||initial.roleTitle!==plan.roleTitle)throw Error('PAGE_OR_ROLE_IDENTITY_CHANGED');
        // Upload first because parsing may replace the form; then create the planned records.
        const uploads=frozenFields.filter(f=>f.kind==='file'&&f.disposition==='fill');
        for(const f of uploads){
          for(const action of f.actions)await page.act(action,f.value,prepared.files);
        }
        for(const f of frozenFields.filter(f=>f.prepareBeforeGroups&&f.disposition==='fill')){
          for(const action of f.actions||[])await page.act(action,f.value,prepared.files);
        }
        if(plan.provider==='feishu')await page.ensureGroups(plan.groups);
        const expanded=plan.provider==='feishu'?await page.inventory(plan):live;
        if(plan.provider==='feishu'&&this.onInventory)await this.onInventory(company.id,task.pageUrl,expanded,plan);
        if(expanded.some(f=>!mapped.has(f.selector)))throw Error('UNMAPPED_FORM_FIELDS_AFTER_EXPANSION');
        for(const f of frozenFields){
          if(f.disposition!=='fill'||uploads.includes(f)||f.prepareBeforeGroups)continue;
          for(const action of f.actions||[]){
            await page.assertLocation(company.origin,plan.pathPrefix);
            await page.act(action, f.value, prepared.files);
          }
        }
        // A final read of the entire page catches later cascades or resume parsing overwriting earlier values.
        const inventory=await page.inventory(plan);
        // Dependencies and parsing can reveal new optional questions after writing.
        // Persist these before any completion verdict, just like the initial capture.
        if(this.onInventory)await this.onInventory(company.id,task.pageUrl,inventory,plan);
        const observation=attachInventory(await page.observe(plan),plan,inventory);
        const observationRunId=randomUUID();
        await this.store.put('runs',observationRunId,{operation:'live_observation',companyId:company.id,observation});
        (result.observationRunIds??=[]).push(observationRunId);
        const verification=verifyForm(compiled.expected,observation);
        result.pageChecks.at(-1).verification=verification;
        result.fields.push(...verification.checks);
        if(verification.status!=='verified')break;
        for(const action of plan.after||[])await page.act(action,null,{});
      }
      result.status=result.pageChecks.length===template.pages.length&&result.pageChecks.every(p=>p.verification?.status==='verified')?'verified':'needs_attention';
    }catch(error){
      result.errorCode=/^[A-Z_]+(?::[a-z0-9_-]+)?$/.test(error.message)?error.message:'BROWSER_OPERATION_FAILED';
      if(activePage&&activePlan)try{
        const inventory=await activePage.inventory(activePlan);
        if(this.onInventory)await this.onInventory(company.id,task.pageUrl,inventory,activePlan);
        result.failureExitInventory={registered:true,count:inventory.length};
      }catch{result.failureExitInventory={registered:false,reason:'FAILURE_EXIT_CAPTURE_OR_MAPPING_INCOMPLETE'};}
    }
    result.elapsedMs=Math.round(performance.now()-started);
    return result;
  }
}
