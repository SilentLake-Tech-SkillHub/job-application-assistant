import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {listPopupSelectionDOM} from '../shared/phoenix-area.mjs';
test('classic selection keeps exact leaf text separate from its visible parent annotation',()=>{
 const shown={getClientRects:()=>[{}]},annotation={...shown,innerText:'(Example Category)',matches:s=>s==='.full-label'};
 const leaf={...shown,innerText:'Example Role(Example Category)',matches:s=>s==='.select-text-label',childNodes:[{nodeType:3,textContent:'Example Role'},{nodeType:1,textContent:'(Example Category)'}]};
 const container={innerText:leaf.innerText,getAttribute:()=>null,querySelector:()=>null,querySelectorAll:s=>s.includes('.select-text-label')?[leaf]:s.includes('.full-label')?[annotation]:[]};
 const pane={...shown,querySelectorAll:s=>s==='.select-data-num-text'?[{innerText:'1/'}]:s==='.select-data-num-limit'?[{innerText:'1'}]:[container]},root={querySelectorAll:()=>[pane]};
 const read=()=>vm.runInNewContext('('+listPopupSelectionDOM.toString()+')(root)',{root,getComputedStyle:()=>({visibility:'visible'})});
 const actual=read();assert.equal(actual.text,'Example Role');assert.equal(actual.path,'Example Category');assert.equal(actual.scopeValid,true);
 annotation.innerText='Wrong Format';assert.equal(read().scopeValid,false);
 annotation.innerText='(Example Category)';leaf.childNodes=[];assert.equal(read().scopeValid,false);
});
