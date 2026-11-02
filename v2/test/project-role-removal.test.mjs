import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {removeRoleProject} from '../shared/project-role-removal.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){
 const selector='phoenixq:'+JSON.stringify({section:'项目经历',label:'项目名称',occurrence:1,part:'native',controlIndex:0}),field={id:'old',source:'projects.old.name',read:{selector},inventorySelectors:[selector]},work={id:'work',source:'employment.name',read:{selector:'#work'},inventorySelectors:['#work']};
 const state={returnUrl:'https://example.test/form',verifyRunId:'old-report',planId:'old-plan',status:'ready_for_user_review'},task={companyId:'sample',roleId:'J000001',taskId:'task'},records=new Map();let names=['First','Old','Last'],clicks=0,workValue='unchanged';
 const page={act:async action=>{if(action.method==='inspect_project_record')return {names:[...names],removeSelector:'#delete'};clicks++;names=['First','Last'];return {status:'removed_verified',readbackStable:true};},observe:async plan=>({fields:Object.fromEntries(plan.fields.map(field=>[field.id,field.id==='old'?{present:true,value:names[1]}:{value:workValue}]))})};
 return {args:{projectId:'old',authorization:{remove:true,evidence:'delete only this project'}},queues:{put:async()=>{}},store:{get:async(_kind,id)=>{if(!records.has(id))throw Object.assign(Error('missing'),{code:'ENOENT'});return records.get(id);},put:async(_kind,id,value)=>records.set(id,value)},boundRole:async()=>({t:task,state,template:{pages:[{pathPrefix:'/form',fields:[field,work]}]}}),profile:{entities:{projects:['old','new']},applicationSelections:{projects:{projectIds:['new']}},facts:{'projects.old.name':{value:'Old'}}},browser:{existingPage:async()=>page},hash,records,state,page,clicks:()=>clicks,changeNames:()=>{names=['First','Old','Other'];},changeWork:()=>{workValue='changed';}};
}
test('preview binds exact record, delete invalidates the old review, and all non-project values stay unchanged',async()=>{
 const f=fixture(),preview=await removeRoleProject(f);assert.equal(f.clicks(),0);assert.equal(f.state.verifyRunId,'old-report');
 const r=await removeRoleProject({...f,args:{...f.args,expectedPreviewHash:preview.previewHash}});assert.equal(f.clicks(),1);assert.equal(r.nonProjectFieldsUnchanged,true);assert.equal(f.state.verifyRunId,undefined);assert.equal(f.state.status,'ready_to_fill');assert.equal(f.state.reconstructionRequired.reason,'confirmed_project_removal');
 const repeat=await removeRoleProject({...f,args:{...f.args,expectedPreviewHash:preview.previewHash}});assert.equal(repeat.alreadyRemoved,true);assert.equal(f.clicks(),1);
});
test('a changed preview or absent current removal authorization never deletes the record',async()=>{
 const f=fixture(),p=await removeRoleProject(f);f.changeNames();await assert.rejects(removeRoleProject({...f,args:{...f.args,expectedPreviewHash:p.previewHash}}),/PREVIEW_CHANGED/);assert.equal(f.clicks(),0);
 f.args.authorization.remove=false;await assert.rejects(removeRoleProject(f),/REMOVAL_AUTHORIZATION_REQUIRED/);
});
test('a project already removed from the current source can be previewed by its explicitly authorized name without restoring facts',async()=>{
 const f=fixture();f.profile.entities.projects=['new'];delete f.profile.facts['projects.old.name'];delete f.profile.applicationSelections;
 f.args.authorization.targetName='Old';
 const result=await removeRoleProject(f);assert.equal(result.projectName,'Old');assert.equal(f.clicks(),0);assert.equal(f.profile.facts['projects.old.name'],undefined);
});
test('an absent source name requires the operation target, rather than a new personal answer',async()=>{
 const f=fixture();f.profile.entities.projects=['new'];delete f.profile.facts['projects.old.name'];
 await assert.rejects(removeRoleProject(f),/PROJECT_RECORD_NAME_REQUIRED/);assert.equal(f.clicks(),0);
});
test('a matching name elsewhere cannot authorize deleting a different captured record',async()=>{
 const f=fixture();const observe=f.page.observe;f.page.observe=async plan=>plan.fields?.some(field=>field.id==='old')?{fields:{old:{present:true,value:'Other current row'}}}:observe(plan);
 await assert.rejects(removeRoleProject(f),/PROJECT_RECORD_NAME_CHANGED/);assert.equal(f.clicks(),0);
});
test('a browser error after the single delete attempt cannot lead to a second click',async()=>{
 const f=fixture(),p=await removeRoleProject(f),act=f.page.act;f.page.act=async action=>{const r=await act(action);if(action.method==='remove_project_record')throw Error('timeout');return r;};
 await assert.rejects(removeRoleProject({...f,args:{...f.args,expectedPreviewHash:p.previewHash}}),/timeout/);
 const recovered=await removeRoleProject({...f,args:{...f.args,expectedPreviewHash:p.previewHash}});assert.equal(recovered.recoveredByObservation,true);assert.equal(f.clicks(),1);
});
function confirmationFixture(){
 const f=fixture(),act=f.page.act;let opened=false,icons=0,confirms=0,fail=false;
 f.page.act=async action=>{
  if(action.method==='inspect_project_record'){const result=await act(action);return {...result,confirmation:opened?{associated:true,targetName:'Old',message:'是否要删除该组信息？',confirmLabel:'是',confirmSelector:'#yes'}:null};}
  if(!action.confirmationOnly){icons++;opened=true;return {status:'awaiting_confirmation'};}
  confirms++;if(fail)throw Error('timeout');opened=false;return act(action);
 };
 return {...f,counts:()=>({icons,confirms}),failConfirmation:()=>{fail=true;}};
}
test('opening a confirmation is not deletion; resuming the same attempt clicks only yes once',async()=>{
 const f=confirmationFixture(),preview=await removeRoleProject(f),pending=await removeRoleProject({...f,args:{...f.args,expectedPreviewHash:preview.previewHash}});
 assert.equal(pending.status,'awaiting_confirmation');assert.deepEqual(f.counts(),{icons:1,confirms:0});assert.ok(f.state.reconstructionRequired);
 const inspected=await removeRoleProject(f);assert.equal(inspected.previewHash,pending.previewHash);assert.deepEqual(f.counts(),{icons:1,confirms:0});
 const done=await removeRoleProject({...f,args:{...f.args,resumeConfirmation:true,expectedPreviewHash:pending.previewHash}});assert.equal(done.status,'removed_verified');assert.equal(done.confirmationActionCount,1);assert.deepEqual(f.counts(),{icons:1,confirms:1});
 await removeRoleProject(f);assert.deepEqual(f.counts(),{icons:1,confirms:1});
});
test('confirmation needs its fresh preview and unchanged non-project values',async()=>{
 const f=confirmationFixture(),preview=await removeRoleProject(f),pending=await removeRoleProject({...f,args:{...f.args,expectedPreviewHash:preview.previewHash}});
 await assert.rejects(removeRoleProject({...f,args:{...f.args,resumeConfirmation:true,expectedPreviewHash:'0'.repeat(64)}}),/CONFIRMATION_PREVIEW_CHANGED/);assert.deepEqual(f.counts(),{icons:1,confirms:0});
 f.changeWork();await assert.rejects(removeRoleProject({...f,args:{...f.args,resumeConfirmation:true,expectedPreviewHash:pending.previewHash}}),/OUTCOME_REQUIRES_INSPECTION/);assert.deepEqual(f.counts(),{icons:1,confirms:0});
});
test('an uncertain yes click cannot be clicked again even while the confirmation remains visible',async()=>{
 const f=confirmationFixture(),preview=await removeRoleProject(f),pending=await removeRoleProject({...f,args:{...f.args,expectedPreviewHash:preview.previewHash}});f.failConfirmation();const args={...f.args,resumeConfirmation:true,expectedPreviewHash:pending.previewHash};
 await assert.rejects(removeRoleProject({...f,args}),/timeout/);await assert.rejects(removeRoleProject({...f,args}),/OUTCOME_REQUIRES_INSPECTION/);assert.deepEqual(f.counts(),{icons:1,confirms:1});
});
