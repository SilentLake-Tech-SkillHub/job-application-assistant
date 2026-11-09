import {safeControlErrorDetails} from './control-error-details.mjs';
import {resolvedFieldValue} from './execution-plan.mjs';
import {choiceActionWithReadback} from './choice-actions.mjs';
const unrestored=details=>details?.phase==='browser_operation'&&/^choice_\w+_unrestored$/.test(details.step);
export async function verifyDropdownSelections(page,plan,task){
 const proofs={};
 for(const field of plan.fields||[]){
  if(field.control?.type!=='dropdown'||field.read?.nativeSelect||field.userOnly||field.readonly||field.when&&task.values?.[field.when.source]!==field.when.equals)continue;
  const value=resolvedFieldValue(field,task);if(value==null)continue;
  const action=field.actions?.find(a=>['dropdown','ud_dropdown','ant_dropdown','phoenix_dropdown'].includes(a.method));
  if(!action){proofs[field.id]={status:'failed',reason:'CHOICE_VERIFICATION_DRIVER_REQUIRED'};continue;}
  try{const result=await page.act(choiceActionWithReadback({...action,method:action.method+'_verify'},field.read?.selectedSelector),value,{});proofs[field.id]=result.selectionProof?{status:'verified',...result.selectionProof}:{status:'failed',reason:'CHOICE_SELECTION_PROOF_REQUIRED'};}
  catch(e){
   const details=safeControlErrorDetails(e.details);
   proofs[field.id]={status:'failed',reason:/^[A-Z_]+$/.test(e.message)?e.message:'CHOICE_SELECTION_VERIFICATION_FAILED',errorDetails:details};
   if(unrestored(details))break;
  }
 }
 return proofs;
}
export const choiceMenuUnrestored=proofs=>Object.values(proofs).some(proof=>unrestored(proof.errorDetails));
export function attachChoiceProofs(observation,proofs){for(const [id,proof]of Object.entries(proofs))if(observation.fields?.[id])observation.fields[id].selectionProof=proof;return observation;}
