import test from 'node:test';
import assert from 'node:assert/strict';
import {Engine} from '../shared/engine.mjs';
import {compileExpected} from '../shared/observation.mjs';

const ref=(occurrence,part='native')=>'phoenixq:'+JSON.stringify({section:'Experience',label:'Organization',occurrence,part,controlIndex:0});
function fixture({warm=false,missingOther=false,count=2}={}){
 let records=warm?2:1;const writes=[],values={first:warm?'Alpha':'',second:warm?'Beta':''};
 const field=(id,occurrence)=>({id,source:id,label:'Organization',kind:'text',required:true,inventorySelectors:[ref(occurrence)],inventoryLabel:'Organization',inventoryType:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:ref(occurrence),kind:'value'},actions:[{method:'fill',selector:ref(occurrence)}]});
 const fields=[field('first',0),field('second',1)];
 if(missingOther)fields.push({...field('other',0),label:'Other',inventoryLabel:'Other',inventorySelectors:['#other'],read:{selector:'#other',kind:'value'},actions:[{method:'fill',selector:'#other'}]});
 const scope={title:'Experience',headingSelector:'#experience-heading',containerSelector:'.experience-section',recordSelector:':scope > .record',addSelector:'#add-experience',addLabel:'Add experience'};
 const group={id:'experience',selector:'phoenixq:'+JSON.stringify({...scope,part:'repeatRecords'}),addSelector:'phoenixq:'+JSON.stringify({...scope,part:'repeatAdd'}),addLabel:scope.addLabel,count};
 const plan={pathPrefix:'/form',readySelector:'form',roleTitle:'Product',roleSelector:'h1',fields,groups:[group]};
 const url='https://fixture.test/form',task={companyId:'sample',roleId:'role',pageUrl:url,browserBinding:{sessionId:'fixture-session',pageId:'fixture-page',generation:'fixture-document'},values:{first:'Alpha',second:'Beta',other:'Other'}};
 const page={assertLocation:async()=>{},wait:async()=>{},
  inventory:async()=>fields.filter(f=>f.id==='first'||f.id==='second'&&records>=2).map(f=>({selector:f.inventorySelectors[0],label:f.inventoryLabel,type:'text',required:true})),
  observe:async spec=>{
   if(records<2&&spec.fields.some(f=>f.id==='second'))throw Error('PHOENIX_QUESTION_NOT_FOUND');
   return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:url,roleTitle:'Product',groups:{experience:records},fields:Object.fromEntries(spec.fields.map(f=>[f.id,{present:f.id!=='other',value:values[f.id]??null,errors:[]}]))};
  },
  ensureGroups:async groups=>{if(records<groups[0].count){records=groups[0].count;writes.push('expand:'+records);}},
  act:async(action,value)=>{const f=fields.find(f=>f.read.selector===action.selector);values[f.id]=value;writes.push('fill:'+f.id);}
 };
 const engine=new Engine({store:{put:async()=>{}},companies:[],browser:{existingPage:async()=>page}});
 const prepared={id:'plan',planHash:'fixture',files:{},pages:[{fields:fields.map(f=>({...f,value:task.values[f.source],disposition:'fill'})),expected:compileExpected(plan,task)}]};
 return {run:()=>engine.runCompany({task,company:{id:'sample',origin:'https://fixture.test'},template:{pages:[plan]},prepared},{}),writes};
}
test('a fresh reused form creates the frozen repeat records before observing and filling their absent fields',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.status,'verified');assert.deepEqual(f.writes,['expand:2','fill:first','fill:second']);
});
test('a warm reused form preserves matching fields and does not recreate existing records',async()=>{
 const f=fixture({warm:true}),result=await f.run();assert.equal(result.status,'verified');assert.deepEqual(f.writes,[]);
});
test('a missing ordinary field outside the repeat contract blocks before any record or answer is written',async()=>{
 const f=fixture({missingOther:true}),result=await f.run();assert.equal(result.errorCode,'PLANNED_FIELDS_MISSING_BEFORE_WRITE');assert.deepEqual(f.writes,[]);
});
test('a repeat count not covered by the frozen field occurrences is not allowed to create records',async()=>{
 const f=fixture({count:3}),result=await f.run();assert.equal(result.errorCode,'REPEAT_GROUP_FIELD_COVERAGE_CHANGED');assert.deepEqual(f.writes,[]);
});
