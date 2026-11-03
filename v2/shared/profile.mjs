import {resolveDateRepresentation} from './date-representation.mjs';
import {resolveDateFact,datePrecisionGap} from './date-fact-resolution.mjs';
import {assertChoiceGoalSources} from './choice-goal-contract.mjs';
import {MATERIAL_SOURCES,materialKey,resolveMaterialValues} from './business-materials.mjs';
import {majorFacts} from './major-policy.mjs';
import {humanActionReason,isAgreementCheckbox} from './field-policy.mjs';
import {authorizedProfileField,PROTECTED_IDENTITY_SOURCE} from './authorized-profile-field.mjs';
import {evaluateBusinessAuthorization} from './business-authorization.mjs';
// Query-addressed editors can share a pathname while belonging to different jobs
// or form schemas. Retain only observed non-secret identity parameters.
export function formLocation(pageUrl){const u=new URL(pageUrl),keys=['pid','postId','tid','qTid','recruitType','jobId','jobAdId','positionId','formId'],q=new URLSearchParams();for(const key of keys)if(u.searchParams.has(key))q.set(key,u.searchParams.get(key));return u.origin+u.pathname+(q.size?'?'+q:'')+(u.hash.startsWith('#/')?u.hash.split('?')[0]:'');}
import { readFile, writeFile, rename, mkdir, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash } from './engine.mjs';
import { resolveContentPolicy } from './content-policy.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
import {validDate,ingestFactValue,matchesValueType} from './value-contract.mjs';
import {auditStoredContract} from './workflow-contract.mjs';
import {assertDefinitionMapped} from './definition-coverage.mjs';
import {allocateFormCode} from './form-identity.mjs';

