import http from 'node:http';import {mkdir,chmod,lstat} from 'node:fs/promises';import path from 'node:path';
import {PageAdapter} from './ui-page.mjs';
// Runs INSIDE the trusted host SDK session, with an explicitly provided browser
// object. It never launches a browser, attaches CDP, or discovers credentials.
export async function startHostBrowserBridge({browser,socketPath,allowedOrigins,mode='iab',onError=()=>{}}){
 if(mode!=='iab'||!socketPath?.startsWith('/')||Buffer.byteLength(socketPath)>100||!allowedOrigins?.length)throw Error('INVALID_HOST_BRIDGE_CONFIGURATION');
 await mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});
 try{await lstat(socketPath);throw Error('HOST_BRIDGE_SOCKET_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const scope=url=>{const u=new URL(url);if(u.protocol!=='https:'||!allowedOrigins.includes(u.origin))throw Error('HOST_BROWSER_SCOPE_MISMATCH');return u;};
 const tabs=async()=>{const out=[];for(const t of await browser.tabs.list()){try{scope(t.url);out.push(t);}catch{}}return out;};
 const tracked=new Map();
 const options=o=>{if(!o)return o;const {timeout,...rest}=o;return timeout===undefined?rest:{...rest,timeoutMs:timeout};};
 const locator=l=>({count:()=>l.count(),first:()=>locator(l.first()),evaluate:(...a)=>l.evaluate(...a),innerText:o=>l.innerText(options(o)),allTextContents:o=>l.allTextContents(options(o)),waitFor:o=>l.waitFor(options(o)),click:o=>l.click(options(o)),fill:(v,o)=>l.fill(v,options(o)),press:(v,o)=>l.press(v,options(o)),setChecked:(v,o)=>l.setChecked(v,options(o)),check:o=>l.check(options(o)),selectOption:(v,o)=>l.selectOption(v,options(o)),filter:o=>locator(l.filter(o)),getByRole:(...a)=>locator(l.getByRole(...a))});
 const get=async id=>{const t=(await tabs()).find(t=>t.id===id);if(!t)throw Error('ROLE_BROWSER_PAGE_LOST');const tab=await browser.tabs.get(id);tracked.set(id,tab);return tab;};
 const adapter=async url=>{const matches=(await tabs()).filter(t=>t.url===url);if(matches.length!==1)throw Error(matches.length?'AMBIGUOUS_PAGE':'EXISTING_PAGE_NOT_FOUND');const tab=await get(matches[0].id),current=await tab.url();scope(current);return new PageAdapter({url:()=>current,evaluate:(...a)=>tab.playwright.evaluate(...a),locator:(...a)=>locator(tab.playwright.locator(...a)),getByRole:(...a)=>locator(tab.playwright.getByRole(...a))},{listOpenPageUrls:async()=>(await tabs()).map(t=>t.url)});};
 const dispatch=async(method,args)=>{
  if(method==='status')return {state:'connected',mode:'iab',protocolVersion:4,connectionAttempts:1,automaticRetries:0,provider:'official_host_browser_sdk'};
  if(method==='tabs')return tabs();
  if(method==='pageIdentity'){const tab=await get(args.pageId);return {pageId:tab.id,pageUrl:await tab.url()};}
  if(method==='openPage'){
   scope(args.pageUrl);const all=await tabs(),matches=args.pageId?all.filter(t=>t.id===args.pageId):all.filter(t=>t.url===args.pageUrl);if(matches.length>1)throw Error('AMBIGUOUS_PAGE');
   const tab=matches.length?await get(matches[0].id):await browser.tabs.new(),reused=await tab.url()===args.pageUrl;if(!reused)await tab.goto(args.pageUrl);tracked.set(tab.id,tab);await tab.markHandoff();return {pageId:tab.id,pageUrl:await tab.url(),reused};
  }
  if(method==='roleEnterApplication'){
   const tab=await get(args.pageId),before=scope(await tab.url());
   const match=before.pathname.match(/^\/(campus|campushirecn)\/(position|resume)\/(\d+)\/(detail|apply)$/);
   if(!match||!args.expectedTitle||!args.expectedAccount)throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
   const expectedPath='/'+match[1]+'/resume/'+match[3]+'/apply';
   const account=await tab.playwright.locator(args.accountSelector).innerText();if(account.trim()!==args.expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
   const detail=match[2]==='position'&&match[4]==='detail';
   if(detail){
    const meta=(await tabs()).find(t=>t.id===args.pageId);if(!meta?.title.startsWith(args.expectedTitle+' - '))throw Error('APPLICATION_ENTRY_ROLE_CHANGED');
    const button=tab.playwright.getByRole('button',{name:'投递',exact:true});if(await button.count()!==1)throw Error('APPLICATION_ENTRY_BUTTON_CHANGED');await button.click({timeoutMs:10000});
   }else if(match[2]!=='resume'||match[4]!=='apply')throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
   await tab.playwright.locator(args.roleSelector).waitFor({state:'visible',timeoutMs:30000});
   const after=scope(await tab.url());if(after.origin!==before.origin||after.pathname!==expectedPath)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
   if((await tab.playwright.locator(args.roleSelector).innerText()).trim()!==args.expectedTitle)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
   if((await tab.playwright.locator(args.accountSelector).innerText()).trim()!==args.expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
   return {pageId:args.pageId,pageUrl:after.href,roleTitle:args.expectedTitle,entryClicked:detail,accountMatched:true,submission:'not_performed'};
  }
  if(method==='roleSnapshot'){
   const tab=await get(args.pageId);return tab.playwright.evaluate(({roleSelector,accountSelector,loginRoot})=>{const read=s=>{if(!s)return null;const ns=document.querySelectorAll(s);return ns.length===1?ns[0].innerText?.trim()||null:null;};return {pageUrl:location.href,roleTitle:read(roleSelector),account:read(accountSelector),loginFormPresent:!!document.querySelector(loginRoot),readAt:new Date().toISOString()};},args);
  }
  if(!['existingPage','inventory','observe','act','ensureGroups','assertLocation','wait'].includes(method))throw Error('UNSUPPORTED_HOST_BROWSER_METHOD');
  scope(args.pageUrl);const p=await adapter(args.pageUrl);
  if(method==='existingPage')return {found:true};
  if(method==='inventory')return p.inventory(args.plan);
  if(method==='observe')return p.observe(args.plan);
  if(method==='assertLocation')return p.assertLocation(args.origin,args.prefix);
  if(method==='wait')return p.wait(args.selector);
  if(method==='ensureGroups')return p.ensureGroups(args.groups);
  if(args.action?.method==='upload')throw Error('HOST_FILE_CHOOSER_ADAPTER_REQUIRED');
  return p.act(args.action,args.value,args.files);
 };
 const server=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/health'){res.end(JSON.stringify({mode:'iab',protocolVersion:4,state:'connected'}));return;}if(req.method!=='POST'||req.url!=='/rpc'){res.writeHead(404).end('{}');return;}try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8*1024*1024)throw Error('REQUEST_TOO_LARGE');chunks.push(c);}const {method,args={}}=JSON.parse(Buffer.concat(chunks));res.end(JSON.stringify({data:await dispatch(method,args)??null}));}catch(e){onError(e);res.end(JSON.stringify({error:/^[A-Z_]+$/.test(e.message)?e.message:'HOST_BROWSER_OPERATION_FAILED'}));}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);return {socketPath,server,mode:'iab'};
}
export async function withHostBrowserBridge(options,run){
 const bridge=await startHostBrowserBridge(options);
 try{return await run({socketPath:bridge.socketPath});}
 finally{await new Promise(resolve=>bridge.server.close(resolve));const {unlink}=await import('node:fs/promises');await unlink(bridge.socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
