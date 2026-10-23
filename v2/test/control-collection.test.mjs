import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {CONTROL_TYPES,CONTROL_METHODS,templateMethods} from '../shared/control-registry.mjs';
import {controlDOM} from '../shared/control-dom.mjs';
import {PageAdapter} from '../shared/ui-page.mjs';
import {locateControl} from '../shared/control-operations.mjs';
import {withHostBrowserBridge} from '../shared/host-browser-bridge.mjs';
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';

test('all declared control contracts share the frozen action registry; inspections never enter templates',()=>{
 assert.equal(Object.keys(CONTROL_TYPES).length,11);
 for(const c of Object.values(CONTROL_TYPES)){assert.ok(Object.isFrozen(c));for(const m of c.methods)assert.ok(templateMethods().has(m));assert.ok(c.reads.length);}
 assert.equal(templateMethods().has('ud_dropdown_inspect'),false);assert.equal(templateMethods().has('capture_wecruit_schema'),false);
 assert.ok(CONTROL_METHODS.ant_day);assert.throws(()=>CONTROL_TYPES.text.methods.push('submit'));
});
function fakeDOM(nodes){
 const document={querySelectorAll:s=>nodes[s]||[],querySelector:s=>(nodes[s]||[])[0]||null};
 return spec=>vm.runInNewContext('('+controlDOM.toString()+')(spec)',{document,spec,location:{href:'https://fixture.test/form'},getComputedStyle:()=>({visibility:'visible'}),Date});
}
const element=(value,shown=true,extra={})=>({value,tagName:'INPUT',getClientRects:()=>shown?[{}]:[],getAttribute:()=>null,querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,...extra});
test('independent readback ignores hidden duplicate but rejects two visible answers',()=>{
 const read=fakeDOM({'#answer':[element('hidden',false),element('actual')]});
 assert.equal(read({fields:[{id:'a',read:{kind:'value',selector:'#answer'}}]}).fields.a.value,'actual');
 const ambiguous=fakeDOM({'#answer':[element('one'),element('two')]});
 assert.equal(ambiguous({fields:[{id:'a',read:{kind:'value',selector:'#answer'}}]}).fields.a.present,false);
});
test('section readback visits every captured root once and preserves actual titles',()=>{
 const root=title=>element(null,true,{tagName:'DIV',querySelector:()=>({innerText:title})}),read=fakeDOM({'#one':[root('One')],'#two':[root('Two')]});
 assert.deepEqual(JSON.parse(JSON.stringify(read({fields:[],sectionDiscovery:{selector:'form',selectors:['#one','#two','#one'],titleSelector:'h3'}}).sections)),[{title:'One',unexpanded:false},{title:'Two',unexpanded:false}]);
});
test('styled checkbox uses visible label; files need rendered server evidence',()=>{
 const label=element(null);const input=element(null,false,{type:'checkbox',checked:false,closest:s=>s==='label'?label:null});
 const file=element(null,true,{tagName:'INPUT',type:'file',files:[{name:'local.pdf'}]});
 const read=fakeDOM({'#check':[input],'#file':[file]});
 const r=read({fields:[{id:'b',read:{kind:'checked',selector:'#check'}},{id:'f',read:{kind:'files',selector:'#file'}}]});
 assert.equal(r.fields.b.present,true);assert.equal(r.fields.b.value,false);assert.equal(r.fields.f.uploadState,'unverified');
});
test('same shared readback handles native select, ARIA radio, month and attachment rows',()=>{
 const radio=element(null,true,{textContent:'B',getAttribute:k=>k==='aria-label'?'B':null});
 const name=element(null,true,{innerText:'resume.pdf'});
 const read=fakeDOM({'#select':[element(null,true,{tagName:'SELECT',selectedOptions:[{textContent:'A',value:'a'}]})],
 '#radio':[element(null,true,{querySelectorAll:()=>[radio]})],
 '#month':[element(null,true,{innerText:'2026-10',querySelector:s=>({innerText:s.includes('year')?'2026':'10'})})],
 '#files':[element(null,true,{tagName:'DIV',querySelectorAll:()=>[name]})],'#uploaded':[element(null)]});
 const fields=[['select','value'],['radio','radio'],['month','month'],['files','files']].map(([id,kind])=>({id,read:{selector:'#'+id,kind,...(kind==='files'?{filenameSelector:'.filename',uploadedSelector:'#uploaded'}:{})}}));
 const r=read({fields}).fields;assert.equal(r.select.value,'A');assert.equal(r.radio.value,'B');assert.equal(r.month.value,'2026-10');assert.equal(r.files.uploadState,'site_rendered_uploaded');
});
test('ambiguous actions cannot use first to bypass uniqueness; visible duplicate is resolved',async()=>{
 const l={count:async()=>2,filter:()=>({count:async()=>2})};await assert.rejects(locateControl({locator:()=>l},{selector:'.x',first:true}),/AMBIGUOUS/);
 const visible={count:async()=>1};assert.equal(await locateControl({locator:()=>({count:async()=>2,filter:()=>visible})},{selector:'.x'}),visible);
});
function fixture(family='ud',duplicate=false){
 let opened=false,selected='Original',checks=0;
 const node={classList:{contains:c=>family==='phoenix'&&c==='phoenix-select'},tagName:'INPUT',type:'text',value:'',readOnly:false,textContent:'Original',getAttribute:k=>k==='role'?'combobox':null,querySelector:()=>null};
 const single={fill:async value=>{node.value=value;},waitFor:async()=>{},count:async()=>1,innerText:async()=>selected,evaluate:async f=>f(node),press:async key=>{if(key==='Escape')opened=false;},click:async()=>{opened=true;},locator:()=>({count:async()=>0}),filter(){return this;}};
 const option={...single,evaluate:async f=>f({tagName:'DIV',textContent:'Other',hasAttribute:()=>false,getAttribute:k=>k==='aria-selected'?String(selected==='Other'):null}),click:async()=>{selected='Other';opened=false;checks++;}};
 const options={...single,allTextContents:async()=>duplicate?['Other','Other']:['Other','Other extended'],first:()=>single,waitFor:async()=>{},filter:o=>{if(o.visible)return options;assert.ok(o.hasText.test('Other'));assert.equal(o.hasText.test('Other extended'),false);return option;}};
 const menu={first:()=>menu,count:async()=>opened?1:0,waitFor:async()=>{},filter(){return this;},locator:()=>options,evaluate:async (f,args)=>f({querySelectorAll:()=>[],parentElement:null,clientHeight:100,scrollHeight:100},args)};
 const page={url:()=> 'https://fixture.test/form',locator:s=>['.common-unmodeled-layer:has(.area-selector-container)','.common-unmodeled-layer:has(.list-item-container)'].includes(s)?{count:async()=>0,filter(){return this;}}:s==='.common-unmodeled-layer'?menu:s.endsWith(' > .ud-formily-item-label')?{...single,click:async()=>{opened=false;}}:s===('.ud__select__list')||s==='[role="listbox"]'||s==='.common-unmodeled-layer:has(.phoenix-selectList)'?menu:s.includes('ant-select-open')?{count:async()=>0,filter(){return this;}}:single};
 return {page,state:()=>({opened,selected,checks})};
}
for(const family of ['ud','aria','phoenix'])test(family+' dropdown scopes the visible menu and matches exact option text',async()=>{
 const f=fixture(family),p=new PageAdapter(f.page,{listOpenPageUrls:async()=>[]});
 await p.act({method:family==='ud'?'ud_dropdown':family==='phoenix'?'phoenix_dropdown':'dropdown',selector:'#question',labelSelector:'#question > .ud-formily-item-label',options:['Other']},'Other',{});
 assert.equal(f.state().selected,'Other');assert.equal(f.state().checks,1);
});
test('inspection preserves selection and duplicate visible options fail without a click',async()=>{
 const f=fixture(),p=new PageAdapter(f.page,{listOpenPageUrls:async()=>[]});const a={method:'ud_dropdown_inspect',selector:'#question',labelSelector:'#question > .ud-formily-item-label'};
 assert.equal((await p.act(a,null,{})).restored,true);assert.equal(f.state().selected,'Original');
 const d=fixture('ud',true),q=new PageAdapter(d.page,{listOpenPageUrls:async()=>[]});await assert.rejects(q.act({...a,method:'ud_dropdown',options:['Other']},'Other',{}),/CHOICE_NOT_UNIQUE/);assert.equal(d.state().checks,0);
});
test('text and checkbox operations reject a UI that did not commit its value',async()=>{
 let node={tagName:'INPUT',type:'text',value:'old',readOnly:false,getAttribute:()=>null,querySelector:()=>null};
 const l={count:async()=>1,evaluate:async f=>f(node),fill:async()=>{},press:async()=>{},setChecked:async()=>{}};
 const p=new PageAdapter({url:()=> 'https://fixture.test/form',locator:()=>l},{listOpenPageUrls:async()=>[]});
 await assert.rejects(p.act({method:'fill',selector:'#x'},'new',{}),/COMMIT_NOT_VERIFIED/);
 node={...node,type:'checkbox',checked:false};await assert.rejects(p.act({method:'check',selector:'#x'},true,{}),/COMMIT_NOT_VERIFIED/);
});
test('real RPC and direct page paths invoke the same UD driver',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'controls-'));const f=fixture();
 const tab={id:'1',url:async()=>f.page.url(),playwright:{locator:s=>f.page.locator(s)}};
 try{await withHostBrowserBridge({browser:{tabs:{list:async()=>[{id:'1',url:f.page.url()}],get:async()=>tab}},socketPath:path.join(d,'b.sock'),allowedOrigins:['https://fixture.test']},async({socketPath})=>{
  const p=await new BrokerBrowserAdapter(socketPath).existingPage(f.page.url());
  await p.act({method:'ud_dropdown',selector:'#question',labelSelector:'#question > .ud-formily-item-label',options:['Other']},'Other',{});
  assert.equal(f.state().checks,1);
 });}finally{await rm(d,{recursive:true,force:true});}
});

