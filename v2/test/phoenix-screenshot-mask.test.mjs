import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {screenshotMaskDOM} from '../shared/screenshot-mask.mjs';
test('Phoenix document inputs with generic attributes are masked by their real question label without reading the number',()=>{
 const question={querySelector:s=>s.includes('form-item__text')?{textContent:'证件号码'}:null};
 const input={tagName:'INPUT',type:'text',id:'generic-field',name:'',getAttribute:()=>null,closest:s=>s.includes('.form-item--phoenix')?question:null};
 Object.defineProperty(input,'value',{get:()=>{throw Error('MUST_NOT_READ_IDENTITY_VALUE');}});
 const result=vm.runInNewContext('('+screenshotMaskDOM.toString()+')()',{document:{querySelectorAll:s=>s==='input,textarea'?[input]:[input]},CSS:{escape:s=>s}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),['#generic-field']);
});
test('a government number rendered as summary text is masked without returning its text',()=>{
 const plain={tagName:'SPAN',id:'summary-government',childNodes:[{nodeType:3,textContent:'1'.repeat(18)}]},script={tagName:'SCRIPT',childNodes:[{nodeType:3,textContent:'1'.repeat(18)}]},normal={tagName:'SPAN',id:'ordinary',childNodes:[{nodeType:3,textContent:'ordinary text'}]};
 const result=vm.runInNewContext('('+screenshotMaskDOM.toString()+')()',{document:{querySelectorAll:s=>s==='input,textarea'?[]:s==='body *'?[plain,script,normal]:s==='#summary-government'?[plain]:[]},CSS:{escape:s=>s}});
 assert.deepEqual(JSON.parse(JSON.stringify(result)),['#summary-government']);assert.equal(JSON.stringify(result).includes('1'.repeat(18)),false);
});
