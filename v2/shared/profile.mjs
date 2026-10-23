import {resolveDateRepresentation} from './date-representation.mjs';
import {MATERIAL_SOURCES,materialKey,resolveMaterialValues} from './business-materials.mjs';
import {majorFacts} from './major-policy.mjs';
import {humanActionReason} from './field-policy.mjs';
// Query-addressed editors can share a pathname while belonging to different jobs
// or form schemas. Retain only observed non-secret identity parameters.
export function formLocation(pageUrl){const u=new URL(pageUrl),keys=['pid','postId','tid','qTid','recruitType','jobId','positionId','formId'],q=new URLSearchParams();for(const key of keys)if(u.searchParams.has(key))q.set(key,u.searchParams.get(key));return u.origin+u.pathname+(q.size?'?'+q:'')+(u.hash.startsWith('#/')?u.hash.split('?')[0]:'');}
import { readFile, writeFile, rename, mkdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from './engine.mjs';
import { resolveContentPolicy } from './content-policy.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
import {validDate,ingestFactValue,matchesValueType} from './value-contract.mjs';
import {auditStoredContract} from './workflow-contract.mjs';
import {assertDefinitionMapped} from './definition-coverage.mjs';

export function lookupCompanyForm(profile,companyId,pageUrl,{migrate=false}={}){
 const pageKey=hash({companyId,pageUrl:formLocation(pageUrl)}).slice(0,20);let storedKey=pageKey,form=profile.companyForms?.[pageKey];
 if(!form){const exact=Object.entries(profile.companyForms||{}).filter(([,f])=>f.companyId===companyId&&f.pageUrl===pageUrl);if(exact.length===1)[storedKey,form]=exact[0];}
 if(migrate&&form&&storedKey!==pageKey){profile.companyForms[pageKey]=form;delete profile.companyForms[storedKey];storedKey=pageKey;}
 return {pageKey,storedKey,form};
}
const forbidden = /(?:^|\.)(?:password|otp|cookie|accessToken|idNumber|passportNumber|bankAccount)(?:\.|$)/i;
export function validateProfile(profile) {
  if(profile.schemaVersion!==1 || !profile.facts || !profile.sources || !profile.entities)throw Error('INVALID_PROFILE');
  for(const [key,fact] of Object.entries(profile.facts)){
    if(forbidden.test(key))throw Error('FORBIDDEN_PROFILE_FIELD');
    if(profile.fieldRegistry?.[key]?.neverStoreValue && fact.value!=null)throw Error('FORBIDDEN_PROFILE_VALUE');
    if(!['known','missing','conflict','not_applicable'].includes(fact.status))throw Error('INVALID_FACT_STATUS');
    if(fact.status==='known' && (fact.value===null||fact.value===undefined||!fact.sourceIds?.length))throw Error('UNSOURCED_FACT');
    if(fact.sourceIds?.some(s=>!profile.sources[s]))throw Error('UNKNOWN_FACT_SOURCE');
    const definition=profile.fieldRegistry?.[key],precision=fact.precision||definition?.precision;
    if(fact.status==='known' && precision && !validDate(fact.value,precision))throw Error('INVALID_CANONICAL_DATE');
    if(fact.status==='known' && definition?.canonicalType && !matchesValueType(fact.value,definition.canonicalType))throw Error('INVALID_CANONICAL_FACT_TYPE');
  }
  return profile;
}
export async function loadProfile(file){return validateProfile(JSON.parse(await readFile(file,'utf8')));}
const profileWrites=new Map();
export async function updateProfile(file,mutate){
  const previous=profileWrites.get(file)||Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
    const canonical=await realpath(file),release=await acquireLease(leasePath(defaultLeaseRoot(),'profile:'+canonical),{waitMs:30000,busyCode:'PROFILE_UPDATE_BUSY'});
    let temp;
    try{
      const p=await loadProfile(canonical); const result=await mutate(p);validateProfile(p);
      temp=`${canonical}.${randomUUID()}.tmp`;
      await writeFile(temp,JSON.stringify(p,null,2),{mode:0o600});await rename(temp,canonical);temp=null;
      return result;
    }finally{if(temp)await unlink(temp).catch(()=>{});await release();}
  });
  profileWrites.set(file,next);try{return await next;}finally{if(profileWrites.get(file)===next)profileWrites.delete(file);}
}

