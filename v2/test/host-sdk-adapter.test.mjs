import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {startHostBrowserBridge,withHostBrowserBridge} from '../shared/host-browser-bridge.mjs';import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
test('caller mode and a Playwright browser cannot fabricate an official host inventory',async()=>{
 const options={browser:{browserId:'x'},socketPath:'/tmp/never-started.sock',allowedOrigins:['https://example.test']};
 await assert.rejects(startHostBrowserBridge(options),/INVALID_HOST_BRIDGE_CONFIGURATION/);
 await assert.rejects(startHostBrowserBridge({...options,inventory:async()=>[{id:'x',type:'chromium'}]}),/PROVIDER_NOT_VERIFIED/);
 await assert.rejects(startHostBrowserBridge({...options,inventory:async()=>[{id:'x',type:'iab'}],hostEnvironment:{}}),/SESSION_ID_REQUIRED/);
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
