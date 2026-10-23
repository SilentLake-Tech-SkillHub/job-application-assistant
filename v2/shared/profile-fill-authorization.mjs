import {createHash} from 'node:crypto';
import {humanActionReason} from './field-policy.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const supportedSources=new Set(['identity.idCard.number']);
export function authorizedProfileContext(profile,template,{materialContext,companyId,roleId,pageUrl,officialOrigin}={}){
 const policy=profile.policy?.profileFillAuthorization;
 if(policy?.scope!=='global'||policy.revoked===true)return null;
 if(policy.destinations!=='confirmed_official_recruiting_roles'||profile.sources?.[policy.sourceId]?.kind!=='user_reply')throw Error('PROFILE_FILL_USER_AUTHORIZATION_REQUIRED');
 if(!materialContext?.batchId||!materialContext.contentSha256||materialContext.companyId!==companyId||materialContext.roleId!==roleId||!officialOrigin||new URL(pageUrl).origin!==officialOrigin)throw Error('PROFILE_FILL_CONFIRMED_ROLE_REQUIRED');
 const fields=[];
 for(const field of template.pages.flatMap(page=>page.fields)){
  const label=field.inventoryLabel||field.label||'';
  if(humanActionReason(field)!=='sensitive_identity'||field.kind!=='text'||/护照|银行卡|passport|bank/i.test(label))continue;
  const explicit=/身份证|national.?id/i.test(label),generic=/证件号|identity.?number|document.?number/i.test(label);
  if(!explicit&&!generic)continue;
  const type=template.pages.flatMap(page=>page.fields).find(f=>f.source==='identity.idCard.type'&&f.kind==='choice'),typeFact=profile.facts?.['identity.idCard.type'];
  let documentTypeGuard=null;
  if(type&&typeFact?.status==='known'&&/^(居民身份证|身份证|中国居民身份证)$/.test(typeFact.value)){
   const expected=type.enumMap?type.enumMap[typeFact.value]:typeFact.value;
   if(expected)documentTypeGuard={fieldId:type.id,read:type.read,expected,sourceHash:digest(typeFact)};
  }
  if(generic&&!documentTypeGuard)continue;
  const source='identity.idCard.number',fact=profile.facts?.[source];
  if(!supportedSources.has(source)||!policy.sensitiveSources?.includes(source)||fact?.status!=='known')continue;
  if(typeof fact.value!=='string'||!fact.value.trim()||!fact.sourceIds?.length||fact.sourceIds.some(id=>!profile.sources[id]))throw Error('SOURCED_PROFILE_IDENTITY_REQUIRED');
  fields.push({fieldId:field.id,source,sourceHash:digest({source,fact}),documentTypeGuard,action:{method:'fill',selector:field.read.selector},read:{selector:field.read.selector,kind:'value'}});
 }
 if(!fields.length)return null;
 const body={schemaVersion:1,scope:'global',companyId,roleId,pageUrl,officialOrigin,templateHash:digest(template),batchId:materialContext.batchId,contentSha256:materialContext.contentSha256,policyHash:digest(policy),authorizationSourceId:policy.sourceId,fields};
 return {...body,contextHash:digest(body)};
}
// Expected values remain in the existing private profile, never in plans,
// observations, tool results, screenshots or duplicate fact records.
export async function applyAuthorizedProfileFields({page,profile,template,scope,expected,prepare=false}){
 const current=authorizedProfileContext(profile,template,scope);
 if(!expected&&!current)return {};
 if(!current||!expected||current.contextHash!==expected.contextHash)throw Error('PROFILE_FILL_AUTHORIZATION_OR_SOURCE_CHANGED');
 const proofs={};
 for(const field of current.fields){
  if(field.documentTypeGuard){const guard=field.documentTypeGuard,r=await page.observe({fields:[{id:guard.fieldId,kind:'choice',read:guard.read}]}),actual=r.fields?.[guard.fieldId];if(actual?.present!==true||actual.selected!==true||actual.value!==guard.expected||actual.errors?.length||guard.read.requireDisabled&&actual.disabled!==true)throw Error('PROFILE_DOCUMENT_TYPE_NOT_VERIFIED');}
  const value=profile.facts[field.source].value;
  const observe=async()=>{const r=await page.observe({fields:[{id:field.fieldId,kind:'text',sensitive:true,read:field.read}]});return r.fields?.[field.fieldId];};
  let first=await observe();
  if(first?.present!==true)throw Error('PROFILE_FILL_TARGET_NOT_PRESENT');
  if(prepare&&(first.value!==value||first.errors?.length)){await page.act(field.action,value,{});first=await observe();}
  const second=await observe(),match=first?.present===true&&second?.present===true&&!first.errors?.length&&!second.errors?.length&&first.value===value&&second.value===value;
  proofs[field.fieldId]={status:match?'verified':'failed',reason:match?null:'AUTHORIZED_PROFILE_VALUE_MISMATCH',contextHash:current.contextHash,sourceHash:field.sourceHash,readbackStable:first?.value===second?.value};
 }
 return proofs;
}
export function attachProfileFillProofs(observation,proofs){for(const [id,proof]of Object.entries(proofs||{}))if(observation.fields?.[id])observation.fields[id].profileFillProof=proof;return observation;}
