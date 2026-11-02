import {reviewRoleAttachments} from './attachment-visual-review.mjs';
// Collects every uploaded attachment of this role and judges them in one model call
// (see attachment-visual-review.mjs). No download, no byte hash.
export async function attachAttachmentVisualProofs(page,observation,plan,task,store,{capture,visionReviewer}={}){
 const items=[];
 for(const field of plan.fields.filter(f=>f.kind==='file')){
  const actual=observation.fields?.[field.id],asset=task.files?.[task.values?.[field.source]];
  if(!actual||!asset)continue;
  items.push({actual,asset,scope:{companyId:task.companyId,roleId:task.roleId,taskId:task.roleQueueArgs?.taskId||task.taskId||task.applicationId||null,pageUrl:task.pageUrl,fieldId:field.id,label:field.inventoryLabel||field.label||null,selector:field.read.selector,read:field.read}});
 }
 if(!items.length)return observation;
 const proofs=await reviewRoleAttachments({store,items,page,...(capture?{capture}:{}),visionReviewer});
 for(const item of items){const proof=proofs[item.scope.fieldId];if(proof)item.actual.attachmentVisualProof=proof;}
 return observation;
}
export const attachUploadContentProofs=attachAttachmentVisualProofs;