test('wait never requires an already-present control before it waits',async()=>{
 let waited=false;const locator={filter(options){assert.deepEqual(options,{visible:true});return this;},first(){return this;},waitFor:async()=>{waited=true;}};
 const p=new PageAdapter({url:()=> 'https://fixture.test/form',locator:()=>locator},{listOpenPageUrls:async()=>[]});
 await p.act({method:'wait',selector:'#late'},null,{});assert.equal(waited,true);
});
test('host role identity is read from actual query rather than the expected ID',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'identity-')),url='https://fixture.test/form?jobId=actual';
 const tab={id:'1',playwright:{evaluate:async(fn,args)=>vm.runInNewContext('('+fn.toString()+')(args)',{args,location:{href:url},URL,Date,document:{querySelectorAll:()=>[],querySelector:()=>null}})}};
 try{await withHostBrowserBridge({browser:{tabs:{list:async()=>[{id:'1',url}],get:async()=>tab}},socketPath:path.join(d,'b.sock'),allowedOrigins:['https://fixture.test']},async({socketPath})=>{const r=await new BrokerBrowserAdapter(socketPath).request('roleSnapshot',{pageId:'1',roleIdentity:{parameter:'jobId',value:'expected'}});assert.equal(r.roleIdentity.value,'actual');});}finally{await rm(d,{recursive:true,force:true});}
});

