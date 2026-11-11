// Repeated real failures (one record per scope+tool, overwritten; no history).
// The same failure twice asks the user, with the failed fields and evidence.
// Nothing is locked: the call can always run again and other companies go on.
import {createHash,randomUUID} from 'node:crypto';import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';import path from 'node:path';
import {TRANSIENT_BROWSER_ERRORS} from './browser-errors.mjs';
import {keyOK} from './ids.mjs';
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
// Construction/mapping explore with different arguments; elsewhere a repeated
// failure code on the same company is a repeat whatever the arguments.
const ARGUMENT_SENSITIVE=new Set(['construct','map','technical_block']);
const FAILED_CHECK=new Set(['mismatch','unverified','failed']);
export const ASK_USER_AFTER=2;
// Only real fill failures count. A refreshed or rebound page and browser recovery say nothing about the form.
const NOT_A_FILL_FAILURE=/BINDING|REBIND|DOCUMENT_CHANGED|SESSION_CHANGED|PAGE_LOST|LOCATION_CHANGED|EXISTING_PAGE_NOT_FOUND|EXPLICIT_PAGE_URL_MISMATCH|PAGE_OR_ROLE_IDENTITY_CHANGED|BROWSER_RESTORE|REPEAT_CONTRACT_LEARNED|COMPANY_TEMPLATE_UPDATE_IN_PROGRESS|PRIMARY_CONTROL_REVIEW_REQUIRED|CURRENT_VISUAL_(?:INVENTORY|REA_PAIR)_REQUIRED|FORM_SECTION_EXPANSION_REQUIRED|AGENT_COMPLETENESS_REVIEW_REQUIRED/;
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
const failedFields=result=>[result,...(Array.isArray(result?.results)?result.results:[])].flatMap(run=>[...(run?.deferredControls||[]),...(run?.checks||[]).filter(c=>FAILED_CHECK.has(c?.status))]).map(({id,label,source,reason})=>({id,label,source,reason}));
export async function recordOutcome({tool,phase,args,result,env=process.env}){
 const dir=stopLossDir(env),scope=scopeOf(args);if(!dir||!scope)return result;
 const file=fileFor(dir,scope,tool),reasons=failureReasons(result);
 if(!reasons.length){if(await load(file))await save(file,{scope,tool,count:0,clearedAt:new Date().toISOString()});return result;}
 if(reasons.every(reason=>TRANSIENT_BROWSER_ERRORS.has(reason)||['BROWSER_OPERATION_FAILED','BROKER_RUNTIME_ERROR'].includes(reason)||NOT_A_FILL_FAILURE.test(reason)))return result;
 const inputHash=await evidenceArgsHash(tool,phase,args,env),signature=sha({tool,reasons,args:inputHash,source:source(env)}),old=await load(file);
 const count=old?.signature===signature?old.count+1:1,evidence=[result.failureEvidenceId,result.id,result.runId,...(Array.isArray(result.results)?result.results.map(r=>r?.id||r?.runId):[])].filter(x=>typeof x==='string');
 const entry={scope,tool,signature,count,reasons,source:source(env),argsHash:inputHash,evidenceIds:[...new Set([...(old?.signature===signature?old.evidenceIds||[]:[]),...evidence])].slice(-5),lastAt:new Date().toISOString()};
 await save(file,entry);
 return count>=ASK_USER_AFTER?askUser(result,entry):result;
}
export function askUser(result,entry){
 return {...result,repeatedFailure:{scope:entry.scope,tool:entry.tool,count:entry.count,reasons:entry.reasons,evidenceIds:entry.evidenceIds,fields:failedFields(result)},
  continuation:{state:'ask_user',owner:'user',requiresUser:true,shouldContinue:true,continueWithOtherCompanies:true,nextTools:[],reason:'SAME_FAILURE_TWICE',
   instruction:'同一失败已出现两次：把 repeatedFailure 里的失败字段和证据交给用户并提问，其他公司照常继续。这家公司没有被锁定，用户回答后可以再试。'}};
}
