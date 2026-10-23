import {resolvedFieldValue} from './execution-plan.mjs';
export async function verifyDropdownSelections(page,plan,task){
 const proofs={};
 for(const field of plan.fields||[]){
  if(field.control?.type!=='dropdown'||field.read?.nativeSelect||field.userOnly||field.readonly||field.when&&task.values?.[field.when.source]!==field.when.equals)continue;
  const value=resolvedFieldValue(field,task);if(value==null)continue;
  const action=field.actions?.find(a=>['dropdown','ud_dropdown','ant_dropdown','phoenix_dropdown'].includes(a.method));
  if(!action){proofs[field.id]={status:'failed',reason:'CHOICE_VERIFICATION_DRIVER_REQUIRED'};continue;}
  try{const result=await page.act({...action,method:action.method+'_verify'},value,{});proofs[field.id]=result.selectionProof?{status:'verified',...result.selectionProof}:{status:'failed',reason:'CHOICE_SELECTION_PROOF_REQUIRED'};}
  catch(e){proofs[field.id]={status:'failed',reason:/^[A-Z_]+$/.test(e.message)?e.message:'CHOICE_SELECTION_VERIFICATION_FAILED'};}
 }
 return proofs;
}
export function attachChoiceProofs(observation,proofs){for(const [id,proof]of Object.entries(proofs))if(observation.fields?.[id])observation.fields[id].selectionProof=proof;return observation;}
