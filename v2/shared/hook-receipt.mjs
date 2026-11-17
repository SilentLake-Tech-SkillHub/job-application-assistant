import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';import path from 'node:path';
import {currentHostCapabilities} from './sampling-bridge.mjs';
export async function hookReceiptStatus(env=process.env){
 const session=currentHostCapabilities().conversationId||env.CODEX_THREAD_ID||env.CODEX_SESSION_ID||env.DSH_SESSION_ID||env.CLAUDE_SESSION_ID;
 const roots=env.RECRUITING_WORKFLOW_STATE?[env.RECRUITING_WORKFLOW_STATE]:env.RECRUITING_WORKSPACE_ROOT?['.codex','.claude','.agents'].map(p=>path.join(env.RECRUITING_WORKSPACE_ROOT,p,'workflow-state')):[];
 if(session)for(const root of roots){
  try{
   const index='hook-session-'+createHash('sha256').update(session).digest('hex').slice(0,24)+'.json';
   const ref=JSON.parse(await readFile(path.join(root,index),'utf8'));
   if(typeof ref.receipt!=='string'||path.basename(ref.receipt)!==ref.receipt)continue;
   const r=JSON.parse(await readFile(path.join(root,ref.receipt),'utf8'));
   if(r.session_id===session&&r.sha256&&r.route_sha256)return {active:true,sessionId:session};
  }catch{}
 }
 return {active:false,sessionId:session||null,message:'本宿主 Hook 未生效：请 Agent 先检查并安装本项目 Hook；当前调用继续执行。'};
}
export async function withHookNotice(result,env=process.env){
 if(!env.RECRUITING_WORKSPACE_ROOT)return result;
 const hookStatus=await hookReceiptStatus(env);
 return {...result,hookStatus,...(!hookStatus.active?{warnings:[...(result.warnings||[]),hookStatus.message]}:{})};
}
