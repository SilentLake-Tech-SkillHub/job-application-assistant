import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {controlDOM,normalizePhoenixReference} from '../shared/control-dom.mjs';
test('repeat records and add control are resolved inside the exact observed heading',()=>{
 const node=(id,innerText)=>({id,innerText,tagName:'DIV',getClientRects:()=>[{}],getAttribute:()=>null});
 const root=node('section-a',''),add=node('add-a','添加记录'),heading=node('heading-a','Example education');
 heading.closest=s=>s==='.section'?root:null;root.querySelectorAll=s=>s==='.add'?[add]:[];
 const document={querySelectorAll:s=>s==='.heading'?[heading]:s==='#section-a'?[root]:s==='#add-a'?[add]:[]};
 const read=ref=>vm.runInNewContext('('+controlDOM.toString()+')({operation:"resolvePhoenix",references:[ref]})',{document,ref,getComputedStyle:()=>({visibility:'visible'}),CSS:{escape:s=>s}})[0];
 const spec={title:'Example education',headingSelector:'.heading',containerSelector:'.section',recordSelector:':scope > .record',addSelector:'.add',addLabel:'添加记录'};
 assert.equal(read('phoenixq:'+JSON.stringify({...spec,part:'repeatRecords'})),'#section-a > .record');
 assert.equal(read('phoenixq:'+JSON.stringify({...spec,part:'repeatAdd'})),'#add-a');
 assert.throws(()=>read('phoenixq:'+JSON.stringify({...spec,title:'Other section',part:'repeatRecords'})),/HEADING_NOT_UNIQUE/);
 assert.throws(()=>read('phoenixq:'+JSON.stringify({...spec,recordSelector:'.record',part:'repeatRecords'})),/CAPTURED_SCOPE_REQUIRED/);
});

test('malformed repeat references fail locally before browser RPC can hide their contract error',()=>{const value={part:'repeatRecords',title:'Languages',headingSelector:'.heading',containerSelector:'.section',recordSelector:'.record'};assert.throws(()=>normalizePhoenixReference('phoenixq:'+JSON.stringify(value)),/REPEAT_CAPTURED_SCOPE_REQUIRED/);value.recordSelector=':scope > .record';assert.equal(normalizePhoenixReference('phoenixq:'+JSON.stringify(value)),'phoenixq:'+JSON.stringify(value));});

test('browser RPC rejects malformed repeat scope before attempting its socket',async()=>{const {BrokerBrowserAdapter}=await import('../shared/browser-rpc.mjs');const broker=new BrokerBrowserAdapter('/not-a-real-browser.sock');const selector='phoenixq:'+JSON.stringify({part:'repeatRecords',title:'Languages',recordSelector:'.record'});await assert.rejects(broker.request('observe',{plan:{groups:[{id:'x',selector}]}}),/REPEAT_CAPTURED_SCOPE_REQUIRED/);});
