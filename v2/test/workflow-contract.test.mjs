import test from 'node:test';import assert from 'node:assert/strict';
import {auditStoredContract,stageResult,registerWorkflowTool} from '../shared/workflow-contract.mjs';
import {registerTemplateContract} from '../shared/profile.mjs';
const field=()=>({id:'school',label:'学校',inventoryLabel:'学校',inventoryType:'combobox',source:'school',kind:'choice',control:{type:'dropdown',valueType:'string',readbackType:'string',options:['One University']},actions:[{method:'dropdown',selector:'#school',options:['One University']}],read:{selector:'#committed-school',selectedSelector:'#committed-school',kind:'text'}});
const template=()=>({id:'generic',version:1,evidence:{sourceUrl:'https://example.test/apply'},pages:[{pathPrefix:'/apply',fields:[field()]}]});
const profile=()=>({schemaVersion:1,entities:{},sources:{},facts:{},companyForms:{},fieldRegistry:{}});
test('each observed field persists full content/component/actions/readback even when construction blocked',()=>{
 const t=template();t.pages[0].fields[0].actions=[];t.pages[0].fields[0].constructionBlockers=['CONTROL_DRIVER_REQUIRED'];const p=profile();
 registerTemplateContract(p,{companyId:'synthetic',template:t,templateHash:'hash',stage:'construction'});
 const stored=Object.values(p.companyForms)[0].executionContract;assert.equal(stored.status,'construction_incomplete');assert.deepEqual(stored.fields[0].constructionBlockers,['CONTROL_DRIVER_REQUIRED']);assert.equal(stored.fields[0].inventoryType,'combobox');assert.equal(stored.storageAudit.ready,false);
 assert.throws(()=>registerTemplateContract(p,{companyId:'synthetic',template:t,templateHash:'hash'}),/COMPLETE_EXECUTION_CONTRACT_REQUIRED/);
});
test('interactive school cannot be parked as readonly text or ordinary user action',()=>{
 const t=template(),f=t.pages[0].fields[0];f.kind='text';f.control={type:'readonly_text',valueType:'string',readbackType:'string'};f.readonly=true;f.actions=[];
 assert.equal(auditStoredContract(t).ready,false);assert.ok(auditStoredContract(t).fields[0].issues.includes('INTERACTIVE_WIDGET_REQUIRES_SELECTION_CONTRACT'));
 f.userOnly=true;assert.ok(auditStoredContract(t).fields[0].issues.includes('ORDINARY_FIELD_MARKED_USER_ONLY'));
});
test('new MCP public tools must declare workflow role; acquisition always continues',async()=>{
 assert.throws(()=>registerWorkflowTool({registerTool(){}},'future_fill',{},()=>{}),/WORKFLOW_STAGE_DECLARATION_REQUIRED/);
 let handler;registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},'capture_rea_structure',{},async()=>({content:[{type:'text',text:JSON.stringify({captureId:'observed'})}]}),{RECRUITING_HOST_ROLE:'executor'});
 const result=JSON.parse((await handler({})).content[0].text);assert.equal(result.workflowContract.tracked,true);assert.equal(result.continuation.owner,'agent');assert.equal(result.continuation.shouldContinue,true);assert.equal(result.completion.complete,false);
});
test('technical errors cannot silently clear the continuation',()=>{
 const result=stageResult('form_build_template',{error:'DRIVER_MISSING'});assert.equal(result.continuation.shouldContinue,true);assert.equal(result.completion.complete,false);
});

test('company hash routes keep role-specific contracts apart and migrate only exact observed page',async()=>{
 const {formLocation,registerObservedQuestions}=await import('../shared/profile.mjs');
 const a='https://example.test/e/?id=1#/job/1/apply',b='https://example.test/e/?id=2#/job/2/apply';assert.notEqual(formLocation(a),formLocation(b));
 const p=profile();p.companyForms.legacy={companyId:'same',pageUrl:a,mappings:{}};
 const r=registerObservedQuestions(p,{companyId:'same',pageUrl:a,fields:[],observedAt:'observed'});assert.equal(p.companyForms.legacy,undefined);assert.ok(p.companyForms[r.pageKey]);
});

test('coverage flags and an old probe cannot seal changed content/component/operation contracts',async()=>{
 const {observedSeal}=await import('./fixtures/observed-seal.mjs'),{assertSealContract}=await import('../shared/form-seal.mjs');
 const t=template(),sealed=observedSeal(t,'synthetic');assert.equal(assertSealContract(sealed.template,sealed.probe,'synthetic'),true);
 sealed.template.pages[0].fields[0].actions[0].selector='#wrong-field';assert.throws(()=>assertSealContract(sealed.template,sealed.probe,'synthetic'),/SEALED_CONTRACT_CHANGED/);
 const f=template();f.coverage={allControlsMapped:true,allDriversSupported:true,allConditionalBranchesVerified:true};assert.throws(()=>assertSealContract(f),/SEAL_PROOF_REQUIRED/);
});

test('ordinary semantic and input errors cannot be laundered into terminal supervisor handoffs',async()=>{
 const {technicalHandoffReasons}=await import('../shared/workflow-contract.mjs');
 for(const error of ['SEMANTIC_MAPPING_REQUIRED','UNKNOWN_QUESTION_OR_FACT','NEW_QUESTIONS_REQUIRE_PROFILE_MAPPING','ACTUAL_CAPTURED_OPTION_REQUIRED','COMPANY_ORIGIN_MISMATCH'])assert.deepEqual(technicalHandoffReasons({operation:'mcp_error',error}),[]);
 assert.deepEqual(technicalHandoffReasons({operation:'mcp_error',error:'BROWSER_HOST_OPERATION_FAILED'}),['BROWSER_HOST_OPERATION_FAILED']);
 assert.deepEqual(technicalHandoffReasons({operation:'internal_condition_probe',errorCode:'BROWSER_HOST_OPERATION_FAILED'}),['BROWSER_HOST_OPERATION_FAILED']);
 assert.deepEqual(technicalHandoffReasons({operation:'internal_condition_probe',errorCode:'SEMANTIC_MAPPING_REQUIRED'}),[]);
});

