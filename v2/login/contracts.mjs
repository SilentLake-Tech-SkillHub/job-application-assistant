import {TaskRecords} from '../shared/task-records.mjs';
import {unstableClassTokens,ruleApplies} from '../shared/selector-stability.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {keyOK} from '../shared/ids.mjs';
export const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const safeCode=e=>/^[A-Z_]+$/.test(e?.message)?e.message:'LOGIN_OPERATION_FAILED';
export function validateCompany(c){
  if(ruleApplies(c.evidence)&&unstableClassTokens(c.account?.selector).length)throw Error('ACCOUNT_SELECTOR_UNSTABLE');
  if(c.schemaVersion!==1||!keyOK(c.companyId)||!Number.isInteger(c.version)||c.version<1)throw Error('INVALID_LOGIN_COMPANY');
  const u=new URL(c.origin);if(u.protocol!=='https:'||u.origin!==c.origin||!c.loginPath?.startsWith('/')||!c.allowedPaths?.every(p=>p.startsWith('/')))throw Error('INVALID_LOGIN_SCOPE');
  if(c.loginMethod==='user_operated'){
    if(c.success?.noApplicationSubmission!==true)throw Error('USER_LOGIN_SESSION_CONTRACT_REQUIRED');
    if(!c.evidence?.sourceUrl||new URL(c.evidence.sourceUrl).origin!==c.origin)throw Error('LOGIN_CAPTURE_EVIDENCE_REQUIRED');
    return c;
  }
  for(const k of ['root','country','countrySelected','countryOptionLabel','phone','otp','send','sendLabel','submit','submitLabel','consent','consentPresence','errors','automaticRegistrationNotice'])if(typeof c.fields?.[k]!=='string'||!c.fields[k])throw Error('INCOMPLETE_LOGIN_FIELD_CONTRACT');
  if(c.fields.submitLabel!=='登录'||c.fields.sendLabel!=='获取验证码')throw Error('LOGIN_ACTION_NOT_ALLOWED');
  if(!c.account?.selector||!c.account.source||!/^\+\d+$/.test(c.account.countryCode)||c.account.mask!=='first4_last3')throw Error('ACCOUNT_CONTRACT_REQUIRED');
  if(!c.evidence?.sourceUrl||new URL(c.evidence.sourceUrl).origin!==c.origin)throw Error('LOGIN_CAPTURE_EVIDENCE_REQUIRED');
  if(c.success.requiresLoginFormAbsent!==true||c.success.noApplicationSubmission!==true)throw Error('LOGIN_SUCCESS_CONTRACT_REQUIRED');
  if(!c.popups?.length||c.popups.some(p=>!p.selector||!p.titleSelector||!p.bodySelector||p.effect!=='dismiss_reading_only'||!p.consentIsSeparate||!['Close','知道了'].includes(p.closeLabel)))throw Error('POPUP_CONTRACT_REQUIRED');
  if(c.challenge?.maxSendAttempts!==2||c.challenge.maxOtpAttempts!==2||c.challenge.cooldownSeconds<60||c.challenge.expirySeconds>300)throw Error('INVALID_CHALLENGE_LIMITS');
  return c;
}
export const assertScope=(c,url)=>{const u=new URL(url);if(u.origin!==c.origin||!c.allowedPaths.some(p=>u.pathname.startsWith(p)))throw Error('LOGIN_PAGE_SCOPE_MISMATCH');};
export function resolveAccount(profile,c){if(c.loginMethod==='user_operated')return null;const f=profile.facts?.[c.account.source];if(f?.status!=='known'||typeof f.value!=='string'||!f.sourceIds?.length)throw Error('LOGIN_ACCOUNT_FACT_REQUIRED');const phone=f.value.replace(/\D/g,'');if(!/^1\d{10}$/.test(phone)||c.account.countryCode!=='+86')throw Error('LOGIN_ACCOUNT_TYPE_MISMATCH');return {phone,fingerprint:hash({phone,country:c.account.countryCode,sourceIds:f.sourceIds})};}
export class PrivateStore{
  constructor(root){this.root=root;this.taskRecords=new TaskRecords(root);}
  file(group,id){if(!['plans','runs','challenges','disclosures','acceptances','captures'].includes(group)||!keyOK(id,90))throw Error('INVALID_LOGIN_STORAGE_KEY');return path.join(this.root,group,id+'.json');}
  async get(group,id){const file=this.file(group,id);if(['runs','plans'].includes(group)){const value=await this.taskRecords.get(group,id);if(value!==undefined)return value;}return JSON.parse(await readFile(file,'utf8'));}
  async put(group,id,value){const file=this.file(group,id);if(await this.taskRecords.put(group,id,value))return;await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);return value;}
}