// Mandatory before a captured company form can be considered mapped.
// Unknown questions are persisted even when optional, unanswered or semantically ambiguous.
export function registerObservedQuestions(profile,{companyId,pageUrl,fields,observedAt,coverageRequired=false}){
  profile.companyForms??={}; profile.fieldRegistry??={};
  const {pageKey,form:old}=lookupCompanyForm(profile,companyId,pageUrl,{migrate:true});
  const questions=fields.filter(f=>!['button','submit','reset','hidden'].includes(f.type));
  const mappings=Object.fromEntries(Object.entries(old?.mappings||{}).map(([key,m])=>[key,{...m,active:false}])); const added=[];
  for(const field of questions){
    const observedKey=hash({selector:field.selector,label:field.label}).slice(0,20);
    const prior=old?.mappings?.[observedKey];
    if(prior?.status==='user_only'&&!field.userOnly&&!humanActionReason({inventoryLabel:field.label,inventoryType:field.type,inventoryRenderer:field.renderer,role:field.role})){
      const definition=profile.fieldRegistry[prior.factKey];
      if(definition?.companyId===companyId&&definition.selector===field.selector){delete definition.neverStoreValue;definition.status='needs_semantic_mapping';prior.status='needs_semantic_mapping';}
    }
    const material=materialKey(field),external=material?{factKey:MATERIAL_SOURCES[material],status:'mapped',mappingEvidence:'Observed exact role-material question semantic'}:{};
    const definitionHash=hash({type:field.type||null,required:!!field.required,options:field.options||null,userOnly:!!field.userOnly,renderer:field.renderer||null,readonly:!!field.readonly,disabled:!!field.disabled,multiple:!!field.multiple,selectedSelector:field.selectedSelector||null});
    const observedControl=Object.fromEntries(['type','renderer','contextProvider','readonly','disabled','role','multiple','controlIndex','repeatIndex','section','options','actionSelector','readSelector','selectedSelector','uploadContainerSelector','filenameSelector','uploadedSelector'].filter(k=>field[k]!==undefined).map(k=>[k,field[k]]));
    if(prior?.definitionHash===definitionHash){mappings[observedKey]={...prior,...external,observedAt,observedControl,operationContractStatus:'requires_current_contract_audit',active:field.active!==false,coverageRequired:!!prior.coverageRequired||coverageRequired};continue;}
    const factKey=`unmapped.${companyId}.${observedKey}`;
    const previous=profile.fieldRegistry[factKey];
    profile.fieldRegistry[factKey]={label:field.label||null,question:field.label||field.placeholder||null,companyId,pageUrl,selector:field.selector,type:field.type||null,required:!!field.required,options:field.options||null,status:'needs_semantic_mapping',observedAt,definitionHash};
    profile.facts[factKey]??={value:null,status:'missing',sourceIds:[],reason:'新公司表单新增字段；须明确语义映射或向用户补充，禁止忽略'};
    mappings[observedKey]={factKey,selector:field.selector,required:!!field.required,status:'needs_semantic_mapping',observedAt,definitionHash,observedControl,operationContractStatus:'missing',active:field.active!==false,coverageRequired:!!prior?.coverageRequired||coverageRequired};
    if(prior?.status==='mapped'&&profile.facts[prior.factKey])Object.assign(mappings[observedKey],{factKey:prior.factKey,status:'mapped',mappingEvidence:prior.mappingEvidence,operationContractStatus:'requires_rebuild_after_component_change'});
    if(field.userOnly){profile.fieldRegistry[factKey].status='user_only';profile.fieldRegistry[factKey].neverStoreValue=true;mappings[observedKey].status='user_only';}
    Object.assign(mappings[observedKey],external);
    added.push(factKey);
  }
  profile.companyForms[pageKey]={...old,companyId,pageUrl,observedAt,inventoryHash:hash(questions),mappings};
  delete profile.companyForms[pageKey].previousInventoryHash;
  if(old?.executionContract&&old.inventoryHash!==hash(questions))Object.assign(profile.companyForms[pageKey].executionContract,{validForCurrentInventory:false,status:'requires_rebuild'});
  profile.updatedAt=observedAt;
  return {pageKey,added,unmapped:Object.values(mappings).filter(m=>m.active!==false&&m.status==='needs_semantic_mapping').length};
}

