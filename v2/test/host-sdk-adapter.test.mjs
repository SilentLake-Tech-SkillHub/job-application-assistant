import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {registerAgent} from '../shared/agent-registry.mjs';
import {startHostBrowserBridge,withHostBrowserBridge} from '../shared/host-browser-bridge.mjs';import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
test('caller mode and a Playwright browser cannot fabricate an official host inventory',async()=>{
 const options={browser:{browserId:'x'},socketPath:'/tmp/never-started.sock',allowedOrigins:['https://example.test']};
 await assert.rejects(startHostBrowserBridge(options),/INVALID_HOST_BRIDGE_CONFIGURATION/);
 await assert.rejects(startHostBrowserBridge({...options,inventory:async()=>[{id:'x',type:'chromium'}]}),/PROVIDER_NOT_VERIFIED/);
});
test('official SDK locator subset supports readback without assuming Playwright-only text and value methods',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'host-sdk-')),url='https://example.test/form';
 const nodes={text:{innerText:'Current account'},value:{value:'Committed value'}};
 const tab={id:'native-tab',url:async()=>url,playwright:{evaluate:async()=>({url,generation:'observed-document'}),locator:selector=>({count:async()=>1,evaluate:async(fn,arg)=>fn(nodes[selector],arg)})}};
 class Adapter{constructor(page){this.page=page;}async inventory(){return [await this.page.locator('text').innerText(),await this.page.locator('value').inputValue()];}}
 try{await withHostBrowserBridge({browser:{browserId:'official-iab',tabs:{list:async()=>[{id:tab.id,url}],get:async()=>tab}},inventory:async()=>[{id:'official-iab',type:'iab',metadata:{codexSessionId:'actual-host'}}],socketPath:path.join(dir,'b.sock'),allowedOrigins:['https://example.test'],pageAdapter:Adapter},async({socketPath})=>{
 const broker=new BrokerBrowserAdapter(socketPath),status=await broker.status();assert.equal(status.executor.provider,'official_host_browser_sdk');assert.equal(status.executor.verified,true);
 const page=await broker.existingPage(url);assert.equal(page.pageId,'native-tab');assert.equal(page.roleBinding.generation,'observed-document');assert.deepEqual(await page.inventory({}),['Current account','Committed value']);
 });}finally{await rm(dir,{recursive:true,force:true});}
});

test('browser bridge identity follows the verified browser and stable Agent group across conversations',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'host-agent-'));
 try{
  const host='codex';
  const first=await registerAgent({workspace,host,instance:'member-one',mode:'multi_agent',group:'team'});
  const second=await registerAgent({workspace,host,instance:'member-two',mode:'multi_agent',group:'team'});
  const independent=await registerAgent({workspace,host,instance:'independent'});
  async function browserSession(agent,thread,browserId='official-iab'){
   return withHostBrowserBridge({
    browser:{browserId},inventory:async()=>[{id:browserId,type:'iab',metadata:{codexSessionId:thread}}],
    socketPath:path.join(workspace,'bridge.sock'),allowedOrigins:['https://example.test'],
    hostEnvironment:{RECRUITING_WORKSPACE_ROOT:workspace,RECRUITING_HOST_ID:host,RECRUITING_AGENT_ID:agent.id,CODEX_THREAD_ID:thread}
   },async({socketPath})=>(await new BrokerBrowserAdapter(socketPath).status()).executor.sessionId);
  }
  const original=await browserSession(first,'original');
  assert.equal(await browserSession(first,'fork'),original);
  assert.equal(await browserSession(second,'new'),original);
  assert.notEqual(await browserSession(independent,'fork'),original);
  assert.notEqual(await browserSession(first,'fork','other-browser'),original);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
