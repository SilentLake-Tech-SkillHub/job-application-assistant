// The selected user's Chrome is controlled through its installed extension.
// No Chrome process, profile, cookie store or remote-debugging port is opened.
import {BrowserAdapter} from './browser.mjs';
import {captureNativePageStructure} from './page-structure.mjs';
import {inspectRea} from './rea-structure.mjs';
import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
import {writeFile,mkdir} from 'node:fs/promises';
import http from 'node:http';import path from 'node:path';import vm from 'node:vm';import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {homedir} from 'node:os';
const require=createRequire(import.meta.url),pw=path.dirname(require.resolve('playwright-core/package.json'));
let selectorSource;
export function injectedSource(){
 if(selectorSource)return selectorSource;
 const bundle=readFileSync(path.join(pw,'lib/coreBundle.js'),'utf8'),at=bundle.indexOf('// packages/playwright-core/src/generated/injectedScriptSource.ts');
 const match=/source\d* = '/g;match.lastIndex=at;const hit=match.exec(bundle);if(!hit||at<0)throw Error('MAIN_CHROME_SELECTOR_ENGINE_UNAVAILABLE');
 const start=hit.index+hit[0].length-1;let end=start+1;
 for(;end<bundle.length;end++){if(bundle[end]==='\\'){end++;continue;}if(bundle[end]==="'")break;}
 selectorSource=vm.runInNewContext(bundle.slice(start,end+1),{},{timeout:1000});return selectorSource;
}
export class PluginTransport{
 constructor({endpoint='http://127.0.0.1:10086',session='recruiting-main-chrome',fetcher=fetch}={}){this.endpoint=endpoint;this.session=session;this.fetcher=fetcher;}
 async status(){try{const r=await this.fetcher(this.endpoint+'/status',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('MAIN_CHROME_PLUGIN_NOT_AVAILABLE');const body=await r.json();return body.ok===true?body.data:body;}catch{throw Error('MAIN_CHROME_PLUGIN_NOT_AVAILABLE');}}
 async start(){const binary=path.join(homedir(),'.kimi-webbridge','bin',process.platform==='win32'?'kimi-webbridge.exe':'kimi-webbridge');const {stdout}=await promisify(execFile)(binary,['start'],{timeout:20000});const result=JSON.parse(stdout);if(result.port)this.endpoint='http://127.0.0.1:'+result.port;return result;}
 async call(action,args={},tabId){
  const r=await this.fetcher(this.endpoint+'/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:this.session,action,args:{...args,...(tabId!=null?{tabId}:{})}}),signal:AbortSignal.timeout(90000)});
  const body=await r.json();if(!r.ok||body.ok!==true){const e=Error('MAIN_CHROME_PLUGIN_OPERATION_FAILED');e.pluginError=body.error?.code||null;throw e;}return body.data;
 }
 async evaluate(code,tabId){const r=await this.call('evaluate',{code},tabId);return r?.value;}
}
const textSelector=(text,exact=false)=>typeof text==='string'?JSON.stringify(text)+(exact?'s':'i'):String(text);
class PluginLocator{
 constructor(page,selector){this.page=page;this.selector=selector;}
 locator(selector){return new PluginLocator(this.page,this.selector+' >> '+selector);}
 getByText(text,{exact=false}={}){return this.locator('internal:text='+textSelector(text,exact));}
 getByRole(role,{name,exact=false}={}){return this.locator('internal:role='+role+(name!==undefined?'[name='+textSelector(name,exact)+']':''));}
 async all(){return Array.from({length:await this.count()},(_,i)=>this.nth(i));}
 nth(n){return this.locator('nth='+n);}first(){return this.nth(0);}last(){return this.nth(-1);}
 filter({visible,hasText,has,hasNot}={}){let s=this.selector;if(visible!==undefined)s+=' >> visible='+visible;if(hasText!==undefined)s+=' >> internal:has-text='+textSelector(hasText);if(has)s+=' >> internal:has='+JSON.stringify(has.selector);if(hasNot)s+=' >> internal:has-not='+JSON.stringify(hasNot.selector);return new PluginLocator(this.page,s);}
 async run(fn,arg){await this.page.ensureSelectors();return this.page.transport.evaluate('(()=>{const nodes=globalThis.__recruitingPluginSelectors.querySelectorAll(globalThis.__recruitingPluginSelectors.parseSelector('+JSON.stringify(this.selector)+'),document);return ('+fn.toString()+')(nodes,'+JSON.stringify(arg??null)+');})()',this.page.tabId);}
 count(){return this.run(nodes=>nodes.length);}
 innerText(){return this.run(nodes=>{if(nodes.length!==1)throw Error('ACTION_TARGET_NOT_UNIQUE');return nodes[0].innerText||nodes[0].textContent||'';});}
 textContent(){return this.run(nodes=>nodes.length===1?nodes[0].textContent:null);}
 allTextContents(){return this.run(nodes=>nodes.map(n=>n.textContent||''));}
 allInnerTexts(){return this.run(nodes=>nodes.map(n=>n.innerText||''));}
 inputValue(){return this.run(nodes=>nodes[0]?.value??'');}
 getAttribute(name){return this.run((nodes,name)=>nodes[0]?.getAttribute(name)??null,name);}
 isVisible(){return this.run(nodes=>nodes.some(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'));}
 isEnabled(){return this.run(nodes=>nodes.length===1&&!nodes[0].disabled&&nodes[0].getAttribute('aria-disabled')!=='true');}
 isDisabled(){return this.isEnabled().then(v=>!v);}
 isChecked(){return this.run(nodes=>nodes[0]?.checked===true||nodes[0]?.getAttribute('aria-checked')==='true');}
 evaluate(fn,arg){return this.run(new Function('nodes','arg',"if(nodes.length!==1)throw Error('ACTION_TARGET_NOT_UNIQUE');return ("+fn.toString()+')(nodes[0],arg);'),arg);}
 evaluateAll(fn,arg){return this.run(fn,arg);}
 async target(){const key=randomUUID();await this.evaluate((node,key)=>node.setAttribute('data-recruiting-plugin-target',key),key);return '[data-recruiting-plugin-target='+JSON.stringify(key)+']';}
 async click(){await this.page.transport.call('mouse_click',{selector:await this.target(),focus_emulation:true},this.page.tabId);await this.page.refreshUrl();}
 async fill(value){await this.page.transport.call('fill',{selector:await this.target(),value:String(value)},this.page.tabId);}
 async press(keys){await this.evaluate(node=>node.focus());await this.page.keyboard.press(keys);}
 async check(){if(!await this.isChecked())await this.click();}async uncheck(){if(await this.isChecked())await this.click();}async setChecked(v){return v?this.check():this.uncheck();}
 async scrollIntoViewIfNeeded(){await this.evaluate(node=>node.scrollIntoView({block:'center'}));}
 async focus(){await this.evaluate(node=>node.focus());}async blur(){await this.evaluate(node=>node.blur());}
 async dispatchEvent(type,eventInit={}){await this.evaluate((node,{type,eventInit})=>node.dispatchEvent(new Event(type,{bubbles:true,...eventInit})),{type,eventInit});}
 screenshot(options){return this.page.screenshot({...options,selector:this.selector});}
 async setInputFiles(files){await this.page.transport.call('upload',{selector:await this.target(),files:Array.isArray(files)?files:[files]},this.page.tabId);}
 selectOption(value){return this.evaluate((node,value)=>{const values=Array.isArray(value)?value:[value];for(const option of node.options)option.selected=values.some(v=>typeof v==='object'?v.label===option.label||v.value===option.value:v===option.value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}));return [...node.selectedOptions].map(o=>o.value);},value);}
 boundingBox(){return this.evaluate(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});}
 async waitFor({state='visible',timeout=15000}={}){const end=Date.now()+timeout;do{const count=await this.count(),visible=count?await this.isVisible():false;if(state==='attached'&&count||state==='visible'&&visible||state==='hidden'&&!visible||state==='detached'&&!count)return;await new Promise(r=>setTimeout(r,50));}while(Date.now()<end);throw Error('BROWSER_OPERATION_TIMEOUT');}
}
class PluginPage{
 constructor(owner,tab){this.owner=owner;this.transport=owner.transport;this.tabId=tab.tabId;this.currentUrl=tab.url;this.titleText=tab.title;this.closed=false;
  this.keyboard={press:keys=>this.transport.call('send_keys',{keys:keys.replace('ControlOrMeta','Mod'),focus_emulation:true},this.tabId),type:text=>this.cdp('Input.insertText',{text})};
  this.mouse={click:async(x,y)=>{await this.cdp('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await this.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});}};
 }
 url(){return this.currentUrl;}isClosed(){return this.closed;}title(){return this.evaluate(()=>document.title);}on(){return this;}once(){return this;}off(){return this;}
 async evaluate(fn,arg){return this.transport.evaluate('('+fn.toString()+')('+JSON.stringify(arg??null)+')',this.tabId);}
 async refreshUrl(){this.currentUrl=await this.evaluate(()=>location.href);return this.currentUrl;}
 async ensureSelectors(){if(await this.evaluate(()=>!!globalThis.__recruitingPluginSelectors))return;const source=injectedSource(),options={isUnderTest:false,sdkLanguage:'javascript',frameSeq:1,testIdAttributeName:'data-testid',stableRafCount:2,browserName:'chromium',shouldPrependErrorPrefix:false,isUtilityWorld:false,customEngines:[]};await this.transport.evaluate('(()=>{const module={};'+source+';globalThis.__recruitingPluginSelectors=new (module.exports.InjectedScript())(globalThis,'+JSON.stringify(options)+');return true;})()',this.tabId);}
 locator(selector){return new PluginLocator(this,selector);}
 getByText(text,{exact=false}={}){return this.locator('internal:text='+textSelector(text,exact));}
 getByRole(role,{name,exact=false}={}){return this.locator('internal:role='+role+(name!==undefined?'[name='+textSelector(name,exact)+']':''));}
 getByLabel(text,{exact=false}={}){return this.locator('internal:label='+textSelector(text,exact));}
 getByPlaceholder(text,{exact=false}={}){return this.locator('internal:attr=[placeholder='+textSelector(text,exact)+']');}
 async goto(url){const r=await this.transport.call('navigate',{url,...(this.tabId==null?{newTab:true}:{}),group_title:'投递生产'},this.tabId);this.tabId=r.tabId;this.currentUrl=r.url||url;return null;}
 async reload(){await this.evaluate(()=>location.reload());}async waitForLoadState(){}
 async bringToFront(){await this.transport.call('attach_tab',{tabId:this.tabId});}
 async waitForFunction(fn,arg,{timeout=15000}={}){const end=Date.now()+timeout;do{if(await this.evaluate(fn,arg))return;await new Promise(r=>setTimeout(r,50));}while(Date.now()<end);throw Error('BROWSER_OPERATION_TIMEOUT');}
 async waitForSelector(selector,options){const locator=this.locator(selector);await locator.waitFor(options);return locator;}
 async waitForURL(predicate,{timeout=15000}={}){const end=Date.now()+timeout;do{const url=await this.refreshUrl();if(typeof predicate==='string'?url===predicate:predicate(new URL(url)))return;await new Promise(r=>setTimeout(r,50));}while(Date.now()<end);throw Error('BROWSER_OPERATION_TIMEOUT');}
 async cdp(method,params={}){return this.transport.call('cdp',{method,params},this.tabId);}
 context(){return {pages:()=>[...this.owner.pages.values()],newCDPSession:async()=>({send:(m,p)=>this.cdp(m,p),detach:async()=>{}})};}
 async screenshot({path:output,fullPage,selector,mask=[]}={}){
  const key=randomUUID();
  try{
   for(const locator of mask)await locator.evaluateAll((nodes,key)=>{for(const node of nodes){const r=node.getBoundingClientRect(),cover=document.createElement('div');cover.dataset.recruitingMask=key;Object.assign(cover.style,{position:'absolute',left:(r.left+scrollX)+'px',top:(r.top+scrollY)+'px',width:r.width+'px',height:r.height+'px',background:'#000',zIndex:'2147483647',pointerEvents:'none'});document.documentElement.appendChild(cover);}},key);
   if(selector)return await this.transport.call('screenshot',{format:'png',selector:await this.locator(selector).target(),...(output?{path:output}:{})},this.tabId);
   const metrics=await this.cdp('Page.getLayoutMetrics'),size=metrics.cssContentSize||metrics.contentSize;
   const result=await this.cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:!!fullPage,...(fullPage&&size?{clip:{x:0,y:0,width:size.width,height:size.height,scale:1}}:{})});
   if(!result.data)throw Error('MAIN_CHROME_SCREENSHOT_REQUIRED');
   if(output){await mkdir(path.dirname(output),{recursive:true});await writeFile(output,Buffer.from(result.data,'base64'),{mode:0o600});}
   return result;
  }finally{await this.evaluate(key=>{for(const node of document.querySelectorAll('[data-recruiting-mask]'))if(node.dataset.recruitingMask===key)node.remove();},key);}
 }
 async close(){await this.transport.call('close_tab',{},this.tabId);this.closed=true;}
}

// A passive, one-tab CDP facade for REA's existing CLI. It forwards actual
// extension command responses. Async event streams are explicitly unavailable.
export async function pluginInspectionEndpoint(page){
 const {wsServer:WebSocketServer}=require(path.join(pw,'lib/utilsBundle.js'));
 const token=randomUUID(),server=http.createServer((req,res)=>{res.writeHead(404).end();}),sockets=new WebSocketServer({server,path:'/'+token});
 sockets.on('connection',socket=>socket.on('message',async raw=>{let request;try{request=JSON.parse(String(raw));const result=await page.cdp(request.method,request.params||{});socket.send(JSON.stringify({id:request.id,result}));}catch(error){socket.send(JSON.stringify({id:request?.id,error:{code:-32000,message:error.message}}));}}));
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {endpoint:'ws://127.0.0.1:'+server.address().port+'/'+token,close:async()=>{for(const c of sockets.clients)c.terminate();await new Promise(r=>sockets.close(r));await new Promise(r=>server.close(r));}};
}
export class MainChromePluginAdapter extends BrowserAdapter{
 constructor({transport=new PluginTransport(),screenshotDir}={}){super('agent-plugin-main-chrome',{screenshotDir});this.transport=transport;this.pages=new Map();this.state='new';this.executor={verified:false};}
 async connect(){
  const status=await this.transport.status();if(!status.extension_connected){this.state='disconnected';this.executor.verified=false;throw Error('MAIN_CHROME_PLUGIN_NOT_CONNECTED');}
  if(!this.executor.verified)this.executor={provider:'agent_plugin_main_chrome',verified:true,sessionId:randomUUID(),profileProof:'user_selected_registered_extension'};
  const result=await this.transport.call('list_browser_tabs');const current=new Set();for(const tab of result.tabs||[]){const key='main-'+tab.tabId;current.add(key);const p=this.pages.get(key)||new PluginPage(this,tab);p.currentUrl=tab.url;p.closed=false;this.pages.set(key,p);this.pageIds.set(key,p);}for(const[key,p]of this.pages)if(!current.has(key))p.closed=true;
  this.state='connected';this.connection={contexts:()=>[{pages:()=>[...this.pages.values()].filter(p=>!p.closed),newPage:async()=>new PluginPage(this,{tabId:null,url:'about:blank'})}],isConnected:()=>true};return this.connection;
 }
 status(){return {state:this.state,mode:'agent_plugin',provider:'agent_plugin_main_chrome',executor:this.executor,pageCount:[...this.pages.values()].filter(p=>!p.closed).length,automaticRetries:0};}
 async initializeConfiguredChrome(){try{await this.connect();}catch(error){if(error.message!=='MAIN_CHROME_PLUGIN_NOT_AVAILABLE'||!this.transport.start)throw error;await this.transport.start();await this.connect();}return {...this.status(),profileReused:true,chromeStarted:false};}
 async restoreConfiguredChrome(){return {...await this.initializeConfiguredChrome(),restored:true};}
 async recoverTransient(){await this.connect();}
 async trackPage(page){const id='main-'+page.tabId;this.pages.set(id,page);this.pageIds.set(id,page);return id;}
 async trackedPage(id){await this.connect();const page=this.pageIds.get(id);if(!page||page.isClosed())throw Error('ROLE_BROWSER_PAGE_LOST');return page;}
 async tabs(){await this.connect();return [...this.pages].filter(([,p])=>!p.closed).map(([id,p])=>({id,url:p.url(),title:p.titleText,pluginTabId:p.tabId}));}
 async openPage(url,{pageId,newPage=false,reuseOnly=false,reload=false,readySelectors=[]}={}){
  await this.connect();const matches=pageId?[await this.trackedPage(pageId)]:newPage?[]:[...this.pages.values()].filter(p=>!p.closed&&p.url()===url);
  if(matches.length>1)throw Error('AMBIGUOUS_PAGE');if(reuseOnly&&!matches.length)throw Error('EXISTING_PAGE_REQUIRED_FOR_REBIND');
  const page=matches[0]||new PluginPage(this,{tabId:null,url:'about:blank'}),reused=page.url()===url;
  if(!reused)await page.goto(url);else if(reload)await page.reload();
  if(readySelectors.length)await page.waitForFunction(selectors=>selectors.some(s=>[...document.querySelectorAll(s)].some(n=>n.getClientRects().length)),readySelectors);
  return {pageId:await this.trackPage(page),pageUrl:page.url(),reused};
 }
 async closePage(pageId){const page=await this.trackedPage(pageId),session=await this.transport.call('list_tabs'),owned=session.tabs?.find(t=>t.tabId===page.tabId);if(!owned||owned.borrowed!==false)throw Error('MAIN_CHROME_BORROWED_PAGE_PRESERVED');await page.close();return {pageId,closed:true};}
 async reaInspect({pageId,pageUrl,authorization}){
  if(!authorization?.acquire||!authorization.evidence?.trim())throw Error('REA_CONSTRUCTION_AUTHORIZATION_REQUIRED');
  const page=await this.trackedPage(pageId);if(page.url()!==pageUrl)throw Error('REA_PAGE_BINDING_CHANGED');
  const {targetInfo}=await page.cdp('Target.getTargetInfo'),nativeStructure=await captureNativePageStructure({send:(m,p)=>page.cdp(m,p)},{pageUrl,targetId:targetInfo.targetId}),proxy=await pluginInspectionEndpoint(page);
  try{const evidence=await inspectRea({endpoint:proxy.endpoint,targetId:targetInfo.targetId,pageUrl,allowedOrigins:nativeStructure.scriptOrigins});
   return {evidence,nativeStructure,bridgeLimitations:['Main Chrome extension forwards command responses only; asynchronous CDP event streams are unavailable.'],binding:{pageId,targetId:targetInfo.targetId,beforeUrl:pageUrl,afterUrl:await page.refreshUrl()}};
  }finally{await proxy.close();}
 }
}
