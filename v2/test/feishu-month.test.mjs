import test from 'node:test';import assert from 'node:assert/strict';
import {performControl} from '../shared/control-operations.mjs';
function fixture(){
 const calls=[];let centered=false;
 const input={tagName:'INPUT',type:'text',getAttribute:()=>null,querySelector:()=>null,scrollIntoView:options=>{assert.equal(options.block,'center');centered=true;calls.push('center');}};
 const trigger={count:async()=>1,evaluate:async fn=>fn(input),press:async key=>calls.push(key),click:async options=>{assert.equal(options.force,undefined);calls.push('open');}};
 const page={locator:selector=>selector==='#date'?trigger:{click:async options=>{assert.equal(options.force,undefined);if(!centered)throw Error('FIXED_FOOTER_INTERCEPTS_MONTH');calls.push(selector);}}};
 return {calls,adapter:{page,assertSingleEditor:async()=>{},resolveSpec:async a=>a}};
}
test('month picker moves above a fixed footer before opening and clicking December',async()=>{
 const f=fixture();await performControl(f.adapter,{method:'feishu_month',selector:'#date'},'2019-12',{});
 assert.deepEqual(f.calls.slice(0,3),['Escape','center','open']);assert.match(f.calls[3],/2019/);assert.match(f.calls[4],/12/);
});
test('ongoing uses the same popup positioning and actual ongoing control',async()=>{
 const f=fixture();await performControl(f.adapter,{method:'feishu_month',selector:'#date'},'至今',{});assert.equal(f.calls.length,4);assert.match(f.calls[3],/data-cy="-"/);
});
test('invalid month performs no positioning or browser clicks',async()=>{
 const f=fixture();await assert.rejects(performControl(f.adapter,{method:'feishu_month',selector:'#date'},'2019-13',{}),/INVALID_MONTH_VALUE/);assert.deepEqual(f.calls,[]);
});
