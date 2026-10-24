import {readFileSync} from 'node:fs';
import {humanActionReason,templateConstructionIssues} from './field-policy.mjs';
import {validateControlContract} from './value-contract.mjs';

export function auditStoredContract(template){
 const construction=templateConstructionIssues(template),fields=(template.pages||[]).flatMap(page=>(page.fields||[]).map(field=>{
  const human=field.userOnly&&humanActionReason(field),issues=construction.filter(x=>x.id===field.id).map(x=>x.reason);
  let componentStored=!!field.control;try{validateControlContract(field);}catch(e){componentStored=false;issues.push(e.message);}
  const contentStored=typeof field.source==='string'&&!!field.source;
  const contentMapped=contentStored&&(human||!field.source.startsWith('unmapped.'));
  const operationMode=human?'user_action':field.readonly?'observe':field.actions?.length?'automated':'unresolved';
  const operationStored=operationMode!=='unresolved';
  const readbackStored=!!field.read?.selector&&!!field.read?.kind;
  if(!contentStored)issues.push('CONTENT_SOURCE_NOT_STORED');if(!contentMapped)issues.push('CONTENT_SOURCE_NOT_MAPPED');
  if(!operationStored)issues.push('OPERATION_NOT_STORED');if(!readbackStored)issues.push('READBACK_NOT_STORED');
  return {id:field.id,contentStored,contentMapped:!!contentMapped,componentStored,operationStored,operationMode,readbackStored,issues:[...new Set(issues)]};
 }));
 return {revision:1,total:fields.length,contentStored:fields.filter(f=>f.contentStored).length,contentMapped:fields.filter(f=>f.contentMapped).length,componentsStored:fields.filter(f=>f.componentStored).length,operationsStored:fields.filter(f=>f.operationStored).length,readbacksStored:fields.filter(f=>f.readbackStored).length,ready:fields.length>0&&fields.every(f=>!f.issues.length)&&!construction.some(x=>!fields.some(f=>f.id===x.id)),fields};
}
export function contractAuditSummary(audit){const {fields,ready,...summary}=audit;return {...summary,contractComplete:ready,executionVerified:false,missing:fields.filter(f=>f.issues.length).map(({id,issues})=>({id,issues}))};}

// Every construction response carries a machine-readable continuation. This is
// also consumed by the host Hook; nextTools alone is not a lifecycle contract.
export function workflowEnvelope(data){
 if(!data||typeof data!=='object')return data;
 if(data.error==='ACCOUNT_PROOF_PAGE_NOT_OPEN')return {...data,completion:{complete:false,status:'identity_page_required',scope:'preparation'},continuation:{state:'login',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['login_open_identity','login_inspect','role_resume'],reason:data.error,retry:'only_after_identity_page_opened'}};
 if(data.continuation){const review=data.continuation.state==='review'&&['verified','ready_for_user_review'].includes(data.status);return {...data,completion:data.completion||{complete:review,status:review?'ready_for_review':data.continuation.requiresUser?'waiting_for_user':'in_progress',scope:'preparation'}};}
 let nextTools,state='construct';
 if(data.error)nextTools=['form_template_audit','workflow_next'];
 else if(data.route==='acquire')nextTools=['capture_rea_structure','form_build_template'];
 else if(data.route==='reuse'){state='prepare';nextTools=['prepare_plan'];}
 else if(Array.isArray(data.plans)){
  if(data.plans.some(p=>p.readyForExecution)){state='prepare';nextTools=['batch_prepare','verify_current'];}
  else if(data.plans.some(p=>p.status==='needs_form_acquisition'||p.constructionBlockers?.length))nextTools=['workflow_next','form_build_template'];
  else return {...data,completion:{complete:false,status:'waiting_for_user',scope:'preparation'},continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['profile_record_answers']}};
 }
 else if(Array.isArray(data.results)){
  if(data.results.length&&data.results.every(r=>['verified','ready_for_user_review'].includes(r.status)))return {...data,completion:{complete:true,status:'ready_for_review',scope:'preparation'},continuation:{state:'review',owner:'user',requiresUser:true,shouldContinue:false,nextTools:[]}};
  state='repair';nextTools=['run_status','form_template_audit','workflow_next'];
 }
 else if(data.readyToRegister!==undefined)nextTools=data.readyToRegister?['template_register']:data.nextTools||['form_mapping_candidates','capture_choice_options','form_build_template'];
 else if(data.choicesId)nextTools=data.nextTools||['form_build_template'];
 else if(data.captureId)nextTools=data.nextTools||['form_mapping_candidates','capture_choice_options','form_build_template'];
 else if(data.status==='captured_not_live_verified')nextTools=['probe_conditions','template_finalize'];
 else if(data.status==='asset_sealed_require_profile_preflight'){nextTools=['prepare_plan'];state='prepare';}
 else if(data.mapped!==undefined)nextTools=['form_build_template'];
 else if(data.operation==='internal_condition_probe')nextTools=data.status==='verified'?['template_finalize']:['capture_controls','form_build_template'];
 else if(data.status==='ready_for_material_staging')nextTools=['material_import_run'];
 else if(data.status==='input_uploaded_server_unverified')nextTools=['capture_controls','verify_current'];
 if(!nextTools)return data;
 if(data.error)state='technical_block';
 return {...data,completion:{status:data.error?'blocked_on_agent':'in_progress',complete:false},continuation:{state,owner:'agent',requiresUser:false,shouldContinue:true,nextTools,...(data.error?{reason:data.error,retry:'only_after_evidence_or_inputs_change'}:{})}};
}

