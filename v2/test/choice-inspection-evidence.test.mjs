import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCapturedChoice} from '../shared/choice-capture.mjs';
import {performControl} from '../shared/control-operations.mjs';
test('native radio inspection reads current evidence instead of returning its static option list',async()=>{
 const records=[{label:'A',selected:true,nativeChecked:true,renderedChecked:false},{label:'B',selected:true,nativeChecked:true,renderedChecked:true}];
 const result=await inspectCapturedChoice({observe:async spec=>{assert.deepEqual(spec,{operation:'radioOptions',selector:'#question'});return records;}},{},{type:'radio_group',selector:'#question',options:['A','B']});
 assert.deepEqual(result.optionRecords,records);assert.equal(result.restored,true);
});
test('network diagnostics retain error codes while excluding console values and URL queries',async()=>{
 const message={text:()=> 'Failed to load private-value: net::ERR_HTTP2_PROTOCOL_ERROR',location:()=>({url:'https://example.test/upload?token=secret'})};
 const result=await performControl({resolveSpec:async action=>action,page:{consoleMessages:async()=>[message]}},{method:'wait',operation:'recent_network_errors',selector:'#resume'},null,{});
 assert.deepEqual(result.errors,[{code:'net::ERR_HTTP2_PROTOCOL_ERROR',resource:'https://example.test/upload'}]);assert.equal(JSON.stringify(result).includes('private-value'),false);assert.equal(JSON.stringify(result).includes('secret'),false);
});
