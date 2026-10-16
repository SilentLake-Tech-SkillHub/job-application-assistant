// Business labels are derived here, never accepted from a model as a target value.
import {readFile,writeFile,open,rename,unlink,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
const sha=b=>createHash('sha256').update(b).digest('hex');
const nonempty=z.string().min(1);
const proof=z.object({file:nonempty,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const outcomeSchema=z.object({schemaVersion:z.literal(1),eventId:z.string().uuid(),event:z.enum(['submission_confirmed','submission_uncertain','application_blocked','user_skipped']),batchId:nonempty,companyId:nonempty,roleId:nonempty,roleUrl:z.string().url(),roleTitle:nonempty,evidence:proof}).strict();
const evidenceSchema=z.object({schemaVersion:z.literal(1),event:outcomeSchema.shape.event,batchId:nonempty,companyId:nonempty,roleId:nonempty,roleUrl:z.string().url(),roleTitle:nonempty,observedAt:z.string().datetime({offset:true}),sourceUrl:z.string().url(),result:nonempty,reviewer:nonempty,artifacts:z.array(proof).min(1)}).strict();
const label=s=>s==='not_submitted'?'待投递':s==='submitted'?'已提交':s;
const readProof=async p=>{const b=await readFile(p.file);if(sha(b)!==p.sha256)throw Error('OUTCOME_EVIDENCE_HASH_MISMATCH');return b;};
export async function recordApplicationOutcome({rolesFile,expectedHash,outcome}){
 const e=outcomeSchema.parse(outcome),file=await realpath(rolesFile),lock=file+'.outcome.lock';let handle;
 try{handle=await open(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('OUTCOME_WRITE_LOCKED');throw error;}
 let tmp;
 try{
  const bytes=await readFile(file),input=JSON.parse(bytes),prior=input.applicationOutcomeEvents||[],eventHash=sha(JSON.stringify(e));
  const duplicate=prior.find(x=>x.eventId===e.eventId);
  if(duplicate){if(duplicate.eventHash!==eventHash)throw Error('OUTCOME_EVENT_ID_CONFLICT');const roles=(input.companies||[]).filter(c=>c.companyId===e.companyId).flatMap(c=>c.roles||[]).filter(r=>(r.roleId||r.id)===e.roleId&&r.url===e.roleUrl&&r.title===e.roleTitle);if(roles.length!==1||roles[0].applicationStatus!==duplicate.applicationStatus)throw Error('OUTCOME_RECORDED_STATE_CHANGED');await readProof(e.evidence);return {status:'already_recorded',eventId:e.eventId,applicationStatus:duplicate.applicationStatus,planHash:sha(bytes)};}
  if(sha(bytes)!==expectedHash)throw Error('OUTCOME_INPUT_CHANGED');
  if(input.schemaVersion!==1||input.batchId!==e.batchId)throw Error('OUTCOME_BATCH_MISMATCH');
  const matches=(input.companies||[]).filter(c=>c.companyId===e.companyId).flatMap(c=>c.roles||[]).filter(r=>(r.roleId||r.id)===e.roleId&&r.url===e.roleUrl&&r.title===e.roleTitle);
  if(matches.length!==1||matches[0].selected!==true)throw Error('OUTCOME_ROLE_IDENTITY_MISMATCH');
  const r=matches[0],before=r.applicationStatus,current=label(before);
  // Legacy leakage can only be repaired with fresh, identity-bound receipt evidence.
  if(!['待投递','已提交'].includes(current)&&!(before==='receipt_verified'&&e.event==='submission_confirmed'))throw Error('OUTCOME_BUSINESS_LABEL_INVALID');
  const evidence=evidenceSchema.parse(JSON.parse(await readProof(e.evidence)));
  for(const k of ['event','batchId','companyId','roleId','roleUrl','roleTitle'])if(evidence[k]!==e[k])throw Error('OUTCOME_EVIDENCE_IDENTITY_MISMATCH');
  const roleOrigin=new URL(e.roleUrl).origin,source=new URL(evidence.sourceUrl);
  if(source.origin!==roleOrigin||source.protocol!=='https:')throw Error('OUTCOME_EVIDENCE_ORIGIN_MISMATCH');
  if(Date.parse(evidence.observedAt)>Date.now()+60000)throw Error('OUTCOME_EVIDENCE_TIME_INVALID');
  for(const p of evidence.artifacts)await readProof(p);
  if(e.event==='submission_confirmed'&&evidence.result!=='official_receipt_confirmed')throw Error('OUTCOME_RECEIPT_REQUIRED');
  if(e.event!=='submission_confirmed'&&current==='已提交')throw Error('OUTCOME_SUBMITTED_DOWNGRADE_FORBIDDEN');
  const next=e.event==='submission_confirmed'?'已提交':'待投递',now=new Date().toISOString();
  r.applicationStatus=next;
  r.applicationOutcome={event:e.event,receiptStatus:e.event==='submission_confirmed'?'receipt_verified':'not_verified',note:evidence.result,evidence:e.evidence,recordedAt:now};
  const entry={eventId:e.eventId,eventHash,event:e.event,companyId:e.companyId,roleId:e.roleId,previousApplicationStatus:before,applicationStatus:next,evidence:e.evidence,recordedAt:now};
  input.applicationOutcomeEvents=[...prior,entry];input.version+=1;input.updatedAt=now;
  const backup=file+'.before-outcome-'+e.eventId+'.json';try{await writeFile(backup,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST'||sha(await readFile(backup))!==sha(bytes))throw error;}
  // Recheck immediately before atomic replacement. Cooperating writers share this lock.
  if(sha(await readFile(file))!==expectedHash)throw Error('OUTCOME_INPUT_CHANGED');
  tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(input,null,2)+'\n',{mode:0o600});await rename(tmp,file);tmp=null;
  const saved=await readFile(file);return {status:'recorded',eventId:e.eventId,applicationStatus:next,receiptStatus:r.applicationOutcome.receiptStatus,planHash:sha(saved),backup};
 }finally{if(tmp)await unlink(tmp).catch(()=>{});await handle.close();await unlink(lock);}
}
