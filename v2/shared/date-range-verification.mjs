import {resolvedFieldValue} from './execution-plan.mjs';
export async function verifyDateRanges(page,plan,task){
 const proofs={},done=new Set();
 for(const field of plan.fields||[]){
  const action=field.actions?.find(a=>a.method==='ant_day'&&a.rangePeerSelector);
  if(!action||field.userOnly||field.when&&task.values?.[field.when.source]!==field.when.equals||done.has(field.id))continue;
  const peer=plan.fields.find(p=>p.read.selector===action.rangePeerSelector),value=resolvedFieldValue(field,task),peerValue=peer&&resolvedFieldValue(peer,task);
  if(value==null||peerValue==null)continue;
  try{
   const result=await page.act({...action,rangePeerValue:peerValue,operation:'verify'},value,{});
   if(result.rangeVerified!==true)throw Error('DATE_RANGE_SELECTION_PROOF_REQUIRED');
   for(const [f,v]of [[field,value],[peer,peerValue]]){proofs[f.id]={status:'verified',value:v,rangeVerified:true};done.add(f.id);}
  }catch(error){for(const f of [field,peer].filter(Boolean)){proofs[f.id]={status:'failed',reason:/^[A-Z_]+$/.test(error.message)?error.message:'DATE_RANGE_SELECTION_VERIFICATION_FAILED'};done.add(f.id);}}
 }
 return proofs;
}
export function attachDateRangeProofs(observation,proofs){for(const [id,proof]of Object.entries(proofs))if(observation.fields?.[id])observation.fields[id].dateRangeProof=proof;return observation;}
