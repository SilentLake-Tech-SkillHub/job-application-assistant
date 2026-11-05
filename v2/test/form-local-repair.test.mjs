import test from 'node:test';import assert from 'node:assert/strict';
import {repairFields} from '../shared/form-local-repair.mjs';
const field=(id,selector,label=id)=>({id,source:id,label,inventoryLabel:label,inventoryType:'text',inventorySelectors:[selector],read:{selector,kind:'value'},actions:[{method:'fill',selector}]});
const template=()=>({id:'F1',pages:[{groups:[{id:'g',count:2}],fields:[field('name','#name','Name'),field('school','#old','School'),field('city','#city','City')]}]});
const control=(selector,label,type='text')=>({selector,label,type});
test('only the failed field moves to its new control; everything else is unchanged',()=>{
 const before=template(),r=repairFields({template:before,failedIds:['school'],controls:[control('#name','Name'),control('#city','City'),control('#new','School')]});
 const f=r.template.pages[0].fields[1];assert.equal(f.read.selector,'#new');assert.deepEqual(f.inventorySelectors,['#new']);assert.equal(f.actions[0].selector,'#new');
 assert.deepEqual(r.repaired,[{id:'school',from:'#old',selector:'#new',moved:true}]);assert.deepEqual(r.unresolved,[]);
 assert.deepEqual(r.template.pages[0].fields[0],before.pages[0].fields[0]);assert.deepEqual(r.template.pages[0].groups,before.pages[0].groups);
 assert.equal(before.pages[0].fields[1].read.selector,'#old');
});
test('a control that is back on the page needs no move',()=>{
 const r=repairFields({template:template(),failedIds:['school'],controls:[control('#old','School')]});
 assert.equal(r.repaired[0].moved,false);assert.equal(r.template.pages[0].fields[1].read.selector,'#old');
});
test('an unclear target is listed with its candidates and an explicit mapping settles it',()=>{
 const controls=[control('#a','School'),control('#b','School')];
 const r=repairFields({template:template(),failedIds:['school'],controls});
 assert.equal(r.unresolved[0].reason,'REPAIR_TARGET_AMBIGUOUS');assert.equal(r.unresolved[0].candidates.length,2);assert.equal(r.template.pages[0].fields[1].read.selector,'#old');
 const m=repairFields({template:template(),failedIds:['school'],controls,mappings:[{fieldId:'school',selector:'#b'}]});assert.equal(m.template.pages[0].fields[1].read.selector,'#b');
});
test('a control of another type or already used by a field is not a target',()=>{
 const r=repairFields({template:template(),failedIds:['school'],controls:[control('#name','School'),control('#x','School','select')]});
 assert.equal(r.unresolved[0].reason,'REPAIR_TARGET_NOT_FOUND');
});