export function assertQuestionsMapped(profile,companyId,pageUrl){
  const {pageKey,form}=lookupCompanyForm(profile,companyId,pageUrl);
  if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');
  if(Object.values(form.mappings).some(m=>(m.active!==false||m.coverageRequired)&&m.status!=='mapped'&&m.status!=='user_only'))throw Error('NEW_QUESTIONS_REQUIRE_PROFILE_MAPPING');
  for(const m of Object.values(form.mappings))if(m.coverageRequired&&m.status==='mapped'&&!form.executionContract?.fields?.some(f=>f.source===m.factKey&&f.inventorySelectors?.includes(m.selector)))throw Error('NEW_QUESTIONS_REQUIRE_TEMPLATE_MAPPING');
  for(const m of Object.values(form.mappings))if((m.active!==false||m.coverageRequired)&&!Object.values(MATERIAL_SOURCES).includes(m.factKey)&&!profile.facts[m.factKey])throw Error('MAPPED_FACT_MISSING');
}

export function registerPlannedQuestions(profile,args,plan) {
  const registration=registerObservedQuestions(profile,args),form=profile.companyForms[registration.pageKey];
  if(!plan)return registration;
  for(const actual of args.fields){
    const matches=plan.fields.filter(f=>(f.inventorySelectors||[f.read.selector]).includes(actual.selector)&&
      f.inventoryLabel===actual.label&&f.inventoryType===actual.type&&!!f.required===!!actual.required);
    if(matches.length!==1||actual.userOnly)continue;
    const expected=matches[0];if(expected.source?.startsWith('unmapped.')||!profile.facts[expected.source])continue;
    const key=hash({selector:actual.selector,label:actual.label}).slice(0,20),mapping=form.mappings[key];
    if(mapping.status==='mapped'&&mapping.factKey!==expected.source)continue;
    const definition=profile.fieldRegistry[mapping.factKey];
    if(mapping.factKey.startsWith('unmapped.')&&definition){definition.aliasOf=expected.source;definition.status='mapped';}
    profile.fieldRegistry[expected.source]??={semanticKey:expected.source,label:actual.label,status:'defined'};
    Object.assign(mapping,{factKey:expected.source,status:'mapped',mappingEvidence:'exact approved template selector/label/type/required signature'});
  }
  return {...registration,unmapped:Object.values(form.mappings).filter(m=>m.active!==false&&m.status==='needs_semantic_mapping').length};
}

