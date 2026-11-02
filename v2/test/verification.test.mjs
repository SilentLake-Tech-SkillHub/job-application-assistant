import test from 'node:test';
import assert from 'node:assert/strict';
import {beforeLoginStep} from '../hooks/login-gate.mjs';
import {readFile} from 'node:fs/promises';
test('human CAPTCHA blocks all dependent login mutations',()=>{
 for(const step of ['prepare','send','verify'])assert.throws(()=>beforeLoginStep({step,state:{challenges:1},authorization:{login:true,evidence:'synthetic'}}),/USER_VERIFICATION_REQUIRED/);
});
test('browser broker exposes inspection but no automatic CAPTCHA mutation',async()=>{
 const source=await readFile(new URL('../shared/browser-host.mjs',import.meta.url),'utf8');
 assert.ok(source.includes("'verificationInspect'"));
 assert.equal(/verificationPrepare|verificationExecute|VerificationDriver/.test(source),false);
});