import {retireLegacyQuestionMappings} from '../shared/profile-migration.mjs';
import {hash} from '../shared/engine.mjs';
import {formLocation} from '../shared/profile.mjs';
test('locator upgrades replace inactive mappings only after full live proof, without deleting facts',()=>{
 const url='https://fixture.test/form',template={evidence:{sourceUrl:url},pages:[{fields:[{source:'hasNoExperience',inventorySelectors:['label.question input'],read:{selector:'label.question input'}}]}]};
 const key=hash({companyId:'fixture',pageUrl:formLocation(url)}).slice(0,20);
 const profile={facts:{hasNoExperience:{value:false}},companyForms:{[key]:{mappings:{old:{factKey:'hasNoExperience',selector:'input[type="checkbox"]',active:false,coverageRequired:true,status:'mapped'},unknown:{factKey:'unknown',selector:'#unknown',active:false,coverageRequired:true,status:'mapped'}}}}};
 const probe={operation:'internal_condition_probe',companyId:'fixture',templateHash:hash(template),status:'verified',restoration:'verified',branches:[{status:'verified',newQuestions:0,inventory:[{selector:'label.question input'}]}]};
 assert.equal(retireLegacyQuestionMappings(profile,{companyId:'fixture',template,probe}).retired,1);assert.ok(!profile.companyForms[key].mappings.old);assert.ok(profile.companyForms[key].mappings.unknown);assert.equal(profile.facts.hasNoExperience.value,false);
 assert.throws(()=>retireLegacyQuestionMappings(profile,{companyId:'fixture',template,probe:{...probe,restoration:'failed'}}),/PROOF_REQUIRED/);
});