export function lookupCompanyForm(profile,companyId,pageUrl,{create=false,companyCode=null}={}){
 const location=formLocation(pageUrl),matches=Object.entries(profile.companyForms||{}).filter(([,f])=>(f.siteId||f.companyId)===companyId&&f.pageUrl&&formLocation(f.pageUrl)===location);
 if(matches.length>1)throw Error('FORM_IDENTITY_AMBIGUOUS');
 if(matches.length){const [pageKey,form]=matches[0];return {pageKey,storedKey:pageKey,form};}
 if(!create)return {pageKey:null,storedKey:null,form:undefined};
 const pageKey=allocateFormCode(profile),form={formId:pageKey,siteId:companyId,companyId,companyCode,pageUrl,mappings:{}};
 profile.companyForms??={};profile.companyForms[pageKey]=form;
 return {pageKey,storedKey:pageKey,form};
}
const forbidden = /(?:^|\.)(?:password|otp|cookie|accessToken|idNumber|passportNumber|bankAccount)(?:\.|$)/i;
export function validateProfile(profile) {
  if(profile.schemaVersion!==1 || !profile.facts || !profile.sources || !profile.entities)throw Error('INVALID_PROFILE');
  for(const [key,fact] of Object.entries(profile.facts)){
    if(forbidden.test(key))throw Error('FORBIDDEN_PROFILE_FIELD');
    if(profile.fieldRegistry?.[key]?.neverStoreValue && fact.value!=null)throw Error('FORBIDDEN_PROFILE_VALUE');
    if(!['known','missing','conflict','not_applicable'].includes(fact.status))throw Error('INVALID_FACT_STATUS');
    // An unusable identity remains reportable as human-owned. It never enters
    // ordinary resolved values; only the shared authorization decision can use it.
    if(fact.status==='known' && (fact.value===null||fact.value===undefined||key!==PROTECTED_IDENTITY_SOURCE&&!fact.sourceIds?.length))throw Error('UNSOURCED_FACT');
    if(key!==PROTECTED_IDENTITY_SOURCE&&fact.sourceIds?.some(s=>!profile.sources[s]))throw Error('UNKNOWN_FACT_SOURCE');
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
// Whether the form now asks something its execution contract does not cover:
// a labelled question no contract field covers (by selector or label), or a
// covered question whose control type changed. Filling never causes this:
// parsed values, added repeat records, revealed conditional fields (they are in
// the contract), changed option lists and layout paths are all ignored.
export function contractQuestionChanges(contract,questions){
 const fields=contract?.fields||[];if(!fields.length)return [];
 const labels=new Set(fields.flatMap(f=>[f.inventoryLabel,f.label]).filter(Boolean));
 const changes=[];
 for(const q of questions){
  const covered=fields.filter(f=>f.inventorySelectors?.includes(q.selector));
  if(covered.length){if(q.type&&covered.some(f=>f.inventoryType&&f.inventoryType!==q.type))changes.push({kind:'type_changed',label:q.label||null});continue;}
  if(q.label&&!labels.has(q.label))changes.push({kind:'new_question',label:q.label});
 }
 return changes.slice(0,10);
}
const privacyGrant=(profile,field)=>isAgreementCheckbox(field)?evaluateBusinessAuthorization(profile,{operation:'recruiting_privacy',phase:'classify',field}):{decision:'out_of_scope',reason:'NOT_AN_AGREEMENT_CHECKBOX'};
const sensitiveMappingStatus=(profile,field,fields)=>authorizedProfileField(profile,field,{fields})?'authorized_profile':privacyGrant(profile,field).decision==='allow'?'authorized_privacy':'user_only';
export function registerObservedQuestions(profile,{companyId,companyCode=null,pageUrl,fields,observedAt,coverageRequired=false}){
  profile.companyForms??={}; profile.fieldRegistry??={};
  const {pageKey,form:old}=lookupCompanyForm(profile,companyId,pageUrl,{create:true,companyCode});
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
    const observedControl=Object.fromEntries(['documentTypePrefix','type','renderer','contextProvider','readonly','disabled','role','multiple','controlIndex','repeatIndex','section','options','actionSelector','readSelector','selectedSelector','uploadContainerSelector','filenameSelector','uploadedSelector'].filter(k=>field[k]!==undefined).map(k=>[k,field[k]]));
    if(prior?.definitionHash===definitionHash){mappings[observedKey]={...prior,...external,observedAt,observedControl,operationContractStatus:'requires_current_contract_audit',active:field.active!==false,coverageRequired:!!prior.coverageRequired||coverageRequired};if(field.userOnly)mappings[observedKey].status=sensitiveMappingStatus(profile,{...field,id:observedKey},questions);continue;}
    const factKey=`unmapped.${companyId}.${observedKey}`;
    const previous=profile.fieldRegistry[factKey];
    profile.fieldRegistry[factKey]={label:field.label||null,question:field.label||field.placeholder||null,companyId,pageUrl,selector:field.selector,type:field.type||null,required:!!field.required,options:field.options||null,status:'needs_semantic_mapping',observedAt,definitionHash};
    profile.facts[factKey]??={value:null,status:'missing',sourceIds:[],reason:'新公司表单新增字段；须明确语义映射或向用户补充，禁止忽略'};
    mappings[observedKey]={factKey,selector:field.selector,required:!!field.required,status:'needs_semantic_mapping',observedAt,definitionHash,observedControl,operationContractStatus:'missing',active:field.active!==false,coverageRequired:!!prior?.coverageRequired||coverageRequired};
    if(prior?.status==='mapped'&&profile.facts[prior.factKey])Object.assign(mappings[observedKey],{factKey:prior.factKey,status:'mapped',mappingEvidence:prior.mappingEvidence,operationContractStatus:'requires_rebuild_after_component_change'});
    if(field.userOnly){profile.fieldRegistry[factKey].status='user_only';profile.fieldRegistry[factKey].neverStoreValue=true;mappings[observedKey].status=sensitiveMappingStatus(profile,{...field,id:observedKey},questions);}
    Object.assign(mappings[observedKey],external);
    added.push(factKey);
  }
  profile.companyForms[pageKey]={...old,companyId,pageUrl,observedAt,inventoryHash:hash(questions),mappings};
  delete profile.companyForms[pageKey].previousInventoryHash;delete profile.companyForms[pageKey].definitionHash;
  // Only a question the contract does not cover invalidates it; the changes
  // filling makes to the page (inventoryHash) do not.
  const changes=old?.executionContract?contractQuestionChanges(old.executionContract,questions):[];
  if(changes.length)Object.assign(profile.companyForms[pageKey].executionContract,{validForCurrentInventory:false,status:'requires_rebuild',rebuildReason:'question_definition_changed',rebuildEvidence:changes});
  profile.updatedAt=observedAt;
  return {pageKey,added,unmapped:Object.values(mappings).filter(m=>m.active!==false&&m.status==='needs_semantic_mapping').length};
}

export function assertQuestionsMapped(profile,companyId,pageUrl,constructionTemplate){
  const {pageKey,form}=lookupCompanyForm(profile,companyId,pageUrl);
  if(!form)throw Error('FORM_QUESTIONS_NOT_REGISTERED');
  if(Object.values(form.mappings).some(m=>(m.active!==false||m.coverageRequired)&&!['mapped','user_only','authorized_profile','authorized_privacy'].includes(m.status)))throw Error('NEW_QUESTIONS_REQUIRE_PROFILE_MAPPING');
  const contract=constructionTemplate&&form.draftExecutionContract?.templateHash===hash(constructionTemplate)?form.draftExecutionContract:form.executionContract;
  for(const m of Object.values(form.mappings))if(m.coverageRequired&&m.status==='mapped'&&!contract?.fields?.some(f=>f.source===m.factKey&&f.inventorySelectors?.includes(m.selector)))throw Error('NEW_QUESTIONS_REQUIRE_TEMPLATE_MAPPING');
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
    const {pageKey,form}=lookupCompanyForm(profile,companyId,pageUrl,{create:true});
    const prior=form||{companyId,pageUrl,mappings:{}};
    const fields=page.fields.map((f,index)=>({...structuredClone(f),index}));
    prior[stage==='construction'?'draftExecutionContract':'executionContract']={revision:2,status:stage==='construction'?(audit.ready?'construction_complete':'construction_incomplete'):'registered',validForCurrentInventory:true,templateId:template.id,templateVersion:template.version,templateHash,inventoryHash:prior.inventoryHash||null,sections:page.sections,groups:page.groups||[],fields,evidence:template.evidence,storageAudit:audit};
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
  const candidate=stored?.templateHash===hash(template)?stored:lookupCompanyForm(profile,companyId,url).form?.draftExecutionContract;
  if(!candidate||candidate.templateHash!==hash(template)||hash((candidate.fields||[]).map(({index,...f})=>f))!==hash(page.fields))throw Error('PROFILE_CONTRACT_STORAGE_READBACK_FAILED');
 }
 return true;
}
export function resolveProfile(profile, template, decisions={}, companyId, materialContext) {
  validateProfile(profile);
  assertChoiceGoalSources(template,profile);
  if(companyId)assertStoredExecutionContract(profile,companyId,template);
  assertDefinitionMapped(profile,companyId,template);
  const material=materialContext?resolveMaterialValues(materialContext):null;
  const dateRepresentations={},values={...material?.values},missing=[],sources={...material?.sources},omissions={...decisions.omissions};
  const factValue=(key,field)=>{
    if(key===PROTECTED_IDENTITY_SOURCE)return undefined;
    if(/^education\.[^.]+\.major\.(canonical|application)$/.test(key)&&majorFacts(profile,key)?.real)throw Error('MAJOR_REAL_SOURCE_REQUIRES_REBUILD');
    if(Object.values(MATERIAL_SOURCES).includes(key)){if(!material)throw Error('CONFIRMED_MATERIAL_CONTEXT_REQUIRED');return material.values[key];}
    const date=field?.kind==='date'?resolveDateFact(profile,key):null,f=date?date.fact:profile.facts[key];
    const dateGap=date?datePrecisionGap(profile,key,field.precision):null;
    if(dateGap){missing.push(key);sources[key]={sourceIds:f.sourceIds,precision:f.precision||dateGap.sourcePrecision,datePrecisionGap:dateGap};return undefined;}
    if(f?.status==='not_applicable'&&f.omission&&profile.sources[f.omission.evidence])return undefined;
    if(!f||f.status!=='known'){missing.push(key);return undefined;}
    sources[key]={sourceIds:f.sourceIds,precision:f.precision||null,...(date?{derivedFrom:date.derivedFrom,dateNormalization:f.dateNormalization||null}: {})};
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
      // 日期表达的岗位范围仍按网站岗位编号（官方岗位ID）核对，与建库时从页面地址读到的一致；第 3 步随表单编码一起改为按绑定。
      const representation=resolveDateRepresentation(profile,{companyId,pageUrl:template.evidence.sourceUrl,roleId:materialContext?.officialId},field);
      if(representation){dateRepresentations[field.id]=representation;sources[representation.source]={sourceIds:representation.sourceIds,precision:'day'};}
      values[field.source]=undefined;continue;
    }
    if(field.compose){
      const parts=field.compose.sources.map(key=>field.compose.optionalSources?.includes(key)&&profile.facts[key]?.status!=='known'?'':factValue(key));
      if(parts.every(v=>v!==undefined))values[field.source]=parts.filter(v=>v!=='').join(field.compose.separator??'\n');
    }else values[field.source]=factValue(field.source,field);
  }
  return {values,dateRepresentations,missing:[...new Set(missing)],sources,...(material?{materialContext}:{}),profileHash:hash(profile),files:profile.files||{},omissions,contentPolicy:resolveContentPolicy(profile,companyId)};
}

