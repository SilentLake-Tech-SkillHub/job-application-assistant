import test from 'node:test';import assert from 'node:assert/strict';
import {resolveBatchChannels} from '../shared/channel-policy.mjs';
const chrome={capability:{status:'detected',channels:['chrome']},channels:{chrome:{available:true},iab:{available:false}}};
test('unavailable IAB preference automatically uses the actual recorded Chrome executor and reports why',()=>{
 const result=resolveBatchChannels(chrome,['iab']);assert.deepEqual(result.channels,['chrome']);assert.equal(result.automaticFallback,true);assert.deepEqual(result.requestedChannels,['iab']);
});
test('a partial intersection narrows normally and an absent capability can never be invented',()=>{
 assert.equal(resolveBatchChannels(chrome,['chrome','iab']).automaticFallback,false);
 assert.throws(()=>resolveBatchChannels({channels:chrome.channels},['chrome']),/DETECTION_REQUIRED/);
 assert.throws(()=>resolveBatchChannels({...chrome,channels:{}}),/NO_USABLE_BROWSER_CHANNEL/);
 assert.throws(()=>resolveBatchChannels(chrome,[]),/INVALID_BATCH_BROWSER_CHANNELS/);
});
