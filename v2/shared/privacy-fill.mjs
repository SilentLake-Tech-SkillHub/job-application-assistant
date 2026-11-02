import {createHash} from 'node:crypto';
import {evaluateBusinessAuthorization} from './business-authorization.mjs';
import {isAgreementCheckbox} from './field-policy.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function authorizedPrivacyContext(profile,template,{companyId,roleId,pageUrl,officialOrigin,materialContext}={}){
 const fields=[];
 for(const field of template.pages.flatMap(page=>page.fields)){
  if(field.kind!=='boolean'||field.read?.kind!=='checked')continue;
  if(!isAgreementCheckbox(field))continue;
  const decision=evaluateBusinessAuthorization(profile,{operation:'recruiting_privacy',phase:'classify',field});
  if(decision.decision==='allow')fields.push({fieldId:field.id,read:field.read,label:field.inventoryLabel||field.label,authorizationRef:decision.authorizationRef});
 }
 if(!fields.length)return null;
 const body={companyId,roleId,pageUrl,officialOrigin,batchId:materialContext?.batchId,contentSha256:materialContext?.contentSha256,templateHash:digest(template),fields};
 return {...body,contextHash:digest(body)};
}
export async function applyAuthorizedPrivacyFields({profile,template,page,scope,expected,prepare=false}){
 const current=authorizedPrivacyContext(profile,template,scope);
 if(!current&&!expected)return {};
 if(!current)throw Error('BUSINESS_AUTHORIZATION_OFF');
 if(current.contextHash!==expected?.contextHash)throw Error('PRIVACY_RUNTIME_CONTEXT_REFRESH_REQUIRED');
 const proofs={};
 for(const field of current.fields){
  // The switch covers every agreement checkbox regardless of wording, so the policy text is
  // not opened or read; only the live target and the committed tick are verified.
  const actual=await page.observe({operation:'recruiting_disclosure',selector:field.read.selector});
  const liveLabel=actual?.checkboxLabel||actual?.text||field.label;
  const confirmedRole=!!scope.materialContext?.batchId&&scope.materialContext.companyId===scope.companyId&&scope.materialContext.roleId===scope.roleId;
  const authorization=evaluateBusinessAuthorization(profile,{operation:'recruiting_privacy',officialOrigin:scope.officialOrigin,pageUrl:scope.pageUrl,confirmedRole,companyId:scope.companyId,field,disclosure:{title:liveLabel,text:actual?.text||''}});
  if(authorization.decision!=='allow')throw Error(authorization.reason);
  if(actual?.present!==true||actual.pageUrl!==scope.pageUrl||!actual.selector)throw Error('PRIVACY_CURRENT_TARGET_REQUIRED');
  if(prepare&&actual.checked!==true)await page.act({method:'check',selector:field.read.selector},true,{});
  const read=()=>page.observe({fields:[{id:field.fieldId,kind:'boolean',read:field.read}]}),first=await read(),second=await read();
  const a=first.fields?.[field.fieldId],b=second.fields?.[field.fieldId],match=first.pageUrl===scope.pageUrl&&second.pageUrl===scope.pageUrl&&a?.present===true&&b?.present===true&&a.value===true&&b.value===true&&!a.errors?.length&&!b.errors?.length;
  proofs[field.fieldId]={status:match?'verified':'failed',reason:match?null:'PRIVACY_CHECKBOX_NOT_COMMITTED',contextHash:current.contextHash,authorizationRef:authorization.authorizationRef,readbackStable:a?.value===b?.value};
 }
 return proofs;
}
