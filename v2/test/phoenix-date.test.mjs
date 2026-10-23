import test from 'node:test';import assert from 'node:assert/strict';import {performPhoenixDate} from '../shared/phoenix-date.mjs';
function fixture({missingMarker=false,ongoing=false}={}){
 let year=2026,value='',opened=false,writes=0,checked=false;const locator=extra=>({count:async()=>1,filter(){return this;},waitFor:async()=>{},...extra});
 const trigger=locator({click:async()=>{opened=true;},innerText:async()=>value||'请选择'}),label=locator({click:async()=>{opened=false;}});
 const panel=locator({count:async()=>opened?1:0,innerText:async()=>year+'年 1月 2月',locator:selector=>{
  if(selector==='.phoenix-calendar-month-panel')return locator({});
  if(selector==='.phoenix-date-picker-special-text input')return locator({count:async()=>ongoing?1:0,inputValue:async()=>'至今'});
  if(selector==='.phoenix-date-picker-special-check input[type="checkbox"]')return locator({count:async()=>ongoing?1:0,setChecked:async v=>{checked=v;value=v?'至今':'';writes++;},isChecked:async()=>checked});
  if(selector==='.phoenix-calendar-month-panel-year-select-content')return locator({innerText:async()=>String(year)});
  if(selector.includes('prev-year-btn')||selector.includes('next-year-btn'))return locator({click:async()=>{year+=selector.includes('prev')?-1:1;}});
  if(selector==='.phoenix-calendar-month-panel-cell'){let month;return locator({filter({hasText}){month=Array.from({length:12},(_,i)=>i+1).find(n=>hasText.test(n+'月'));return this;},click:async()=>{value=year+'-'+String(month).padStart(2,'0');opened=false;writes++;},evaluate:async fn=>fn({className:missingMarker?'phoenix-calendar-month-panel-current-cell':'phoenix-calendar-month-panel-selected-cell',getAttribute:()=>null})});}
  throw Error('unexpected test locator '+selector);
 }});
 return {adapter:{page:{locator:selector=>selector==='#date'?trigger:selector==='#label'?label:panel}},state:()=>({year,value,opened,writes})};
}
test('Phoenix date discovery reads actual panel precision and restores without changing a value',async()=>{const f=fixture(),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label',operation:'inspect'});assert.equal(r.dateOptions.precision,'month');assert.equal(r.restored,true);assert.equal(f.state().writes,0);});
test('Phoenix month selection navigates actual year and independently reopens selected month',async()=>{const f=fixture(),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label'},'2027-08');assert.equal(r.selectionVerified,true);assert.deepEqual(f.state(),{year:2027,value:'2027-08',opened:false,writes:1});});
test('matching date text and today marker cannot substitute for actual selected state',async()=>{const f=fixture({missingMarker:true});await assert.rejects(performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label'},'2026-10'),/SELECTION_NOT_VERIFIED/);assert.equal(f.state().writes,1);});
test('ongoing dates require the real displayed option and checked checkbox',async()=>{const f=fixture({ongoing:true}),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label'},'至今');assert.equal(r.selectionVerified,true);assert.equal(f.state().value,'至今');const absent=fixture();await assert.rejects(performPhoenixDate(absent.adapter,{selector:'#date',labelSelector:'#label'},'至今'),/OPTION_NOT_CAPTURED/);assert.equal(absent.state().writes,0);});
