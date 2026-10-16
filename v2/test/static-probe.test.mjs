import test from 'node:test';import assert from 'node:assert/strict';import {probeConditions} from '../shared/condition-probe.mjs';
test('a form without declared conditional fields still needs actual matching readback before sealing',async()=>{
 let writes=0;const c={selector:'#name',label:'Name',type:'text',required:false},field={id:'name',source:'name',inventorySelectors:['#name'],inventoryLabel:'Name',inventoryType:'text'};
 const observed={pageUrl:'https://a.example/form',roleTitle:'Role',groups:{},fields:{name:{present:true,value:'Existing'}}};
 const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>[c],observe:async spec=>spec.fields[0]?.id==='name'?observed:{fields:{}},act:async()=>{writes++;}};
 const r=await probeConditions({page,plan:{pathPrefix:'/form',roleTitle:'Role',fields:[field],readySelector:'#form'},pageUrl:observed.pageUrl,origin:'https://a.example',onInventory:async()=>{}});
 assert.equal(r.status,'verified');assert.equal(r.restoration,'verified');assert.equal(r.branches[0].source,'__baseline__');assert.equal(writes,0);
});
