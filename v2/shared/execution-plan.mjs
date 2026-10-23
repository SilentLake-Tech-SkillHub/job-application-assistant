import {materialAudit,effectiveRequired} from './business-materials.mjs';
import {assertApplicationText} from './application-text.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {compileExpected} from './observation.mjs';
import {assertContentPolicy} from './content-policy.mjs';
import {validateControlContract,validDate,projectDateValue,matchesValueType} from './value-contract.mjs';
import {templateConstructionIssues} from './field-policy.mjs';

const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const json=v=>JSON.parse(JSON.stringify(v));
export function orderedFillIds(fields,requiredMaterials=[]){
 const fill=fields.filter(f=>f.disposition==='fill'&&f.kind!=='file'&&!f.prepareBeforeGroups),required=new Set(requiredMaterials.map(r=>r.fieldId)),done=new Set(),visiting=new Set(),order=[];
 const visit=field=>{if(done.has(field.id))return;if(visiting.has(field.id))throw Error('CYCLIC_FIELD_DEPENDENCY');visiting.add(field.id);
  if(field.when)for(const parent of fill.filter(f=>f.source===field.when.source))visit(parent);
  visiting.delete(field.id);done.add(field.id);order.push(field.id);
 };
 for(const field of [...fill.filter(f=>required.has(f.id)),...fill])visit(field);
 return order;
}
export function resolvedFieldValue(f,task) {
  let value=task.values?.[f.source];
  if(f.enumMap&&value!==undefined&&value!==null){
    if(!Object.hasOwn(f.enumMap,value))throw Error('UNMAPPED_ENUM_VALUE');
    value=f.enumMap[value];
  }
  if(f.ongoingSource&&task.values?.[f.ongoingSource]===true)value=task.dateRepresentations?.[f.id]?.value||'至今';
  return f.kind==='date'?projectDateValue(value,f.precision):value;
}

function inputSnapshot(template,task){
  const keys=[...new Set(template.pages.flatMap(p=>p.fields.flatMap(f=>[f.source,f.when?.source,f.ongoingSource,...(f.compose?.sources||[])])).filter(Boolean))].sort();
  const values=Object.fromEntries(keys.map(k=>[k,task.values?.[k]??null]));
  const sources=Object.fromEntries(keys.filter(k=>task.sources?.[k]).map(k=>[k,task.sources[k]]));
  const refs=[...new Set(template.pages.flatMap(p=>p.fields).filter(f=>f.kind==='file').map(f=>task.values?.[f.source]).filter(v=>v!=null))].sort();
  return json({companyId:task.companyId,pageUrl:task.pageUrl,templateHash:task.templateHash,values,sources,omissions:task.omissions||{},files:Object.fromEntries(refs.map(ref=>[ref,task.files?.[ref]??null])),contentPolicy:task.contentPolicy||null,materialContext:task.materialContext||null,dateRepresentations:task.dateRepresentations||{},profileFillContext:task.profileFillContext||null});
}

async function validateFile(ref,files){
  const file=files?.[ref];
  if(!file||!Array.isArray(file.paths)||!file.paths.length||!Array.isArray(file.displayNames)||!Array.isArray(file.sha256)||file.paths.length!==file.displayNames.length||file.paths.length!==file.sha256.length)throw Error('INVALID_PREFLIGHT_FILE_REFERENCE');
  for(const [i,p]of file.paths.entries()){
    if(typeof p!=='string'||!p.startsWith('/')||typeof file.displayNames[i]!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256[i]))throw Error('INVALID_PREFLIGHT_FILE_REFERENCE');
    let bytes;try{bytes=await readFile(p);}catch{throw Error('PREFLIGHT_FILE_UNAVAILABLE');}
    if(!bytes.length||createHash('sha256').update(bytes).digest('hex')!==file.sha256[i])throw Error('PREFLIGHT_FILE_HASH_MISMATCH');
  }
}

