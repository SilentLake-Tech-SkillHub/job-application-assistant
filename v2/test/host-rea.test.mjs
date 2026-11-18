import test from 'node:test';
import assert from 'node:assert/strict';
import {collectHostReaPage} from '../shared/host-rea.mjs';

function fixture({moves=false}={}){
 const pageUrl='https://example.test/form',calls=[];let reads=0;
 const tab={id:'123',url:async()=>pageUrl,title:async()=> 'Form',capabilities:{get:async()=>({
  send:async(method,params)=>{calls.push({method,params});
   if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'frame',loaderId:moves&&++reads>1?'changed':'loader',url:pageUrl,securityOrigin:new URL(pageUrl).origin},childFrames:[{frame:{id:'foreign',securityOrigin:'https://other.test'}}]}};
   if(method==='Page.getResourceTree')return {frameTree:{resources:[]}};
   if(method==='DOMSnapshot.captureSnapshot')return {documents:[],strings:[]};
   if(method==='Accessibility.getFullAXTree')return {nodes:[{nodeId:'node'}]};
   return {};
  }
 })}};
 return {tab,pageUrl,calls};
}
test('host REA collects the original tab without browser-wide target discovery',async()=>{
 const f=fixture(),result=await collectHostReaPage(f);
 assert.equal(result.binding.targetId,'host-tab:123');
 assert.equal(result.nativeStructure.targetId,result.binding.targetId);
 assert.deepEqual(f.calls.filter(x=>x.method==='Accessibility.getFullAXTree').map(x=>x.params.frameId),['frame']);
 assert.ok(f.calls.every(x=>!x.method.startsWith('Target.')));
});
test('host REA discards the result if the bound document changes during capture',async()=>{
 await assert.rejects(collectHostReaPage(fixture({moves:true})),/REA_PAGE_BINDING_CHANGED/);
});