// Stored during internal asset registration, before any preparation call. This
// includes inactive conditional fields, rather than only the currently visible DOM.
export function registerTemplateContract(profile,{companyId,template,templateHash,stage='registered'}){
  profile.companyForms??={};profile.fieldRegistry??={};
  const audit=auditStoredContract(template);if(stage!=='construction'&&!audit.ready)throw Error('COMPLETE_EXECUTION_CONTRACT_REQUIRED');
  for(const page of template.pages){
    const sourceUrl=new URL(template.evidence.sourceUrl),pageUrl=sourceUrl.pathname.startsWith(page.pathPrefix)?sourceUrl.href:new URL(page.pathPrefix,sourceUrl).href;
    const {pageKey,form}=lookupCompanyForm(profile,companyId,pageUrl,{migrate:true});
    const prior=form||{companyId,pageUrl,mappings:{}};
    const fields=page.fields.map((f,index)=>({...structuredClone(f),index}));
    prior.executionContract={revision:2,status:stage==='construction'?(audit.ready?'construction_complete':'construction_incomplete'):'registered',validForCurrentInventory:true,templateId:template.id,templateVersion:template.version,templateHash,inventoryHash:prior.inventoryHash||null,sections:page.sections,groups:page.groups||[],fields,evidence:template.evidence,storageAudit:audit};
    profile.companyForms[pageKey]=prior;
    if(stage==='construction')continue;
    for(const f of page.fields){
      if(Object.values(MATERIAL_SOURCES).includes(f.source))continue;
      const old=profile.fieldRegistry[f.source]||{};
      const fact=profile.facts[f.source],sourceType=f.enumMap?(old.canonicalType||(fact?.status==='known'?typeof fact.value:f.control.valueType)):f.control.valueType;
      if(old.canonicalType&&old.canonicalType!==sourceType)throw Error('CANONICAL_FIELD_TYPE_CONFLICT');
      const canonicalPrecision=profile.facts[f.source]?.precision||old.precision||f.precision;
      profile.fieldRegistry[f.source]={...old,semanticKey:f.source,label:old.label||f.label,canonicalType:sourceType,...(canonicalPrecision?{precision:canonicalPrecision}:{})};
      profile.facts[f.source]??={value:null,status:'missing',sourceIds:[],reason:'新表单契约问题；待用户资料，禁止忽略'};
    }
  }
  validateProfile(profile);
  return {companyId,templateHash,registeredFields:template.pages.reduce((n,p)=>n+p.fields.length,0)};
}
export function assertStoredExecutionContract(profile,companyId,template){
 for(const page of template.pages){const source=new URL(template.evidence.sourceUrl),url=source.pathname.startsWith(page.pathPrefix)?source.href:new URL(page.pathPrefix,source).href,stored=lookupCompanyForm(profile,companyId,url).form?.executionContract;
  if(!stored||stored.templateHash!==hash(template)||hash((stored.fields||[]).map(({index,...f})=>f))!==hash(page.fields))throw Error('PROFILE_CONTRACT_STORAGE_READBACK_FAILED');
 }
 return true;
}
export function resolveProfile(profile, template, decisions={}, companyId, materialContext) {
  validateProfile(profile);
  if(companyId)assertStoredExecutionContract(profile,companyId,template);
  assertDefinitionMapped(profile,companyId,template);
  const material=materialContext?resolveMaterialValues(materialContext):null;
  const dateRepresentations={},values={...material?.values},missing=[],sources={...material?.sources},omissions={...decisions.omissions};
  const factValue=key=>{
    if(/^education\.[^.]+\.major\.(canonical|application)$/.test(key)&&majorFacts(profile,key)?.real)throw Error('MAJOR_REAL_SOURCE_REQUIRES_REBUILD');
    if(Object.values(MATERIAL_SOURCES).includes(key)){if(!material)throw Error('CONFIRMED_MATERIAL_CONTEXT_REQUIRED');return material.values[key];}
    const f=profile.facts[key];
    if(f?.status==='not_applicable'&&f.omission&&profile.sources[f.omission.evidence])return undefined;
    if(!f||f.status!=='known'){missing.push(key);return undefined;}
    sources[key]={sourceIds:f.sourceIds,precision:f.precision||null};
    return f.value;
  };
  for(const field of template.pages.flatMap(p=>p.fields)){
    const major=majorFacts(profile,field.source),policy=profile.policies?.majorDropdownResolution||profile.policy?.majorDropdownResolution;
    if(major?.application&&field.choiceResolution&&field.choiceResolution.majorPolicyHash!==hash({real:major.real,application:major.application,policy}))throw Error('CHOICE_RESOLUTION_STALE');
    if(field.when&&(values[field.when.source]??profile.facts[field.when.source]?.value)!==field.when.equals)continue;
    if(field.ongoingSource)values[field.ongoingSource]=factValue(field.ongoingSource);
    const omission=material?.omissions[field.source]||profile.facts[field.source]?.omission;
    if(!field.required && omission && (material?.omissions[field.source]||profile.sources[omission.evidence]))omissions[field.id]=omission;
    if(field.source.startsWith('decision:')){values[field.source]=decisions[field.source.slice(9)];continue;}
    if(field.ongoingSource&&values[field.ongoingSource]===true){
      const representation=resolveDateRepresentation(profile,{companyId,pageUrl:template.evidence.sourceUrl,roleId:materialContext?.roleId},field);
      if(representation){dateRepresentations[field.id]=representation;sources[representation.source]={sourceIds:representation.sourceIds,precision:'day'};}
      values[field.source]=undefined;continue;
    }
    if(field.compose){
      const parts=field.compose.sources.map(key=>field.compose.optionalSources?.includes(key)&&profile.facts[key]?.status!=='known'?'':factValue(key));
      if(parts.every(v=>v!==undefined))values[field.source]=parts.filter(v=>v!=='').join(field.compose.separator??'\n');
    }else values[field.source]=factValue(field.source);
  }
  return {values,dateRepresentations,missing:[...new Set(missing)],sources,...(material?{materialContext}:{}),profileHash:hash(profile),files:profile.files||{},omissions,contentPolicy:resolveContentPolicy(profile,companyId)};
}

