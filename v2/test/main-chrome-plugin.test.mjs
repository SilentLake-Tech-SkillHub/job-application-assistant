import test from 'node:test';import assert from 'node:assert/strict';
import {PluginTransport,MainChromePluginAdapter,pluginInspectionEndpoint,injectedSource} from '../shared/main-chrome-plugin.mjs';
import vm from 'node:vm';
import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';import http from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {executorCapability} from '../shared/browser-environment.mjs';
import {resolveBatchChannels} from '../shared/channel-policy.mjs';
test('the actual bootstrap launch chain passes workspace selection to its dormant broker',async()=>{
 const root=await mkdtemp('/tmp/c48-launch-'),socket=path.join(root,'host.sock');
 await mkdir(path.join(root,'产品管理'));await writeFile(path.join(root,'产品管理','浏览器设置.json'),JSON.stringify({schemaVersion:1,choice:'main'}));
 const rpc=body=>new Promise((resolve,reject)=>{const req=http.request({socketPath:socket,path:'/rpc',method:'POST'},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks))));});req.on('error',reject);req.end(JSON.stringify(body));});
 try{
  await promisify(execFile)(process.execPath,['--input-type=module','-e',"import {bootstrapRuntime} from './shared/bootstrap.mjs';await bootstrapRuntime({workspace:process.argv[1]});",root],{timeout:15000,env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:'cdp',RECRUITING_CDP_URL:'http://127.0.0.1:9',RECRUITING_BROWSER_SOCKET:socket}});
  assert.equal((await rpc({method:'wait',args:{ms:1}})).error,'BROWSER_RESTORE_REQUIRED');
 }finally{await rpc({method:'shutdown'}).catch(()=>{});await rm(root,{recursive:true,force:true});}
});
test('a broker started with the configured handoff directory reads main Chrome selection before any operation',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'c48-broker-')),socket=path.join(root,'host.sock');
 await mkdir(path.join(root,'产品管理'));await writeFile(path.join(root,'产品管理','浏览器设置.json'),JSON.stringify({schemaVersion:1,choice:'main'}));
 const child=spawn(process.execPath,['shared/browser-host.mjs',socket],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:'cdp',RECRUITING_CDP_URL:'http://127.0.0.1:9',RECRUITING_HANDOFF_DIR:path.join(root,'岗位交接')},stdio:['ignore','pipe','pipe']});
 const rpc=(url,body)=>new Promise((resolve,reject)=>{const r=http.request({socketPath:socket,path:url,method:body?'POST':'GET',headers:{'content-type':'application/json'}},s=>{const chunks=[];s.on('data',c=>chunks.push(c));s.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks))));});r.on('error',reject);r.end(body?JSON.stringify(body):undefined);});
 try{
  let ready=false;for(let i=0;i<100;i++){try{await rpc('/health');ready=true;break;}catch{await new Promise(r=>setTimeout(r,30));}}
  assert.equal(ready,true);const r=await rpc('/rpc',{method:'wait',args:{ms:1}});assert.equal(r.error,'BROWSER_RESTORE_REQUIRED');
 }finally{child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(root,{recursive:true,force:true});}
});
test('the pinned selector engine loads as valid browser code without starting Chromium',()=>{
 const source=injectedSource();assert.ok(source.includes('module.exports'));assert.doesNotThrow(()=>new vm.Script(source));
});
test('plugin commands preserve exact values and bind every action to the selected existing tab',async()=>{
 const requests=[],transport=new PluginTransport({session:'test-task',fetcher:async(url,options)=>{requests.push({url,...options});return {ok:true,json:async()=>({ok:true,data:{value:'observed'}})};}});
 const value="A' $() `text` 中文";assert.equal((await transport.call('fill',{selector:'#name',value},17)).value,'observed');
 const body=JSON.parse(requests[0].body);assert.equal(body.args.value,value);assert.equal(body.args.tabId,17);assert.equal(body.session,'test-task');
});
test('main Chrome initialization uses the connected extension and never launches a browser',async()=>{
 const calls=[],transport={status:async()=>({extension_connected:true}),call:async action=>{calls.push(action);return {tabs:[{tabId:17,url:'https://example.test/form',title:'Form'}]};}};
 const browser=new MainChromePluginAdapter({transport}),r=await browser.initializeConfiguredChrome();
 assert.equal(r.chromeStarted,false);assert.equal(r.provider,'agent_plugin_main_chrome');assert.equal(r.executor.verified,true);
 assert.equal(executorCapability(r,'chrome').available,true);assert.equal(executorCapability(r,'iab').available,false);
 assert.deepEqual(resolveBatchChannels({channels:{chrome:executorCapability(r,'chrome')},capability:{status:'not_configured'}}).channels,['chrome']);
 assert.deepEqual((await browser.tabs()).map(t=>[t.id,t.pluginTabId]),[['main-17',17]]);assert.deepEqual(calls,['list_browser_tabs','list_browser_tabs']);
});
test('reusing a user tab attaches it as borrowed through the plugin before reading or editing',async()=>{
 const calls=[],transport={status:async()=>({extension_connected:true}),call:async(action,args)=>{calls.push([action,args]);return action==='list_browser_tabs'?{tabs:[{tabId:17,url:'https://example.test/form',title:'Form'}]}:{success:true,borrowed:true};}};
 const browser=new MainChromePluginAdapter({transport});await browser.initializeConfiguredChrome();
 assert.equal((await browser.openPage('https://example.test/form')).reused,true);
 await browser.trackedPage('main-17');assert.deepEqual(calls.filter(([a])=>a==='attach_tab'),[['attach_tab',{tabId:17}]]);
 assert.equal(calls.some(([a])=>a==='navigate'),false);
});
test('REA inspection facade forwards actual CDP command responses for the bound tab',async()=>{
 const calls=[],bridge=await pluginInspectionEndpoint({cdp:async(method,params)=>{calls.push({method,params});return {root:{nodeId:42}};}}),socket=new WebSocket(bridge.endpoint);
 try{
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const reply=new Promise(resolve=>socket.addEventListener('message',e=>resolve(JSON.parse(e.data)),{once:true}));socket.send(JSON.stringify({id:7,method:'DOM.getDocument',params:{depth:1}}));
  assert.deepEqual(await reply,{id:7,result:{root:{nodeId:42}}});assert.deepEqual(calls,[{method:'DOM.getDocument',params:{depth:1}}]);
 }finally{socket.close();await bridge.close();}
});
test('screenshot masks remain until the extension capture actually completes',async()=>{
 const events=[],transport={status:async()=>({extension_connected:true}),evaluate:async code=>{if(code.includes('node.remove()'))events.push('unmask');return true;},call:async action=>{
  if(action==='list_browser_tabs')return {tabs:[{tabId:17,url:'https://example.test/form',title:'Form'}]};
  if(action==='screenshot'){await new Promise(r=>setTimeout(r,5));events.push('capture');return {path:'synthetic.png'};}
 }};
 const browser=new MainChromePluginAdapter({transport});await browser.initializeConfiguredChrome();
 const page=browser.pages.get('main-17');await page.screenshot({selector:'#field',mask:[{evaluateAll:async()=>events.push('mask')}]});
 assert.deepEqual(events,['mask','capture','unmask']);
});
