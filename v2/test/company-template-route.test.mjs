import {observedSeal} from './fixtures/observed-seal.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {bindCompanyTemplateRoute} from '../shared/company-template-route.mjs';
const config={origin:'https://fixture.test',allowedPaths:['/campus/'],entry:{recipe:'feishu_campus_detail_to_form',params:{pathPrefix:'campus'}}};
const template={id:'C00001',evidence:{sourceUrl:'https://fixture.test/campus/resume/111/apply'},pages:[{pathPrefix:'/campus/resume/111/apply',fields:[{source:'profile.name'}]}]};
test('one company template binds to another confirmed role on the registered form route',()=>{const result=bindCompanyTemplateRoute(template,'https://fixture.test/campus/resume/222/apply',config);assert.equal(result.id,template.id);assert.equal(result.pages[0].pathPrefix,'/campus/resume/222/apply');assert.equal(result.pages[0].sourcePathPrefix,template.pages[0].pathPrefix);assert.equal(template.pages[0].pathPrefix,'/campus/resume/111/apply');assert.equal(result.pages[0].fields,template.pages[0].fields);});
test('other origins, tenants and non-form pages are not covered',()=>{for(const url of ['https://other.test/campus/resume/222/apply','https://fixture.test/other/resume/222/apply','https://fixture.test/campus/position/222/detail'])assert.equal(bindCompanyTemplateRoute(template,url,config),template);});
test('existing covered page keeps its exact object and metadata',()=>assert.equal(bindCompanyTemplateRoute(template,template.evidence.sourceUrl,config),template));
import {Engine,Store,hash} from '../shared/engine.mjs';
import {assertPreparedPlan} from '../shared/execution-plan.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('runtime path binding compiles and revalidates a frozen plan while stored company template stays unchanged',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'company-role-route-'));
 try{
  const raw={...template,version:1,coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true},evidence:{...template.evidence,observedAt:'synthetic'},pages:[{...template.pages[0],readySelector:'#form',roleTitle:'Original',roleSelector:'h1',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[{id:'name',label:'Name',source:'name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]};
  const t=observedSeal(raw,"C00001").template;
  const store=new Store(dir);await store.put('templates',t.id,t);
  const routeTemplate=async(t,task)=>bindCompanyTemplateRoute(t,task.pageUrl,config);
  const e=new Engine({store,companies:[{id:'C00001',origin:config.origin,templateId:t.id}],routeTemplate});
  const task={companyId:'C00001',pageUrl:config.origin+'/campus/resume/222/apply',templateHash:hash(t),values:{name:'Fixture'},confirmedRole:{title:'Current',officialId:'222'}};
  const p=await e.preparePlan(task);assert.equal(p.readyForExecution,true,JSON.stringify(p));
  const saved=await store.get('plans',p.planId);assert.equal(saved.pages[0].pathPrefix,'/campus/resume/222/apply');
  await assertPreparedPlan(saved,await routeTemplate(t,task),{...task,planId:p.planId,planHash:p.planHash},{prepare:true});
  assert.equal(hash(await store.get('templates',t.id)),hash(t));
 }finally{await rm(dir,{recursive:true,force:true});}
});