const lifecycle=JSON.parse(readFileSync(new URL('../catalog/workflow-tools.json',import.meta.url),'utf8'));
const inspections=new Set(lifecycle.inspections),stages=lifecycle.stages;

export function stageResult(tool,data){
 if(inspections.has(tool))return data;
 if(!stages[tool])throw Error('WORKFLOW_STAGE_DECLARATION_REQUIRED');
 const [phase,nextTools]=stages[tool];let result=workflowEnvelope(data);
 if(!result.continuation){
  const wait=['needs_user_login','needs_user_verification','waiting_user_otp','needs_privacy_acceptance'].includes(result.status);
  const afterLogin=result.status==='authenticated'?['role_resume']:result.status==='ready_to_fill'?['workflow_next']:result.status==='authenticated_at_role'?['role_enter_application']:result.status==='ready_to_request_sms'||result.status==='privacy_accepted'?['login_request_sms']:nextTools;
  result={...result,completion:{complete:false,status:wait?'waiting_for_user':'in_progress',scope:'preparation'},continuation:{state:wait?'user_input':phase,owner:wait?'user':'agent',requiresUser:wait,shouldContinue:!wait,nextTools:afterLogin}};
 }
 if(tool==='company_batch_close_preparation')result={...result,completion:{complete:false,status:'closed_by_user_request'},continuation:{state:'closed',owner:'user',requiresUser:false,shouldContinue:false,nextTools:[]}};
 if(tool==='application_closeout'&&result.status==='closed')result={...result,completion:{complete:true,status:'closeout_recorded',scope:'closeout_record'},continuation:{state:'review',owner:'user',requiresUser:true,shouldContinue:false,nextTools:[]}};
 return {...result,workflowContract:{revision:1,tool,phase,tracked:true}};
}
// Every new public tool must declare its lifecycle role. Both MCP servers use
// this registration boundary, so new stages cannot silently omit their Hook.
export function registerWorkflowTool(server,tool,definition,handler){
 if(!inspections.has(tool)&&!stages[tool])throw Error('WORKFLOW_STAGE_DECLARATION_REQUIRED:'+tool);
 return server.registerTool(tool,definition,async(args,extra)=>{
  const result=await handler(args,extra);if(inspections.has(tool))return result;
  const block=result.content?.find(x=>x.type==='text');if(!block)throw Error('WORKFLOW_RESPONSE_ENVELOPE_REQUIRED');
  return {...result,content:[{type:'text',text:JSON.stringify(stageResult(tool,JSON.parse(block.text)))}]};
 });
}

export function technicalHandoffReasons(source){
 const drivers=new Set(['CONTROL_DRIVER_REQUIRED','DATE_DRIVER_CONTRACT_REQUIRED','UPLOAD_SITE_READBACK_REQUIRED','SEARCHABLE_TEXT_COMMIT_CONTRACT_REQUIRED','MULTISELECT_DRIVER_CONTRACT_REQUIRED']);
 // Bad arguments, missing mappings and unfinished construction are ordinary
 // Agent work. A stored error alone does not make them supervisor blockers.
 const technical=/^(?:BROWSER_|HOST_BROWSER_|HOST_FILE_|REA_|CDP_|IAB_|CONTROL_COMMIT_|AUTOCOMPLETE_|SEARCHABLE_COMMIT_|PHOENIX_|AREA_|LIST_POPUP_|CHOICE_(?:TRIGGER_|MENU_|COMBOBOX_|INSPECTION_)|SHARED_RESUME_|OPERATION_FAILED$)/;
 const error=source.operation==='mcp_error'?source.error:source.operation==='internal_condition_probe'?source.errorCode:null;
 if(error&&(drivers.has(error)||technical.test(error)))return [error];
 // Real preparation/verification runs are themselves evidence IDs. Do not
 // force the executor to manufacture a second error to report a driver gap.
 const execution=/^(?:FORM_CONTROL_|CONTROL_OPERATION_|AUTOCOMPLETE_|SEARCHABLE_COMMIT_|AREA_|LIST_POPUP_|PHOENIX_|CHOICE_|UPLOAD_(?:NOT_CONFIRMED_BY_SITE|DOWNLOAD_[A-Z_]+|VERIFIED_DOWNLOAD_CONTROL_REQUIRED|CONTENT_DIFFERS_FROM_SOURCE)$)/;
 const runs=[source,...(source.results||[]),...(source.pageChecks||[]).map(page=>page.verification).filter(Boolean)];
 const reasons=runs.flatMap(run=>[run.errorCode,...(run.checks||[]).filter(check=>['mismatch','unverified'].includes(check.status)).map(check=>check.reason),...(run.deferredControls||[]).map(control=>control.reason)]).filter(reason=>typeof reason==='string'&&execution.test(reason));
 if(reasons.length)return [...new Set(reasons)];
 return [...new Set((source.blockers||[]).filter(b=>drivers.has(b.reason)).map(b=>b.reason))];
}
