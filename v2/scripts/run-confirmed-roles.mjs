import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),rolesFile=process.argv[2];
const evidenceDir=process.env.RECRUITING_RUN_EVIDENCE_DIR,authorizationFile=process.env.RECRUITING_RUN_AUTHORIZATION_FILE;
if(!rolesFile||!evidenceDir||!authorizationFile)throw Error('ROLE_INPUT_EVIDENCE_AND_AUTHORIZATION_REQUIRED');
const evidence=await readFile(authorizationFile,'utf8');if(!evidence.trim())throw Error('RUN_AUTHORIZATION_REQUIRED');
await mkdir(evidenceDir,{recursive:true,mode:0o700});
const started=process.env.RECRUITING_RUN_STARTED_AT?Date.parse(process.env.RECRUITING_RUN_STARTED_AT):performance.timeOrigin;if(!Number.isFinite(started)||started>Date.now())throw Error('INVALID_RUN_START_TIMESTAMP');const timing={startedAt:new Date(started).toISOString(),source:process.env.RECRUITING_RUN_STARTED_AT?'user_turn_start_timestamp':'node_process_time_origin',timingRule:'end_timestamp_minus_start_timestamp_includes_all_time_no_deductions',stage:'initializing',calls:[],waitingIntervals:[],submission:'not_performed'};
const persist=()=>writeFile(path.join(evidenceDir,'计时与状态.json'),JSON.stringify(timing,null,2),{mode:0o600});
const clients={};
for(const mode of ['login','application']){const c=new Client({name:'confirmed-role-runner',version:'2.0.0-alpha.3'});const env=Object.fromEntries(Object.entries(process.env).filter(([,v])=>typeof v==='string'));await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/start.mjs'),mode],env,stderr:'ignore'}));clients[mode]=c;}
async function call(mode,name,args){const start=performance.now(),r=await clients[mode].callTool({name,arguments:args},undefined,{timeout:120000});const value=JSON.parse(r.content[0].text);const event={mode,tool:name,startedAt:new Date(performance.timeOrigin+start).toISOString(),elapsedMs:Math.round(performance.now()-start),isError:!!r.isError,result:value};timing.calls.push({mode,tool:name,startedAt:event.startedAt,elapsedMs:event.elapsedMs,isError:event.isError});await writeFile(path.join(evidenceDir,`${timing.calls.length}-${name}.json`),JSON.stringify(event,null,2),{mode:0o600});await persist();if(r.isError)throw Error(value.error||'MCP_OPERATION_FAILED');return value;}
const loginAuth={login:true,evidence:'User-authorized current run; source file: '+authorizationFile};
const fillAuth={prepare:true,evidence:'User-authorized current materials and private profile in current run; source file: '+authorizationFile,sensitiveFields:true,uploads:true};
let queue,index=0,currentArgs,waiting=false;
async function handoff(result){waiting=true;timing.stage='waiting_for_user_login';timing.waitingIntervals.push({startedAt:new Date().toISOString(),reason:'human_verification_and_login'});timing.currentTask=queue.tasks[index];await persist();console.log(JSON.stringify({event:'needs_user_login',...result,elapsedSinceStartMs:Math.round(performance.timeOrigin+performance.now()-started),next:'Complete graphical verification and SMS login in the opened role tab, then send resume.'}));}
async function fill(){
 const prepared=await call('application','role_prepare',{...currentArgs,authorization:fillAuth});
 if(prepared.status!=='ready_for_user_review'){timing.stage='needs_attention';await persist();console.log(JSON.stringify({event:'needs_attention',...prepared}));return false;}
 const verified=await call('application','role_verify',currentArgs);if(verified.status!=='verified')throw Error('INDEPENDENT_ROLE_VERIFICATION_FAILED');
 const screenshot=await call('login','role_screenshot',currentArgs);
 (timing.completedTasks??=[]).push({...queue.tasks[index],...prepared,independentVerification:verified,screenshot});
 index++;await persist();return true;
}
async function nextParallel(){
 while(index<queue.tasks.length){const company=queue.tasks[index].companyId,group=[];let end=index;while(end<queue.tasks.length&&queue.tasks[end].companyId===company)group.push(queue.tasks[end++]);
  for(const task of group){currentArgs={queueId:queue.queueId,queueHash:queue.queueHash,taskId:task.taskId};const opened=await call('login','role_open',currentArgs);if(opened.status==='needs_login'){
   const prepared=await call('login','login_prepare',{planId:opened.loginPlan.planId,planHash:opened.loginPlan.planHash,authorization:loginAuth});let result=prepared;if(prepared.status==='ready_to_request_sms')result=await call('login','login_request_sms',{planId:opened.loginPlan.planId,planHash:opened.loginPlan.planHash,acceptanceId:prepared.acceptanceId,authorization:loginAuth});await handoff(result);return;
  }if(opened.status!=='ready_to_fill')throw Error('ROLE_OPEN_DID_NOT_RELEASE_FILL');}
  const prepared=await call('application','roles_prepare_batch',{queueId:queue.queueId,queueHash:queue.queueHash,taskIds:group.map(t=>t.taskId),concurrency:Math.min(group.length,5),authorization:fillAuth});
  if(prepared.status!=='ready_for_user_review'){timing.stage='needs_attention';await persist();console.log(JSON.stringify({event:'needs_attention',...prepared}));return;}
  for(const result of prepared.results){const task=group.find(t=>t.taskId===result.taskId),args={queueId:queue.queueId,queueHash:queue.queueHash,taskId:task.taskId};const screenshot=await call('login','role_screenshot',args);(timing.completedTasks??=[]).push({...task,...result,screenshot});}index=end;await persist();
 }
 timing.stage='ready_for_user_review';timing.completedAt=new Date().toISOString();timing.elapsedMs=Date.parse(timing.completedAt)-started;await persist();console.log(JSON.stringify({event:'ready_for_user_review',startedAt:timing.startedAt,completedAt:timing.completedAt,elapsedMs:timing.elapsedMs,tasks:timing.completedTasks,submission:'not_performed'}));
}
async function next(){
 if(queue.executionMode==='parallel_roles')return nextParallel();
 while(index<queue.tasks.length){currentArgs={queueId:queue.queueId,queueHash:queue.queueHash,taskId:queue.tasks[index].taskId};const opened=await call('login','role_open',currentArgs);
  if(opened.status==='needs_login'){
   const prepared=await call('login','login_prepare',{planId:opened.loginPlan.planId,planHash:opened.loginPlan.planHash,authorization:loginAuth});
   let result=prepared;
   if(prepared.status==='ready_to_request_sms')result=await call('login','login_request_sms',{planId:opened.loginPlan.planId,planHash:opened.loginPlan.planHash,acceptanceId:prepared.acceptanceId,authorization:loginAuth});
   const screenshot=await call('login','role_screenshot',currentArgs);await handoff({...result,screenshot});return;
  }
  if(opened.status!=='ready_to_fill')throw Error('ROLE_OPEN_DID_NOT_RELEASE_FILL');
  if(!await fill())return;
 }
 timing.stage='ready_for_user_review';timing.completedAt=new Date().toISOString();timing.elapsedMs=Math.round(Date.parse(timing.completedAt)-started);timing.humanWaitingMs=timing.waitingIntervals.reduce((n,x)=>n+Date.parse(x.finishedAt)-Date.parse(x.startedAt),0);timing.elapsedExcludingWaitingMs=timing.elapsedMs-timing.humanWaitingMs;await persist();console.log(JSON.stringify({event:'ready_for_user_review',elapsedMs:timing.elapsedMs,humanWaitingMs:timing.humanWaitingMs,elapsedExcludingWaitingMs:timing.elapsedExcludingWaitingMs,tasks:timing.completedTasks,submission:'not_performed'}));
}
async function safe(fn){try{await fn();}catch(e){timing.stage='needs_attention';timing.error=/^[A-Z_]+$/.test(e.message)?e.message:'RUN_FAILED';await persist();console.log(JSON.stringify({event:'needs_attention',error:timing.error}));}}
await safe(async()=>{queue=await call('login','role_queue_import',{rolesFile});timing.queueId=queue.queueId;timing.queueHash=queue.queueHash;if(!queue.tasks.length){timing.stage='all_roles_protected';await persist();console.log(JSON.stringify({event:'all_roles_protected',protectedRoles:queue.protectedRoles}));return;}await next();});
if(process.stdin.isTTY)process.stdin.setRawMode(true);
for await(const line of createInterface({input:process.stdin,terminal:false})){
 if(line.trim()==='close')break;
 if(line.trim()==='resume'&&waiting)await safe(async()=>{
  const interval=timing.waitingIntervals.at(-1);interval.finishedAt=new Date().toISOString();waiting=false;
  const restored=await call('login','role_resume',currentArgs);if(restored.status!=='ready_to_fill'){await handoff(restored);return;}
  console.log(JSON.stringify({event:'original_role_restored',...restored}));if(queue.executionMode==='parallel_roles')await next();else if(await fill())await next();
 });
}
for(const c of Object.values(clients))await c.close();
