import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {controlDOM} from '../shared/control-dom.mjs';
import {verifyForm} from '../shared/verifier.mjs';
function read({value='x'.repeat(2132),counter='2132/2000',maxLength=-1,nativeTooLong=false,error=false}={}){
 const shown=()=>[{}],bar={innerText:counter,getClientRects:shown},box={querySelector:()=>bar},message={innerText:'最多输入2000字符',getClientRects:shown};
 const question={querySelectorAll:()=>error?[message]:[]};
 const input={tagName:'TEXTAREA',value,maxLength,validity:{tooLong:nativeTooLong},getClientRects:shown,getAttribute:()=>null,closest:s=>s==='.phoenix-textarea'?box:question};
 const field={id:'description',label:'工作职责',kind:'text',read:{selector:'#description',kind:'value'}};
 const document={querySelectorAll:s=>s==='#description'?[input]:[],body:{}};
 const observed=vm.runInNewContext('('+controlDOM.toString()+')(spec)',{document,spec:{fields:[field]},getComputedStyle:()=>({visibility:'visible'}),location:{href:'https://fixture.test/form'},Date});
 return {field,observation:JSON.parse(JSON.stringify(observed)),value};
}
test('equal profile/page text still fails when the actual Phoenix counter exceeds its limit',()=>{
 const f=read();assert.ok(f.observation.fields.description.errors.length);
 const r=verifyForm({pageUrl:'https://fixture.test/form',roleTitle:'Product',fields:[{...f.field,value:f.value}]},{...f.observation,roleTitle:'Product',inventoryIds:['description']});
 assert.notEqual(r.status,'verified');assert.ok(r.checks.some(c=>c.reason==='FIELD_VALIDATION_ERROR'));
});
test('a within-limit counter is not mistaken for a validation error',()=>{
 const f=read({value:'x'.repeat(1859),counter:'1859/2000'});assert.deepEqual(f.observation.fields.description.errors,[]);
});
test('native maximum lengths and native too-long validity fail without reading error prose',()=>{
 for(const options of [{maxLength:2000,counter:''},{nativeTooLong:true,counter:''}])assert.ok(read(options).observation.fields.description.errors.length);
});
