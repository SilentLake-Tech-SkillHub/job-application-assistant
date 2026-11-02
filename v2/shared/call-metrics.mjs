// Per company/task × tool aggregate of call count, elapsed time and returned
// bytes. Returned bytes are what the host feeds back into the model context,
// so they are the measurable proxy for token load on the MCP side. One record
// per scope+tool, overwritten (no call history, no argument or value content).
import {createHash,randomUUID} from 'node:crypto';import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import path from 'node:path';
export function metricsDir(env=process.env){return env.RECRUITING_METRICS_DIR||(env.RECRUITING_PRIVATE_DIR?path.join(env.RECRUITING_PRIVATE_DIR,'metrics'):null);}
export async function recordCall({tool,args,startedAt,bytes,isError,env=process.env}){
 const dir=metricsDir(env);if(!dir)return;
 const scope=(typeof args?.taskId==='string'&&args.taskId)||(typeof args?.companyId==='string'&&args.companyId)||'_unscoped';
 const file=path.join(dir,createHash('sha256').update(scope+'\0'+tool).digest('hex').slice(0,40)+'.json');
 let m;try{m=JSON.parse(await readFile(file,'utf8'));}catch{m={scope,tool,calls:0,errors:0,elapsedMs:0,resultBytes:0,maxResultBytes:0};}
 const elapsed=Math.max(0,Date.now()-startedAt);
 m.calls++;if(isError)m.errors++;m.elapsedMs+=elapsed;m.resultBytes+=bytes;m.maxResultBytes=Math.max(m.maxResultBytes,bytes);m.lastAt=new Date().toISOString();m.source=env.RECRUITING_WORKER_SOURCE_SHA256||null;
 try{await mkdir(dir,{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(m),{mode:0o600});await rename(tmp,file);}catch{}
}