export function profileStatus(profile,companyId,pageUrl) {
  validateProfile(profile);
  const forms=Object.entries(profile.companyForms||{}).filter(([,f])=>(!companyId||f.companyId===companyId)&&(!pageUrl||f.pageUrl===pageUrl));
  return {profileHash:hash(profile),forms:forms.map(([pageKey,form])=>({pageKey,companyId:form.companyId,pageUrl:form.pageUrl,
    questions:Object.entries(form.mappings).map(([questionId,m])=>{const f=profile.facts[m.factKey],d=profile.fieldRegistry?.[m.factKey];
      const contract=form.executionContract?.fields?.find(x=>x.source===m.factKey&&x.inventorySelectors?.includes(m.selector));
      const resolvedDate=contract?.kind==='date'?resolveDateFact(profile,m.factKey):null,dateGap=resolvedDate?datePrecisionGap(profile,m.factKey,contract.precision):null;
      const ongoing=contract?.ongoingSource&&profile.facts[contract.ongoingSource];
      const derived=ongoing?.status==='known'&&ongoing.value===true;
      const inScope=m.active!==false||m.coverageRequired;
      const authorization=authorizedProfileField(profile,{...m.observedControl,...contract,id:contract?.id||questionId,label:d?.label||d?.semanticKey||contract?.inventoryLabel||'',source:m.factKey},{fields:form.executionContract?.fields||[]});
      const currentField={...m.observedControl,...contract,label:d?.label||d?.semanticKey||contract?.inventoryLabel||''},privacy=privacyGrant(profile,currentField),privacyAuthorized=privacy.decision==='allow';
      const identity=evaluateBusinessAuthorization(profile,{operation:'identity_fill',phase:'classify',field:currentField,fields:form.executionContract?.fields||[]}),technical=!authorization&&identity.decision==='technical_pending';
      return {questionId,selector:m.selector,factKey:authorization?.source||m.factKey,label:d?.label||d?.semanticKey||null,mappingStatus:!inScope?'inactive':authorization?'authorized_profile':privacyAuthorized?'authorized_privacy':technical?'runtime_evidence_pending':['authorized_profile','authorized_privacy'].includes(m.status)?'user_only':m.status,
        ...(authorization?{resolution:'authorized_profile',owner:'agent'}:privacyAuthorized?{resolution:'authorized_privacy',owner:'agent',authorizationRef:privacy.authorizationRef}:technical?{resolution:'authorization_runtime_evidence_pending',owner:identity.requiresUserInput?'user':'agent',reason:identity.reason,authorizationStillValid:true}:{}),
        answerStatus:!inScope?'inactive':authorization||privacyAuthorized?'known':technical?'technical_pending':['user_only','authorized_profile','authorized_privacy'].includes(m.status)?'user_only':Object.values(MATERIAL_SOURCES).includes(m.factKey)?'role_material':dateGap?'precision_incomplete':derived||resolvedDate?.fact?.status==='known'?'known':f?.status||'missing',factStatus:authorization||privacyAuthorized?'known':technical?(identity.requiresUserInput?'missing':'evidence_pending'):Object.values(MATERIAL_SOURCES).includes(m.factKey)?'external_source':f?.status||'missing',...(dateGap?{datePrecisionGap:dateGap}:{}),...(derived?{resolution:{kind:'ongoing',source:contract.ongoingSource,sourceIds:ongoing.sourceIds}}:{}),required:!!m.required,active:m.active!==false,coverageRequired:!!m.coverageRequired,userOnly:!!inScope&&!authorization&&!privacyAuthorized&&!technical&&['user_only','authorized_profile','authorized_privacy'].includes(m.status),omission:f?.omission||null};})}))};
}

