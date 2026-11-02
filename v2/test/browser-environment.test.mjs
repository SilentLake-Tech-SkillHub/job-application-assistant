import test from 'node:test';import assert from 'node:assert/strict';
import {readChromeProcessInventory,executorCapability} from '../shared/browser-environment.mjs';
test('process metadata strips proxy authentication and distinguishes explicit profiles and debugging ports',async()=>{
 const r=await readChromeProcessInventory({run:async()=>({stdout:'  2013 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/private/Example Profile --proxy-server=http://username:password@proxy.test:8080 --remote-debugging-port=9223 about:blank\n'})});
 assert.equal(r.available,true);assert.equal(r.processes[0].profileDir,'/private/Example Profile');assert.equal(r.processes[0].debugPort,9223);assert.equal(r.processes[0].proxyEndpoint,'http://proxy.test:8080');assert.equal(JSON.stringify(r).includes('password'),false);
});
test('mode strings alone cannot certify IAB or Chrome executor capability',()=>{
 assert.equal(executorCapability({mode:'iab'},'iab').available,false);assert.equal(executorCapability({mode:'iab',executor:{provider:'managed_chrome',verified:true,sessionId:'x'}},'iab').available,false);assert.equal(executorCapability({mode:'iab',executor:{provider:'official_host_browser_sdk',verified:true,sessionId:'actual'}},'iab').available,true);assert.equal(executorCapability({mode:'cdp',executor:{provider:'unverified_proxy',verified:true,sessionId:'x'}},'chrome').available,false);
});

test('process inventory keeps Unicode profile paths in a broker with no inherited locale',async()=>{
 const {readChromeProcessInventory}=await import('../shared/browser-environment.mjs');
 const result=await readChromeProcessInventory({run:async(command,args,options)=>{
  assert.equal(options.env.LC_ALL,process.platform==='darwin'?'en_US.UTF-8':'C.UTF-8');
  return {stdout:'777 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/中文目录/chrome-profile --remote-debugging-port=9333'};
 }});assert.equal(result.processes[0].profileDir,'/tmp/中文目录/chrome-profile');assert.equal(result.processes[0].debugPort,9333);
});
