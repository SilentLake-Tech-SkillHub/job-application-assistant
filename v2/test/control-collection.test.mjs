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

test('all ten control contracts share the frozen action registry; inspections never enter templates',()=>{
 assert.equal(Object.keys(CONTROL_TYPES).length,10);
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
 const node={tagName:'INPUT',type:'text',value:'',readOnly:false,textContent:'Original',getAttribute:k=>k==='role'?'combobox':null,querySelector:()=>null};
 const single={waitFor:async()=>{},count:async()=>1,innerText:async()=>selected,evaluate:async f=>f(node),press:async key=>{if(key==='Escape')opened=false;},click:async()=>{opened=true;},locator:()=>({count:async()=>0}),filter(){return this;}};
 const option={...single,click:async()=>{selected='Other';opened=false;checks++;}};
 const options={...single,allTextContents:async()=>duplicate?['Other','Other']:['Other','Other extended'],first:()=>single,waitFor:async()=>{},filter:o=>{if(o.visible)return options;assert.ok(o.hasText.test('Other'));assert.equal(o.hasText.test('Other extended'),false);return option;}};
 const menu={count:async()=>opened?1:0,waitFor:async()=>{},filter(){return this;},locator:()=>options};
 const page={url:()=> 'https://fixture.test/form',locator:s=>s.endsWith(' > .ud-formily-item-label')?{...single,click:async()=>{opened=false;}}:s===('.ud__select__list')||s==='[role="listbox"]'?menu:s.includes('ant-select-open')?{count:async()=>0,filter(){return this;}}:single};
 return {page,state:()=>({opened,selected,checks})};
}
for(const family of ['ud','aria'])test(family+' dropdown scopes the visible menu and matches exact option text',async()=>{
 const f=fixture(family),p=new PageAdapter(f.page,{listOpenPageUrls:async()=>[]});
 await p.act({method:family==='ud'?'ud_dropdown':'dropdown',selector:'#question',labelSelector:'#question > .ud-formily-item-label',options:['Other']},'Other',{});
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
 let waited=false;const p=new PageAdapter({url:()=> 'https://fixture.test/form',locator:()=>({waitFor:async()=>{waited=true;}})},{listOpenPageUrls:async()=>[]});
 await p.act({method:'wait',selector:'#late'},null,{});assert.equal(waited,true);
});
test('host role identity is read from actual query rather than the expected ID',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'identity-')),url='https://fixture.test/form?jobId=actual';
 const tab={id:'1',playwright:{evaluate:async(fn,args)=>vm.runInNewContext('('+fn.toString()+')(args)',{args,location:{href:url},URL,Date,document:{querySelectorAll:()=>[],querySelector:()=>null}})}};
 try{await withHostBrowserBridge({browser:{tabs:{list:async()=>[{id:'1',url}],get:async()=>tab}},socketPath:path.join(d,'b.sock'),allowedOrigins:['https://fixture.test']},async({socketPath})=>{const r=await new BrokerBrowserAdapter(socketPath).request('roleSnapshot',{pageId:'1',roleIdentity:{parameter:'jobId',value:'expected'}});assert.equal(r.roleIdentity.value,'actual');});}finally{await rm(d,{recursive:true,force:true});}
});

import {retireLegacyQuestionMappings} from '../shared/profile-migration.mjs';
import {hash} from '../shared/engine.mjs';
test('locator upgrades replace inactive mappings only after full live proof, without deleting facts',()=>{
 const url='https://fixture.test/form',template={evidence:{sourceUrl:url},pages:[{fields:[{source:'hasNoExperience',inventorySelectors:['label.question input'],read:{selector:'label.question input'}}]}]};
 const key=hash({companyId:'fixture',pageUrl:'/form'}).slice(0,20);
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
