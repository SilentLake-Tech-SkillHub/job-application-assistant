import test from 'node:test';
import assert from 'node:assert/strict';
import {readPhoenixSelectedValue} from '../shared/phoenix-selection.mjs';
function trigger({value='上海市',count=1,layout='上海市',placeholder='请选择'}={}){
 let rootReads=0,contentReads=0;
 return {innerText:async()=>{rootReads++;return [value,layout,placeholder].join('\n');},locator:selector=>{assert.equal(selector,'.phoenix-select__content');return {count:async()=>count,innerText:async()=>{contentReads++;return value;}};},reads:()=>({rootReads,contentReads})};
}
test('Phoenix readback uses actual selected content despite duplicated calcEle layout text',async()=>{
 const t=trigger();assert.equal(await readPhoenixSelectedValue(t),'上海市');assert.deepEqual(t.reads(),{rootReads:0,contentReads:1});
});
test('empty selected content remains empty and cannot become a placeholder or layout measurement',async()=>{
 const t=trigger({value:'',layout:'old option',placeholder:'请选择'});assert.equal(await readPhoenixSelectedValue(t),'');assert.equal(t.reads().rootReads,0);
});
test('missing or duplicate content never falls back to matching trigger or layout text',async()=>{
 for(const count of [0,2]){const t=trigger({count});await assert.rejects(readPhoenixSelectedValue(t),count===0?/PHOENIX_SELECTED_CONTENT_REQUIRED/:/PHOENIX_SELECTED_CONTENT_NOT_UNIQUE/);assert.deepEqual(t.reads(),{rootReads:0,contentReads:0});}
});
