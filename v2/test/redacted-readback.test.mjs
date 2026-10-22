import test from 'node:test';
import assert from 'node:assert/strict';
import {performControl} from '../shared/control-operations.mjs';
import {verifyForm} from '../shared/verifier.mjs';
import {Engine} from '../shared/engine.mjs';

const url='https://forms.example/application';
const observed=value=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Role',inventoryIds:['a'],fields:{a:{present:true,value,errors:[]}}});
const expected=value=>({pageUrl:url,roleTitle:'Role',fields:[{id:'a',label:'Text',kind:'text',required:true,value}]});

test('an exact privacy sentinel is unverified even if the expected value is identical',()=>{
 for(const value of ['known value','<redacted>',null]){
  const r=verifyForm(expected(value),observed('<redacted>'));
  assert.notEqual(r.status,'verified');assert.equal(r.checks[0].status,'unverified');
  assert.equal(r.checks[0].reason,'REDACTED_VALUE_UNVERIFIABLE');
  assert.equal(r.checks[0].readbackVisibility,'redacted');assert.equal(Object.hasOwn(r.checks[0],'actual'),false);
 }
 for(const value of ['<redacted> suffix',' <redacted>','[redacted]'])assert.equal(verifyForm(expected('known value'),observed(value)).checks[0].reason,'VALUE_DIFFERS');
});

function textFixture(mode='redacted'){
 const nodes={a:{tagName:'INPUT',type:'text',readOnly:false,value:''},b:{tagName:'INPUT',type:'text',readOnly:false,value:''}};
 for(const n of Object.values(nodes)){n.getAttribute=()=>null;n.querySelector=()=>null;}
 const written=[];
 const locator=selector=>{const id=selector.slice(1),n=nodes[id];return {count:async()=>1,evaluate:async f=>f(n),fill:async v=>{written.push(id);n.value=id==='a'&&mode==='redacted'?'<redacted>':id==='a'&&mode==='wrong'?'different value':v;},pressSequentially:async v=>{n.value=id==='a'&&mode==='redacted'?'<redacted>':v;},press:async()=>{}};};
 const page={locator};
 const adapter={page,assertSingleEditor:async()=>{},resolveSpec:async a=>a};
 return {nodes,written,adapter};
}

test('normal and keyboard fill defer an exact redacted readback without inventing actual values',async()=>{
 for(const inputMode of [undefined,'keyboard']){
  const {adapter,nodes}=textFixture();
  const r=await performControl(adapter,{method:'fill',selector:'#a',inputMode},'known value');
  assert.deepEqual(r,{status:'deferred_readback',reason:'REDACTED_VALUE_UNVERIFIABLE'});
  assert.equal(nodes.a.value,'<redacted>');
 }
});

test('ordinary non-redacted mismatches still fail the commit gate',async()=>{
 const {adapter}=textFixture('wrong');
 await assert.rejects(performControl(adapter,{method:'fill',selector:'#a'},'known value'),/CONTROL_COMMIT_NOT_VERIFIED/);
});

test('Engine continues later fields but final independent verification cannot pass a redacted value',async()=>{
 const {adapter,nodes,written}=textFixture();
 const fields=['a','b'].map(id=>({id,label:id,kind:'text',required:true,source:id,control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#'+id,kind:'value'},inventorySelectors:['#'+id],inventoryLabel:id,inventoryType:'text',actions:[{method:'fill',selector:'#'+id}]}));
 const plan={pathPrefix:'/application',roleTitle:'Role',readySelector:'#a',roleSelector:'.role',fields};
 const inventory=fields.map(f=>({selector:f.read.selector,label:f.label,type:'text',required:true,locatorStrategy:'semantic_question'}));
 const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>inventory,act:(...args)=>performControl(adapter,...args),observe:async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Role',fields:Object.fromEntries(fields.map(f=>[f.id,{present:true,value:nodes[f.id].value,errors:[]}]))})};
 const engine=new Engine({store:{put:async()=>{}},companies:[],browser:{existingPage:async()=>page}});
 const prepared={id:'plan',planHash:'synthetic',files:{},pages:[{fields:fields.map(f=>({...f,value:'known '+f.id,disposition:'fill'})),expected:{pageUrl:url,roleTitle:'Role',fields:fields.map(f=>({...f,value:'known '+f.id}))}}]};
 const result=await engine.runCompany({task:{pageUrl:url},company:{id:'sample',origin:'https://forms.example'},template:{pages:[plan]},prepared},{});
 assert.deepEqual(written,['a','b']);assert.equal(nodes.b.value,'known b');assert.equal(nodes.a.value,'<redacted>');
 assert.equal(result.status,'needs_attention');assert.equal(result.errorCode,undefined);
 assert.equal(result.fields.find(f=>f.id==='a').status,'unverified');
 assert.equal(result.fields.find(f=>f.id==='a').reason,'REDACTED_VALUE_UNVERIFIABLE');
 assert.equal(result.fields.find(f=>f.id==='b').status,'match');assert.equal(result.submission,'not_performed');
});
