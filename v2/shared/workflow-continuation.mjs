import {withProfileRecords,recordPlanOf} from './repeat-groups.mjs';
import {classifyPending} from './field-policy.mjs';
// The component names the one route for a failure; the agent only carries it out.
const ROUTE_BY_ERROR=new Map([['REPEAT_CONTRACT_LEARNED',['prepare_plan','batch_prepare']],['ROLE_BROWSER_PAGE_LOST',['role_resume']],['ROLE_OR_ACCOUNT_CHANGED_BEFORE_FILL',['role_resume']],['EXISTING_PAGE_NOT_FOUND',['role_resume']],['UNMAPPED_FORM_FIELDS',['form_repair_fields']],['FORM_CONTROL_CONTRACT_CHANGED',['form_repair_fields']],['REPEAT_ADD_CONTROL_CHANGED',['form_repair_fields']]]);
const REPAIRABLE=new Set(['CONTROL_NOT_ON_PAGE','CONTROL_NOT_IN_TEMPLATE']);
export function continuationFor({route,plan,verification,template,profile,error}={}){
 if(error)return {state:'technical_block',owner:'agent',requiresUser:false,shouldContinue:true,continueWithOtherCompanies:true,reason:error,routeCode:ROUTE_BY_ERROR.has(error)?error:null,nextTools:ROUTE_BY_ERROR.get(error)||['run_status','form_template_audit'],retry:'only_after_evidence_or_inputs_change'};
 if(route?.route&&route.route!=='reuse'||plan?.constructionBlockers?.length)return {state:'construct',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:route?.nextTools||['capture_controls','form_mapping_candidates','form_build_template','template_register','probe_conditions','template_finalize'],retry:'only_changed_missing_parts'};
 const fields=(template&&profile?withProfileRecords(template,recordPlanOf(profile)):template)?.pages?.flatMap(p=>p.fields)||[],pending=fields.map(f=>({id:f.id,...classifyPending(f,profile)}));
 if(pending.some(x=>x.kind==='mapping'))return {state:'map',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:pending.some(x=>x.reason==='SOURCE_NOT_REGISTERED')?['capture_repeat_slots','capture_controls','form_mapping_candidates','profile_map_questions','form_build_template']:['form_mapping_candidates','profile_map_questions','form_build_template']};
 if(verification){
  if(verification.status==='verified')return {state:'review',owner:'user',requiresUser:true,nextTools:[],submission:'not_performed'};
  const technical=verification.checks?.filter(x=>['unmapped','unverified','mismatch','invalid','construction_required'].includes(x.status))||[];
  if(technical.length)return {state:'repair',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:technical.every(x=>REPAIRABLE.has(x.reason))?['form_repair_fields']:['form_template_audit','capture_controls','form_build_template'],technical:technical.map(({id,reason})=>({id,reason})),retry:'only_after_evidence_or_inputs_change'};
  const unresolved=new Set((verification.checks||[]).filter(check=>['needs_user','missing_input'].includes(check.status)).map(check=>check.id));
  const waiting=pending.filter(field=>unresolved.has(field.id)&&['answer','human_action'].includes(field.kind));
  return {state:'user_input',owner:'user',requiresUser:true,continueWithOtherCompanies:true,nextTools:waiting.some(field=>field.kind==='answer')?['profile_record_answers']:[],fields:waiting};
 }
 if(pending.some(x=>x.kind==='answer'))return {state:'user_input',owner:'user',requiresUser:true,continueWithOtherCompanies:true,nextTools:['profile_record_answers'],fields:pending.filter(x=>x.kind==='answer')};
 return {state:'prepare',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['prepare_plan','batch_prepare','verify_current']};
}
// Each eligible company advances in the same call. A user's wait at one company
// does not end the batch. No automatic retry of a failed write or submission.
export async function advanceCompanies(tasks,advanceOne,{concurrency=2,affinity}={}){
 const results=new Array(tasks.length),buckets=new Map();let cursor=0;
 tasks.forEach((t,i)=>{const key=affinity?affinity(t):i;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(i);});
 const groups=[...buckets.values()];
 await Promise.all(Array.from({length:Math.min(concurrency,groups.length)},async()=>{
  for(;;){
   const group=groups[cursor++];if(!group)return;
   for(const i of group){
    try{results[i]={task:tasks[i],...await advanceOne(tasks[i])};}
    catch(e){results[i]={task:tasks[i],continuation:continuationFor({error:/^[A-Z_]+$/.test(e.message)?e.message:'WORKFLOW_STEP_FAILED'})};}
   }
  }
 }));
 return {results,requiresUser:results.some(r=>r.continuation?.requiresUser),agentWorkRemaining:results.some(r=>r.continuation?.owner==='agent'),submission:'not_performed'};
}