test('dropdown presentation labels do not overwrite numeric canonical fact types',()=>{
 const t=template(),p=profile(),f=t.pages[0].fields[0];f.source='rank';f.enumMap={'30':'Top 30%'};f.control.options=['Top 30%'];f.actions[0].options=['Top 30%'];p.sources.test={kind:'synthetic'};p.facts.rank={status:'known',value:30,sourceIds:['test']};p.fieldRegistry.rank={canonicalType:'number'};
 registerTemplateContract(p,{companyId:'synthetic',template:t,templateHash:'test'});assert.equal(p.fieldRegistry.rank.canonicalType,'number');assert.equal(p.facts.rank.value,30);
});

test('document type choices are ordinary controls while actual document numbers stay protected',async()=>{
 const {humanActionReason,normalizeControlPolicy}=await import('../shared/field-policy.mjs');
 const type={label:'身份证件',type:'search',renderer:'ant_select',userOnly:true};assert.equal(humanActionReason(type),null);assert.equal(normalizeControlPolicy([type])[0].userOnly,false);
 assert.equal(humanActionReason({label:'身份证号码',type:'text'}),'sensitive_identity');assert.equal(normalizeControlPolicy([{label:'身份证号码',type:'text',userOnly:true}])[0].userOnly,true);
});

test('legacy form keys resolve only the same full URL, never another role or domain',async()=>{
 const {lookupCompanyForm,formLocation}=await import('../shared/profile.mjs'),p=profile(),url='https://one.test/e/#/job/1/apply';p.companyForms.legacy={companyId:'same',pageUrl:url,mappings:{}};
 assert.equal(lookupCompanyForm(p,'same',url).storedKey,'legacy');assert.equal(lookupCompanyForm(p,'same','https://one.test/e/#/job/2/apply').form,undefined);assert.notEqual(formLocation(url),formLocation('https://two.test/e/#/job/1/apply'));
 const r=lookupCompanyForm(p,'same',url,{migrate:true});assert.ok(p.companyForms[r.pageKey]);assert.equal(p.companyForms.legacy,undefined);
});

test('recapture with an old template cannot overwrite a newly confirmed semantic mapping',async()=>{
 const {registerObservedQuestions,mapProfileQuestions,registerPlannedQuestions}=await import('../shared/profile.mjs'),p=profile();p.sources.test={kind:'test'};p.facts.old={status:'known',value:'Old',sourceIds:['test']};p.facts.current={status:'known',value:'Current',sourceIds:['test']};
 const args={companyId:'same',pageUrl:'https://fixture.test/form',fields:[{selector:'#name',label:'Name',type:'text',required:true}],observedAt:'test'};
 const r=registerObservedQuestions(p,args),questionId=Object.keys(p.companyForms[r.pageKey].mappings)[0];mapProfileQuestions(p,{...args,evidence:'latest approved source',mappings:[{questionId,factKey:'current'}]});
 registerPlannedQuestions(p,args,{fields:[{source:'old',inventorySelectors:['#name'],inventoryLabel:'Name',inventoryType:'text',required:true}]});assert.equal(p.companyForms[r.pageKey].mappings[questionId].factKey,'current');
});

test('numeric canonical source is validated after its declared dropdown presentation mapping',async()=>{
 const {compileExecutionPlan}=await import('../shared/execution-plan.mjs'),t=template(),f=t.pages[0].fields[0];f.source='rank';f.enumMap={'30':'Top 30%'};f.control.options=['Top 30%'];f.actions[0].options=['Top 30%'];
 const plan=await compileExecutionPlan(t,{values:{rank:30}});assert.equal(plan.pages[0].fields[0].value,'Top 30%');assert.equal(plan.pages[0].fields[0].disposition,'fill');
 await assert.rejects(compileExecutionPlan(t,{values:{rank:20}}),/UNMAPPED_ENUM_VALUE/);
});

test('a genuine new question can be semantically defined without inventing a personal answer',async()=>{
 const {registerObservedQuestions,mapProfileQuestions}=await import('../shared/profile.mjs'),p=profile(),args={companyId:'same',pageUrl:'https://fixture.test/form',fields:[{selector:'#new',label:'Preferred locations',type:'combobox'}],observedAt:'test'};
 const r=registerObservedQuestions(p,args),questionId=Object.keys(p.companyForms[r.pageKey].mappings)[0];
 assert.throws(()=>mapProfileQuestions(p,{...args,evidence:'observed question',mappings:[{questionId,factKey:'preferences.locations'}]}),/UNKNOWN_QUESTION_OR_FACT/);
 mapProfileQuestions(p,{...args,evidence:'observed new location preference, no existing semantic source',mappings:[{questionId,factKey:'preferences.locations',define:{label:'Preferred locations',canonicalType:'string[]'}}]});
 assert.equal(p.facts['preferences.locations'].status,'missing');assert.equal(p.facts['preferences.locations'].value,null);assert.equal(p.companyForms[r.pageKey].mappings[questionId].status,'mapped');
});
