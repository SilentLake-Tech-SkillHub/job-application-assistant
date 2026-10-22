import {classifyPending} from './field-policy.mjs';
export function continuationFor({route,plan,verification,template,profile,error}={}){
 if(error)return {state:'technical_block',owner:'agent',requiresUser:false,continueWithOtherCompanies:true,reason:error,nextTools:['run_status','form_template_audit'],retry:'only_after_evidence_or_inputs_change'};
 if(route?.route==='acquire'||plan?.constructionBlockers?.length)return {state:'construct',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['capture_rea_structure','capture_controls','form_mapping_candidates','capture_choice_options','form_build_template','template_register','probe_conditions','template_finalize'],retry:'only_changed_missing_parts'};
 const fields=template?.pages?.flatMap(p=>p.fields)||[],pending=fields.map(f=>({id:f.id,...classifyPending(f,profile)}));
 if(pending.some(x=>x.kind==='mapping'))return {state:'map',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['form_mapping_candidates','profile_map_questions','form_build_template']};
 if(verification){
  if(verification.status==='verified')return {state:'review',owner:'user',requiresUser:true,nextTools:[],submission:'not_performed'};
  const technical=verification.checks?.filter(x=>['unmapped','unverified','mismatch','invalid','construction_required'].includes(x.status))||[];
  if(technical.length)return {state:'repair',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['form_template_audit','capture_controls','form_build_template'],technical:technical.map(({id,reason})=>({id,reason})),retry:'only_after_evidence_or_inputs_change'};
  return {state:'user_input',owner:'user',requiresUser:true,continueWithOtherCompanies:true,nextTools:pending.some(x=>x.kind==='answer')?['profile_record_answers']:[],fields:pending.filter(x=>['answer','human_action'].includes(x.kind))};
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
