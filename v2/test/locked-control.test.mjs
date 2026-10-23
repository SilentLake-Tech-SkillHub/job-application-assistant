import test from 'node:test';import assert from 'node:assert/strict';
import {captureLockedChoice} from '../shared/locked-control.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';
import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';
import {performAntDay} from '../shared/ant-date.mjs';
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
test('readiness accepts multiple visible form roots without treating them as an action target',async()=>{
 const browser=new BrokerBrowserAdapter('unused'),calls=[];browser.request=async(method,args)=>{calls.push({method,args});return method==='observe'?{groups:{ready:2}}:{found:true};};
 const page=await browser.existingPage('https://sample.test/form');await page.wait('form');assert.equal(calls.at(-1).method,'observe');assert.deepEqual(calls.at(-1).args.plan.fields,[]);
});
test('ongoing dates require an actual captured footer option; inspection restores the prior value',async()=>{
 let value='',opened=false,clicks=0;const labels=['至今'];
 const input={count:async()=>1,evaluate:async fn=>fn({tagName:'INPUT',closest:()=>({}),get value(){return value;}}),click:async()=>{opened=true;},press:async key=>{if(key==='Escape')opened=false;}};
 const panel={filter(){return this;},count:async()=>opened?1:0,waitFor:async()=>{},innerText:async()=>labels.join(' '),locator:()=>({filter(){return this;},allTextContents:async()=>labels}),getByText:label=>({count:async()=>labels.includes(label)?1:0,click:async()=>{clicks++;value='至今';opened=false;}})};
 const page={resolveSelector:async s=>s,page:{locator:s=>s==='#end'?input:panel}};
 const capture=await performAntDay(page,{selector:'#end',operation:'inspect'},null);assert.equal(capture.dateOptions.ongoingLabel,'至今');assert.equal(capture.restored,true);assert.equal(clicks,0);assert.equal(opened,false);
 await assert.rejects(performAntDay(page,{selector:'#end'},'至今'),/ONGOING_DATE_OPTION_NOT_CAPTURED/);
 await performAntDay(page,{selector:'#end',ongoingLabel:capture.dateOptions.ongoingLabel},'至今');assert.equal(value,'至今');assert.equal(clicks,1);
 value='';labels.splice(0,1,'Today');const absent=await performAntDay(page,{selector:'#end',operation:'inspect'},null);assert.equal(absent.dateOptions.ongoingLabel,null);assert.equal(value,'');
});
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