import {canonicalControlSpec} from '../shared/control-registry.mjs';
test('semantic controls use one reference regardless of raw or URL-encoded transport',()=>{
 const raw='antq:'+JSON.stringify({section:'Basics',label:'Name',part:'control',occurrence:0,index:0});
 const encoded='antq:'+encodeURIComponent(raw.slice(5));
 assert.deepEqual(canonicalControlSpec({read:{selector:encoded},actions:[{selector:raw}]}),{read:{selector:raw},actions:[{selector:raw}]});
 assert.equal(canonicalControlSpec('antq:'+JSON.stringify({label:'Top 10%'})),'antq:'+JSON.stringify({label:'Top 10%'}));
 assert.throws(()=>canonicalControlSpec('antq:%invalid'),/INVALID_SEMANTIC/);
});

test('async controlled inputs are polled until committed without repeating the mutation',async()=>{
 let node={tagName:'INPUT',type:'checkbox',checked:false,readOnly:false,getAttribute:()=>null,querySelector:()=>null},writes=0,reads=0;
 const l={count:async()=>1,evaluate:async f=>{reads++;if(writes&&reads>3)node.checked=true;return f(node);},setChecked:async()=>{writes++;}};
 const p=new PageAdapter({url:()=> 'https://fixture.test/form',locator:()=>l},{listOpenPageUrls:async()=>[]});await p.act({method:'check',selector:'#check'},true,{});assert.equal(writes,1);assert.equal(node.checked,true);
});

test('captured keyboard input mode sends real keystrokes and independently reads committed value',async()=>{
 const node={tagName:'INPUT',type:'text',value:'old',readOnly:false,getAttribute:()=>null,querySelector:()=>null};let typed=0;
 const l={count:async()=>1,evaluate:async f=>f(node),fill:async v=>{assert.equal(v,'');node.value='';},pressSequentially:async v=>{typed++;node.value=v;},press:async()=>{}};
 const p=new PageAdapter({url:()=> 'https://fixture.test/form',locator:()=>l},{listOpenPageUrls:async()=>[]});await p.act({method:'fill',selector:'#text',inputMode:'keyboard'},'confirmed',{});assert.equal(node.value,'confirmed');assert.equal(typed,1);
});

import {projectDateValue} from '../shared/value-contract.mjs';
import {resolvedFieldValue} from '../shared/execution-plan.mjs';
import {compileExpected} from '../shared/observation.mjs';
test('sourced full dates project consistently to month and year without inventing precision',()=>{
 assert.equal(projectDateValue('2026-08-01','month'),'2026-08');assert.equal(projectDateValue('2026-08-01','year'),'2026');assert.equal(projectDateValue('2026-08','day'),'2026-08');assert.equal(projectDateValue('至今','month'),'至今');
 const f={id:'date',source:'start',kind:'date',precision:'month',read:{selector:'#date'}};const task={values:{start:'2026-08-01'}};assert.equal(resolvedFieldValue(f,task),'2026-08');assert.equal(compileExpected({fields:[f]},task).fields[0].value,'2026-08');
});

