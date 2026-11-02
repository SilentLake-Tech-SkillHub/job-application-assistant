import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {controlDOM} from '../shared/control-dom.mjs';
// Minimal DOM: each checkbox has an id and a label holder; only the checkbox query returns nodes.
function observe(boxes){
 const nodes=boxes.map(b=>{const holder={innerText:b.label,getClientRects:()=>[1]};return {id:b.id,checked:b.checked,getAttribute:()=>null,getClientRects:()=>[1],closest:()=>holder,parentElement:holder};});
 const document={scripts:[],body:{},querySelectorAll:s=>s==='input[type="checkbox"],[role="checkbox"]'?nodes:s.startsWith('#')?nodes.filter(n=>'#'+n.id===s):[]};
 return JSON.parse(JSON.stringify(vm.runInNewContext('('+controlDOM.toString()+')({operation:"submission_controls"})',{document,location:{href:'https://example.test/summary'},getComputedStyle:()=>({visibility:'visible'}),CSS:{escape:v=>v}})));
}
test('submission controls report agreement checkboxes only, never preference questions',()=>{
 const r=observe([{id:'a',label:'我已阅读并同意《隐私政策》',checked:false},{id:'b',label:'本人承诺以上信息真实有效',checked:true},{id:'c',label:'是否同意调剂',checked:false},{id:'d',label:'接收短信通知',checked:false}]);
 assert.deepEqual(r.agreements,[{label:'我已阅读并同意《隐私政策》',checked:false,selector:'#a'},{label:'本人承诺以上信息真实有效',checked:true,selector:'#b'}]);
});