export function profileStatus(profile,companyId,pageUrl) {
  validateProfile(profile);
  const forms=Object.entries(profile.companyForms||{}).filter(([,f])=>(!companyId||f.companyId===companyId)&&(!pageUrl||f.pageUrl===pageUrl));
  return {profileHash:hash(profile),forms:forms.map(([pageKey,form])=>({pageKey,companyId:form.companyId,pageUrl:form.pageUrl,
    questions:Object.entries(form.mappings).map(([questionId,m])=>{const f=profile.facts[m.factKey],d=profile.fieldRegistry?.[m.factKey];
      const contract=form.executionContract?.fields?.find(x=>x.source===m.factKey&&x.inventorySelectors?.includes(m.selector));
      const ongoing=contract?.ongoingSource&&profile.facts[contract.ongoingSource];
      const derived=ongoing?.status==='known'&&ongoing.value===true;
      return {questionId,selector:m.selector,factKey:m.factKey,label:d?.label||d?.semanticKey||null,mappingStatus:m.status,
        answerStatus:Object.values(MATERIAL_SOURCES).includes(m.factKey)?'role_material':derived?'known':f?.status||'missing',factStatus:Object.values(MATERIAL_SOURCES).includes(m.factKey)?'external_source':f?.status||'missing',...(derived?{resolution:{kind:'ongoing',source:contract.ongoingSource,sourceIds:ongoing.sourceIds}}:{}),required:!!m.required,active:m.active!==false,coverageRequired:!!m.coverageRequired,userOnly:m.status==='user_only',omission:f?.omission||null};})}))};
}

