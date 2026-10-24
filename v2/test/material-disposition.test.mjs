import test from 'node:test';
import assert from 'node:assert/strict';
import {recordMaterialDestinationException,revokeMaterialDestinationException,withMaterialDispositions} from '../shared/material-disposition.mjs';
import {materialAudit,resolveMaterialValues,verifyMaterialCoverage,assertMaterialDestinationsRemainAbsent} from '../shared/business-materials.mjs';
import {compileExecutionPlan,assertPreparedPlan} from '../shared/execution-plan.mjs';
import {hash} from '../shared/engine.mjs';

function fixture(){
 const pageUrl='https://fixture.test/form?job=role-a',roleUrl='https://fixture.test/job/role-a';
 const context={batchId:'batch',contentSha256:'confirmed-content',companyId:'sample',roleId:'role-a',roleUrl,materials:{schemaVersion:1,items:[{key:'referralCode',status:'available',value:'ExampleCode',raw:'ExampleCode',requireWhenAvailable:true,evidence:{masterDataSha256:'master',roleUrl}}]}};
 const controls=[{selector:'#name',label:'Name',type:'text'}],capture={captureId:'capture',companyId:'sample',pageUrl,controls};
 const field={id:'name',source:'name',label:'Name',kind:'text',required:true,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]};
 const template={id:'fixture',version:1,evidence:{sourceUrl:pageUrl,observedAt:'fixture'},coverage:{allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:true},pages:[{pathPrefix:'/form',readySelector:'#name',roleTitle:'Product',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[field]}]};
 const profile={sources:{},facts:{}},args={context,pageUrl,template,templateHash:hash(template),capture,controls,key:'referralCode',evidence:'User explicitly confirms this role does not use this code because the site has no destination.'};
 const scoped=()=>withMaterialDispositions(profile,context,{pageUrl,templateHash:hash(template)});
 const job=ctx=>({companyId:'sample',roleId:'role-a',pageUrl,templateHash:hash(template),...resolveMaterialValues(ctx),values:{...resolveMaterialValues(ctx).values,name:'Example'},sources:{name:{kind:'user_reply'}},files:{}});
 return {profile,args,scoped,job,context,template,pageUrl};
}
test('a user-confirmed no-destination decision is scoped, frozen and reported as an explicit omission',async()=>{
 const f=fixture();assert.deepEqual(materialAudit(f.template.pages[0].fields,f.job(f.context)).blockers,['ROLE_MATERIAL_DESTINATION_REQUIRED']);
 recordMaterialDestinationException(f.profile,f.args);
 const task=f.job(f.scoped()),plan=await compileExecutionPlan(f.template,task);
 assert.equal(plan.materialCoverage.complete,true);assert.equal(plan.materialCoverage.exceptions.length,1);assert.equal(plan.readyForExecution,true);
 const readback=verifyMaterialCoverage({materialAudit:plan.materialCoverage,fields:[]},{fields:{},materialDestinationKeys:[]});assert.equal(readback.complete,true);assert.equal(readback.checks[0].status,'confirmed_omission');
 assert.equal(f.context.materials.items[0].value,'ExampleCode');assert.equal(f.profile.facts['material:referralCode'],undefined);
 await assert.rejects(assertPreparedPlan(plan,f.template,{...f.job(f.context),planId:plan.id,planHash:plan.planHash},{}),/PREPARED_PLAN_INPUTS_CHANGED/);
});
test('a live placeholder-only code destination blocks writing and independent completion',async()=>{
 const f=fixture();recordMaterialDestinationException(f.profile,f.args);const audit=materialAudit(f.template.pages[0].fields,f.job(f.scoped()));
 const changed=[{selector:'#name',label:'Name',type:'text',placeholder:'请输入推荐码'}];
 assert.throws(()=>assertMaterialDestinationsRemainAbsent(audit,changed),/MATERIAL_DESTINATION_APPEARED_EXCEPTION_INVALID/);
 assert.equal(verifyMaterialCoverage({materialAudit:audit,fields:[]},{fields:{},materialDestinationKeys:['referralCode']}).complete,false);
 assert.equal(verifyMaterialCoverage({materialAudit:audit,fields:[]},{fields:{}}).complete,false);
});
test('an actual code destination is always mandatory even when an exception was recorded',()=>{
 const f=fixture();recordMaterialDestinationException(f.profile,f.args);
 const field={source:'material:referralCode',id:'code',label:'推荐码',required:false};
 const task=f.job(f.scoped());delete task.values['material:referralCode'];
 assert.ok(materialAudit([field],task).blockers.includes('ROLE_MATERIAL_VALUE_NOT_RESOLVED'));
 for(const location of ['controls','capture','template']){
  const g=fixture();if(location==='controls')g.args.controls=[field];if(location==='capture')g.args.capture.controls=[field];if(location==='template')g.args.template.pages[0].fields=[field];
  assert.throws(()=>recordMaterialDestinationException(g.profile,g.args),/MATERIAL_DESTINATION_EXISTS_CANNOT_EXEMPT/);
 }
});
test('exceptions cannot leak across page, template, role, batch, materials, or withdrawn user source',()=>{
 for(const change of ['page','template','role','batch','materials','source']){
  const f=fixture();recordMaterialDestinationException(f.profile,f.args);
  let context=structuredClone(f.context),pageUrl=f.pageUrl,templateHash=hash(f.template);
  if(change==='page')pageUrl+='&other=1';if(change==='template')templateHash='a'.repeat(64);if(change==='role')context.roleId='other';if(change==='batch')context.contentSha256='changed';if(change==='materials')context.materials.items[0].value='ChangedCode';if(change==='source')f.profile.sources={};
  const ctx=withMaterialDispositions(f.profile,context,{pageUrl,templateHash});assert.equal(ctx.dispositions,undefined);
 }
});
test('registration refuses absent confirmation, wrong capture, and unavailable material',()=>{
 for(const change of ['evidence','capture','material']){
  const f=fixture();if(change==='evidence')f.args.evidence='';if(change==='capture')f.args.capture.pageUrl='https://fixture.test/other';if(change==='material')f.context.materials.items[0].status='absent';
  assert.throws(()=>recordMaterialDestinationException(f.profile,f.args));assert.deepEqual(f.profile.sources,{});
 }
});
test('explicit revocation invalidates old plans and prevents new exception-based plans',async()=>{
 const f=fixture();recordMaterialDestinationException(f.profile,f.args);const task=f.job(f.scoped()),plan=await compileExecutionPlan(f.template,task);
 revokeMaterialDestinationException(f.profile,{context:f.context,pageUrl:f.pageUrl,key:'referralCode',evidence:'User withdraws this role-specific exception.'});
 assert.equal(f.scoped().dispositions,undefined);const next=f.job(f.scoped());assert.ok(materialAudit(f.template.pages[0].fields,next).blockers.includes('ROLE_MATERIAL_DESTINATION_REQUIRED'));
 await assert.rejects(assertPreparedPlan(plan,f.template,{...next,planId:plan.id,planHash:plan.planHash},{}),/PREPARED_PLAN_INPUTS_CHANGED/);
 const g=fixture();recordMaterialDestinationException(g.profile,g.args);Object.values(g.profile.sources)[0].revokedAt=new Date().toISOString();assert.equal(g.scoped().dispositions,undefined);
});
