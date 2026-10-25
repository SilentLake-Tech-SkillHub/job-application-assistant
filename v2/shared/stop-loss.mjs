// Stop-loss for repeated identical agent-owned failures (one record per
// scope+tool, overwritten; no history). The same failure twice on the same
// task/company and code version stops that company and routes the executor to
// hand off and continue other companies; a third identical call is refused
// before it touches the browser. A new code version or a success resets it.
import {createHash,randomUUID} from 'node:crypto';import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import path from 'node:path';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
// Construction/mapping explore with different arguments; elsewhere a repeated
// failure code on the same company is a repeat whatever the arguments.
const ARGUMENT_SENSITIVE=new Set(['construct','map']);
const FAILED_CHECK=new Set(['mismatch','unverified','failed']);
export const STOP_LOSS_LIMIT=2;
export function stopLossDir(env=process.env){return env.RECRUITING_STOP_LOSS_DIR||(env.RECRUITING_PRIVATE_DIR?path.join(env.RECRUITING_PRIVATE_DIR,'stop-loss'):null);}
export function scopeOf(args){const s=args?.taskId||args?.companyId;return typeof s==='string'&&s?s:null;}
export function failureReasons(result){
 if(!result||typeof result!=='object')return [];
 if(result.continuation?.owner!=='agent')return [];
 if(result.error)return [String(result.error)];
 const runs=[result,...(Array.isArray(result.results)?result.results:[])];
 const reasons=runs.flatMap(run=>[run?.errorCode,...(run?.checks||[]).filter(c=>FAILED_CHECK.has(c?.status)).map(c=>c.reason),...(run?.deferredControls||[]).map(c=>c?.reason),...(run?.blockers||[]).map(b=>typeof b==='string'?b:b?.reason)]).filter(r=>typeof r==='string'&&r);
 return [...new Set(reasons)].sort();
}
const fileFor=(dir,scope,tool)=>path.join(dir,sha([scope,tool]).slice(0,40)+'.json');
async function load(file){try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}}
async function save(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,file);}
const source=env=>env.RECRUITING_WORKER_SOURCE_SHA256||null;
const argsHash=(phase,args)=>ARGUMENT_SENSITIVE.has(phase)?sha(stable(args||{})):null;
export async function stopLossBlocked({tool,phase,args,env=process.env}){
 const dir=stopLossDir(env),scope=scopeOf(args);if(!dir||!scope)return null;
 const entry=await load(fileFor(dir,scope,tool));
 if(!entry||entry.count<STOP_LOSS_LIMIT||entry.source!==source(env)||entry.argsHash!==argsHash(phase,args))return null;
 return entry;
}
export async function recordOutcome({tool,phase,args,result,env=process.env,technical=()=>false}){
 const dir=stopLossDir(env),scope=scopeOf(args);if(!dir||!scope)return result;
 const file=fileFor(dir,scope,tool),reasons=failureReasons(result);
 if(!reasons.length){if(await load(file))await save(file,{scope,tool,count:0,clearedAt:new Date().toISOString()});return result;}
 const signature=sha({tool,reasons,args:argsHash(phase,args),source:source(env)}),old=await load(file);
 const count=old?.signature===signature?old.count+1:1,evidence=[result.failureEvidenceId,result.id,result.runId,...(Array.isArray(result.results)?result.results.map(r=>r?.id||r?.runId):[])].filter(x=>typeof x==='string');
 const entry={scope,tool,signature,count,reasons,source:source(env),argsHash:argsHash(phase,args),evidenceIds:[...new Set([...(old?.signature===signature?old.evidenceIds||[]:[]),...evidence])].slice(-5),lastAt:new Date().toISOString()};
 await save(file,entry);
 return count>=STOP_LOSS_LIMIT?withStopLoss(result,entry,technical(reasons)):result;
}
export function withStopLoss(result,entry,isTechnical){
 const nextTools=isTechnical?['workflow_handoff','workflow_advance']:['company_batch_record','workflow_advance'];
 return {...result,stopLoss:{scope:entry.scope,tool:entry.tool,count:entry.count,reasons:entry.reasons,evidenceIds:entry.evidenceIds,technical:isTechnical},
  completion:{complete:false,status:'stopped_after_repeated_failure'},
  continuation:{state:'technical_block',owner:'agent',requiresUser:false,shouldContinue:true,nextTools,reason:'STOP_LOSS_REPEATED_FAILURE',
   instruction:isTechnical?'同一失败已在本公司出现两次：用 workflow_handoff 引用 evidenceIds 交给维护端，然后推进其它公司；本公司在代码版本更新前不得重试同一调用。':'同一失败已在本公司出现两次：用 company_batch_record 把本公司记为 blocked 并写明原因，然后推进其它公司；只有输入或代码版本变化后才可重试。'}};
}
export function stopLossRefusal(tool,entry,isTechnical){
 return withStopLoss({error:'STOP_LOSS_REPEATED_FAILURE',tool,message:'同一公司、同一调用、同一失败在当前代码版本已出现两次，本次调用未执行。'},entry,isTechnical);
}
