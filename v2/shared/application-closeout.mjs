import {readFile,writeFile,rename,open,unlink,realpath} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {recordApplicationOutcome} from './application-outcome.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const adapter=fileURLToPath(new URL('../scripts/sync-application-tracker.py',import.meta.url));
export async function syncTracker(request){
 return new Promise((resolve,reject)=>{const child=spawn(process.env.RECRUITING_PYTHON||'python3',[adapter],{stdio:['pipe','pipe','pipe']}),chunks=[];child.stdout.on('data',b=>chunks.push(b));child.stderr.resume();child.on('error',reject);child.on('close',code=>{try{const r=JSON.parse(Buffer.concat(chunks));if(code||r.status!=='synced')reject(Error(r.error||'TRACKER_SYNC_FAILED'));else resolve(r);}catch(e){reject(e);}});child.stdin.end(JSON.stringify(request));});
}
export async function closeApplication(args,{configFile=process.env.RECRUITING_TRACKER_CONFIG,sync=syncTracker}={}){
 if(!configFile)throw Error('TRACKER_CONFIGURATION_REQUIRED');
 // One completion call owns result persistence and synchronization; no website action exists here.
 const file=await realpath(args.rolesFile),lock=file+'.closeout.lock',handle=await open(lock,'wx',0o600);let tmp;
 try{
  const recorded=await recordApplicationOutcome(args);
  let tracker,error;
  try{tracker=await sync({configFile,event:args.outcome,applicationStatus:recorded.applicationStatus});}
  catch(e){error=e.message;}
  const bytes=await readFile(file),plan=JSON.parse(bytes),entry=plan.applicationOutcomeEvents.find(x=>x.eventId===args.outcome.eventId);
  entry.sync={status:error?'sync_failed':'synced',attemptedAt:new Date().toISOString(),...(error?{error}:{tracker})};
  tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
  if(hash(await readFile(file))!==hash(bytes))throw Error('CLOSEOUT_INPUT_CHANGED');await rename(tmp,file);tmp=null;
  return {...recorded,status:error?'sync_failed':'closed',sync:entry.sync,planHash:hash(await readFile(file)),websiteAction:'none',retry:'same_event_sync_only'};
 }finally{if(tmp)await unlink(tmp).catch(()=>{});await handle.close();await unlink(lock);}
}
