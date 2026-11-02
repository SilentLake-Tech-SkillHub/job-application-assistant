import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {waitForAreaResults,areaReadinessDOM} from '../shared/phoenix-area.mjs';
const row=(label='Example City')=>({label,path:'Example Province',value:null,disabled:false});
const initial={input:'',records:[row()],resultText:null,loading:false};
function clockRead(sample,options={}){
 let tick=0,reads=0;
 const run=()=>waitForAreaResults({read:async()=>{reads++;return sample(tick);},now:()=>tick,sleep:async ms=>{tick+=ms;},timeoutMs:1000,stableMs:150,pollMs:50,...options});
 return {run,time:()=>tick,reads:()=>reads};
}
test('opening a region list waits for real delayed rows instead of immediately returning zero',async()=>{
 const f=clockRead(t=>({input:'',records:t<250?[]:[row()],resultText:null,loading:t<200})),r=await f.run();
 assert.equal(r.status,'captured');assert.equal(f.time(),250);assert.ok(r.waitEvidence.polls>1);assert.equal(r.waitEvidence.sawLoading,true);
});
test('unqueried zero rows without a loading-completion proof stay unobserved',async()=>{
 const f=clockRead(()=>({input:'',records:[],resultText:'搜索结果0个',loading:false})),r=await f.run();
 assert.equal(r.status,'options_not_observed');assert.equal(f.time(),1000);assert.deepEqual(r.empty,[]);assert.equal(r.waitEvidence.decision,'results_not_proven_settled');
});
test('unqueried explicit empty waits through a loading transition and stable empty state',async()=>{
 const f=clockRead(t=>({input:'',records:[],resultText:null,loading:t<200,emptyEvidence:t<200?[]:['暂无数据']})),r=await f.run();
 assert.equal(r.status,'options_not_observed');assert.equal(f.time(),350);assert.equal(r.waitEvidence.loadingEnded,true);assert.equal(r.waitEvidence.stableMs,150);assert.equal(r.waitEvidence.decision,'observed_loaded_empty_branches');
});
test('an old zero header cannot end the query before asynchronous matching rows arrive',async()=>{
 const baseline={input:'Previous',records:[],resultText:'搜索结果0个',loading:false};
 const f=clockRead(t=>({input:'Example',records:t<600?[]:[row()],resultText:t<600?'搜索结果0个':'搜索结果1个',loading:t>=100&&t<450}),{query:'Example',baseline}),r=await f.run();
 assert.equal(r.status,'captured');assert.equal(f.time(),600);assert.equal(r.waitEvidence.fullWindowElapsed,false);assert.equal(r.waitEvidence.loadingEnded,true);assert.deepEqual(r.empty,[]);
});
test('unchanged stale zero without a response transition never proves an empty dictionary search',async()=>{
 const baseline={input:'Previous',records:[],resultText:'搜索结果0个',loading:false};
 const f=clockRead(()=>({input:'Example',records:[],resultText:'搜索结果0个',loading:false}),{query:'Example',baseline}),r=await f.run();
 assert.equal(r.status,'options_not_observed');assert.equal(f.time(),1000);assert.deepEqual(r.empty,[]);assert.deepEqual(r.waitEvidence.freshness,[]);
});
test('a fresh actual zero is accepted only after the complete window and continuous stable proof',async()=>{
 const f=clockRead(()=>({input:'Missing',records:[],resultText:'搜索结果0个',loading:false}),{query:'Missing',baseline:initial}),r=await f.run();
 assert.equal(r.status,'captured_empty_search');assert.equal(f.time(),1000);assert.equal(r.waitEvidence.fullWindowElapsed,true);assert.ok(r.waitEvidence.stableMs>=150);assert.deepEqual(r.empty,['搜索结果0个']);assert.equal(r.waitEvidence.queryApplied,true);
});
test('late zero, an active loader, wrong query or missing zero evidence all stay unobserved',async()=>{
 for(const sample of [
  t=>({input:'Missing',records:[],resultText:t<950?null:'搜索结果0个',loading:false}),
  ()=>({input:'Missing',records:[],resultText:'搜索结果0个',loading:true,explicitLoaded:true}),
  ()=>({input:'Another',records:[],resultText:'搜索结果0个',loading:false}),
  ()=>({input:'Missing',records:[],resultText:null,loading:false})
 ]){const f=clockRead(sample,{query:'Missing',baseline:initial}),r=await f.run();assert.equal(r.status,'options_not_observed');assert.deepEqual(r.empty,[]);assert.equal(f.time(),1000);}
});
test('stale unrelated positive rows and a contradictory zero header cannot be captured',async()=>{
 for(const sample of [
  ()=>({input:'Target',records:[row('Other City')],resultText:'搜索结果1个',loading:false}),
  ()=>({input:'Target',records:[row('Target City')],resultText:'搜索结果0个',loading:false})
 ]){const f=clockRead(sample,{query:'Target',baseline:initial}),r=await f.run();assert.equal(r.status,'options_not_observed');assert.deepEqual(r.records,[]);}
});
test('current matching real rows can return immediately without paying the empty-search window',async()=>{
 const f=clockRead(()=>({input:'Example',records:[row()],resultText:'搜索结果1个',loading:false}),{query:'Example',baseline:initial}),r=await f.run();
 assert.equal(r.status,'captured');assert.equal(f.time(),0);assert.equal(f.reads(),1);assert.equal(r.waitEvidence.fullWindowElapsed,false);
});
test('sampling never changes the provided DOM observation or baseline',async()=>{
 const state=Object.freeze({input:'Example',records:Object.freeze([Object.freeze(row())]),resultText:'搜索结果1个',loading:false}),baseline=structuredClone(initial),before=structuredClone(baseline);
 assert.equal((await clockRead(()=>state,{query:'Example',baseline}).run()).status,'captured');assert.deepEqual(baseline,before);assert.equal(Object.hasOwn(state,'freshness'),false);
});
test('loading and loaded evidence comes from visible DOM markers rather than absence alone',()=>{
 const node=(attributes,classes='')=>({tagName:'DIV',className:classes,innerText:'',getClientRects:()=>[{}],getAttribute:k=>attributes[k]??null,matches:s=>s.includes('[aria-busy="'+attributes['aria-busy']+'"]')});
 const busy=node({'aria-busy':'true'}),ready=node({'aria-busy':'false'}),root={matches:()=>false,querySelectorAll:s=>s.startsWith('[aria-busy="true"]')?[busy]:s.startsWith('[aria-busy="false"]')?[ready]:[]};
 const read=()=>vm.runInNewContext('('+areaReadinessDOM.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});
 let r=read();assert.equal(r.loading,true);assert.equal(r.explicitLoaded,true);assert.equal(r.loadingEvidence[0].ariaBusy,'true');
 root.querySelectorAll=()=>[];r=read();assert.equal(r.loading,false);assert.equal(r.explicitLoaded,false);assert.equal(r.emptyEvidence.length,0);
});
