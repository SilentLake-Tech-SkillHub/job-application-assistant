import test from 'node:test';
import assert from 'node:assert/strict';
import {bindNativeDom,correlateNativeControls} from '../shared/structure-dom-binding.mjs';
import {bindStructureControls} from '../shared/rea-structure.mjs';
const time='2026-10-23T18:01:00.000Z';
function fixture(){
 const structure={targetId:'target',pageUrl:'https://forms.example/apply',pageId:'chrome:p',observedAt:time,accessibility:[{nodeId:'ax-first',role:'textbox',label:'请输入'},{nodeId:'ax-second',role:'textbox',label:'请输入'},{nodeId:'ax-radio',role:'radio',label:'女'},{nodeId:'ax-unknown',role:'checkbox',label:''}]};
 const nodes=[
  {index:0,parentIndex:-1,nodeType:9,nodeName:'#document',backendNodeId:1,attributes:{}},
  {index:1,parentIndex:0,nodeType:1,nodeName:'HTML',backendNodeId:2,attributes:{}},
  {index:2,parentIndex:1,nodeType:1,nodeName:'BODY',backendNodeId:3,attributes:{}},
  {index:3,parentIndex:2,nodeType:1,nodeName:'DIV',backendNodeId:4,attributes:{class:'form-item--phoenix'}},
  {index:4,parentIndex:3,nodeType:1,nodeName:'INPUT',backendNodeId:5,attributes:{id:'first'}},
  {index:5,parentIndex:2,nodeType:1,nodeName:'DIV',backendNodeId:6,attributes:{class:'form-item--phoenix'}},
  {index:6,parentIndex:5,nodeType:1,nodeName:'INPUT',backendNodeId:7,attributes:{}},
  {index:7,parentIndex:2,nodeType:1,nodeName:'DIV',backendNodeId:8,attributes:{id:'radio-group'}},
  {index:8,parentIndex:7,nodeType:1,nodeName:'SPAN',backendNodeId:9,attributes:{role:'radio'}},
  {index:9,parentIndex:5,nodeType:1,nodeName:'INPUT',backendNodeId:10,attributes:{type:'checkbox'}}
 ];
 const native={targetId:structure.targetId,pageUrl:structure.pageUrl,observedAt:time,documents:[{frameId:'main',nodes}],accessibility:structure.accessibility.map((a,i)=>({...a,backendNodeId:[5,7,9,10][i]}))};
 const capture={pageUrl:structure.pageUrl,pageId:structure.pageId,observedAt:time,controls:[{selector:'semantic:first',diagnosticSelector:'#first',label:'姓名'},{selector:'semantic:second',diagnosticSelector:'body > div:nth-of-type(2) > input:nth-of-type(1)',label:'学校'},{selector:'semantic:radio',diagnosticSelector:'#radio-group',label:'性别'}]};
 return {structure,native,capture};
}
test('duplicate AX placeholder labels bind through backend DOM identity and actual diagnostic path',()=>{
 const {structure,native,capture}=fixture();structure.accessibility=bindNativeDom(structure,native);const joined=bindStructureControls(structure,capture);
 assert.deepEqual(joined.controls.map(c=>c.reaCandidates),[['ax-first'],['ax-second'],['ax-radio']]);
 assert.equal(joined.controls[0].selector,'semantic:first');assert.equal(joined.controls[0].reaBindings[0].backendNodeId,5);
 assert.equal(joined.controls[2].reaBindings[0].relationship,'descendant');assert.deepEqual(joined.uncorrelatedControls.map(n=>n.nodeId),['ax-unknown']);
 assert.equal(joined.uncorrelatedControls[0].nativeDOM.ancestors[0].class,'form-item--phoenix');
});
test('no native identity or diagnostic path keeps unresolved nodes even when labels match',()=>{
 const {structure,capture}=fixture();capture.controls[0].label='请输入';assert.equal(bindStructureControls(structure,capture).uncorrelatedControls.length,4);
 structure.accessibility=bindNativeDom(structure,null);assert.equal(structure.accessibility[0].nativeBindingStatus,'native_structure_missing');
});
test('same DOM path must be uniquely assigned; ties never resolve by capture array order',()=>{
 const {structure,native,capture}=fixture();structure.accessibility=bindNativeDom(structure,native);capture.controls.push({...capture.controls[0],selector:'duplicate'});const joined=bindStructureControls(structure,capture);
 assert.equal(joined.controls[0].reaCandidates.length,0);assert.ok(joined.uncorrelatedControls.some(n=>n.nodeId==='ax-first'));
});
test('scope/time mismatches and cross-frame identical paths cannot bind',()=>{
 const {structure,native,capture}=fixture();assert.throws(()=>bindNativeDom(structure,{...native,targetId:'other'}),/SCOPE_MISMATCH/);assert.throws(()=>bindNativeDom(structure,{...native,pageUrl:'https://other.example/apply'}),/SCOPE_MISMATCH/);assert.throws(()=>bindNativeDom(structure,{...native,observedAt:'2026-10-23T17:01:00Z'}),/TOO_FAR_APART/);
 native.documents.unshift({frameId:'other',nodes:[]});structure.accessibility=bindNativeDom(structure,native);assert.equal(correlateNativeControls(structure.accessibility,capture.controls).bound.size,0);
});
test('native AX node id reused for a different role/name is not identity evidence',()=>{
 const {structure,native,capture}=fixture();native.accessibility[0].label='different';structure.accessibility=bindNativeDom(structure,native);assert.equal(structure.accessibility[0].nativeBindingStatus,'native_ax_identity_unproven');assert.ok(bindStructureControls(structure,capture).uncorrelatedControls.some(n=>n.nodeId==='ax-first'));
});
test('duplicate actual DOM ids cannot bind, even if the duplicate is absent from AX',()=>{
 const {structure,native,capture}=fixture();native.documents[0].nodes.push({index:10,parentIndex:2,nodeType:1,nodeName:'INPUT',backendNodeId:11,attributes:{id:'first'}});structure.accessibility=bindNativeDom(structure,native);assert.equal(bindStructureControls(structure,capture).controls[0].reaCandidates.length,0);
});
test('escaped real ids and html-prefixed nth paths are diagnostic equivalents',()=>{
 const {structure,native,capture}=fixture();native.documents[0].nodes[4].attributes.id='5abc';capture.controls[0].diagnosticSelector='#\\35 abc';capture.controls[1].diagnosticSelector='html:nth-of-type(1) > body:nth-of-type(1) > div:nth-of-type(2) > input:nth-of-type(1)';structure.accessibility=bindNativeDom(structure,native);assert.deepEqual(bindStructureControls(structure,capture).controls.slice(0,2).map(c=>c.reaCandidates),[['ax-first'],['ax-second']]);
});
