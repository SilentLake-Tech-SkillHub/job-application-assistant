import test from 'node:test';import assert from 'node:assert/strict';import {BrowserAdapter} from '../shared/browser.mjs';
const page=(target,generation='document-1')=>({url:()=> 'https://example.test/form',isClosed:()=>false,context:()=>({newCDPSession:async()=>({send:async method=>method==='Target.getTargetInfo'?{targetInfo:{targetId:target}}:{frameTree:{frame:{loaderId:generation}}},detach:async()=>{}})})});
test('native Chrome target IDs survive broker tracking reset and do not select another identical URL',async()=>{
 const a=page('native-original'),other=page('different-target'),b=new BrowserAdapter('http://127.0.0.1:1');b.state='connected';b.connection={contexts:()=>[{pages:()=>[a,other]}]};
 assert.equal(await b.trackPage(a),'native-original');b.pageIds.clear();assert.equal((await b.pageIdentity('native-original')).generation,'document-1');assert.equal(await b.trackedPage('native-original'),a);
 b.pageIds.clear();b.connection={contexts:()=>[{pages:()=>[other]}]};await assert.rejects(b.trackedPage('native-original'),/ROLE_BROWSER_PAGE_LOST/);
});
test('a refreshed bound page stays usable: the document changing is not a new page',async()=>{
 const a=page('native-original','new-document'),b=new BrowserAdapter('http://127.0.0.1:1');b.state='connected';b.connection={contexts:()=>[{pages:()=>[a]}]};b.executor={verified:true,sessionId:'actual-browser'};
 assert.ok(await b.existingPage(a.url(),{pageId:'native-original',roleBinding:{kind:'verified_role',taskId:'task',pageId:'native-original',pageUrl:a.url(),sessionId:'actual-browser',generation:'old-document'}}));
});
test('fake managed IAB and everyday Chrome discovery are rejected before any connector or launch',async()=>{
 let calls=0;for(const endpoint of ['managed-iab','chrome-default']){const b=new BrowserAdapter(endpoint,{connector:async()=>{calls++;},launcher:async()=>{calls++;}});await assert.rejects(b.connect(),/IAB_HOST_BRIDGE_REQUIRED|EXPLICIT_BROWSER_SESSION_REQUIRED/);}assert.equal(calls,0);
});
import {mkdtemp,rm,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('the Chrome clone (no --enable-automation) is verified by its browser pid matched to the process with its profile',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'clone-pid-'));try{
  const connection={newBrowserCDPSession:async()=>({send:async method=>{if(method==='Browser.getBrowserCommandLine')throw Error('Command line not returned because --enable-automation not set');if(method==='SystemInfo.getProcessInfo')return {processInfo:[{type:'renderer',id:8},{type:'browser',id:7}]};},detach:async()=>{}}),on(){}};
  const mk=processes=>new BrowserAdapter('http://127.0.0.1:9333',{profileDir:dir,connector:async()=>connection,versionProbe:async()=>({webSocketDebuggerUrl:'ws://127.0.0.1:9333/devtools/browser/id'}),processInventory:async()=>({available:true,processes})});
  let b=mk([{pid:7,profileDir:dir,debugPort:9333,explicitProxy:false,proxyPacConfigured:false}]);await b.connect();assert.equal(b.executor.verified,true);assert.equal(b.executor.profileProof,'browser_pid_process_inventory');
  b=mk([{pid:7,profileDir:'/some/other/profile',debugPort:9333}]);await b.connect();assert.equal(b.executor.verified,false);assert.equal(b.executor.reason,'BROWSER_PROFILE_IDENTITY_MISMATCH');
  b=mk([]);await b.connect();assert.equal(b.executor.verified,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('without pid evidence, DevToolsActivePort in the clone profile must name this port and the current browser id',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'clone-identity-'));try{
  // What Chrome answers without --enable-automation: the method is not available.
  const connection={newBrowserCDPSession:async()=>({send:async method=>{if(method==='Browser.getBrowserCommandLine')throw Error("Protocol error (Browser.getBrowserCommandLine): Command can only be executed if --enable-automation is set");},detach:async()=>{}}),on(){}};
  const adapter=id=>{const b=new BrowserAdapter('http://127.0.0.1:9333',{profileDir:dir,connector:async()=>connection,versionProbe:async()=>({webSocketDebuggerUrl:`ws://127.0.0.1:9333/devtools/browser/${id}`}),processInventory:async()=>({available:false,processes:[]})});return b;};
  await writeFile(path.join(dir,'DevToolsActivePort'),'9333\n/devtools/browser/live-id\n');
  let b=adapter('live-id');await b.connect();assert.equal(b.executor.verified,true);assert.equal(b.executor.profileProof,'devtools_active_port');assert.equal(b.executor.browserInstanceId,'live-id');
  b=adapter('relaunched-id');await b.connect();assert.equal(b.executor.verified,false);assert.equal(b.executor.reason,'BROWSER_PROFILE_IDENTITY_MISMATCH');
  await writeFile(path.join(dir,'DevToolsActivePort'),'9444\n/devtools/browser/live-id\n');b=adapter('live-id');await b.connect();assert.equal(b.executor.reason,'BROWSER_PROFILE_IDENTITY_MISMATCH');
  await rm(path.join(dir,'DevToolsActivePort'));b=adapter('live-id');await b.connect();assert.equal(b.executor.reason,'BROWSER_PROFILE_IDENTITY_MISMATCH');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a Chrome started with --enable-automation is still verified by its command line',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'cmdline-identity-'));try{
  const connection={newBrowserCDPSession:async()=>({send:async()=>({arguments:['--enable-automation',`--user-data-dir=${dir}`]}),detach:async()=>{}}),on(){}};
  const b=new BrowserAdapter('http://127.0.0.1:9333',{profileDir:dir,connector:async()=>connection,versionProbe:async()=>({webSocketDebuggerUrl:'ws://127.0.0.1:9333/devtools/browser/x'})});
  await b.connect();assert.equal(b.executor.verified,true);assert.equal(b.executor.profileProof,'browser_command_line');
 }finally{await rm(dir,{recursive:true,force:true});}
});