import {registerTemplateContract} from '../shared/profile.mjs';
test('portal month registration preserves canonical day precision and keeps its own contract precision',()=>{
 const p={schemaVersion:1,entities:{},sources:{s:{kind:'user_reply'}},facts:{start:{value:'2026-08-01',status:'known',sourceIds:['s'],precision:'day'}},fieldRegistry:{start:{canonicalType:'string',precision:'day'}}};
 const f={id:'start',source:'start',label:'Start',kind:'date',precision:'month',control:{type:'month_picker',valueType:'string',readbackType:'string'},read:{selector:'#start',kind:'value',selectedSelector:'#start'},actions:[{method:'ud_date',selector:'#start'}]};
 registerTemplateContract(p,{companyId:'sample',template:{id:'t',version:1,evidence:{sourceUrl:'https://example.com/form'},pages:[{pathPrefix:'/form',fields:[f]}]},templateHash:'hash'});
 assert.equal(p.fieldRegistry.start.precision,'day');assert.equal(p.facts.start.value,'2026-08-01');assert.equal(Object.values(p.companyForms)[0].executionContract.fields[0].precision,'month');
});

test('typed school search text is not an actual committed dropdown selection',()=>{
 const input=element('Invented University',true,{role:'combobox'}),read=fakeDOM({'#school':[input]});
 const result=read({fields:[{id:'school',kind:'choice',read:{kind:'value',selector:'#school',selectedSelector:'#school'}}]}).fields.school;
 assert.equal(result.value,'Invented University');assert.equal(result.selected,false);
});
test('field readback automatically carries website validation errors even without agent-supplied error selectors',()=>{
 const input=element('SampleCode',true,{getAttribute:key=>key==='aria-invalid'?'true':null}),read=fakeDOM({'#code':[input]});
 const result=read({fields:[{id:'code',read:{kind:'value',selector:'#code'}}]}).fields.code;
 assert.equal(result.errors[0].source,'aria_invalid');
});

test('Ant readonly search input opens via its selector and scopes rendered popup rather than hidden aria list',async()=>{
 let open=false,selected='Original',triggerClicks=0;const events=[];
 const inputNode={tagName:'INPUT',type:'search',readOnly:true,querySelector:()=>null,getAttribute:k=>({role:'combobox','aria-controls':'field_list','aria-expanded':String(open)})[k]??null};
 const display={count:async()=>1,filter(){return this;},click:async()=>{open=true;triggerClicks++;},innerText:async()=>selected};
 const parent={count:async()=>1,locator:s=>{assert.equal(s,'.ant-select-selector, .ant-select-selection');return display;}};
 const l={count:async()=>1,evaluate:async f=>f(inputNode),locator:s=>{assert.ok(s.includes('" ant-select "'));return parent;},filter(){return this;},press:async()=>{open=false;}};
 const label={count:async()=>1,click:async()=>{open=false;}};
 const option={count:async()=>1,evaluate:async f=>f({tagName:'DIV',textContent:'Master',hasAttribute:()=>false,getAttribute:k=>k==='aria-selected'?String(selected==='Master'):null}),click:async()=>{selected='Master';open=false;}};
 const options={count:async()=>2,filter:o=>o.visible?options:option,first:()=>({waitFor:async()=>{}}),allTextContents:async()=>['Bachelor','Master']};
 const menu={filter(){return this;},count:async()=>open?1:0,waitFor:async()=>{},locator:()=>options,evaluate:async (f,args)=>f({querySelectorAll:()=>[],parentElement:null,clientHeight:100,scrollHeight:100},args)};
 const page={url:()=> 'https://fixture.test/form',locator:s=>{events.push(s);if(s==='#field')return l;if(s==='#label')return label;if(s.startsWith('.ant-select-dropdown'))return menu;return {filter(){return this;},count:async()=>0};}};
 const p=new PageAdapter(page,{listOpenPageUrls:async()=>[]});await p.act({method:'ant_dropdown',selector:'#field',labelSelector:'#label',options:['Master']},'Master',{});
 assert.equal(triggerClicks,2);assert.equal(selected,'Master');assert.ok(events.some(s=>s.includes('.ant-select-dropdown:has([id="field_list"])')));
});
