import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');
const token=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const knownTools=values=>Array.isArray(values)?values.filter(token).slice(0,20):[];

export async function loadCliWorkflowTarget({workspace,env=process.env}){
 const session=env.CODEX_THREAD_ID||env.CODEX_SESSION_ID||env.DSH_SESSION_ID||env.CLAUDE_SESSION_ID;
 if(!token(session)||!workspace)return null;
 const state=env.RECRUITING_WORKFLOW_STATE||path.join(workspace,env.CLAUDE_SESSION_ID&&!env.CODEX_THREAD_ID?'.claude':'.codex','workflow-state');
 const file=path.join(state,'host-turn-'+hash(session).slice(0,24)+'.json');
 try{
  const anchor=JSON.parse(await readFile(file,'utf8'));
  if(anchor.session_id===session&&token(anchor.turn_id))return {session,turn:anchor.turn_id,state,file};
 }catch{}
 return null;
}

export async function recordCliWorkflow({target,operation,input={},result}){
 if(!target||!token(operation))return false;
 const batch=operation==='company_batch_status'&&typeof result?.agentWorkRemaining==='boolean';
 const c=batch?{owner:result.agentWorkRemaining?'agent':'user',state:'prepare',shouldContinue:result.agentWorkRemaining,
  requiresUser:!result.agentWorkRemaining,nextTools:(result.actionable||[]).map(a=>a.nextTool)}:result?.continuation;
 if(!c||!['agent','user','supervisor','maintainer'].includes(c.owner)||typeof c.shouldContinue!=='boolean')return false;
 const route={owner:c.owner,state:token(c.state)?c.state:'prepare',shouldContinue:c.shouldContinue,requiresUser:c.requiresUser===true,
  nextTools:knownTools(c.nextTools),handoffVerified:c.handoffVerified===true};
 const scope=batch?'batch':[input.taskId,input.companyId,result?.companyId].find(token)||'batch';
 const {session,turn,state,file:anchorFile}=target;
 let current;
 try{current=JSON.parse(await readFile(anchorFile,'utf8'));}catch{return false;}
 if(current.session_id!==session||current.turn_id!==turn)return false;
 const dir=path.join(state,'cli-continuation-'+hash(session+'\0'+turn));
 await mkdir(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,hash(scope));const tmp=file+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(tmp,JSON.stringify({session_id:session,turn_id:turn,scope,batch,operation,atMs:Date.now(),route}),{mode:0o600});
  await rename(tmp,file);
 }finally{await unlink(tmp).catch(()=>{});}
 return true;
}
