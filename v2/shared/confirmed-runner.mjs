// Fixed orchestration shared by standalone execution and transport adapters.
import {interfaceCall} from './interface-call.mjs';
import {Store} from './engine.mjs';
import {configurePaths} from './runtime-paths.mjs';
export async function createConfirmedRunner({authorization,startedAt,emit=()=>{},clients,workspace}={}){
 if(!authorization?.trim())throw Error('RUN_AUTHORIZATION_REQUIRED');
 const paths=configurePaths({workspace}),store=new Store(paths.application);
 clients||=Object.fromEntries(['login','application'].map(mode=>[mode,{execute:(operation,args)=>interfaceCall({mode,kind:'execute',operation,args})}]));
 const started=startedAt?Date.parse(startedAt):Date.now();if(!Number.isFinite(started)||started>Date.now())throw Error('INVALID_RUN_START_TIMESTAMP');
 const timing={startedAt:new Date(started).toISOString(),timingRule:'elapsed_includes_waiting',stage:'initializing',calls:{},waitingIntervals:[],submission:'not_performed'};
 const taskRef=task=>task?{companyId:task.companyId,roleId:task.roleId,taskId:task.taskId,status:task.status,fillRunId:task.fillRunId,verifyRunId:task.verifyRunId||task.independentVerification?.id}:undefined;
 const persist=()=>store.put('runs','confirmed-runner-current',{...timing,currentTask:taskRef(timing.currentTask),completedTasks:timing.completedTasks?.map(taskRef)});
async function call(mode,name,args){const start=performance.now(),value=await clients[mode].execute(name,args);const r=value;const event={mode,tool:name,startedAt:new Date(performance.timeOrigin+start).toISOString(),elapsedMs:Math.round(performance.now()-start),isError:!!r.isError,result:value};timing.calls[JSON.stringify([mode,name,args.taskId||'queue'])]={mode,tool:name,taskId:args.taskId||null,startedAt:event.startedAt,elapsedMs:event.elapsedMs,isError:event.isError};await persist();if(r.isError)throw Error(value.error||'MCP_OPERATION_FAILED');return value;}
const loginAuth={login:true,evidence:authorization};
const fillAuth={prepare:true,evidence:authorization,sensitiveFields:true,uploads:true};
let queue,index=0,currentArgs,waiting=false;
async function handoff(result){waiting=true;timing.stage='waiting_for_user_login';timing.waitingIntervals.push({startedAt:new Date().toISOString(),reason:'human_verification_and_login'});timing.currentTask=queue.tasks[index];await persist();emit(JSON.stringify({event:'needs_user_login',...result,elapsedSinceStartMs:Math.round(performance.timeOrigin+performance.now()-started),next:'Complete graphical verification and SMS login in the opened role tab, then send resume.'}));}
async function fill(){
 const prepared=await call('application','role_prepare',{...currentArgs,authorization:fillAuth});
 if(prepared.status!=='ready_for_user_review'){timing.stage='needs_attention';await persist();emit(JSON.stringify({event:'needs_attention',...prepared}));return false;}
 const verified=await call('application','role_verify',currentArgs);if(verified.status!=='verified')throw Error('INDEPENDENT_ROLE_VERIFICATION_FAILED');
 const screenshot=await call('login','role_screenshot',currentArgs);
 (timing.completedTasks??=[]).push({...queue.tasks[index],...prepared,independentVerification:verified,screenshot});
 index++;await persist();return true;
}
async function nextParallel(){
 while(index<queue.tasks.length){const company=queue.tasks[index].companyId,group=[];let end=index;while(end<queue.tasks.length&&queue.tasks[end].companyId===company)group.push(queue.tasks[end++]);
  for(const task of group){currentArgs={queueId:queue.queueId,queueHash:queue.queueHash,taskId:task.taskId};const entered=await call('login','role_advance',{...currentArgs,authorization:loginAuth});if(entered.continuation?.requiresUser){await handoff(entered);return;}if(entered.status!=='ready_to_fill')throw Error('ROLE_ENTRY_NOT_READY');}
  const prepared=await call('application','roles_prepare_batch',{queueId:queue.queueId,queueHash:queue.queueHash,taskIds:group.map(t=>t.taskId),concurrency:Math.min(group.length,5),authorization:fillAuth});
  if(prepared.status!=='ready_for_user_review'){timing.stage='needs_attention';await persist();emit(JSON.stringify({event:'needs_attention',...prepared}));return;}
  for(const result of prepared.results){const task=group.find(t=>t.taskId===result.taskId),args={queueId:queue.queueId,queueHash:queue.queueHash,taskId:task.taskId};const screenshot=await call('login','role_screenshot',args);(timing.completedTasks??=[]).push({...task,...result,screenshot});}index=end;await persist();
 }
 timing.stage='ready_for_user_review';timing.completedAt=new Date().toISOString();timing.elapsedMs=Date.parse(timing.completedAt)-started;await persist();emit(JSON.stringify({event:'ready_for_user_review',startedAt:timing.startedAt,completedAt:timing.completedAt,elapsedMs:timing.elapsedMs,tasks:timing.completedTasks,submission:'not_performed'}));
}
async function next(){
 if(queue.executionMode==='parallel_roles')return nextParallel();
 while(index<queue.tasks.length){currentArgs={queueId:queue.queueId,queueHash:queue.queueHash,taskId:queue.tasks[index].taskId};const opened=await call('login','role_advance',{...currentArgs,authorization:loginAuth});
  if(opened.continuation?.requiresUser){await handoff(opened);return;}
  if(opened.status!=='ready_to_fill')throw Error('ROLE_ENTRY_NOT_READY');
  if(!await fill())return;
 }
 timing.stage='ready_for_user_review';timing.completedAt=new Date().toISOString();timing.elapsedMs=Math.round(Date.parse(timing.completedAt)-started);timing.humanWaitingMs=timing.waitingIntervals.reduce((n,x)=>n+Date.parse(x.finishedAt)-Date.parse(x.startedAt),0);timing.elapsedExcludingWaitingMs=timing.elapsedMs-timing.humanWaitingMs;await persist();emit(JSON.stringify({event:'ready_for_user_review',elapsedMs:timing.elapsedMs,humanWaitingMs:timing.humanWaitingMs,elapsedExcludingWaitingMs:timing.elapsedExcludingWaitingMs,tasks:timing.completedTasks,submission:'not_performed'}));
}
async function safe(fn){try{await fn();}catch(e){timing.stage='needs_attention';timing.error=/^[A-Z_]+$/.test(e.message)?e.message:'RUN_FAILED';await persist();emit(JSON.stringify({event:'needs_attention',error:timing.error}));}}
async function start(){await safe(async()=>{queue=await call('login','role_queue_import',{});timing.queueId=queue.queueId;timing.queueHash=queue.queueHash;if(!queue.tasks.length){timing.stage='all_roles_protected';await persist();emit(JSON.stringify({event:'all_roles_protected',protectedRoles:queue.protectedRoles}));return;}await next();});
}
async function resume(){if(!waiting)return;await safe(async()=>{const interval=timing.waitingIntervals.at(-1);interval.finishedAt=new Date().toISOString();waiting=false;const restored=await call('login','role_advance',{...currentArgs,authorization:loginAuth});if(restored.status!=='ready_to_fill'){await handoff(restored);return;}emit(JSON.stringify({event:'original_role_restored',...restored}));if(queue.executionMode==='parallel_roles')await next();else if(await fill())await next();});}
return {start,resume,status:()=>structuredClone(timing)};
}
