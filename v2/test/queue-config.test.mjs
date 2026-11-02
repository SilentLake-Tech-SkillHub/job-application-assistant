import test from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';
import {queueFromEnv} from '../shared/queue-config.mjs';
test('moving canonical profile does not lose the existing application queue',()=>{
 const keys=['RECRUITING_PROFILE_JSON','RECRUITING_PRIVATE_DIR','RECRUITING_ROLE_QUEUE_DIR'],prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try{delete process.env.RECRUITING_ROLE_QUEUE_DIR;process.env.RECRUITING_PROFILE_JSON=path.resolve('canonical/profile.json');process.env.RECRUITING_PRIVATE_DIR=path.resolve('runtime/application');assert.equal(queueFromEnv([]).root,path.resolve('runtime/.role-queue'));process.env.RECRUITING_ROLE_QUEUE_DIR=path.resolve('explicit/queue');assert.equal(queueFromEnv([]).root,path.resolve('explicit/queue'));}
 finally{for(const k of keys)if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}
});
