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
 let handler;registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},'capture_rea_structure',{},async()=>({content:[{type:'text',text:JSON.stringify({captureId:'observed'})}]}));
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
});
