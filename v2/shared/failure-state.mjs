import {roleQueueDirectory} from './queue-config.mjs';
import http from 'node:http';import path from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
// Private implementation reads the real bound task and asks the broker for a
// read-only fingerprint. No field in the Agent's arguments is accepted as proof.
export async function observeBrowserFailureState(args,env=process.env){
 const root=roleQueueDirectory(env);let socketPath=env.RECRUITING_BROWSER_SOCKET;
 if(!root||!socketPath)return null;
 try{
  let state;
  if(args.taskId&&/^[a-zA-Z0-9-]{1,90}$/.test(args.taskId))state=JSON.parse(await readFile(path.join(root,args.taskId+'.json'),'utf8'));
  else if(args.companyId){
   const records=[];
   for(const f of await readdir(root)){if(!/^[a-zA-Z0-9-]+\.json$/.test(f))continue;records.push(JSON.parse(await readFile(path.join(root,f),'utf8')));}
   const matches=[];
   for(const queue of records.filter(v=>v.id&&Array.isArray(v.tasks)))for(const task of queue.tasks){
    if(task.companyId!==args.companyId||args.roleId&&task.roleId!==args.roleId)continue;
    const bound=records.find(v=>v.taskId===task.taskId&&v.queueId===queue.id&&v.pageId);
    if(bound&&(!args.pageUrl||[bound.applicationUrl,bound.returnUrl,bound.originalRoleUrl].includes(args.pageUrl)))matches.push(bound);
   }
   if(matches.length!==1)return null;state=matches[0];
  }
  if(!state?.pageId)return null;
  if(state.pageId.startsWith('iab:'))socketPath=env.RECRUITING_IAB_SOCKET;
  if(!socketPath)return null;
  const pageId=state.pageId.replace(/^(chrome|iab):/,'');
  return await new Promise(resolve=>{
   const req=http.request({socketPath,path:'/rpc',method:'POST',headers:{'content-type':'application/json'}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{try{const d=JSON.parse(Buffer.concat(chunks));resolve(d.error?null:d.data);}catch{resolve(null);}});});
   req.on('error',()=>resolve(null));req.setTimeout(3000,()=>{req.destroy();resolve(null);});req.end(JSON.stringify({method:'failureSnapshot',args:{pageId,knownUrls:[...new Set([state.returnUrl,state.applicationUrl,state.originalRoleUrl].filter(v=>typeof v==='string'&&v.startsWith('https://')))]}}));
  });
 }catch{return null;}
}
