import {createHash} from 'node:crypto';import {resolvedFieldValue} from './execution-plan.mjs';
import {safeControlErrorDetails} from './control-error-details.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key=(task,field)=>'searchable-'+hash({companyId:task.companyId,roleId:task.roleId,pageUrl:task.pageUrl,fieldId:field.id}).slice(0,40);
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
function assertCurrentProof(read,mode,value,expectedId){
 if(read?.value!==value||read.blurConfirmed!==true||read.readbackStable!==true)throw Error('SEARCHABLE_CURRENT_COMMIT_NOT_VERIFIED');
 if(mode==='explicit_custom_value'){
  const proof=read.customAcceptance;
  if(proof?.verified!==true||proof.label!==value||!nonempty(proof.websiteEvidence)||proof.websiteEvidence!==read.warning||read.websiteId)throw Error('AUTOCOMPLETE_CURRENT_CUSTOM_ACCEPTANCE_REQUIRED');
  return proof;
 }
 if(mode!=='actual_option_click'||read.warning)throw Error('SEARCHABLE_CURRENT_COMMIT_NOT_VERIFIED');
 const proof=read.currentSelection;
 if(proof?.verified!==true||proof.label!==value||!['entity_id','selected_option'].includes(proof.kind)||proof.kind==='selected_option'&&proof.selected!==true)throw Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');
 if(proof.kind==='entity_id'&&(!nonempty(proof.value)||!read.websiteId||read.websiteId.value!==proof.value||proof.websiteId?.value!==proof.value))throw Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');
 if(expectedId!=null&&proof.value!==expectedId)throw Error('AUTOCOMPLETE_SELECTED_ID_MISMATCH');
 return proof;
}
export async function saveSearchableCommit(store,task,field,result){
 const proof=result?.searchableCommit;
 if(!proof||proof.optionLabel!==field.value||!(proof.mode==='actual_option_click'&&proof.optionClicked===true||proof.mode==='explicit_custom_value'&&proof.optionClicked===false&&nonempty(proof.customValueEvidence)))throw Error('SEARCHABLE_COMMIT_ACTION_PROOF_REQUIRED');
 assertCurrentProof(proof,proof.mode,field.value,proof.optionValue);
 await store.put('runs',key(task,field),{companyId:task.companyId,roleId:task.roleId,pageUrl:task.pageUrl,fieldId:field.id,templateHash:task.templateHash,valueHash:hash(field.value),proof,readAt:new Date().toISOString()});
}
export async function verifySearchableCommits({store,page,plan,task}){
 const proofs={};
 for(const field of plan.fields.filter(f=>f.control?.type==='searchable_text'&&!f.userOnly&&(!f.when||task.values?.[f.when.source]===f.when.equals))){
  const value=resolvedFieldValue(field,task);if(value==null)continue;
  try{const saved=await store.get('runs',key(task,field)),action=field.actions.find(a=>a.method==='phoenix_autocomplete');
   if(saved.templateHash!==task.templateHash||saved.valueHash!==hash(value)||!action)throw Error('SEARCHABLE_COMMIT_SOURCE_CHANGED');
   assertCurrentProof(saved.proof,saved.proof.mode,value,saved.proof.optionValue);
   if(action.expectedOptionValue!=null&&saved.proof.optionValue!==action.expectedOptionValue)throw Error('AUTOCOMPLETE_SELECTED_ID_MISMATCH');
   const read=await page.act({...action,method:'phoenix_autocomplete_verify',expectedCommitMode:saved.proof.mode,...(saved.proof.optionValue!=null?{expectedOptionValue:saved.proof.optionValue}:{})},value,{});
   const current=assertCurrentProof(read,saved.proof.mode,value,saved.proof.optionValue);
   proofs[field.id]={status:'verified',mode:saved.proof.mode,label:value,optionValue:saved.proof.optionValue,optionClicked:saved.proof.optionClicked,blurConfirmed:true,readbackStable:true,...(saved.proof.mode==='explicit_custom_value'?{customAcceptance:current}:{currentSelection:current})};
  }catch(error){const errorDetails=safeControlErrorDetails(error.details);proofs[field.id]={status:'failed',reason:/^[A-Z_]+$/.test(error.message)?error.message:'SEARCHABLE_COMMIT_NOT_VERIFIED',...(errorDetails?{errorDetails}:{})};}
 }
 return proofs;
}
export function attachSearchableCommits(observation,proofs){for(const[id,proof]of Object.entries(proofs))if(observation.fields?.[id])observation.fields[id].searchableCommitProof=proof;return observation;}