export function recordProfileAnswers(profile,{answers,evidence,recordedAt=new Date().toISOString()}) {
  if(!evidence?.trim()||!Array.isArray(answers)||!answers.length)throw Error('USER_ANSWER_EVIDENCE_REQUIRED');
  if(new Set(answers.map(a=>a.factKey)).size!==answers.length)throw Error('DUPLICATE_ANSWER_FACT');
  const sourceId='user_'+randomUUID();
  answers=answers.map(answer=>{
    const definition=profile.fieldRegistry?.[answer.factKey],precision=profile.facts[answer.factKey]?.precision||definition?.precision;
    const value=answer.status==='known'?ingestFactValue(answer.value,precision):answer.value;
    if(answer.status==='known'&&definition?.canonicalType&&!matchesValueType(value,definition.canonicalType))throw Error('INVALID_CANONICAL_FACT_TYPE');
    return {...answer,value};
  });
  // Validate the entire update before mutation; secrets and unregistered facts stay rejected.
  for(const answer of answers){
    const definition=profile.fieldRegistry?.[answer.factKey];
    if(!profile.facts[answer.factKey]||forbidden.test(answer.factKey)||definition?.neverStoreValue)throw Error('ANSWER_FACT_NOT_ALLOWED');
    if(!['known','not_applicable'].includes(answer.status))throw Error('INVALID_ANSWER_STATUS');
    if(answer.status==='known'&&(answer.value===null||answer.value===undefined))throw Error('KNOWN_ANSWER_REQUIRES_VALUE');
    if(answer.status==='not_applicable'&&(!['confirmed_absent','user_declined','not_applicable'].includes(answer.omissionKind)||answer.value!=null))throw Error('EXPLICIT_OMISSION_REQUIRED');
  }
  profile.sources[sourceId]={kind:'user_reply',evidence,recordedAt};
  for(const answer of answers){
    const previous=profile.facts[answer.factKey];
    const next={...previous,value:answer.status==='known'?answer.value:null,status:answer.status,sourceIds:[sourceId],updatedAt:recordedAt};
    delete next.history;
    if(answer.status==='not_applicable')next.omission={kind:answer.omissionKind,evidence:sourceId};else delete next.omission;
    profile.facts[answer.factKey]=next;
  }
  validateProfile(profile);
  return {sourceId,updatedFacts:answers.map(a=>a.factKey),profileHash:hash(profile)};
}

export function mapProfileQuestions(profile,{companyId,pageUrl,mappings,evidence}) {
  if(!evidence?.trim()||!Array.isArray(mappings)||!mappings.length)throw Error('MAPPING_EVIDENCE_REQUIRED');
  const {pageKey,form}=lookupCompanyForm(profile,companyId,pageUrl,{migrate:true});
  if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');
  for(const mapping of mappings){
    const prior=form.mappings[mapping.questionId];
    if(!prior)throw Error('UNKNOWN_QUESTION_OR_FACT');
    if(!Object.values(MATERIAL_SOURCES).includes(mapping.factKey)&&!profile.facts[mapping.factKey]&&(!mapping.define||forbidden.test(mapping.factKey)||mapping.factKey.startsWith('unmapped.')||!['string','number','boolean','string[]'].includes(mapping.define.canonicalType)||!mapping.define.label?.trim()))throw Error('UNKNOWN_QUESTION_OR_FACT');
    if(prior.status==='user_only'||profile.fieldRegistry[prior.factKey]?.neverStoreValue)throw Error('USER_ONLY_QUESTION_CANNOT_BE_MAPPED');
  }
  for(const mapping of mappings){
    const prior=form.mappings[mapping.questionId],definition=profile.fieldRegistry[prior.factKey];
    if(!Object.values(MATERIAL_SOURCES).includes(mapping.factKey)&&!profile.facts[mapping.factKey]){profile.fieldRegistry[mapping.factKey]={...mapping.define,semanticKey:mapping.factKey,status:'defined',definitionEvidence:evidence};profile.facts[mapping.factKey]={status:'missing',value:null,sourceIds:[],reason:'Observed question mapped to a newly defined semantic fact; no answer inferred'};}
    if(definition){definition.aliasOf=mapping.factKey;definition.status='mapped';definition.mappingEvidence=evidence;}
    Object.assign(prior,{factKey:mapping.factKey,status:'mapped',mappingEvidence:evidence});
  }
  return {pageKey,mapped:mappings.length,remainingUnmapped:Object.values(form.mappings).filter(m=>m.status==='needs_semantic_mapping').length};
}
