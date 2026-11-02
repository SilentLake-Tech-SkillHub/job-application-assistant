import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareSelectedFields} from '../shared/selected-field-prepare.mjs';
import {hash} from '../shared/engine.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';
import {compileExpected} from '../shared/observation.mjs';

const text=(id,extra={})=>({id,source:id,label:id,kind:'text',required:true,inventorySelectors:['#'+id],inventoryLabel:id,inventoryType:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#'+id,kind:'value'},actions:[{method:'fill',selector:'#'+id}],...extra});
function fixture(fields=[text('first'),text('second')],{values={},errors={},failure,extraInventory=[]}={}){
 const url='https://fixture.test/form',plan={pathPrefix:'/form',provider:'phoenix',roleTitle:'Product',roleSelector:'h1',fields},template={id:'example',version:1,pages:[plan]},sourceValues=Object.fromEntries(fields.map(f=>[f.source,'frozen-'+f.id]));
 const task={companyId:'example',roleId:'product',pageUrl:url,templateHash:hash(template),planId:'plan',planHash:'frozen-plan',values:Object.fromEntries(fields.map(f=>[f.source,'changed-task-'+f.id]))};
 const frozen=fields.map(f=>({...structuredClone(f),value:sourceValues[f.source],disposition:'fill'})),prepared={id:task.planId,planHash:task.planHash,companyId:task.companyId,pageUrl:url,templateHash:task.templateHash,pages:[{pathPrefix:'/form',fields:frozen,executionOrder:[{stage:'fill',fieldIds:fields.filter(f=>f.kind!=='file').map(f=>f.id)}],expected:compileExpected(plan,{...task,values:sourceValues})}]};
 const current={...Object.fromEntries(fields.map(f=>[f.id,''])),...values},calls=[],records=[],reads=[];
 const store={put:async(group,id,value)=>records.push({group,id,value:structuredClone(value)}),get:async()=>{throw Error('MISSING');}};
 const page={inventory:async()=>{reads.push('inventory');return [...fields.map(f=>({selector:f.inventorySelectors[0],label:f.label,type:f.inventoryType,required:f.required,locatorStrategy:'semantic_question'})),...extraInventory];},observe:async p=>{reads.push(p.fields.map(f=>f.id));return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Product',fields:Object.fromEntries(p.fields.map(f=>[f.id,{present:true,value:current[f.id],errors:errors[f.id]||[],selected:true}]))};},act:async(action,value,files)=>{calls.push({action,value,files});if(failure)await failure(action,value);const id=action.selector.slice(1);current[id]=value;return {};}};
 return {store,page,task,template,prepared,calls,records,reads,current,run:fieldIds=>prepareSelectedFields({store,page,task,template,prepared,fieldIds})};
}

test('only selected frozen fields run in compiled order; attachments and other fields receive no action',async()=>{
 const file=text('resume',{kind:'file',inventoryType:'file',control:{type:'file_upload',valueType:'string',readbackType:'string[]'},read:{selector:'#resume',kind:'files'},actions:[{method:'upload',selector:'#resume'}]});
 const f=fixture([text('first'),text('second'),text('other'),file]);
 const result=await f.run(['second','first']);
 assert.deepEqual(f.calls.map(c=>[c.action.selector,c.value]),[['#first','frozen-first'],['#second','frozen-second']]);
 assert.equal(result.status,'prepared');assert.equal(result.fullFormVerified,false);assert.deepEqual(result.fieldIds,['first','second']);
 assert.ok(f.records.some(r=>r.value.actions.some(a=>a.status==='attempt_started')));
 assert.ok(f.records.every(r=>!JSON.stringify(r.value).includes('frozen-first')&&!JSON.stringify(r.value).includes('changed-task')));
});

test('scope mismatch is refused before any page read or action',async()=>{
 const f=fixture();f.prepared.pageUrl='https://fixture.test/other';
 await assert.rejects(f.run(['first']),/SELECTED_FIELD_PLAN_SCOPE_CHANGED/);assert.deepEqual(f.reads,[]);assert.deepEqual(f.calls,[]);
});

test('duplicate, unknown, forbidden and non-fill selections are refused without actions',async()=>{
 for(const mode of ['duplicate','unknown','sensitive','readonly','userOnly','file','no-action','inactive']){
  const f=fixture();let ids=['first'];
  if(mode==='duplicate')ids=['first','first'];else if(mode==='unknown')ids=['missing'];else if(mode==='inactive')f.prepared.pages[0].fields[0].disposition='inactive';else if(mode==='file')f.prepared.pages[0].fields[0].kind='file';else if(mode==='no-action')f.prepared.pages[0].fields[0].actions=[];else f.prepared.pages[0].fields[0][mode]=true;
  await assert.rejects(f.run(ids));assert.deepEqual(f.calls,[]);
 }
});

test('unmapped live controls block selected writes',async()=>{
 const f=fixture(undefined,{extraInventory:[{selector:'#new',label:'New',type:'text',required:false,locatorStrategy:'semantic_question'}]});
 const result=await f.run(['first']);assert.equal(result.errorCode,'FORM_CONTROL_CONTRACT_CHANGED');assert.deepEqual(f.calls,[]);
});

test('an existing validation error is never treated as a matching completed value',async()=>{
 const f=fixture(undefined,{values:{first:'frozen-first'},errors:{first:[{source:'rendered_validation'}]}});
 const result=await f.run(['first']);assert.equal(f.calls.length,1);assert.equal(result.status,'needs_attention');assert.equal(result.fields[0].reason,'FIELD_VALIDATION_ERROR');
});

test('recoverable source failure blocks its dependent and continues independent selected fields',async()=>{
 const parent=text('parent',{control:{type:'searchable_text',valueType:'string',readbackType:'string'},actions:[{method:'phoenix_autocomplete',selector:'#parent'}]});
 const dependent=text('dependent',{when:{source:'parent',equals:'frozen-parent'}}),independent=text('independent');
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const f=fixture([parent,dependent,independent],{failure:async(action,value)=>{if(action.selector!=='#parent')return;const error=Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');error.details={phase:'independent_verify',expectedValueHash:digest(value),observedValueHash:digest(value),valueMatches:true,readbackAvailable:true};throw error;}});
 const result=await f.run(['parent','dependent','independent']);
 assert.deepEqual(f.calls.map(c=>c.action.selector),['#parent','#independent']);assert.equal(result.status,'needs_attention');assert.equal(result.fields.find(x=>x.id==='dependent').status,'blocked_dependency');assert.equal(result.fields.find(x=>x.id==='independent').status,'prepared_pending_full_verification');
});

test('nonrecoverable source failure stops immediately and identifies the real field',async()=>{
 const f=fixture(undefined,{failure:async()=>{throw Error('CONTROL_NOT_FOUND');}}),result=await f.run(['first','second']);
 assert.equal(result.errorCode,'CONTROL_NOT_FOUND');assert.equal(result.failedField.id,'first');assert.deepEqual(f.calls.map(c=>c.action.selector),['#first']);assert.equal(result.actions[0].status,'failed');
});

test('a current native selection proves a dependency without acting on the unselected parent',async()=>{
 const parent=text('parent',{kind:'choice',inventoryType:'select',control:{type:'dropdown',valueType:'string',readbackType:'string',options:['frozen-parent']},read:{selector:'#parent',kind:'value',nativeSelect:true},actions:[{method:'select',selector:'#parent',options:['frozen-parent']}]});
 const dependent=text('dependent',{when:{source:'parent',equals:'frozen-parent'}}),f=fixture([parent,dependent],{values:{parent:'frozen-parent'}});
 const result=await f.run(['dependent']);assert.equal(result.status,'prepared');assert.deepEqual(f.calls.map(c=>c.action.selector),['#dependent']);
});

test('a mismatching dependency is refused before the dependent action',async()=>{
 const dependent=text('second',{when:{source:'first',equals:'frozen-first'}}),f=fixture([text('first'),dependent]);
 const result=await f.run(['second']);assert.equal(result.errorCode,'SELECTED_FIELD_DEPENDENCY_NOT_VERIFIED');assert.deepEqual(f.calls,[]);
});

test('a range date action cannot write an unselected peer',async()=>{
 const date=id=>text(id,{kind:'date',inventoryType:'combobox',precision:'day',control:{type:'day_picker',valueType:'string',readbackType:'string'},read:{selector:'#'+id,kind:'text'},actions:[{method:'ant_day',selector:'#'+id}]});
 const f=fixture([date('start'),date('end')]);
 Object.assign(f.prepared.pages[0].fields[0].actions[0],{rangePeerSelector:'#end',rangePeerFieldId:'end',rangePeerValue:'frozen-end'});
 await assert.rejects(f.run(['start']),/SELECTED_FIELD_RANGE_SCOPE_REQUIRED/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.reads,[]);
});


test('selected scope validates complete plan and known ordinary IDs without requiring upload authority',async()=>{
 const f=fixture(),template={...f.template,coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true}};
 template.pages[0].sections=[{title:'Basics'}];template.pages[0].sectionDiscovery={selector:'section',titleSelector:'h2'};
 const task={...f.task,templateHash:hash(template),values:{first:'frozen-first',second:'frozen-second'}},prepared=await compileExecutionPlan(template,task),frozen={...task,planId:prepared.id,planHash:prepared.planHash};
 await assertPreparedPlan(prepared,template,frozen,{prepare:true},{scope:'selected_fields',fieldIds:['first']});
 for(const ids of [[],['first','first'],['missing']])await assert.rejects(assertPreparedPlan(prepared,template,frozen,{prepare:true},{scope:'selected_fields',fieldIds:ids}));
 await assert.rejects(assertPreparedPlan(prepared,template,{...frozen,values:{...task.values,second:'changed'}},{prepare:true},{scope:'selected_fields',fieldIds:['first']}),/PREPARED_PLAN_INPUTS_CHANGED/);
 template.coverage.allControlsMapped=false;const badTask={...task,templateHash:hash(template)},bad=await compileExecutionPlan(template,badTask);
 await assert.rejects(assertPreparedPlan(bad,template,{...badTask,planId:bad.id,planHash:bad.planHash},{prepare:true,allowPartialPreparation:true},{scope:'selected_fields',fieldIds:['first']}),/FORM_CONSTRUCTION_INCOMPLETE/);
});
