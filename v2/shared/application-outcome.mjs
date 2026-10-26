// 投递结果回传：只写工作区 岗位交接/投递回传.json，每个岗位只保留最新一条结果（覆盖写），不留事件历史、不另存备份。
// 业务状态不在这里改：搜索端 company_store.py reverse 读取回传，生成“当前状态是X，更新状态是Y”，用户确认后才写主表。
import {readFile,writeFile,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {handoffDirFromEnv,contentSha} from './company-directory.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const nonempty=z.string().min(1);
const proof=z.object({file:nonempty,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const OUTCOME_EVENTS=['submission_confirmed','submission_uncertain','application_blocked','user_skipped','role_closed'];
// 需要用户处理、在处理前禁止重跑的结果
export const UNRESOLVED_EVENTS=['submission_uncertain','application_blocked'];
export const outcomeSchema=z.object({schemaVersion:z.literal(1),eventId:z.string().uuid(),event:z.enum(OUTCOME_EVENTS),batchId:nonempty,companyId:nonempty,roleId:nonempty,roleUrl:z.string().url(),roleTitle:nonempty,evidence:proof}).strict();
const evidenceSchema=z.object({schemaVersion:z.literal(1),event:outcomeSchema.shape.event,batchId:nonempty,companyId:nonempty,roleId:nonempty,roleUrl:z.string().url(),roleTitle:nonempty,observedAt:z.string().datetime({offset:true}),sourceUrl:z.string().url(),result:nonempty,reviewer:nonempty,artifacts:z.array(proof).min(1)}).strict();
const readProof=async p=>{const b=await readFile(p.file);if(sha(b)!==p.sha256)throw Error('OUTCOME_EVIDENCE_HASH_MISMATCH');return b;};
export const outcomeFile=dir=>path.join(dir,'投递回传.json');
export async function readOutcomes(dir){
 try{return JSON.parse(await readFile(outcomeFile(dir),'utf8'));}catch(e){if(e.code==='ENOENT')return {schemaVersion:1,roles:{}};throw e;}
}
export async function recordApplicationOutcome({outcome,handoffDir=handoffDirFromEnv()}){
 const e=outcomeSchema.parse(outcome),dir=path.resolve(handoffDir),file=outcomeFile(dir),lock=file+'.lock';let handle,tmp;
 try{handle=await open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('OUTCOME_WRITE_LOCKED');throw error;}
 try{
  const batch=JSON.parse(await readFile(path.join(dir,'投递批次.json'),'utf8'));
  if(!['已交接','进行中','等待反向评审'].includes(batch.state)||!batch.confirmation||batch.confirmation.contentSha256!==contentSha(batch))throw Error('HANDOFF_NOT_CONFIRMED');
  if(batch.batchId!==e.batchId)throw Error('OUTCOME_BATCH_MISMATCH');
  const matches=batch.companies.flatMap(c=>c['岗位'].map(r=>({companyId:c.companyId,...r}))).filter(r=>r['岗位ID']===e.roleId&&r['岗位链接']===e.roleUrl&&r['岗位名称']===e.roleTitle);
  if(matches.length!==1)throw Error('OUTCOME_ROLE_IDENTITY_MISMATCH');
  const companyId=matches[0].companyId,key=companyId+'|'+e.roleId,eventHash=sha(JSON.stringify(e));
  const out=await readOutcomes(dir),prior=out.roles[key];
  if(prior&&prior.eventId===e.eventId){
   if(prior.eventHash!==eventHash)throw Error('OUTCOME_EVENT_ID_CONFLICT');
   await readProof(e.evidence);return {status:'already_recorded',eventId:e.eventId,event:prior.event,businessStatus:'unchanged_until_user_review'};
  }
  if(prior?.event==='submission_confirmed'&&e.event!=='submission_confirmed')throw Error('OUTCOME_SUBMITTED_DOWNGRADE_FORBIDDEN');
  const evidence=evidenceSchema.parse(JSON.parse(await readProof(e.evidence)));
  for(const k of ['event','batchId','companyId','roleId','roleUrl','roleTitle'])if(evidence[k]!==e[k])throw Error('OUTCOME_EVIDENCE_IDENTITY_MISMATCH');
  const source=new URL(evidence.sourceUrl);
  if(source.origin!==new URL(e.roleUrl).origin||source.protocol!=='https:')throw Error('OUTCOME_EVIDENCE_ORIGIN_MISMATCH');
  if(Date.parse(evidence.observedAt)>Date.now()+60000)throw Error('OUTCOME_EVIDENCE_TIME_INVALID');
  for(const p of evidence.artifacts)await readProof(p);
  if(e.event==='submission_confirmed'&&evidence.result!=='official_receipt_confirmed')throw Error('OUTCOME_RECEIPT_REQUIRED');
  if(e.event==='role_closed'&&evidence.result!=='official_role_closed')throw Error('OUTCOME_ROLE_CLOSED_EVIDENCE_REQUIRED');
  out.roles[key]={eventId:e.eventId,eventHash,event:e.event,batchId:e.batchId,companyId,siteId:e.companyId,roleId:e.roleId,roleUrl:e.roleUrl,roleTitle:e.roleTitle,
   result:evidence.result,observedAt:evidence.observedAt,evidence:e.evidence,recordedAt:new Date().toISOString()};
  tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(out,null,2)+'\n',{mode:0o600});await rename(tmp,file);tmp=null;
  return {status:'recorded',eventId:e.eventId,event:e.event,businessStatus:'unchanged_until_user_review',nextStep:'company_store.py reverse'};
 }finally{if(tmp)await unlink(tmp).catch(()=>{});await handle.close();await unlink(lock).catch(()=>{});}
}

// A confirmed role link that the site redirects elsewhere is proposed back to the
// search side; the master table is changed only after the user confirms there
// (company_store.py relink-observed). One proposal per role, overwritten.
const PERSONAL_QUERY=new Set(['userid','userId','uid','token']);
export function canonicalRoleUrl(value){const u=new URL(value);for(const k of [...u.searchParams.keys()])if(PERSONAL_QUERY.has(k))u.searchParams.delete(k);u.hash=u.hash.replace(/([?&])(userId|uid|token)=[^&]*/g,'$1');return u.href;}
export async function recordLinkChange({companyId,roleId,roleUrl,roleTitle,observedUrl,evidence='entry_transition_detail_page_verified',observedAt=new Date().toISOString(),handoffDir=handoffDirFromEnv()}){
 if(!['entry_transition_detail_page_verified','derived_from_application_page'].includes(evidence))throw Error('LINK_CHANGE_EVIDENCE_INVALID');
 const role=new URL(roleUrl),observed=new URL(canonicalRoleUrl(observedUrl));
 if(observed.protocol!=='https:'||observed.origin!==role.origin)return {status:'skipped_cross_origin'};
 if(observed.href===canonicalRoleUrl(role.href))return {status:'unchanged'};
 const dir=path.resolve(handoffDir),file=outcomeFile(dir),lock=file+'.lock';let handle,tmp;
 try{handle=await open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')return {status:'skipped_locked'};throw error;}
 try{
  const out=await readOutcomes(dir),key=companyId+'|'+roleId,prior=out.linkChanges?.[key];
  if(prior&&prior.observedUrl===observed.href&&(prior.evidence===evidence||prior.evidence==='entry_transition_detail_page_verified'))return {status:'already_proposed'};
  out.linkChanges={...(out.linkChanges||{}),[key]:{companyId,roleId,roleUrl:role.href,roleTitle,observedUrl:observed.href,observedAt,evidence}};
  tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(out,null,2)+'\n',{mode:0o600});await rename(tmp,file);tmp=null;
  return {status:'proposed',key};
 }finally{if(tmp)await unlink(tmp).catch(()=>{});await handle.close();await unlink(lock).catch(()=>{});}
}
