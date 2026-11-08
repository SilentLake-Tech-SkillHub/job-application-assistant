import test from 'node:test';import assert from 'node:assert/strict';
import {openSamplingBridge,delegatedVisionReviewer,withHostCapabilities} from '../shared/sampling-bridge.mjs';
test('host sampling availability remains per-call across independent core boundary',async()=>{
 const bridge=await openSamplingBridge({getClientCapabilities:()=>({sampling:{}})}),reviewer=delegatedVisionReviewer();
 try{assert.equal(await reviewer.isAvailable(),false);assert.equal(await withHostCapabilities({visionSocket:bridge.socket},()=>reviewer.isAvailable()),true);assert.equal(await reviewer.isAvailable(),false);}finally{await bridge.close();}
});
