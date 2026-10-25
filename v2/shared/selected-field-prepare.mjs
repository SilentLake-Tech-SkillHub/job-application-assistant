import {randomUUID} from 'node:crypto';
import {hash,compare,canContinueAfterUnverifiedSelection,canContinueAfterRecoveredControl} from './engine.mjs';
import {liveControls} from './control-context.mjs';
import {controlContractChanges} from './control-contract.mjs';
import {matchesRole} from './role-identity.mjs';
import {validateControlContract} from './value-contract.mjs';
import {verifyForm} from './verifier.mjs';
import {safeControlErrorDetails} from './control-error-details.mjs';
import {saveSearchableCommit,searchableWitnessScope} from './searchable-commit.mjs';

const code=error=>/^[A-Z_]+(?::[a-z0-9_-]+)?$/.test(error?.message)?error.message:'SELECTED_FIELD_OPERATION_FAILED';
const assertObservation=(observation,task,plan)=>{
 if(observation?.source!=='live_dom'||observation.pageUrl!==task.pageUrl||!matchesRole(plan,observation))throw Error('PAGE_OR_ROLE_IDENTITY_CHANGED');
 const age=Date.now()-Date.parse(observation.readAt);
 if(!Number.isFinite(age)||age < -5000||age>60000)throw Error('STALE_OR_INVALID_OBSERVATION');
};

