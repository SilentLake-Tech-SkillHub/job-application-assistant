#!/usr/bin/env node
// 业务授权开关（主档 policy.businessAuthorization）的唯一写入口。AI 不得用编辑工具直接改主档里的这个开关。
// 1：组件执行全部需要勾选的条款、有来源的身份证号、已确认的照片来源；永久有效，跨会话、公司、条款文字修订。
// 0：组件一律不执行这些项，转为本人操作，其余字段照常；验证码/短信码和最终提交不归本开关。
// 用法：
//   node scripts/business-authorization.mjs status [--profile <主档.json>]
//   node scripts/business-authorization.mjs set --value 1|0 --quote "<用户原话>" [--profile <主档.json>]
// --profile 缺省读 RECRUITING_PROFILE_JSON。set 同时移除旧的分散授权字段，保证主档里只有这一个开关。
import {randomUUID} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {loadProfile,updateProfile} from '../shared/profile.mjs';
import {businessAuthorizationSwitch,AUTHORIZATION_SWITCH_REF} from '../shared/business-authorization.mjs';
export const LEGACY_AUTHORIZATION_KEYS=['globalAgreementAccepted','privacyAcceptanceScope','privacyAcceptanceRevoked','profileFillAuthorization','loginPrivacyAcceptances'];
export async function authorizationStatus(profileFile){
 const p=await loadProfile(profileFile),raw=p.policy?.businessAuthorization;
 return {switchValue:businessAuthorizationSwitch(p),authorizationRef:AUTHORIZATION_SWITCH_REF,updatedAt:raw?.updatedAt||null,sourceId:raw?.sourceId||null,legacyKeysPresent:LEGACY_AUTHORIZATION_KEYS.filter(k=>Object.hasOwn(p.policy||{},k))};
}
export async function setAuthorization(profileFile,{value,quote,now=()=>new Date().toISOString()}){
 if(value!==1&&value!==0)throw Error('BUSINESS_AUTHORIZATION_VALUE_MUST_BE_1_OR_0');
 if(typeof quote!=='string'||!quote.trim())throw Error('USER_QUOTE_REQUIRED');
 let out;
 await updateProfile(profileFile,p=>{
  const at=now(),sourceId='user-business-authorization-'+randomUUID();
  p.sources??={};p.sources[sourceId]={kind:'user_reply',evidence:quote.trim(),recordedAt:at};
  p.policy??={};
  const previous=businessAuthorizationSwitch(p);
  for(const key of LEGACY_AUTHORIZATION_KEYS)delete p.policy[key];
  // A stored ID number is governed by this switch; a contradictory "never store" entry is removed.
  if(Array.isArray(p.policy.forbiddenStoredValues))p.policy.forbiddenStoredValues=p.policy.forbiddenStoredValues.filter(v=>v!=='government_id_number');
  p.policy.businessAuthorization={value,sourceId,updatedAt:at};
  out={previous,switchValue:value,sourceId,updatedAt:at,authorizationRef:AUTHORIZATION_SWITCH_REF};
 });
 return out;
}
const args=process.argv.slice(2),flag=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:undefined;};
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const profileFile=flag('profile')||process.env.RECRUITING_PROFILE_JSON;
 try{
  if(!profileFile)throw Error('PROFILE_JSON_REQUIRED');
  if(args[0]==='status')console.log(JSON.stringify(await authorizationStatus(profileFile),null,1));
  else if(args[0]==='set')console.log(JSON.stringify(await setAuthorization(profileFile,{value:Number(flag('value')),quote:flag('quote')}),null,1));
  else throw Error('USAGE: status | set --value 1|0 --quote "<用户原话>"');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
