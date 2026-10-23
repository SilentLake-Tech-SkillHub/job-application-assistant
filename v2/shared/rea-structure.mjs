import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {bindNativeDom,correlateNativeControls} from './structure-dom-binding.mjs';
const run=promisify(execFile);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const documentUrl=value=>{const u=new URL(value);u.hash='';return u.href;};
export function localReaEndpoint(value){
 let u;try{u=new URL(value);}catch{throw Error('REA_HOST_CAPABILITY_REQUIRED');}
 if(!['http:','ws:'].includes(u.protocol)||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('REA_LOCAL_ENDPOINT_REQUIRED');
 return u.href;
}
// Called only by an explicitly authorized internal construction operation.
// The broker obtains targetId from its existing page, never from a guessed URL.
export async function inspectRea({endpoint,targetId,pageUrl,allowedOrigins=[new URL(pageUrl).origin],command,execute=run}){
 localReaEndpoint(endpoint);
 const base=command||JSON.parse(process.env.RECRUITING_REA_COMMAND||'["npx","--offline","--yes","--package","rea-agents@6.7.0","rea"]');
 if(!Array.isArray(base)||!base.length||base.some(x=>typeof x!=='string'||!x))throw Error('REA_COMMAND_CONFIGURATION_INVALID');
 if(!targetId||new URL(pageUrl).protocol!=='https:')throw Error('REA_PAGE_BINDING_REQUIRED');
 if(!allowedOrigins.includes(new URL(pageUrl).origin)||allowedOrigins.some(origin=>{try{const u=new URL(origin);return u.protocol!=='https:'||u.origin!==origin;}catch{return true;}}))throw Error('REA_SCRIPT_ORIGIN_SCOPE_INVALID');
 const {stdout}=await execute(base[0],[...base.slice(1),'inspect-web-page',endpoint,targetId,...allowedOrigins.flatMap(origin=>['--allowed-origins',origin]),'--include-accessibility-text','--include-script-sources','--observation-ms','500','--format','json'],{timeout:120000,maxBuffer:64*1024*1024,encoding:'utf8'});
 let evidence;try{evidence=JSON.parse(stdout);}catch{throw Error('REA_COMPLETE_JSON_REQUIRED');}
 return evidence;
}
export function normalizeReaStructure(evidence,binding,{now=Date.now(),maxAgeMs=120000,nativeStructure}={}){
 const n=evidence?.normalized_result,p=evidence?.parameters;
 if(evidence?.operation!=='inspect_web_page'||evidence?.predicate_type!=='rea.web-page-inspection'||!n?.dom?.nodes||!n?.accessibility?.nodes)throw Error('REA_STRUCTURE_EVIDENCE_REQUIRED');
 if(!binding?.pageId||!binding?.targetId||binding.beforeUrl!==binding.afterUrl||new URL(binding.beforeUrl).protocol!=='https:')throw Error('REA_PAGE_BINDING_CHANGED');
 if(p?.target_id!==binding.targetId||n.target?.target_id!==binding.targetId||documentUrl(n.target.url)!==documentUrl(binding.beforeUrl)||new URL(n.target.url).origin!==n.target.origin)throw Error('REA_TARGET_MISMATCH');
 const ended=Date.parse(n.capture_window?.ended_at),age=now-ended;
 if(!Number.isFinite(age)||age< -5000||age>maxAgeMs)throw Error('REA_STALE_CAPTURE');
 if(n.accessibility.text_capture?.status!=='included')throw Error('REA_ACCESSIBILITY_LABELS_REQUIRED');
 if(n.completeness?.truncated_sections?.some(s=>/dom|accessibility/.test(s))||n.completeness?.unavailable_sections?.some(s=>/dom|accessibility/.test(s)))throw Error('REA_STRUCTURE_INCOMPLETE');
 const roles=new Set(['textbox','combobox','checkbox','radio','button','heading','group','radiogroup','listbox','option']);
 const nodes=n.accessibility.nodes.filter(x=>!x.ignored&&roles.has(x.role)).map(x=>({nodeId:x.node_id,parentId:x.parent_id,role:x.role,label:x.name||'',states:(x.states||[]).filter(s=>['required','disabled','readonly','expanded','multiselectable'].includes(s.name))}));
 const structure={schemaVersion:1,provider:'rea',evidenceId:evidence.evidence_id,evidenceHash:hash(evidence),pageId:binding.pageId,pageUrl:binding.beforeUrl,targetId:binding.targetId,observedAt:n.capture_window.ended_at,domNodeCount:n.dom.total_nodes,accessibility:nodes,limitations:n.limitations||[],completeness:n.completeness,executableSelectors:false,executionVerified:false};
 structure.accessibility=bindNativeDom(structure,nativeStructure,{maxAgeMs});
 return structure;
}
export function bindStructureControls(structure,capture){
 if(structure.pageUrl!==capture.pageUrl||capture.pageId&&structure.pageId!==capture.pageId)throw Error('REA_CONTROL_CAPTURE_SCOPE_MISMATCH');
 const elapsed=Math.abs(Date.parse(capture.observedAt)-Date.parse(structure.observedAt));
 if(!Number.isFinite(elapsed)||elapsed>120000)throw Error('REA_CONTROL_CAPTURE_TOO_FAR_APART');
 // Names are context, never a substitute for current backend DOM identity.
 const {controls,bound}=correlateNativeControls(structure.accessibility,capture.controls);
 const excluded=correlateNativeControls(structure.accessibility,(capture.scopeExclusions||[]).filter(e=>e.kind==='navigation'&&e.reason==='outside_application_form'));
 const scopeExclusions=excluded.controls.flatMap(c=>c.reaBindings.map(binding=>({...binding,kind:'navigation',reason:'outside_application_form',containerSelector:c.containerSelector})));
 const uncorrelatedControls=structure.accessibility.filter(n=>['textbox','combobox','checkbox','radio'].includes(n.role)&&!bound.has(String(n.nodeId))&&!excluded.bound.has(String(n.nodeId)));
 return {companyId:capture.companyId,pageUrl:capture.pageUrl,pageId:structure.pageId,reaEvidenceId:structure.evidenceId,reaEvidenceHash:structure.evidenceHash,captureId:capture.captureId,controls,scopeExclusions,uncorrelatedControls,requiresLiveProbe:true};
}