// The caller owns the company lease, current bound role and full plan assertion.
// This helper accepts only field IDs; every value and action comes from that plan.
export async function prepareSelectedFields({store,page,task,template,prepared,fieldIds}){
 if(!Array.isArray(fieldIds)||!fieldIds.length||fieldIds.some(id=>typeof id!=='string'||!id)||new Set(fieldIds).size!==fieldIds.length)throw Error('SELECTED_FIELD_IDS_REQUIRED');
 if(!prepared||prepared.companyId!==task.companyId||prepared.pageUrl!==task.pageUrl||prepared.templateHash!==task.templateHash||task.templateHash!==hash(template)||prepared.id!==task.planId||prepared.planHash!==task.planHash)throw Error('SELECTED_FIELD_PLAN_SCOPE_CHANGED');
 const pages=template.pages.map((plan,index)=>({plan,compiled:prepared.pages?.[index]})).filter(({plan})=>new URL(task.pageUrl).pathname.startsWith(plan.pathPrefix));
 if(pages.length!==1)throw Error('AMBIGUOUS_SELECTED_FIELD_PAGE');
 const {plan,compiled}=pages[0];
 if(!compiled||compiled.pathPrefix!==plan.pathPrefix||!Array.isArray(compiled.fields))throw Error('SELECTED_FIELD_PLAN_SCOPE_CHANGED');
 const selected=fieldIds.map(id=>{
  const fields=compiled.fields.filter(f=>f.id===id),originals=plan.fields.filter(f=>f.id===id);
  if(fields.length!==1||originals.length!==1)throw Error('SELECTED_FIELD_NOT_IN_PLAN');
  const f=fields[0],original=originals[0];
  if(f.source!==original.source||f.kind!==original.kind||f.disposition!=='fill'||!['text','choice','date'].includes(f.kind)||f.userOnly||f.sensitive||f.readonly||!f.actions?.length||original.userOnly||original.sensitive||original.readonly)throw Error('SELECTED_FIELD_NOT_WRITABLE');
  validateControlContract(f);
  return f;
 });
 for(const f of selected)for(const action of f.actions)if(action.rangePeerSelector){
  const peers=compiled.fields.filter(peer=>peer.id!==f.id&&peer.read?.selector===action.rangePeerSelector);
  if(peers.length!==1||!fieldIds.includes(peers[0].id)||action.rangePeerFieldId!==peers[0].id||compare(action.rangePeerValue,peers[0].value)!=='match')throw Error('SELECTED_FIELD_RANGE_SCOPE_REQUIRED');
 }
 const fillOrder=compiled.executionOrder?.find(step=>step.stage==='fill')?.fieldIds;
 if(!Array.isArray(fillOrder)||new Set(fillOrder).size!==fillOrder.length||selected.some(f=>!fillOrder.includes(f.id)))throw Error('SELECTED_FIELD_EXECUTION_ORDER_REQUIRED');
 const ordered=fillOrder.filter(id=>fieldIds.includes(id)).map(id=>selected.find(f=>f.id===id));
 const selectionHash=hash({planHash:prepared.planHash,fieldIds:ordered.map(f=>f.id)});
 const run={id:randomUUID(),operation:'selected_field_prepare',companyId:task.companyId,roleId:task.roleId||null,pageUrl:task.pageUrl,templateHash:task.templateHash,planHash:prepared.planHash,selectionHash,fieldIds:ordered.map(f=>f.id),startedAt:new Date().toISOString(),status:'running',fields:[],actions:[],fullFormVerified:false,submission:'not_performed'};
 const checkpoint=()=>store.put('runs',run.id,run);
 const observe=async fields=>{const o=await page.observe({...plan,fields});assertObservation(o,task,plan);return o;};
 const inventory=async()=>{const current=await liveControls(page,plan);if(controlContractChanges(plan,current).length)throw Error('FORM_CONTROL_CONTRACT_CHANGED');return current;};
 const unverifiedSources=new Set();let activeField;
 await checkpoint();
 try{
  await inventory();await observe([]);
  for(const f of ordered){
   activeField={id:f.id,source:f.source,kind:f.kind};
   if(f.when){
    if(unverifiedSources.has(f.when.source)){unverifiedSources.add(f.source);run.fields.push({id:f.id,status:'blocked_dependency',reason:'UNVERIFIED_CONTROL_DEPENDENCY'});await checkpoint();continue;}
    const parents=compiled.fields.filter(parent=>parent.source===f.when.source);
    if(parents.length!==1||parents[0].when||parents[0].disposition!=='fill'||compare(parents[0].value,f.when.equals)!=='match')throw Error('SELECTED_FIELD_DEPENDENCY_NOT_VERIFIED');
    const parent=parents[0],observation=await observe([parent]),expected=compiled.expected?.fields?.find(item=>item.id===parent.id);
    if(!expected)throw Error('SELECTED_FIELD_DEPENDENCY_NOT_VERIFIED');
    const proof=verifyForm({pageUrl:task.pageUrl,roleTitle:plan.roleTitle,...(plan.roleIdentity?{roleIdentity:plan.roleIdentity}:{}),...(plan.rolePrefix!==undefined?{rolePrefix:plan.rolePrefix,roleSelector:plan.roleSelector}:{}),fields:[expected]}, {...observation,inventoryIds:[parent.id]});
    if(proof.status!=='verified')throw Error('SELECTED_FIELD_DEPENDENCY_NOT_VERIFIED');
   }
   const current=(await observe([f])).fields?.[f.id];
   if(!current?.present)throw Error('SELECTED_FIELD_NOT_PRESENT');
   if(f.kind==='text'&&f.control.type==='text'&&!current.errors?.length&&compare(current.value,f.value)==='match'){
    run.fields.push({id:f.id,status:'matching_current_value'});await checkpoint();continue;
   }
   try{
    for(const [index,action] of f.actions.entries()){
     await inventory();await observe([f]);
     const attempt={fieldId:f.id,index,method:action.method,status:'attempt_started'};run.actions.push(attempt);await checkpoint();
     const result=await page.act(f.control.type==='searchable_text'?{...action,witnessScope:searchableWitnessScope(task,f)}:action,f.value,{});
     if(f.control.type==='searchable_text')await saveSearchableCommit(store,task,f,result);
     attempt.status='action_returned';await checkpoint();
    }
    const after=(await observe([f])).fields?.[f.id];
    if(!after?.present||after.errors?.length||compare(after.value,f.value)!=='match'){
     unverifiedSources.add(f.source);run.fields.push({id:f.id,status:'unverified',reason:after?.errors?.length?'FIELD_VALIDATION_ERROR':!after?.present?'FIELD_NOT_READ':'VALUE_DIFFERS'});
    }else run.fields.push({id:f.id,status:'prepared_pending_full_verification'});
   }catch(error){
    const attempt=run.actions.at(-1);if(attempt?.fieldId===f.id&&attempt.status==='attempt_started'){attempt.status='failed';attempt.errorCode=code(error);}
    const details=safeControlErrorDetails(error.details);
    if(!canContinueAfterUnverifiedSelection(error,f)&&!canContinueAfterRecoveredControl(error,f))throw error;
    unverifiedSources.add(f.source);run.fields.push({id:f.id,status:'unverified',reason:code(error),...(details?{errorDetails:details}:{})});
   }
   await checkpoint();
  }
  run.status=run.fields.some(f=>['unverified','blocked_dependency'].includes(f.status))?'needs_attention':'prepared';
 }catch(error){run.status='needs_attention';run.errorCode=code(error);if(activeField)run.failedField=activeField;const details=safeControlErrorDetails(error.details);if(details)run.errorDetails=details;}
 run.finishedAt=new Date().toISOString();await checkpoint();return run;
}
