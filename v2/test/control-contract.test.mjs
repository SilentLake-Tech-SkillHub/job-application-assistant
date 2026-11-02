import test from 'node:test';import assert from 'node:assert/strict';
import {controlContractChanges} from '../shared/control-contract.mjs';
const p={fields:[{id:'x',inventorySelectors:['#question input'],inventoryLabel:'School',inventoryType:'text',required:true}]};
test('a reused selector never hides a changed question, kind or requirement',()=>{
 const c={selector:'#question input',label:'School',type:'text',required:true};
 assert.deepEqual(controlContractChanges(p,[c]),[]);
 for(const delta of [{label:'Employer'},{type:'combobox'},{required:false},{selector:'#unknown'}])assert.equal(controlContractChanges(p,[{...c,...delta}]).length,1);
});
import {Engine} from '../shared/engine.mjs';
test('a changed live question stops actual runner before its first write',async()=>{
 let writes=0,registered=0;
 const plan={pathPrefix:'/form',readySelector:'#form',fields:p.fields,groups:[],roleTitle:'Role'};
 const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>[{selector:'#question input',label:'Employer',type:'text',required:true}],observe:async()=>({fields:{}}),act:async()=>{writes++;}};
 const engine=new Engine({store:{put:async()=>{}},companies:[],browser:{existingPage:async()=>page},onInventory:async()=>{registered++;}});
 const result=await engine.runCompany({task:{pageUrl:'https://a.example/form'},company:{id:'a',origin:'https://a.example'},template:{pages:[plan]},prepared:{id:'plan',pages:[{fields:[]}]}},{});
 assert.equal(result.errorCode,'FORM_CONTROL_CONTRACT_CHANGED');assert.equal(writes,0);assert.ok(registered>=1);
});
