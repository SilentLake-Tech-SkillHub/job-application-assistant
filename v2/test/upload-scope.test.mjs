import test from 'node:test';import assert from 'node:assert/strict';import {Engine} from '../shared/engine.mjs';
test('a scoped photo upload cannot write another mismatched attachment through the ordinary fill loop',async()=>{
 const url='https://fixture.test/form',writes=[];
 const fields=['resume','photo'].map(id=>({id,source:id,label:id,kind:'file',inventorySelectors:['#'+id],inventoryLabel:id,inventoryType:'file',control:{type:'upload',valueType:'file_ref',readbackType:'file_names'},read:{selector:'#'+id,kind:'files'},actions:[{method:'upload',selector:'#'+id}]}));
 const plan={pathPrefix:'/form',readySelector:'form',roleTitle:'Product',fields};
 const task={companyId:'sample',roleId:'role',pageUrl:url,templateHash:'fixture',values:{resume:'resume',photo:'photo'},files:{resume:{displayNames:['source.pdf']},photo:{displayNames:['source.jpg']}}};
 const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>fields.map(f=>({selector:'#'+f.id,label:f.label,type:'file'})),observe:async()=>({source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Product',fields:{resume:{present:true,value:['other.pdf'],uploadState:'site_rendered_uploaded',errors:[]},photo:{present:true,value:['source.jpg'],uploadState:'site_rendered_uploaded',errors:[]}}}),act:async action=>{writes.push(action.selector);}};
 const engine=new Engine({store:{put:async()=>{},get:async()=>{throw Error('missing');}},companies:[],browser:{existingPage:async()=>page}});
 const prepared={id:'plan',planHash:'hash',files:task.files,pages:[{fields:fields.map(f=>({...f,value:f.source,disposition:'fill'}))}]};
 const result=await engine.runCompany({task,company:{id:'sample',origin:'https://fixture.test'},template:{pages:[plan]},prepared},{uploadFieldIds:['photo']});
 assert.deepEqual(writes,['#photo']);assert.ok(result.uploadScopeHash);assert.equal(result.status,'needs_attention');
});
