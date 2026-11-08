import {Engine,hash} from './engine.mjs';
import {compileExecutionPlan} from './execution-plan.mjs';
import {completeFormTemplate} from './template-validation.mjs';

// Exercise a candidate through the same driver and independent verifier used
// for filling. The provisional template remains in memory until confirmation.
export async function testControlInteractions({engine,store,template,probe,task,authorization,assertBinding,channel='chrome'}){
 if(!authorization?.prepare||!authorization.evidence?.trim())throw Error('PREPARATION_AUTHORIZATION_REQUIRED');
 const provisional=completeFormTemplate(template,probe,{companyId:task.companyId,profileMapped:true,channel});
 let memoryTemplate=provisional;
 const overlay=Object.create(store);
 overlay.get=async(group,id)=>group==='templates'&&id===template.id?memoryTemplate:store.get(group,id);
 overlay.put=async(group,id,value,options)=>{if(group==='templates'&&id===template.id){memoryTemplate=value;return;}return store.put(group,id,value,options);};
 const tester=new Engine({...engine,store:overlay,onTemplateUpdated:async()=>{throw Error('CONTROL_TEMPLATE_BACKFILL_REQUIRED');}});
 tester.learnRepeatContract=async()=>{};
 const input={...task,templateHash:hash(provisional),testInteractions:true};
 const routed=await tester.routeTemplate(provisional,input),prepared=await compileExecutionPlan(routed,input);
 if(!prepared.readyForExecution)throw Error('INTERACTION_TEST_PROFILE_OR_CONTROL_INCOMPLETE');
 if(prepared.pages.some(p=>p.fields.some(f=>f.sensitive&&f.disposition==='fill'))&&!authorization.sensitiveFields)throw Error('SENSITIVE_FIELD_AUTHORIZATION_REQUIRED');
 if(prepared.counts.fill&&prepared.pages.some(p=>p.fields.some(f=>f.kind==='file'&&f.disposition==='fill'))&&!authorization.uploads)throw Error('UPLOAD_AUTHORIZATION_REQUIRED');
 await assertBinding();
 const company=tester.companyForTask(input),result=await tester.runCompany({task:input,company,template:provisional,prepared},authorization);
 await assertBinding();
 const checks=new Map(result.fields.map(f=>[f.id,f]));
 const inactiveFieldIds=prepared.pages.flatMap(p=>p.fields.filter(f=>f.disposition==='inactive').map(f=>f.id));
 const omittedFieldIds=prepared.pages.flatMap(p=>p.fields.filter(f=>f.disposition==='omitted').map(f=>f.id));
 const testedFieldIds=template.pages.flatMap(p=>p.fields).filter(f=>!f.userOnly&&!f.readonly&&checks.get(f.id)?.status==='match').map(f=>f.id);
 const failures=result.fields.filter(f=>!['match','confirmed_omission'].includes(f.status)).map(({id,status,reason})=>({id,status,reason}));
 if(result.errorCode)failures.push({id:result.failedField?.id||null,reason:result.errorCode});
 return {operation:'form_interaction_test',companyId:task.companyId,roleId:task.roleId,templateHash:hash(template),status:result.status,browserExecuted:true,testedFieldIds,inactiveFieldIds,omittedFieldIds,failures,conditionProbeId:probe.id,observationRunIds:result.observationRunIds||[],observedAt:new Date().toISOString(),submission:'not_performed'};
}
