import test from 'node:test';import assert from 'node:assert/strict';
import {PluginTransport,MainChromePluginAdapter,pluginInspectionEndpoint,injectedSource} from '../shared/main-chrome-plugin.mjs';
import vm from 'node:vm';
import {executorCapability} from '../shared/browser-environment.mjs';
import {resolveBatchChannels} from '../shared/channel-policy.mjs';
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
