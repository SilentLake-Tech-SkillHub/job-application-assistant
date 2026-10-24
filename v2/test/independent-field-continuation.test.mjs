import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Engine,canContinueAfterUnverifiedSelection} from '../shared/engine.mjs';
import {compileExpected} from '../shared/observation.mjs';
import {safeControlErrorDetails} from '../shared/control-error-details.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const details=value=>({phase:'independent_verify',expectedValueHash:digest(value),observedValueHash:digest(value),valueMatches:true,readbackAvailable:true});
const school={id:'school',source:'school',label:'School',kind:'text',required:true,value:'Example University',control:{type:'searchable_text',valueType:'string',readbackType:'string'},read:{selector:'#school',kind:'value'},actions:[{method:'phoenix_autocomplete',selector:'#school'}],inventorySelectors:['#school'],inventoryLabel:'School',inventoryType:'text'};
test('only a stable post-blur searchable-selection proof gap can continue independent work',()=>{
 const error=Object.assign(Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED'),{details:details(school.value)});
 assert.equal(canContinueAfterUnverifiedSelection(error,school),true);
 for(const patch of [{phase:'after_option_click'},{valueMatches:false},{readbackAvailable:false,observedValueHash:null},{expectedValueHash:digest('other')}])assert.equal(canContinueAfterUnverifiedSelection({...error,message:error.message,details:{...error.details,...patch}},school),false);
 for(const field of [{...school,sensitive:true},{...school,userOnly:true},{...school,kind:'date'},{...school,actions:[{method:'fill',selector:'#school'}]}])assert.equal(canContinueAfterUnverifiedSelection(error,field),false);
 assert.equal(canContinueAfterUnverifiedSelection({message:'CONTROL_COMMIT_NOT_VERIFIED',details:error.details},school),false);
});

async function runFixture({errorDetails=details(school.value),protectedDependency=false}={}){
 const url='https://fixture.test/form',writes=[],values={school:'',dependent:'',name:''};
 const text=id=>({id,source:id,label:id,kind:'text',required:true,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#'+id,kind:'value'},actions:[{method:'fill',selector:'#'+id}],inventorySelectors:['#'+id],inventoryLabel:id,inventoryType:'text'});
 const fields=[school,{...text('dependent'),when:{source:'school',equals:school.value}},text('name')];
 if(protectedDependency)fields.push({...text('id'),userOnly:true,actions:[],when:{source:'school',equals:school.value}});
 const pagePlan={pathPrefix:'/form',readySelector:'#school',roleTitle:'Product',roleSelector:'h1',fields};
 const task={companyId:'sample',roleId:'role',pageUrl:url,templateHash:'fixture',values:{school:school.value,dependent:'Related value',name:'Example'}};
 const inventory=fields.map(f=>({selector:f.read.selector,label:f.inventoryLabel,type:'text',required:true,locatorStrategy:'semantic_question'}));
 const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>inventory,observe:async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Product',fields:Object.fromEntries(fields.map(f=>[f.id,{present:true,value:values[f.id]||'',errors:[]}]))}),act:async(action,value)=>{
  writes.push(action.selector);if(action.selector==='#school'){values.school=value;throw Object.assign(Error('AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED'),{details:errorDetails});}values[action.selector.slice(1)]=value;
 }};
 let protectedWrites=0;
 const engine=new Engine({store:{put:async()=>{},get:async()=>{throw Error('no saved selection proof');}},companies:[],browser:{existingPage:async()=>page},profileFields:async()=>{protectedWrites++;return {};}});
 const prepared={id:'fixture-plan',planHash:'fixture',files:{},pages:[{fields:fields.map(f=>({...f,value:task.values[f.source],disposition:f.userOnly?'user_only':'fill'})),expected:compileExpected(pagePlan,task)}]};
 const result=await engine.runCompany({task,company:{id:'sample',origin:'https://fixture.test'},template:{pages:[pagePlan]},prepared},{});
 return {result,writes,protectedWrites};
}
test('later independent fields fill, dependents wait, and final verification stays incomplete',async()=>{
 const {result,writes}=await runFixture();assert.deepEqual(writes,['#school','#name']);
 assert.equal(result.status,'needs_attention');assert.equal(result.errorCode,undefined);assert.equal(result.save,'not_verified');assert.equal(result.submission,'not_performed');
 assert.deepEqual(result.deferredControls.map(f=>f.status),['unverified','blocked_dependency']);
 assert.equal(result.fields.find(f=>f.id==='name').status,'match');assert.notEqual(result.fields.find(f=>f.id==='school').status,'match');
});
test('failed click/blur stops later writes; protected dependents are never filled',async()=>{
 const failed=await runFixture({errorDetails:{...details(school.value),phase:'after_option_click'}});assert.deepEqual(failed.writes,['#school']);assert.equal(failed.result.errorCode,'AUTOCOMPLETE_CURRENT_SELECTION_PROOF_REQUIRED');
 const protectedResult=await runFixture({protectedDependency:true});assert.deepEqual(protectedResult.writes,['#school','#name']);assert.equal(protectedResult.protectedWrites,0);assert.equal(protectedResult.result.errorCode,'UNVERIFIED_DEPENDENCY_BEFORE_PROFILE_FILL');
});
test('failed role preparation records its actual run and clears stale verified state',async()=>{
 const source=await readFile(new URL('../shared/server.mjs',import.meta.url),'utf8'),body=source.slice(source.indexOf('async function prepareRole(args){'),source.indexOf("registerTool('role_prepare',"));
 const state={returnUrl:'https://fixture.test/form',status:'ready_for_user_review',verifyRunId:'old',verifiedAt:'old'},t={taskId:'task',companyId:'sample',roleId:'role'},saved=[];
 const context={queues:{task:async()=>({t}),read:async()=>state,put:async(id,data)=>saved.push(structuredClone(data))},boundRole:async()=>({t,state,template:{}}),engine:{formRoute:async()=>({route:'reuse'}),preparePlan:async()=>({readyForExecution:true,planId:'plan',planHash:'hash'}),prepare:async()=>({id:'failed-run',elapsedMs:17,results:[{errorCode:'BROWSER_HOST_OPERATION_FAILED',errorDetails:details(school.value),failedField:{id:'school'}}]})},loadProfile:async()=>({}),profileFile:'fixture',assertQuestionsMapped:()=>{},resolveInputs:async()=>({}),hash:()=>'',continuationFor:()=>({state:'technical_block'}),safeControlErrorDetails};
 const execute=vm.runInNewContext(body+';prepareRole',context),out=await execute({authorization:{prepare:true}});
 assert.equal(out.fillRunId,'failed-run');assert.equal(out.fillElapsedMs,17);assert.equal(out.errorDetails.phase,'independent_verify');assert.equal(saved[0].status,'needs_attention');assert.equal(saved[0].fillRunId,'failed-run');assert.equal(saved[0].verifyRunId,null);assert.equal(saved[0].verifiedAt,null);
});
