import test from 'node:test';import assert from 'node:assert/strict';
import {assertMappingCapture} from '../shared/mapping-capture.mjs';
import {captureContentHash} from '../shared/acquisition-chain.mjs';
import {registerPlannedQuestions} from '../shared/profile.mjs';
import {withProfileRecords,recordPlanOf} from '../shared/repeat-groups.mjs';
const fixture=()=>{
 const capture={companyId:'C00001',formId:'C00001',captureId:'capture-C00001',pageId:'chrome:original',pageUrl:'https://sample.test/form',controls:[{selector:'#field',label:'Name',type:'text'}]};capture.contentHash=captureContentHash(capture);
 const template={id:'C00001',coverage:{allConditionalBranchesVerified:true,allControlsMapped:true,allDriversSupported:true,proof:{runId:'built'}},evidence:{formId:'C00001',sourceUrl:capture.pageUrl},pages:[{pathPrefix:'/form'}]};
 return {capture,template,store:{get:async(group,id)=>{if(id===capture.captureId)return capture;throw Object.assign(Error('missing'),{code:'ENOENT'});}}};
};
test('built company mapping uses current captured questions without reacquiring REA',async()=>{const f=fixture();assert.equal((await assertMappingCapture(f.store,{companyId:f.capture.companyId,captureId:f.capture.captureId,template:f.template})).mode,'existing_company_capture');});
test('unbuilt company retains the first acquisition chain',async()=>{const f=fixture();delete f.template.coverage;await assert.rejects(assertMappingCapture(f.store,{companyId:f.capture.companyId,captureId:f.capture.captureId,template:f.template}),/MCP_ACQUISITION_CHAIN_REQUIRED/);});
test('built mapping rejects another company, page, capture edits and changed form identity',async()=>{
 for(const mutate of [f=>f.capture.companyId='C00002',f=>f.capture.pageUrl='https://other.test/form',f=>f.capture.controls[0].label='Edited',f=>f.capture.formId='C00002',f=>f.capture.pageId=null]){const f=fixture();mutate(f);await assert.rejects(assertMappingCapture(f.store,{companyId:'C00001',captureId:'capture-C00001',template:f.template}),/ACQUISITION_/);}
});
test('live added record registers the expanded approved source instead of a new personal question',()=>{
 const selector=i=>`#formily-item-project_list [class^="apply-form-array-card__"]:nth-child(${i}) input`;
 const profile={schemaVersion:1,entities:{projects:['first','second']},facts:{'projects.first.name':{status:'known',value:'First'},'projects.second.name':{status:'known',value:'Second'}},fieldRegistry:{},companyForms:{}};
 const template={pages:[{fields:[{id:'name',label:'项目名称',source:'projects.first.name',kind:'text',required:false,inventoryLabel:'项目名称',inventoryType:'text',inventorySelectors:[selector(1)],read:{selector:selector(1),kind:'value'},actions:[{method:'fill',selector:selector(1)}]}],groups:[{id:'project',selector:'#formily-item-project_list [class^="apply-form-array-card__"]',addSelector:'#add',count:1}]}]};
 const fields=[{selector:selector(2),label:'项目名称',type:'text',required:false}],args={companyId:'C00001',companyCode:'C00001',pageUrl:'https://sample.test/form',fields,observedAt:'now'};
 const old=structuredClone(profile),prior=registerPlannedQuestions(old,args,template.pages[0]);assert.equal(Object.values(old.companyForms[prior.pageKey].mappings)[0].status,'needs_semantic_mapping');
 const r=registerPlannedQuestions(profile,args,withProfileRecords(template,recordPlanOf(profile)).pages[0]);assert.equal(Object.values(profile.companyForms[r.pageKey].mappings)[0].factKey,'projects.second.name');
});
