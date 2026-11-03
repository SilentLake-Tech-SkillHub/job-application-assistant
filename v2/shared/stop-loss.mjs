// Stop-loss for repeated identical agent-owned failures (one record per
// scope+tool, overwritten; no history). The same failure twice on the same
// task/company and code version stops that company and routes the executor to
// hand off and continue other companies; a third identical call is refused
// before it touches the browser. A new code version or a success resets it.
import {createHash,randomUUID} from 'node:crypto';import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import path from 'node:path';
import {observeBrowserFailureState} from './failure-state.mjs';
import {TRANSIENT_BROWSER_ERRORS} from './browser-errors.mjs';
import {keyOK} from './ids.mjs';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
// Construction/mapping explore with different arguments; elsewhere a repeated
// failure code on the same company is a repeat whatever the arguments.
const ARGUMENT_SENSITIVE=new Set(['construct','map','technical_block']);
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
const fingerprintArgs=value=>Array.isArray(value)?value.map(fingerprintArgs):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['authorization','authorizationRef','evidence','recoveryRef','recoveryEvidence'].includes(key)).map(([key,v])=>[key,fingerprintArgs(v)])):value;
const argsHash=(tool,phase,args)=>tool==='role_confirm_material_no_destination'?sha({captureId:args?.captureId||null,key:args?.key||null,mode:args?.mode||'confirm',queueId:args?.queueId||null,queueHash:args?.queueHash||null}):tool==='role_prepare_fields'&&Array.isArray(args?.fieldIds)?sha({fieldIds:[...new Set(args.fieldIds)].sort()}):ARGUMENT_SENSITIVE.has(phase)?sha(stable(fingerprintArgs(args||{}))):null;
// Fixed form IDs do not change after a real recapture. Retry accounting must
// bind current evidence content, not rely on content-addressed filenames.
const semanticEvidence=value=>Array.isArray(value)?value.map(semanticEvidence):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['observedAt','readAt','capturedAt','createdAt','finishedAt','evidence','authorization','authorizationRef'].includes(key)).map(([key,v])=>[key,semanticEvidence(v)])):value;
async function evidenceArgsHash(tool,phase,args,env){
 const base=argsHash(tool,phase,args);if(base===null||!env.RECRUITING_PRIVATE_DIR)return base;
 const refs=[];
 for(const key of ['captureId','baselineCaptureId','choicesId','structureId','draftId','sourceTemplateId','templateId'])if(typeof args?.[key]==='string'&&keyOK(args[key]))refs.push([key,args[key]]);
 for(const id of args?.choiceIds||[])if(typeof id==='string'&&keyOK(id))refs.push(['choicesId',id]);
 if(!refs.length)return base;
 const evidence=[];
 for(const [kind,id] of refs){
  const value=await load(path.join(env.RECRUITING_PRIVATE_DIR,kind.endsWith('TemplateId')||kind==='templateId'?'templates':'runs',id+'.json'));
  if(!value){evidence.push([kind,id,null]);continue;}
  const content=kind.toLowerCase().includes('capture')?{companyId:value.companyId,formId:value.formId,pageUrl:value.pageUrl,provider:value.provider,controls:value.controls}:kind==='structureId'?{companyId:value.companyId,formId:value.formId,controlCaptureHash:value.controlCaptureHash,nativeStructureHash:value.nativeStructure?.structureHash,controls:value.controls,scriptInventory:value.scriptInventory}:value;
  evidence.push([kind,id,sha(stable(semanticEvidence(content)))]);
 }
 return sha({base,evidence});
}
const noObserve=new Set(['role_submit','application_closeout','login_request_sms','login_verify_otp']);
const observed=async(tool,args,env,observeState)=>{if(noObserve.has(tool))return null;try{const s=await observeState(args,env);return typeof s?.fingerprint==='string'?{fingerprint:s.fingerprint}:null;}catch{return null;}};
export async function stopLossBlocked({tool,phase,args,env=process.env,observeState=observeBrowserFailureState}){
 const dir=stopLossDir(env),scope=scopeOf(args);if(!dir||!scope)return null;
 const entry=await load(fileFor(dir,scope,tool)),inputHash=await evidenceArgsHash(tool,phase,args,env);
 if(!entry||entry.count<STOP_LOSS_LIMIT||entry.source!==source(env)||entry.argsHash!==inputHash)return null;
 const current=await observed(tool,args,env,observeState);
 if(entry.observedState&&current&&entry.observedState.fingerprint!==current.fingerprint){await save(fileFor(dir,scope,tool),{...entry,count:0,clearedAt:new Date().toISOString(),recovery:{reason:'component_observed_page_state_changed',previousFingerprint:entry.observedState.fingerprint,currentFingerprint:current.fingerprint},observedState:current});return null;}
 return entry;
}
export async function recordOutcome({tool,phase,args,result,env=process.env,technical=()=>false,observeState=observeBrowserFailureState}){
 const dir=stopLossDir(env),scope=scopeOf(args);if(!dir||!scope)return result;
 const file=fileFor(dir,scope,tool),reasons=failureReasons(result);
 if(!reasons.length){if(await load(file))await save(file,{scope,tool,count:0,clearedAt:new Date().toISOString()});return result;}
 if(reasons.every(reason=>TRANSIENT_BROWSER_ERRORS.has(reason)||['BROWSER_OPERATION_FAILED','BROKER_RUNTIME_ERROR'].includes(reason)))return result;
 const observedState=await observed(tool,args,env,observeState);
 const inputHash=await evidenceArgsHash(tool,phase,args,env),signature=sha({tool,reasons,args:inputHash,source:source(env)}),old=await load(file);
 const count=old?.signature===signature?old.count+1:1,evidence=[result.failureEvidenceId,result.id,result.runId,...(Array.isArray(result.results)?result.results.map(r=>r?.id||r?.runId):[])].filter(x=>typeof x==='string');
 const entry={scope,tool,signature,count,reasons,observedState,source:source(env),argsHash:inputHash,evidenceIds:[...new Set([...(old?.signature===signature?old.evidenceIds||[]:[]),...evidence])].slice(-5),lastAt:new Date().toISOString()};
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
