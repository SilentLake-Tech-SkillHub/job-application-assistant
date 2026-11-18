import test from 'node:test';
import {unresolvedRepeatSections} from '../shared/repeat-groups.mjs';
import assert from 'node:assert/strict';
import {retainReviewedPrimary,currentPrimaryContinuation} from '../shared/form-visual-inventory.mjs';
import {pageFromTemplate,runConstructionBuild} from '../shared/construction-orchestrator.mjs';

for(const framework of ['ant','feishu','phoenix'])test(framework+' child-only growth retains the primary comparison but a new primary does not',()=>{
 const page={pageId:'chrome:p',pageUrl:'https://example.test/apply?role=one',generation:'g',sessionId:'session'};
 const primary={id:'r1',kind:'field',label:'Degree',controlType:'choice',selectors:['#degree']},extra={id:'r2',kind:'field',label:'Degree 2',controlType:'choice',selectors:['#degree2']};
 const review={status:'passed',visualHash:'visual',screenshotId:'shot',structureHash:'baseline',matches:[{visualId:'v1',reaId:'r1'}],expansionIds:[]};
 const table={current:{page,inventoryHash:'visual',screenshotId:'shot',surveyRevision:2}};
 const asset={visualPage:page,contentHash:'changed',provider:framework,controls:[],primaryCandidates:[primary,extra]};
 const retained=retainReviewedPrimary(asset,{primaryCandidates:[primary]},table,{review},{verifiedLocalSelectors:['#degree2']});
 assert.equal(retained.primaryContentHash,'baseline');
 assert.ok(currentPrimaryContinuation(table,{review},retained,page));
 assert.equal(retainReviewedPrimary({...asset,primaryCandidates:[{...primary,label:'Company'},extra]},{primaryCandidates:[primary]},table,{review},{verifiedLocalSelectors:['#degree2']}).primaryContentHash,undefined);
 assert.equal(retainReviewedPrimary(asset,{primaryCandidates:[primary]},table,{review}).primaryContentHash,undefined);
});

test('shared template optional identity is bound to the current role before the internal schema',()=>{
 const template={companyTemplateVersion:2,pages:[{readySelector:'#r',sections:['Edu'],roleIdentity:{source:'query',parameter:'job'}}]};
 assert.equal(pageFromTemplate(template,{pageUrl:'https://example.test/form?job=R42',officialId:'R42'}).roleIdentity.value,'R42');
 assert.equal(pageFromTemplate(template,{pageUrl:'https://example.test/form'}).roleIdentity,undefined);
});

test('stage 2 consumes safely suggested option capture once and seals without going back to the caller',async()=>{
 const args={companyId:'C00001',pageUrl:'https://example.test/apply',captureId:'capture-C00001',queue:{taskId:'task'}};
 let stage='build',choices=false;const calls=[];
 const deps={cycle:async()=>({stage,templateHash:'h'}),profile:async()=>({}),template:async()=>null,update:async()=>({construction:{conditionProbeId:'p'}}),
 call:async(tool,a)=>{
  calls.push(tool);
  if(tool==='form_mapping_candidates')return {candidates:[]};
  if(tool==='form_build_template')return {readyToRegister:choices,templateId:'T',templateHash:'h',nextGoals:choices?[]:[{selector:'#select',captureId:args.captureId,nextTool:'capture_choice_options'}]};
  if(tool==='capture_choice_options'){assert.deepEqual(a.selectors,['#select']);choices=true;return {status:'captured'};}
  if(tool==='template_register'){stage='interaction_test';return {status:'registered'};}
  if(tool==='form_test_interactions'){stage='confirm';return {status:'verified'};}
  if(tool==='template_finalize')return {status:'company_template_ready',templateHash:'h'};
  throw Error(tool);
 }};
 const r=await runConstructionBuild({deps,task:args,authorization:{prepare:true,evidence:'authorized'},page:{readySelector:'#form',sections:['Basic']}});
 assert.equal(r.status,'company_template_ready');
 assert.equal(calls.filter(x=>x==='capture_choice_options').length,1);
 assert.equal(r.stageMetrics.operationCounts.form_test_interactions,1);
});
test('unmapped or duplicated repeat source rows cannot trigger additional blank records',()=>{
 const field=(section,index,source)=>({source,inventorySelectors:[`#formily-item-${section}_list [class^="apply-form-array-card__"]:nth-child(${index}) input`]});
 const sections=unresolvedRepeatSections({fields:[
  field('works',1,'portfolio.first.link'),field('works',2,'unmapped.company.field'),
  field('projects',1,'projects.first.title'),field('projects',2,'projects.first.title'),
  field('education',1,'education.first.school'),field('education',1,'unmapped.company.helper')
 ]});
 assert.deepEqual([...sections],['works','projects']);
});
