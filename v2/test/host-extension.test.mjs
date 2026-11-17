import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {spawn} from 'node:child_process';
import {loadAdapter} from '../host/adapters/registry.mjs';
import {registerHostExtension,resolveHostExtension,extensionSocketPath} from '../shared/host-extension.mjs';
import {installHost} from '../scripts/install-host.mjs';
import {registerMainChromeExtension} from '../scripts/host-browser-bridge.mjs';
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {registerAgent} from '../shared/agent-registry.mjs';
for(const [host,id,transport]of [['codex','chatgpt','host_sdk'],['claude-code','claude','host_sdk'],['kimi-work','kimi','webbridge']])test(host+' declares its own extension',async()=>{
 const a=await loadAdapter(host);assert.equal(a.mainChromeExtension.id,id);assert.equal(a.mainChromeExtension.transport,transport);
});
test('new host extension registration is explicit, updates one registry row and preserves existing surfaces',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'extension-reg-'));
 try{
  await registerHostExtension({workspace,hostId:'new-agent',agent:'New Agent',extension:{id:'new-plugin',name:'New Plugin',transport:'host_sdk'}});
  await registerHostExtension({workspace,hostId:'new-agent',agent:'New Agent',extension:{id:'new-plugin',name:'New Plugin',transport:'host_sdk'}});
  const registry=JSON.parse(await readFile(path.join(workspace,'产品管理/Agent浏览器兜底登记.json'),'utf8'));
  assert.equal(registry.agents.length,1);assert.ok(registry.agents[0]['浏览器'].includes('chrome_main_extension'));
  assert.equal(resolveHostExtension({registry,hostId:'new-agent'}).id,'new-plugin');
  assert.throws(()=>resolveHostExtension({registry,hostId:'codex'}),/HOST_EXTENSION_NOT_REGISTERED/);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
test('installer registers supported plugins and accepts a future agent explicit plugin declaration',async()=>{
 const workspace=await mkdtemp(path.join(os.tmpdir(),'extension-install-'));
 try{
  await installHost({host:'codex',workspace,write:true});
  await installHost({host:'new-agent',workspace,write:true,extension:{id:'new-plugin',name:'New Plugin',transport:'host_sdk'}});
  await installHost({host:'unknown-agent',workspace,write:true});
  const registry=JSON.parse(await readFile(path.join(workspace,'产品管理/Agent浏览器兜底登记.json'),'utf8'));
  assert.equal(resolveHostExtension({registry,hostId:'codex'}).id,'chatgpt');
  assert.equal(resolveHostExtension({registry,hostId:'new-agent'}).id,'new-plugin');
  assert.throws(()=>resolveHostExtension({registry,hostId:'unknown-agent'}),/HOST_EXTENSION_NOT_REGISTERED/);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
test('native extension sockets remain separate for hosts sharing the same clone broker',()=>{
 assert.notEqual(extensionSocketPath('/tmp/recruiting/b.sock','codex'),extensionSocketPath('/tmp/recruiting/b.sock','claude-code'));
 assert.throws(()=>extensionSocketPath('/tmp/recruiting/b.sock','../other'),/HOST_EXTENSION_ID_INVALID/);
});
test('a known host cannot register or resolve another product plugin even when the generic main surface is allowed',async()=>{
 const workspace=await mkdtemp('/tmp/ext-owner-');
 try{
  await assert.rejects(registerHostExtension({workspace,hostId:'codex',extension:{id:'kimi',name:'Kimi',transport:'webbridge'}}),/HOST_EXTENSION_IDENTITY_MISMATCH/);
  const registry={agents:[{hostId:'codex','浏览器':['chrome_main_extension'],mainChromeExtension:{id:'kimi',name:'Kimi',transport:'webbridge'}}]};
  assert.throws(()=>resolveHostExtension({registry,hostId:'codex',capability:{id:'chatgpt',transport:'host_sdk'}}),/HOST_EXTENSION_IDENTITY_MISMATCH/);
 }finally{await rm(workspace,{recursive:true,force:true});}
});
test('direct future Agent registration records its declared plugin without changing its stable Agent id',async()=>{
 const workspace=await mkdtemp('/tmp/ext-agent-');
 try{
  const input={workspace,host:'new-agent',instance:'default',extension:{id:'own-plugin',name:'Own Plugin',transport:'host_sdk'}};
  const first=await registerAgent(input),again=await registerAgent(input);assert.equal(first.id,again.id);
  const registry=JSON.parse(await readFile(path.join(workspace,'产品管理/Agent浏览器兜底登记.json'),'utf8'));assert.equal(resolveHostExtension({registry,hostId:'new-agent'}).id,'own-plugin');
 }finally{await rm(workspace,{recursive:true,force:true});}
});
test('the shared broker routes each real request to its registered host plugin and checks the returned identity',async()=>{
 const root=await mkdtemp('/tmp/ext-route-'),socket=path.join(root,'b.sock'),servers=[],calls=[];let child,corrupt=false;
 const rpc=(body)=>new Promise((resolve,reject)=>{const r=http.request({socketPath:socket,path:'/rpc',method:'POST'},s=>{let raw='';s.on('data',c=>raw+=c);s.on('end',()=>resolve(JSON.parse(raw)));});r.on('error',reject);r.end(JSON.stringify(body));});
 try{
  for(const [hostId,id]of [['codex','chatgpt'],['claude-code','claude']]){
   await registerHostExtension({workspace:root,hostId,extension:{id,name:id,transport:'host_sdk'}});
   const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const {method}=JSON.parse(raw);calls.push([hostId,method]);res.end(JSON.stringify({data:method==='status'?{state:'connected',mode:'agent_plugin',executor:{verified:true,sessionId:hostId,hostId,extensionId:corrupt&&hostId==='codex'?'claude':id,browserType:'extension'}}:{plugin:id}}));});
   await new Promise(resolve=>server.listen(extensionSocketPath(socket,hostId),resolve));servers.push(server);
  }
  await writeFile(path.join(root,'产品管理','浏览器设置.json'),JSON.stringify({choice:'main'}));
  child=spawn(process.execPath,['shared/browser-host.mjs',socket],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_WORKSPACE_ROOT:root,RECRUITING_BROWSER_MODE:'cdp',RECRUITING_CDP_URL:'http://127.0.0.1:9'},stdio:'ignore'});
  let result;for(let i=0;i<400;i++){try{result=await rpc({method:'initializeConfiguredChrome',hostId:'codex'});break;}catch{await new Promise(r=>setTimeout(r,30));}}
  assert.deepEqual(result.data,{plugin:'chatgpt'});
  assert.deepEqual((await rpc({method:'initializeConfiguredChrome',hostId:'claude-code'})).data,{plugin:'claude'});
  assert.equal((await rpc({method:'act',hostId:'unknown-agent'})).error,'HOST_EXTENSION_NOT_REGISTERED');
  assert.ok(calls.some(([h,m])=>h==='codex'&&m==='initializeConfiguredChrome'));
  corrupt=true;assert.equal((await rpc({method:'act',hostId:'codex'})).error,'HOST_EXTENSION_IDENTITY_MISMATCH');assert.equal(calls.some(([,m])=>m==='act'),false);
 }finally{if(child){child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}for(const s of servers)await new Promise(r=>s.close(r));await rm(root,{recursive:true,force:true});}
});
test('the official host extension bridge claims an existing user tab, preserves it, and reports plugin identity through RPC',async()=>{
 const workspace=await mkdtemp('/tmp/ext-sdk-'),url='https://example.test/form',claims=[];let bridge;
 const tab={id:'user-tab',url:async()=>url,goto:async()=>{throw Error('must preserve user page');},markHandoff:async()=>{},playwright:{evaluate:async()=>({url,generation:null})},capabilities:{get:async()=>({send:async method=>{assert.equal(method,'Page.getFrameTree');return {frameTree:{frame:{loaderId:'observed-loader'}}};}})}};
 try{
  await registerHostExtension({workspace,hostId:'codex',extension:{id:'chatgpt',name:'ChatGPT',transport:'host_sdk'}});
  const browser={browserId:'official-extension',tabs:{list:async()=>[],get:async()=>{throw Error('must claim first');}},user:{openTabs:async()=>[{id:tab.id,url}],claimTab:async t=>{claims.push(t.id);return tab;}}};
  const agent={browsers:{list:async()=>[{id:browser.browserId,type:'extension'}],get:async()=>browser}};
  const env={RECRUITING_HANDOFF_DIR:path.join(workspace,'岗位交接'),RECRUITING_HOST_ID:'codex',RECRUITING_BROWSER_SOCKET:path.join(workspace,'b.sock')};
  bridge=await registerMainChromeExtension({agent,browserId:browser.browserId,allowedOrigins:['https://example.test'],env,deferBrowserCalls:false});
  const client=new BrokerBrowserAdapter(bridge.socketPath),status=await client.status();assert.equal(status.executor.extensionId,'chatgpt');assert.equal(status.executor.hostId,'codex');
  assert.equal((await client.request('openPage',{pageUrl:url})).reused,true);assert.deepEqual(claims,['user-tab']);
  assert.equal((await client.request('pageIdentity',{pageId:'user-tab'})).generation,'observed-loader');
  await assert.rejects(client.request('closePage',{pageId:'user-tab'}),/MAIN_CHROME_BORROWED_PAGE_PRESERVED/);
 }finally{if(bridge)await new Promise(r=>bridge.server.close(r));await rm(workspace,{recursive:true,force:true});}
});
