import test from 'node:test';import assert from 'node:assert/strict';
import {captureLockedChoice} from '../shared/locked-control.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';
import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';
const field={selector:'#country',selectedSelector:'#selected-country',label:'Country',type:'combobox',renderer:'ant_select',contextProvider:'.ant-form-item',disabled:true};
test('disabled controls require a stable observed selected value; empty or unlocked controls retain dependency blockers',async()=>{
 for(const patch of [{disabled:false},{selected:false},{value:''},{present:false}]){
  const page={observe:async()=>({fields:{locked:{present:true,disabled:true,selected:true,value:'Country',...patch}}})};assert.equal((await captureLockedChoice(page,field)).status,'disabled_by_parent');
 }
 const page={observe:async()=>({readAt:new Date().toISOString(),fields:{locked:{present:true,disabled:true,selected:true,value:'Country'}}})},choice=await captureLockedChoice(page,field);
 assert.equal(choice.status,'captured_locked_value');assert.deepEqual(choice.options,['Country']);
 const pageContract={roleTitle:'Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}},capture={companyId:'sample',pageUrl:'https://sample.test/form',captureId:'capture',observedAt:'synthetic',controls:[field]},profile={facts:{country:{status:'known',value:'Country'}},fieldRegistry:{}};
 const b=buildFormTemplate({capture,profile,mappings:[{selector:field.selector,factKey:'country'}],choices:[{...choice,selector:field.selector}],page:pageContract,templateId:'sample'});assert.equal(b.readyToRegister,true);assert.equal(b.template.pages[0].fields[0].readonly,true);assert.deepEqual(b.template.pages[0].fields[0].actions,[]);
 const expected=compileExpected(b.template.pages[0],{companyId:'sample',pageUrl:capture.pageUrl,values:{country:'Country'}}),observed={source:'live_dom',readAt:new Date().toISOString(),pageUrl:capture.pageUrl,roleTitle:'Role',sections:pageContract.sections,inventoryIds:[b.template.pages[0].fields[0].id],fields:{[b.template.pages[0].fields[0].id]:{present:true,value:'Country',selected:true,disabled:true}}};
 assert.equal(verifyForm(expected,observed).status,'verified');Object.values(observed.fields)[0].disabled=false;assert.equal(verifyForm(expected,observed).status,'needs_attention');
});
test('an end-date mapping takes its same-record sourced ongoing flag; another record cannot supply it',()=>{
 const c={companyId:'sample',pageUrl:'https://sample.test/form',captureId:'c',observedAt:'synthetic',controls:[{selector:'#end',label:'End',type:'date',tag:'input'}]},profile={facts:{'projects.one.ongoing':{status:'known',value:true}},fieldRegistry:{}},page={roleTitle:'Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Dates'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}};
 const build=source=>buildFormTemplate({capture:c,profile,mappings:[{selector:'#end',factKey:source}],page,templateId:'sample'}).template.pages[0].fields[0];
 assert.equal(build('projects.one.end').ongoingSource,'projects.one.ongoing');assert.equal(build('projects.two.end').ongoingSource,undefined);
});