export function recordProfileAnswers(profile,{answers,evidence,recordedAt=new Date().toISOString()}) {
  if(!evidence?.trim()||!Array.isArray(answers)||!answers.length)throw Error('USER_ANSWER_EVIDENCE_REQUIRED');
  if(new Set(answers.map(a=>a.factKey)).size!==answers.length)throw Error('DUPLICATE_ANSWER_FACT');
  const sourceId='user_'+randomUUID();
  answers=answers.map(answer=>{
    const definition=profile.fieldRegistry?.[answer.factKey],declared=profile.facts[answer.factKey]?.precision||definition?.precision;
    const temporal=/(?:^|\.)(?:date|start|end|birthDate|earliestStart|yearMonth)$/.test(answer.factKey),units=['year','month','day'];
    const supplied=temporal&&answer.status==='known'?units.find(unit=>validDate(answer.value,unit)):null;
    // A user's explicit full date upgrades a coarse fact; a portal's month
    // precision is projected later and must not discard the supplied day.
    const precision=supplied&&(!declared||units.indexOf(supplied)>units.indexOf(declared))?supplied:declared;
    const value=answer.status==='known'?ingestFactValue(answer.value,precision):answer.value;
    if(answer.status==='known'&&definition?.canonicalType&&!matchesValueType(value,definition.canonicalType))throw Error('INVALID_CANONICAL_FACT_TYPE');
    return {...answer,value,canonicalPrecision:precision||null};
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
    if(answer.status==='known'){delete next.reason;if(answer.canonicalPrecision){next.precision=answer.canonicalPrecision;delete next.dateNormalization;}}
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
    if(definition&&prior.factKey.startsWith('unmapped.')){definition.aliasOf=mapping.factKey;definition.status='mapped';definition.mappingEvidence=evidence;}
    Object.assign(prior,{factKey:mapping.factKey,status:'mapped',mappingEvidence:evidence});
  }
  return {pageKey,mapped:mappings.length,remainingUnmapped:Object.values(form.mappings).filter(m=>m.status==='needs_semantic_mapping').length};
}
