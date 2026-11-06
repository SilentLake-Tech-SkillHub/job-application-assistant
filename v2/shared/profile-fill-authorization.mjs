import {withProfileRecords,recordPlanOf} from './repeat-groups.mjs';
import {createHash} from 'node:crypto';
import {authorizedProfileField} from './authorized-profile-field.mjs';
import {evaluateBusinessAuthorization,businessAuthorizationSwitch} from './business-authorization.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function authorizedProfileContext(profile,template,{materialContext,companyId,roleId,pageUrl,officialOrigin}={}){
 template=withProfileRecords(template,recordPlanOf(profile));
 // Switch 0 or undecided: the ID field is simply not executed by the component (user-operated).
 const grant=evaluateBusinessAuthorization(profile,{operation:'identity_fill',phase:'classify',permissionOnly:true});
 if(grant.decision!=='allow')return null;
 const confirmedRole=!!materialContext?.batchId&&!!materialContext.contentSha256&&materialContext.companyId===companyId&&materialContext.roleId===roleId;
 if(evaluateBusinessAuthorization(profile,{operation:'identity_fill',permissionOnly:true,officialOrigin,pageUrl,confirmedRole}).decision!=='allow')throw Error('PROFILE_FILL_CONFIRMED_ROLE_REQUIRED');
 const fields=[],allFields=template.pages.flatMap(page=>page.fields);
 for(const field of allFields){
  const authorization=authorizedProfileField(profile,field,{fields:allFields});
  if(!authorization)continue;
  fields.push({fieldId:field.id,...authorization,action:{method:'fill',selector:field.read.selector},read:{selector:field.read.selector,kind:'value'}});
 }
 if(!fields.length)return null;
 const body={schemaVersion:1,scope:'global',companyId,roleId,pageUrl,officialOrigin,templateHash:digest(template),batchId:materialContext.batchId,contentSha256:materialContext.contentSha256,authorizationSwitch:businessAuthorizationSwitch(profile),fields};
 return {...body,contextHash:digest(body)};
}
// Expected values remain in the existing private profile, never in plans,
// observations, tool results, screenshots or duplicate fact records.
export async function applyAuthorizedProfileFields({page,profile,template,scope,expected,prepare=false}){
 const current=authorizedProfileContext(profile,template,scope);
 if(!expected&&!current)return {};
 if(!current||!expected){const grant=evaluateBusinessAuthorization(profile,{operation:'identity_fill',phase:'classify',permissionOnly:true});throw Error(grant.decision==='allow'?'PROFILE_FILL_RUNTIME_CONTEXT_REFRESH_REQUIRED':'BUSINESS_AUTHORIZATION_OFF');}
 if(current.contextHash!==expected.contextHash){const error=Error('PROFILE_FILL_RUNTIME_CONTEXT_REFRESH_REQUIRED');error.continuation={owner:'agent',requiresUser:false,shouldContinue:true,reason:'existing_permission_remains_valid_recompile_current_context'};throw error;}
 const proofs={};
 for(const field of current.fields){
  if(field.documentTypeGuard){const guard=field.documentTypeGuard,r=await page.observe({fields:[{id:guard.fieldId,kind:guard.mode==='rendered_prefix'?'text':'choice',read:guard.read}]}),actual=r.fields?.[guard.fieldId];if(actual?.present!==true||guard.mode!=='rendered_prefix'&&actual.selected!==true||actual.value!==guard.expected||actual.errors?.length||guard.read.requireDisabled&&actual.disabled!==true)throw Error('PROFILE_DOCUMENT_TYPE_NOT_VERIFIED');}
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