// Pure form compilation plus local-file checks; never acquires a browser page.
// All fields (including inactive branches and unanswered optional fields) retain
// their position, source, type, action, constraints and readback specification.
export async function compileExecutionPlan(template,task){
  assertContentPolicy(task.values,task.contentPolicy);assertApplicationText(task.values);
  const pages=[],counts={fill:0,observe:0,needs_user:0,omitted:0,user_only:0,authorized_profile:0,inactive:0};
  const materialCoverage=materialAudit(template.pages.flatMap(p=>p.fields),task);
  const checkedFiles=new Set();
  for(const page of template.pages){
    const fields=[];
    for(const f of page.fields){
      validateControlContract(f);
      const inactive=!!f.when&&task.values?.[f.when.source]!==f.when.equals;
      let value;
      if(!inactive){
        const raw=task.values?.[f.source];
        if(f.choiceResolution&&raw!=null&&JSON.stringify(raw)!==JSON.stringify(f.choiceResolution.sourceValue))throw Error('CHOICE_RESOLUTION_STALE');
        if(!f.enumMap&&raw!==undefined&&raw!==null&&!matchesValueType(raw,f.control.valueType))throw Error('PROFILE_CONTROL_VALUE_TYPE_MISMATCH');
        if(f.ongoingSource&&task.values?.[f.ongoingSource]!=null&&typeof task.values[f.ongoingSource]!=='boolean')throw Error('ONGOING_VALUE_MUST_BE_BOOLEAN');
        value=resolvedFieldValue(f,task);
        if(value!==undefined&&value!==null){
          if(!matchesValueType(value,f.control.valueType))throw Error('PRESENTATION_CONTROL_VALUE_TYPE_MISMATCH');
          if(f.kind==='date'&&!(value==='至今'&&f.ongoingSource)&&!validDate(value,f.precision))throw Error('INVALID_PREFLIGHT_DATE');
          if(f.kind==='choice'&&(f.control.valueType==='string[]'?(!Array.isArray(value)||new Set(value).size!==value.length||value.some(v=>!f.control.options.includes(v))||f.required&&!value.length):!f.control.options.includes(value))){const error=Error('VALUE_OUTSIDE_CAPTURED_OPTIONS');error.details={fieldId:f.id,source:f.source,kind:f.kind,label:f.label};throw error;}
          if(typeof value==='string'&&!value.trim())throw Error('EMPTY_KNOWN_VALUE');
          if(f.kind==='file'&&!checkedFiles.has(value)){await validateFile(value,task.files);checkedFiles.add(value);}
        }
      }
      const required=effectiveRequired(f,task),omission=task.omissions?.[f.id];
      if(required&&omission)throw Error('REQUIRED_FIELD_CANNOT_BE_OMITTED');
      if(omission&&(!['confirmed_absent','user_declined','not_applicable'].includes(omission.kind)||typeof omission.evidence!=='string'||!omission.evidence.trim()))throw Error('INVALID_PLAN_OMISSION');
      if(omission&&value!=null)throw Error('OMISSION_WITH_PLANNED_VALUE');
      const authorized=task.profileFillContext?.fields?.some(field=>field.fieldId===f.id);
      const disposition=inactive?'inactive':f.userOnly?(authorized?'authorized_profile':'user_only'):value==null?(!required&&omission?'omitted':'needs_user'):f.readonly?'observe':'fill';
      counts[disposition]++;
      fields.push(json({...f,effectiveRequired:required,businessRequired:materialCoverage.requirements.some(r=>r.fieldId===f.id),value,disposition}));
    }
    // Pair only inputs captured inside the same real range widget. Values are
    // resolved from this plan's peer field, never stored in reusable templates.
    for(const f of fields)for(const action of f.actions||[])if(action.method==='ant_day'&&action.rangePeerSelector){
      const peers=fields.filter(p=>p.id!==f.id&&p.kind==='date'&&p.read.selector===action.rangePeerSelector);
      if(peers.length!==1||![0,1].includes(action.rangeIndex))throw Error('DATE_RANGE_PEER_MAPPING_REQUIRED');
      const peer=peers[0],back=peer.actions?.find(a=>a.method==='ant_day'&&a.rangePeerSelector===f.read.selector);
      if(!back||back.rangeIndex===action.rangeIndex)throw Error('DATE_RANGE_PEER_MAPPING_REQUIRED');
      if(f.disposition==='fill'){
        if(!['fill','observe'].includes(peer.disposition)||!validDate(peer.value,'day'))throw Error('DATE_RANGE_PEER_VALUE_REQUIRED');
        const pair=action.rangeIndex===0?[f.value,peer.value]:[peer.value,f.value];
        if(pair[0]>pair[1])throw Error('DATE_RANGE_ORDER_INVALID');
        action.rangePeerValue=peer.value;action.rangePeerFieldId=peer.id;
      }
    }
    const writable=fields.filter(f=>f.disposition==='fill');
    pages.push({pathPrefix:page.pathPrefix,fields,
      executionOrder:[{stage:'upload',fieldIds:writable.filter(f=>f.kind==='file').map(f=>f.id)},
        {stage:'prepare_groups',fieldIds:writable.filter(f=>f.prepareBeforeGroups).map(f=>f.id)},
        {stage:'ensure_groups',groups:page.groups||[]},
        {stage:'fill',fieldIds:orderedFillIds(fields,materialCoverage.requirements)},
        {stage:'observe_and_verify',fieldIds:fields.filter(f=>f.disposition!=='inactive').map(f=>f.id)}],
      expected:compileExpected(page,task)});
  }
  // Captured/mapped does not mean construction is complete. Preserve explicit
  // failures in the frozen plan so every entry path rejects them before I/O.
  const constructionBlockers=[...new Set([...templateConstructionIssues(template).map(x=>x.reason),...materialCoverage.blockers])];
  for(const f of template.pages.flatMap(p=>p.fields))if(f.kind==='date'&&f.ongoingSource&&task.values?.[f.ongoingSource]===true){
   const representation=task.dateRepresentations?.[f.id];
   if(f.dateRepresentation&&(!representation||representation.source!==f.dateRepresentation.source))constructionBlockers.push('DATE_REPRESENTATION_AUTHORIZATION_CHANGED');
   if(!representation&&f.actions?.some(a=>a.method==='ant_day'&&!a.ongoingLabel))constructionBlockers.push('ONGOING_DATE_OPTION_REQUIRED');
  }
  const globalPositional = selector => typeof selector==='string' && /^\s*(?:html\s*>\s*)?body\s*>/i.test(selector) && /:nth-(?:of-type|child)\(/.test(selector);
  const unstableFields=template.pages.flatMap(p=>p.fields).filter(f=>!f.userOnly&&!f.readonly&&[f.read?.selector,f.read?.selectedSelector,...(f.inventorySelectors||[]),...(f.actions||[]).flatMap(a=>[a.selector,a.labelSelector,a.openSelector])].some(globalPositional)).map(f=>f.id);
  if(unstableFields.length)constructionBlockers.push('PAGE_GLOBAL_POSITIONAL_LOCATORS');
  if(template.pages.some(p=>p.fields.some(f=>f.prepareBeforeGroups)))constructionBlockers.push('PRE_GROUP_WRITES_REQUIRE_REBUILD');
  if(template.coverage?.allConditionalBranchesVerified!==true)constructionBlockers.push('CONDITIONAL_BRANCHES_NOT_VERIFIED');
  if(template.coverage?.allControlsMapped!==true)constructionBlockers.push('CONTROLS_NOT_FULLY_MAPPED');
  if(template.coverage?.allDriversSupported!==true)constructionBlockers.push('CONTROL_DRIVERS_NOT_SUPPORTED');
  const body=json({schemaVersion:1,compilerVersion:3,companyId:task.companyId,pageUrl:task.pageUrl,templateHash:task.templateHash,inputHash:digest(inputSnapshot(template,task)),files:inputSnapshot(template,task).files,profileFillContext:task.profileFillContext||null,pages,counts,materialCoverage,constructionBlockers,unstableFields,readyForExecution:constructionBlockers.length===0&&counts.needs_user===0,allKnown:counts.needs_user===0&&counts.user_only===0});
  const planHash=digest(body);
  return {id:randomUUID(),createdAt:new Date().toISOString(),...body,planHash};
}

export async function assertPreparedPlan(prepared,template,task,authorization,{scope='full'}={}){
  if(!['full','authorized_profile_fields'].includes(scope))throw Error('INVALID_EXECUTION_SCOPE');
  if(!prepared||!task.planId||!task.planHash)throw Error('PREPARED_PLAN_REQUIRED');
  const {id,createdAt,planHash,...body}=prepared;
  if(id!==task.planId||planHash!==task.planHash||digest(body)!==planHash)throw Error('PREPARED_PLAN_HASH_MISMATCH');
  if(prepared.companyId!==task.companyId||prepared.pageUrl!==task.pageUrl||prepared.templateHash!==task.templateHash||prepared.compilerVersion!==3)throw Error('PREPARED_PLAN_IDENTITY_CHANGED');
  if(prepared.inputHash!==digest(inputSnapshot(template,task)))throw Error('PREPARED_PLAN_INPUTS_CHANGED');
  // Recompile before any browser operation to reject corrupted plan bodies and
  // changed file bytes; deterministic values must still match the frozen plan.
  const current=await compileExecutionPlan(template,task);
  if(current.planHash!==planHash)throw Error('PREPARED_PLAN_CONTENT_CHANGED');
  if(prepared.constructionBlockers.length)throw Error('FORM_CONSTRUCTION_INCOMPLETE');
  if(prepared.counts.needs_user&&!authorization.allowPartialPreparation)throw Error('PROFILE_PREPARATION_INCOMPLETE');
  if(scope==='authorized_profile_fields'){
    const ids=new Set(prepared.profileFillContext?.fields?.map(field=>field.fieldId)||[]),fields=prepared.pages.flatMap(page=>page.fields).filter(field=>ids.has(field.id));
    if(!ids.size||fields.length!==ids.size||fields.some(field=>field.disposition!=='authorized_profile'||field.kind!=='text'||!field.userOnly))throw Error('AUTHORIZED_PROFILE_EXECUTION_SCOPE_INVALID');
    return prepared;
  }
  for(const f of prepared.pages.flatMap(p=>p.fields).filter(f=>f.disposition==='fill')){
    if(f.sensitive&&!authorization.sensitiveFields)throw Error('SENSITIVE_FIELD_AUTHORIZATION_REQUIRED');
    if(f.kind==='file'&&!authorization.uploads)throw Error('UPLOAD_AUTHORIZATION_REQUIRED');
  }
  return prepared;
}
