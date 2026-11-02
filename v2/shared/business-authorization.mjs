import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const PROTECTED_IDENTITY_SOURCE='identity.idCard.number';
export const AUTHORIZATION_SWITCH_REF='profile.policy.businessAuthorization';
const identityType=value=>typeof value==='string'&&/^(居民身份证|身份证|中国居民身份证)$/.test(value);
// One durable user switch decides every business permission of this component:
// all agreement/declaration checkboxes on confirmed official recruiting forms,
// the sourced ID-card number and the confirmed photo source.
//   1    -> the component executes them, permanently, across sessions/companies/text revisions.
//   0    -> the component never executes them; they stay user-operated, other fields continue.
//   none -> the user has not decided yet; treated as not executed and reported once.
// Only scripts/business-authorization.mjs writes the switch. Captcha/SMS codes and
// the final submit are not business permissions and keep their own gates.
export function businessAuthorizationSwitch(profile){
 const raw=profile?.policy?.businessAuthorization,value=raw&&typeof raw==='object'?raw.value:raw;
 return value===1||value===0?value:null;
}
const result=(decision,reason,switchValue,extra={})=>({decision,reason,switchValue,authorizationRef:AUTHORIZATION_SWITCH_REF,authorizationSource:'business_authorization_switch',scope:'confirmed_official_recruiting_roles',permanent:switchValue!==null,...extra});
// Kept for reporting only. The switch does not depend on how a disclosure is worded.
export function recruitingDisclosureCategory(){return 'recruiting_agreement';}
function executionScope(options){
 if(options.phase==='classify')return null;
 const {officialOrigin,pageUrl,confirmedRole}=options;
 try{const origin=new URL(officialOrigin);if(origin.protocol!=='https:'||origin.origin!==officialOrigin||origin.username||origin.password)return 'OFFICIAL_RECRUITING_ORIGIN_REQUIRED';if(pageUrl&&new URL(pageUrl).origin!==officialOrigin)return 'OFFICIAL_RECRUITING_ORIGIN_REQUIRED';}catch{return 'OFFICIAL_RECRUITING_ORIGIN_REQUIRED';}
 if(!(confirmedRole===true||confirmedRole?.confirmed===true||confirmedRole?.companyId&&confirmedRole?.roleId))return 'CONFIRMED_RECRUITING_ROLE_REQUIRED';
 return null;
}
const OPERATIONS=['recruiting_privacy','identity_fill','photo_source'];
export function evaluateBusinessAuthorization(profile,options={}){
 const operation=options.operation,field=options.field,fields=options.fields||[];
 if(!OPERATIONS.includes(operation))return result('out_of_scope','BUSINESS_OPERATION_NOT_AUTHORIZED',null);
 const value=businessAuthorizationSwitch(profile);
 if(value===0)return result('revoked','BUSINESS_AUTHORIZATION_OFF',0);
 if(value===null)return result('out_of_scope','BUSINESS_AUTHORIZATION_SWITCH_REQUIRED',null);
 // Technical scope checks are agent-owned evidence work, never a renewed permission request.
 const scopeError=executionScope(options);if(scopeError)return result('technical_pending',scopeError,1);
 if(operation!=='identity_fill'||options.permissionOnly===true)return result('allow','BUSINESS_AUTHORIZATION_ON',1,{permissionScope:'global'});
 if(!field)return result('technical_pending','IDENTITY_FIELD_EVIDENCE_REQUIRED',1);
 const label=field.inventoryLabel||field.label||'';
 // Field-shape checks keep the ID-card number out of passport/bank/code fields; they are correctness, not permission.
 if(/护照|银行卡|passport|bank|验证码|password|captcha/i.test(label)||/类型|类别|document\s*type/i.test(label)||!/身份证|national.?id|证件号|identity.?number|document.?number/i.test(label)||field.kind&&field.kind!=='text'||field.type&&field.type!=='text'&&!['tel','number'].includes(field.type))return result('out_of_scope','IDENTITY_FIELD_OUTSIDE_ID_CARD',1);
 const source=PROTECTED_IDENTITY_SOURCE,fact=profile.facts?.[source];
 if(fact?.status!=='known'||typeof fact.value!=='string'||!fact.value.trim())return result('technical_pending','IDENTITY_PROFILE_FACT_REQUIRED',1,{requiresUserInput:true});
 if(!fact.sourceIds?.length||fact.sourceIds.some(id=>!profile.sources?.[id]))return result('technical_pending','IDENTITY_PROFILE_PROVENANCE_REQUIRED',1);
 const type=fields.find(f=>f.source==='identity.idCard.type'&&f.kind==='choice'),typeFact=profile.facts?.['identity.idCard.type'];let documentTypeGuard=null;
 if(type){if(typeFact?.status!=='known'||!identityType(typeFact.value))return result('technical_pending','CURRENT_IDENTITY_DOCUMENT_TYPE_REQUIRED',1);const expected=type.enumMap?type.enumMap[typeFact.value]:typeFact.value;if(expected)documentTypeGuard={fieldId:type.id,read:type.read,expected,sourceHash:digest(typeFact)};}
 if(field.documentTypePrefix){if(!identityType(field.documentTypePrefix.label)||!field.documentTypePrefix.selector||typeFact?.status!=='known'||!identityType(typeFact.value))return result('technical_pending','CURRENT_IDENTITY_DOCUMENT_TYPE_REQUIRED',1);documentTypeGuard={fieldId:field.id+'-document-type',mode:'rendered_prefix',read:{selector:field.documentTypePrefix.selector,kind:'text'},expected:field.documentTypePrefix.label,sourceHash:digest(typeFact)};}
 if(!/身份证|national.?id/i.test(label)&&!documentTypeGuard)return result('technical_pending','CURRENT_IDENTITY_DOCUMENT_TYPE_REQUIRED',1);
 return result('allow','BUSINESS_AUTHORIZATION_ON',1,{permissionScope:'global',source,sourceHash:digest({source,fact}),documentTypeGuard});
}
