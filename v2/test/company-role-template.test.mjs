import test from 'node:test';import assert from 'node:assert/strict';
import {toCompanyRoleTemplate,ensureRoleBindings,selectCompanyRole,resolveCompanyRoleTemplate} from '../shared/company-role-template.mjs';
const config={origin:'https://fixture.test',allowedPaths:['/campus/'],entry:{recipe:'feishu_campus_detail_to_form',params:{pathPrefix:'campus'}}};
const roles=[{companyId:'C00001',roleId:'J000001',title:'Role A',officialId:'111',url:config.origin+'/campus/position/111/detail'},{companyId:'C00001',roleId:'J000002',title:'Role B',officialId:'222',url:config.origin+'/campus/position/222/detail'}];
const legacy={id:'C00001',version:1,evidence:{sourceUrl:config.origin+'/campus/resume/111/apply'},pages:[{pathPrefix:'/campus/resume/111/apply',roleTitle:'Role A',readySelector:'#form',roleSelector:'h1',fields:[{id:'name',source:'name',actions:[{method:'fill',selector:'#name'}]}]}]};
test('two roles share one control definition and use their own current targets in alternating order',()=>{
 const template=toCompanyRoleTemplate(legacy,roles),before=JSON.stringify(template);
 assert.equal(template.pages[0].pathPrefix,undefined);assert.equal(template.pages[0].roleTitle,undefined);assert.deepEqual(Object.keys(template.roleBindings),['J000001','J000002']);
 for(const role of [roles[1],roles[0],roles[1]]){
  const pageUrl=config.origin+`/campus/resume/${role.officialId}/apply`,resolved=resolveCompanyRoleTemplate(template,{companyId:'C00001',role,pageUrl},config);
  assert.equal(resolved.pages[0].fields,template.pages[0].fields);assert.equal(resolved.pages[0].roleTitle,role.title);assert.equal(resolved.pages[0].pathPrefix,new URL(pageUrl).pathname);
 }
 assert.equal(JSON.stringify(template),before);assert.equal(template.evidence.sourceUrl,legacy.evidence.sourceUrl);
});
test('role lookup is fixed by code or an unambiguous registered role page',()=>{
 assert.equal(selectCompanyRole(roles,{roleId:'J000002'},config),roles[1]);assert.equal(selectCompanyRole(roles,{pageUrl:config.origin+'/campus/resume/222/apply'},config),roles[1]);
 assert.throws(()=>selectCompanyRole(roles,{roleId:'J000999'},config),/ROLE_NOT_IN_COMPANY/);
});
test('another role address and role-local copied controls are rejected',()=>{
 const template=toCompanyRoleTemplate(legacy,roles);
 assert.throws(()=>resolveCompanyRoleTemplate(template,{companyId:'C00001',role:roles[1],pageUrl:config.origin+'/campus/resume/111/apply'},config),/ROLE_TEMPLATE_PAGE_MISMATCH/);
 template.roleBindings.J000002.fields=[];assert.throws(()=>resolveCompanyRoleTemplate(template,{companyId:'C00001',role:roles[1],pageUrl:config.origin+'/campus/resume/222/apply'},config),/ROLE_BINDING_MUST_SHARE_CONTROLS/);
});
test('adding a role updates references without duplicating or changing controls',()=>{
 const template=toCompanyRoleTemplate(legacy,roles.slice(0,1)),updated=ensureRoleBindings(template,roles);
 assert.equal(updated.pages,template.pages);assert.equal(Object.keys(updated.roleBindings).length,2);assert.equal(ensureRoleBindings(updated,roles),updated);
});

import {Engine,Store,hash} from '../shared/engine.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';
import {mkdtemp,rm,readdir} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
test('company-role lookup stays consistent through compile and both preparation checks',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'company-role-execution-'));
 try{
  const field={id:'name',label:'Name',source:'name',kind:'text',required:false,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]};
  const old={...legacy,version:1,evidence:{...legacy.evidence,observedAt:'synthetic'},pages:[{...legacy.pages[0],sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[field]}]};
  const template=toCompanyRoleTemplate(observedSeal(old,'C00001').template,roles),store=new Store(dir);await store.put('templates',template.id,template);
  const engine=new Engine({store,companies:[{id:'C00001',origin:config.origin,templateId:template.id}],routeTemplate:async(t,task)=>resolveCompanyRoleTemplate(t,{...task,role:roles.find(r=>r.roleId===task.roleId)},config),resolveTask:async t=>({...t})});
  const visited=[];engine.runCompany=async({task,template:t})=>{const resolved=await engine.routeTemplate(t,task);visited.push(resolved.pages[0].roleTitle);return {companyId:task.companyId,status:'verified',fields:[],pageChecks:[],submission:'not_performed'};};
  for(const role of [roles[1],roles[0]]){const task={companyId:'C00001',roleId:role.roleId,pageUrl:config.origin+`/campus/resume/${role.officialId}/apply`,templateHash:hash(template),values:{name:'Example'}};const plan=await engine.preparePlan(task);let id;for(let i=0;i<20;i++){const result=await engine.prepare({tasks:[{...task,planId:plan.planId,planHash:plan.planHash}],authorization:{prepare:true,evidence:'synthetic'}});id??=result.id;assert.equal(result.id,id);}}
  assert.deepEqual(visited,[...Array(20).fill('Role B'),...Array(20).fill('Role A')]);assert.equal((await readdir(path.join(dir,'runs'))).filter(x=>x.startsWith('batch-current-')).length,2);assert.equal(hash(await store.get('templates',template.id)),hash(template));
 }finally{await rm(dir,{recursive:true,force:true});}
});
