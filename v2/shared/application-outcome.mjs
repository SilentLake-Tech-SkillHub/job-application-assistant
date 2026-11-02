// 投递回传：只写工作区 岗位交接/投递回传.json，按岗位编码每个岗位只保留最新一条结果（覆盖写），不留事件历史、不另存备份。
// 业务状态不在这里改：搜索端 company_store.py reverse 读取回传，生成“当前状态是X，更新状态是Y”，用户确认后才写主表。
// 链接观察（岗位链接打不开、第一次拿到投递链接、站点登录链接/账号核对页）也只记在这里，
// 由搜索端 apply-observations 预览、用户确认后写主表；投递端不改交接区的任何链接。
import {readFile,writeFile,open,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {z} from 'zod';
import {handoffDirFromEnv,readHandoffCompanies,CODE} from './company-directory.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const nonempty=z.string().min(1);
const proof=z.object({file:nonempty,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const OUTCOME_EVENTS=['submission_confirmed','submission_uncertain','application_blocked','user_skipped','role_closed'];
// 需要用户处理、在处理前禁止重跑的结果
export const UNRESOLVED_EVENTS=['submission_uncertain','application_blocked'];
// companyId 是目录项编号（站点资产键，没有绑定时就是站点编码 S0001），roleId 是岗位编码（J000001）。
export const outcomeSchema=z.object({schemaVersion:z.literal(1),eventId:z.string().uuid(),event:z.enum(OUTCOME_EVENTS),batchId:nonempty,companyId:nonempty,roleId:z.string().regex(CODE.role),roleUrl:z.string().url(),roleTitle:nonempty,evidence:proof}).strict();
const evidenceSchema=z.object({schemaVersion:z.literal(1),event:outcomeSchema.shape.event,batchId:nonempty,companyId:nonempty,roleId:nonempty,roleUrl:z.string().url(),roleTitle:nonempty,observedAt:z.string().datetime({offset:true}),sourceUrl:z.string().url(),result:nonempty,reviewer:nonempty,artifacts:z.array(proof).min(1)}).strict();
const readProof=async p=>{const b=await readFile(p.file);if(sha(b)!==p.sha256)throw Error('OUTCOME_EVIDENCE_HASH_MISMATCH');return b;};
export const outcomeFile=dir=>path.join(dir,'投递回传.json');
export async function readOutcomes(dir){
 let out;try{out=JSON.parse(await readFile(outcomeFile(dir),'utf8'));}catch(e){if(e.code==='ENOENT')return {schemaVersion:2,roles:{},observations:[]};throw e;}
 return {schemaVersion:2,roles:out.roles||{},observations:out.observations||[]};
}
async function writeOutcomes(dir,fn){
 const file=outcomeFile(dir),lock=file+'.lock';let handle,tmp;
 try{handle=await open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('OUTCOME_WRITE_LOCKED');throw error;}
 try{
  const out=await readOutcomes(dir),result=await fn(out);if(result?.write===false)return result.value;
  tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(out,null,2)+'\n',{mode:0o600});await rename(tmp,file);tmp=null;
  return result?.value;
 }finally{if(tmp)await unlink(tmp).catch(()=>{});await handle.close();await unlink(lock).catch(()=>{});}
}
// catalog：投递目录（站点资产键 → 站点编码）；不传时 companyId 按站点编码对应。
export async function recordApplicationOutcome({outcome,handoffDir=handoffDirFromEnv(),catalog=null}){
 const e=outcomeSchema.parse(outcome),dir=path.resolve(handoffDir);
 const siteId=catalog?catalog.find(c=>c.id===e.companyId)?.siteId:e.companyId;
 if(!CODE.site.test(siteId||''))throw Error('OUTCOME_ROLE_IDENTITY_MISMATCH');
 const {batchId,files}=await readHandoffCompanies({handoffDir:dir,states:['已交接','进行中','等待反向评审']});
 if(batchId!==e.batchId)throw Error('OUTCOME_BATCH_MISMATCH');
 const matches=files.flatMap(f=>(f.doc['岗位']||[]).filter(r=>f.doc['批次']['选中岗位'].includes(r['岗位编码'])).map(r=>({companyCode:f.code,...r})))
  .filter(r=>r['岗位编码']===e.roleId&&r['站点编码']===siteId&&r['岗位链接']===e.roleUrl&&r['岗位名称']===e.roleTitle);
 if(matches.length!==1)throw Error('OUTCOME_ROLE_IDENTITY_MISMATCH');
 const key=e.roleId,eventHash=sha(JSON.stringify(e));
 return writeOutcomes(dir,async out=>{
  const prior=out.roles[key];
  if(prior&&prior.eventId===e.eventId){
   if(prior.eventHash!==eventHash)throw Error('OUTCOME_EVENT_ID_CONFLICT');
   await readProof(e.evidence);return {write:false,value:{status:'already_recorded',eventId:e.eventId,event:prior.event,businessStatus:'unchanged_until_user_review'}};
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
  out.roles[key]={eventId:e.eventId,eventHash,event:e.event,batchId:e.batchId,companyCode:matches[0].companyCode,siteId,roleId:e.roleId,roleTitle:e.roleTitle,
   result:evidence.result,observedAt:evidence.observedAt,evidence:e.evidence,recordedAt:new Date().toISOString()};
  return {value:{status:'recorded',eventId:e.eventId,event:e.event,businessStatus:'unchanged_until_user_review',nextStep:'company_store.py reverse'}};
 });
}

// 链接观察：只在“打不开”或“第一次拿到空着的链接”时记；能打开的跳转不算变化，不记。
// 每个（编码, 字段）只留最新一条，覆盖写。搜索端 apply-observations 预览、用户确认后写主表。
const OBSERVATION_FIELDS={role:['岗位链接','投递链接'],site:['登录链接','账号核对页']};
export async function recordObservation({kind,code,field,value=null,evidence,observedAt=new Date().toISOString(),handoffDir=handoffDirFromEnv()}){
 if(!OBSERVATION_FIELDS[kind]?.includes(field)||!(kind==='role'?CODE.role:CODE.site).test(code||''))throw Error('INVALID_OBSERVATION');
 if(typeof evidence!=='string'||!evidence.trim())throw Error('OBSERVATION_EVIDENCE_REQUIRED');
 // 岗位链接：值为空 = 打不开；带值 = 打开后跳到了编号不同的岗位页（岗位名已核对一致），值是跳转后的岗位页。
 if(value!==null){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('INVALID_OBSERVATION');}
 if(value===null&&field==='账号核对页')throw Error('INVALID_OBSERVATION');
 return writeOutcomes(path.resolve(handoffDir),async out=>{
  const prior=out.observations.find(o=>o.code===code&&o.field===field);
  if(prior&&prior.value===value)return {write:false,value:{status:'already_observed'}};
  out.observations=[...out.observations.filter(o=>!(o.code===code&&o.field===field)),{kind,code,field,value,evidence:evidence.trim(),observedAt}];
  return {value:{status:'observed',code,field}};
 });
}
