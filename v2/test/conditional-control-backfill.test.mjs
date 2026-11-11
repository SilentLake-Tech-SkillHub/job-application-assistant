import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../shared/engine.mjs';
import {conditionalControlBackfill} from '../shared/conditional-control-backfill.mjs';
const fixture=()=>{
 const field={source:'answers.ambassador',inventoryLabel:'推荐码',inventoryType:'text',required:false,inventorySelectors:['#old input'],when:{source:'channel',equals:'Ambassador'}};
 const template={pages:[{fields:[{source:'channel',kind:'choice',control:{options:['None','Ambassador']}},field]}]},binding={generation:'document',sessionId:'browser'};
 const capture={companyId:'C00001',pageUrl:'https://example.test/apply',pageId:'chrome:page',visualPage:binding,controls:[]};
 const probe={operation:'internal_condition_probe',companyId:capture.companyId,pageUrl:capture.pageUrl,pageId:capture.pageId,browserBinding:binding,templateHash:hash(template),restoration:'verified',status:'needs_attention',branches:[{source:'channel',value:'Ambassador',selected:true,roleMatched:true,inventory:[{selector:'input[placeholder="code"]',label:'推荐码',type:'text',required:false}],selectorEquivalences:[{selector:'#old input',reference:'input[placeholder="code"]'}]}]};
 return {capture,previous:[template],probe,mappings:[{selector:'input[placeholder="code"]',factKey:'material:referralCode',mappingEvidence:'Observed exact role-material question semantic'}]};
};
test('a failed but restored conditional probe backfills the same observed input and its existing meaning',()=>{
 const input=fixture(),result=conditionalControlBackfill(input);
 assert.equal(result.controls.length,1);assert.deepEqual(result.controls[0].when,{source:'channel',equals:'Ambassador'});assert.deepEqual(result.obsoleteSelectors,['#old input']);assert.equal(result.mappings[0].factKey,'answers.ambassador');
 input.mappings[0]={...input.mappings[0],factKey:'answers.current',mappingEvidence:'new explicit semantic mapping'};assert.deepEqual(conditionalControlBackfill(input).mappings,[]);
});
test('a locator guess, different page, failed restoration or unselected branch cannot manufacture conditional coverage',()=>{
 for(const mutate of [x=>x.probe.branches[0].selectorEquivalences=[],x=>x.probe.pageId='chrome:other',x=>x.probe.browserBinding={generation:'other',sessionId:'browser'},x=>x.probe.restoration='failed',x=>x.probe.branches[0].selected=false,x=>x.probe.branches[0].value='Unknown']){const input=fixture();mutate(input);assert.deepEqual(conditionalControlBackfill(input).controls,[]);}
});
