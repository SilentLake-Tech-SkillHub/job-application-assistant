import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {controlDOM} from '../shared/control-dom.mjs';
import {matchesRole,bindRoleTitleProof} from '../shared/role-identity.mjs';
import {compileExpected} from '../shared/observation.mjs';
import {validateTemplate} from '../shared/engine.mjs';
import {verifyForm} from '../shared/verifier.mjs';

const url='https://fixture.test/form?id=actual';
const node=innerText=>({innerText,tagName:'SPAN',getClientRects:()=>[{}]});
function observe(plan,titles){
 const document={querySelectorAll:s=>s==='#role'?titles:[],querySelector:s=>s==='#role'?titles[0]||null:null};
 return vm.runInNewContext('('+controlDOM.toString()+')(plan)',{document,plan,location:{href:url},Date,getComputedStyle:()=>({visibility:'visible'})});
}
const page={pathPrefix:'/form',readySelector:'#role',roleSelector:'#role',roleTitle:'Product',rolePrefix:'Applying for: ',roleIdentity:{parameter:'id',value:'actual'},sections:[{title:'Basics'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[{id:'name',source:'name',label:'Name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]};
const template=p=>({id:'prefix-fixture',version:1,evidence:{sourceUrl:url,observedAt:'fixture'},pages:[p]});

test('literal role prefixes preserve raw live text and pass ordinary independent verification',()=>{
 for(const prefix of ['Applying for: ','你正在投递职位:']){
  const plan={...page,rolePrefix:prefix},raw=prefix+' Product';
  const o=observe({...plan,fields:[]},[node(raw)]);
  assert.equal(o.rawRoleTitle,raw);assert.equal(o.prefixApplied,true);assert.equal(o.roleTitle,'Product');
  o.roleIdentity={parameter:'id',value:'actual'};
  assert.ok(matchesRole(plan,o));
  const expected=compileExpected(plan,{pageUrl:url,values:{name:'Example'}});
  assert.equal(expected.rolePrefix,prefix);assert.equal(expected.roleSelector,'#role');
  o.fields={name:{present:true,value:'Example',errors:[]}};o.inventoryIds=['name'];o.sections=[{title:'Basics',unexpanded:false}];
  assert.equal(verifyForm(expected,o).status,'verified');
 }
});
test('wrong prefix, ambiguous title, forged normalization, or changed job ID remain blocked',()=>{
 for(const titles of [[],[node('Wrong: Product')],[node('x Applying for: Product')],[node('Applying for: Product'),node('Applying for: Product')]]){
  const o=observe({...page,fields:[]},titles);o.roleIdentity={parameter:'id',value:'actual'};assert.equal(matchesRole(page,o),false);
 }
 const good=observe({...page,fields:[]},[node('Applying for: Product')]);good.roleIdentity={parameter:'id',value:'actual'};
 for(const extra of [{prefixApplied:false},{roleTitle:'Other'},{rawRoleTitle:'Applying for: Other'},{roleIdentity:{parameter:'id',value:'changed'}}])assert.equal(matchesRole(page,{...good,...extra}),false);
 const legacy={...page};delete legacy.rolePrefix;
 const observed=observe({...legacy,fields:[]},[node(' Product ')]);assert.equal(observed.roleTitle,'Product');assert.equal(Object.hasOwn(observed,'rawRoleTitle'),false);
 assert.ok(matchesRole(legacy,{roleTitle:null,roleIdentity:{parameter:'id',value:'actual'}}));
});
test('prefix contracts require a literal single-line prefix and a real selector',()=>{
 validateTemplate(template(page));
 for(const prefix of ['', ' ', 7, 'a\nb','a\rb','a\u2028b','a\u2029b'])assert.throws(()=>validateTemplate(template({...page,rolePrefix:prefix})),/ROLE_PREFIX_CONTRACT_REQUIRED/);
 assert.throws(()=>validateTemplate(template({...page,roleSelector:undefined})),/ROLE_PREFIX_CONTRACT_REQUIRED/);
});
test('bound role reads prefix proof from the exact original page without replacing account or ID',async()=>{
 const source=await readFile(new URL('../shared/server.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('async function boundRole(args){'),source.indexOf('async function reconcileSelectorMappings'));
 async function run({prefix=true,snapshotId='actual',account='User',proofUrl=url,proofSource='live_dom'}={}){
  const plan={...page};if(!prefix)delete plan.rolePrefix;const calls=[];
  const snapshot={pageUrl:url,roleTitle:prefix?'Applying for: Product':'Product',roleIdentity:{parameter:'id',value:snapshotId},account,loginFormPresent:false};
  const state={pageId:'chrome:original',returnUrl:url};
  const context={queues:{task:async()=>({q:{},t:{taskId:'task',companyId:'fixture',roleId:'job',title:'Product'}}),read:async()=>state},assertBoundRoleState:()=>{},catalog:{companies:[{id:'fixture',templateId:'form'}]},store:{get:async()=>({pages:[plan]})},directory:{loginFile:()=>'/fixture/login.json'},readFile:async()=>JSON.stringify({account:{selector:'#account'}}),browser:{request:async()=>snapshot,existingPage:async(...args)=>{calls.push(args);return {observe:async spec=>{assert.deepEqual(Object.keys(spec).sort(),['fields','rolePrefix','roleSelector']);return {source:proofSource,pageUrl:proofUrl,rawRoleTitle:'Applying for: Product',roleTitle:'Product',prefixApplied:true,account:'Evil',roleIdentity:{parameter:'id',value:'evil'}};}};}},matchesRole,loadProfile:async()=>({}),profileFile:'fixture',resolveAccount:()=>{},matchesAccount:value=>value==='User'};
  const execute=vm.runInNewContext(body+';boundRole',{...context,URL,bindRoleTitleProof});
  const result=await execute({});return {result,calls};
 }
 const good=await run();assert.equal(good.calls[0][0],url);assert.equal(good.calls[0][1].pageId,'chrome:original');assert.equal(good.calls[0][1].readOnly,true);
 assert.equal((await run({prefix:false})).calls.length,0);
 for(const options of [{snapshotId:'wrong'},{account:'Other'},{proofUrl:'https://fixture.test/other'},{proofSource:'model'}])await assert.rejects(run(options),/ROLE_OR_ACCOUNT_CHANGED_BEFORE_FILL|ROLE_TITLE_OBSERVATION_SCOPE_CHANGED/);
});
