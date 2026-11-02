import test from 'node:test';import assert from 'node:assert/strict';
import {performAntDay} from '../shared/ant-date.mjs';
import {compileExecutionPlan} from '../shared/execution-plan.mjs';
import {validateTemplate,hash} from '../shared/engine.mjs';
import {verifyDateRanges,attachDateRangeProofs} from '../shared/date-range-verification.mjs';
import {compileExpected} from '../shared/observation.mjs';import {verifyForm} from '../shared/verifier.mjs';
const field=(id,source,peer,index)=>({id,source,label:'Range',kind:'date',precision:'day',required:true,control:{type:'day_picker',valueType:'string',readbackType:'string'},read:{selector:'#'+id,selectedSelector:'#'+id,kind:'value'},actions:[{method:'ant_day',selector:'#'+id,openSelector:'#'+id,openLabel:'Range',openKind:'captured_date_input',rangePeerSelector:'#'+peer,rangeIndex:index}]});
const template=()=>({id:'range',version:1,evidence:{sourceUrl:'https://sample.test/form',observedAt:'synthetic'},coverage:{allControlsMapped:true,allConditionalBranchesVerified:true,allDriversSupported:true},pages:[{pathPrefix:'/form',readySelector:'form',roleTitle:'Role',roleSelector:'h1',sections:[{title:'History'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[field('start','record.start','end',0),field('end','record.end','start',1)]}]});
test('range peers are captured references; their values are derived only inside the frozen plan',async()=>{
 const t=template(),task={companyId:'sample',pageUrl:t.evidence.sourceUrl,templateHash:hash(t),values:{'record.start':'2021-02-03','record.end':'2025-06-07'}},plan=await compileExecutionPlan(t,task);
 assert.equal(plan.pages[0].fields[0].actions[0].rangePeerValue,'2025-06-07');assert.equal(plan.pages[0].fields[1].actions[0].rangePeerValue,'2021-02-03');assert.equal(t.pages[0].fields[0].actions[0].rangePeerValue,undefined);
 assert.throws(()=>validateTemplate({...t,pages:[{...t.pages[0],fields:plan.pages[0].fields}]}),/VALUES_AND_CODE_DO_NOT_BELONG_IN_TEMPLATE/);
 await assert.rejects(compileExecutionPlan(t,{...task,values:{'record.start':'2021-02-03'}}),/DATE_RANGE_PEER_VALUE_REQUIRED/);
 await assert.rejects(compileExecutionPlan(t,{...task,values:{'record.start':'2026-02-03','record.end':'2025-06-07'}}),/DATE_RANGE_ORDER_INVALID/);
 t.pages[0].fields[1].actions[0].rangePeerSelector='#unrelated';await assert.rejects(compileExecutionPlan(t,task),/DATE_RANGE_PEER_MAPPING_REQUIRED/);
});
function browser({wrongPeer=false,missingMarker=false,duplicates=false,editable=false,navigation=false,delayedHeaders=false,animated=false}={}){
 const values=['2026-10-01','2026-10-06'],written=[],opened=[],keys=[];let active=0,currentMonth=2020*12,headerReads=0,animationReads=0;
 const inputs=[0,1].map(index=>({count:async()=>1,evaluate:async()=>!wrongPeer,click:async()=>{active=index;opened.push(index);},press:async()=>{},inputValue:async()=>values[index]}));
 if(editable)inputs.forEach((input,index)=>{input.fill=async value=>{values[index]=value;};});
 const cells=selector=>({filter(){return this;},evaluateAll:async()=>{const date=selector.match(/title="(\d{4})-(\d{2})/),month=date?Number(date[1])*12+Number(date[2])-1:null;if(navigation&&(month<currentMonth||month>currentMonth+1))return [];return duplicates?[{inView:true,disabled:false},{inView:true,disabled:false}]:[{inView:true,disabled:false}];},nth:()=>({evaluate:async()=>!missingMarker,click:async()=>{const value=selector.match(/title="([^"]+)"/)[1];values[active]=value;written.push([active,value]);}}),count:async()=>missingMarker?0:1});
 const panel={filter(){return this;},waitFor:async()=>{},count:async()=>1,locator:selector=>!navigation?cells(selector):selector.startsWith('.ant-picker-header-view')?{filter(){return this;},allTextContents:async()=>delayedHeaders&&headerReads++===0?[]:[0,1].map(offset=>`${Math.floor((currentMonth+offset)/12)}年${(currentMonth+offset)%12+1}月`)}:selector.startsWith('.ant-picker-header-')?{evaluateAll:async()=>[{visible:false,disabled:false},{visible:true,disabled:false}],nth(index){assert.equal(index,1);return this;},isEnabled:async()=>true,press:async key=>{keys.push(key);currentMonth+=(selector.includes('prev')?-1:1)*(selector.includes('super')?12:1);}}:cells(selector)};
 if(animated)panel.getAttribute=async()=>animationReads++<2?'ant-slide-up-enter-active':'ant-picker-dropdown';
 return {animationReads:()=>animationReads,page:{resolveSelector:async s=>s,page:{locator:s=>s==='#start'?inputs[0]:s==='#end'?inputs[1]:panel}},values,written,opened,keys};
}
test('range executes actual calendar cells for both frozen values and reopens both selected endpoints',async()=>{
 const b=browser(),action={method:'ant_day',selector:'#end',openSelector:'#end',openLabel:'End',rangePeerSelector:'#start',rangeIndex:1,rangePeerValue:'2026-10-01'};
 assert.equal((await performAntDay(b.page,action,'2026-10-23')).rangeVerified,true);assert.deepEqual(b.values,['2026-10-01','2026-10-23']);assert.deepEqual(b.opened,[0,1,0,1]);assert.deepEqual(b.written,[[0,'2026-10-01'],[1,'2026-10-23']]);
 await assert.rejects(performAntDay(browser({wrongPeer:true}).page,action,'2026-10-23'),/ANT_DATE_RANGE_CAPTURE_CHANGED/);
 await assert.rejects(performAntDay(browser({missingMarker:true}).page,action,'2026-10-23'),/ANT_DATE_RANGE_SELECTION_NOT_VERIFIED/);
 await assert.rejects(performAntDay(browser({duplicates:true}).page,action,'2026-10-23'),/ANT_DATE_OPTION_NOT_UNIQUE/);
 await assert.rejects(performAntDay(b.page,{...action,rangePeerValue:null},'2026-10-23'),/ANT_DATE_RANGE_FROZEN_PEER_REQUIRED/);
});
test('editable range keyboard commit still requires real selected calendar endpoint markers',async()=>{
 const b=browser({editable:true}),action={selector:'#end',openSelector:'#end',openLabel:'End',rangePeerSelector:'#start',rangeIndex:1,rangePeerValue:'2026-10-01'};
 assert.equal((await performAntDay(b.page,action,'2026-10-23')).rangeVerified,true);assert.equal(b.written.length,0);assert.deepEqual(b.values,['2026-10-01','2026-10-23']);
 await assert.rejects(performAntDay(browser({editable:true,missingMarker:true}).page,action,'2026-10-23'),/ANT_DATE_RANGE_SELECTION_NOT_VERIFIED/);
});
test('cross-year range navigation activates only the observed button by keyboard, and inspection never selects dates',async()=>{
 const b=browser({navigation:true}),action={selector:'#start',openSelector:'#start',openLabel:'Start',rangePeerSelector:'#end',rangeIndex:0,rangePeerValue:'2025-06-07'};
 assert.equal((await performAntDay(b.page,action,'2021-02-03')).rangeVerified,true);assert.deepEqual(b.written,[[0,'2021-02-03'],[1,'2025-06-07']]);assert.ok(b.keys.length>0);assert.ok(b.keys.every(key=>key==='Enter'));
 b.written.length=0;assert.equal((await performAntDay(b.page,{...action,operation:'verify'},'2021-02-03')).rangeVerified,true);assert.equal(b.written.length,0);
});
test('independent whole-form readback rejects matching date text without real range proof',async()=>{
 const plan=template().pages[0],task={companyId:'sample',pageUrl:'https://sample.test/form',values:{'record.start':'2021-02-03','record.end':'2025-06-07'}},expected=compileExpected({...plan,sections:undefined},task);
 const observed={source:'live_dom',readAt:new Date().toISOString(),pageUrl:task.pageUrl,roleTitle:'Role',inventoryIds:['start','end'],fields:{start:{present:true,selected:true,value:'2021-02-03'},end:{present:true,selected:true,value:'2025-06-07'}}};
 assert.equal(verifyForm(expected,observed).status,'needs_attention');let calls=0;
 const proofs=await verifyDateRanges({act:async action=>{calls++;assert.equal(action.operation,'verify');assert.equal(action.rangePeerValue,'2025-06-07');return {rangeVerified:true};}},plan,task);
 assert.equal(calls,1);assert.equal(verifyForm(expected,attachDateRangeProofs(observed,proofs)).status,'verified');
 const failed=await verifyDateRanges({act:async()=>{throw Error('ANT_DATE_RANGE_SELECTION_NOT_VERIFIED');}},plan,task);assert.equal(verifyForm(expected,attachDateRangeProofs(observed,failed)).status,'needs_attention');
});

test('visible calendar waits for its rendered headers before navigating',async()=>{
 const b=browser({navigation:true,delayedHeaders:true}),action={selector:'#start',openSelector:'#start',openLabel:'Start',rangePeerSelector:'#end',rangeIndex:0,rangePeerValue:'2025-06-07'};
 assert.equal((await performAntDay(b.page,action,'2021-02-03')).rangeVerified,true);assert.ok(b.keys.length>0);
});

test('range inspection waits for the observed popup animation to settle',async()=>{
 const b=browser({animated:true}),action={selector:'#start',openSelector:'#start',openLabel:'Start',rangePeerSelector:'#end',rangeIndex:0,rangePeerValue:'2026-10-23'};
 assert.equal((await performAntDay(b.page,action,'2026-10-01')).rangeVerified,true);assert.ok(b.animationReads()>=3);
});
