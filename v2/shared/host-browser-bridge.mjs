import http from 'node:http';import {mkdir,chmod,lstat} from 'node:fs/promises';import path from 'node:path';
import {READY_TIMEOUT_MS,matchEntryPath} from './entry-recipe.mjs';
import {PageAdapter} from './ui-page.mjs';
// Runs INSIDE the trusted host SDK session, with an explicitly provided browser
// object. It never launches a browser, attaches CDP, or discovers credentials.
export async function startHostBrowserBridge({browser,socketPath,allowedOrigins,mode='iab',onError=()=>{},deferBrowserCalls=false,fileUpload,pageAdapter=PageAdapter}){
 if(mode!=='iab'||!socketPath?.startsWith('/')||Buffer.byteLength(socketPath)>100||!allowedOrigins?.length)throw Error('INVALID_HOST_BRIDGE_CONFIGURATION');
 await mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});
 try{await lstat(socketPath);throw Error('HOST_BRIDGE_SOCKET_ALREADY_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
 const scope=url=>{const u=new URL(url);if(u.protocol!=='https:'||!allowedOrigins.includes(u.origin))throw Error('HOST_BROWSER_SCOPE_MISMATCH');return u;};
 const tabs=async()=>{const out=[];for(const t of await browser.tabs.list()){try{scope(t.url);out.push(t);}catch{}}return out;};
 const tracked=new Map();
 const options=o=>{if(!o)return o;const {timeout,...rest}=o;return timeout===undefined?rest:{...rest,timeoutMs:timeout};};
 const locator=(l,context={})=>({count:()=>l.count(),first:()=>locator(l.first(),context),evaluate:(...a)=>l.evaluate(...a),innerText:o=>l.innerText(options(o)),allTextContents:o=>l.allTextContents(options(o)),waitFor:o=>l.waitFor(options(o)),click:o=>l.click(options(o)),fill:(v,o)=>l.fill(v,options(o)),press:(v,o)=>l.press(v,options(o)),setChecked:(v,o)=>l.setChecked(v,options(o)),check:o=>l.check(options(o)),selectOption:(v,o)=>l.selectOption(v,options(o)),filter:o=>locator(l.filter(o),context),getByRole:(...a)=>locator(l.getByRole(...a),context),locator:(...a)=>locator(l.locator(...a),context),setInputFiles:async paths=>{if(typeof fileUpload!=='function'||!context.tab||!context.selector)throw Error('HOST_FILE_CHOOSER_ADAPTER_REQUIRED');return fileUpload({tab:context.tab,selector:context.selector,paths});}});
 const get=async id=>{const t=(await tabs()).find(t=>t.id===id);if(!t)throw Error('ROLE_BROWSER_PAGE_LOST');const tab=await browser.tabs.get(id);tracked.set(id,tab);return tab;};
 const adapter=async url=>{const matches=(await tabs()).filter(t=>t.url===url);if(matches.length!==1)throw Error(matches.length?'AMBIGUOUS_PAGE':'EXISTING_PAGE_NOT_FOUND');const tab=await get(matches[0].id),current=await tab.url();scope(current);return new pageAdapter({url:()=>current,evaluate:(...a)=>tab.playwright.evaluate(...a),locator:(...a)=>locator(tab.playwright.locator(...a),{tab,selector:a[0]}),getByRole:(...a)=>locator(tab.playwright.getByRole(...a))},{listOpenPageUrls:async()=>(await tabs()).map(t=>t.url)});};
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
   const entry=args.entry;
   if(entry?.kind==='resume_modal'){
    if(!args.expectedRoleId||entry.entryLabel!=='立即投递'||entry.editLabel!=='编辑'||!args.sessionAccountPageUrl)throw Error('RESUME_ENTRY_CONTRACT_REQUIRED');
    scope(args.sessionAccountPageUrl);
    const readAccount=async()=>{const candidates=(await tabs()).filter(t=>t.url===args.sessionAccountPageUrl);if(candidates.length!==1)throw Error('SESSION_IDENTITY_PAGE_NOT_UNIQUE');return (await (await get(candidates[0].id)).playwright.locator(args.accountSelector).innerText()).trim();};
    if(await readAccount()!==args.expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    let target=tab,clicked=false;
    if(before.pathname===entry.detailPath){
     if(before.searchParams.get(entry.detailIdParameter)!==args.expectedRoleId||(await tab.playwright.locator(entry.detailRoleSelector).innerText()).trim()!==args.expectedTitle)throw Error('APPLICATION_ENTRY_ROLE_CHANGED');
     const button=tab.playwright.locator(entry.entrySelector);if(await button.count()!==1||(await button.innerText()).trim()!==entry.entryLabel)throw Error('APPLICATION_ENTRY_BUTTON_CHANGED');
     await button.click({timeoutMs:10000});clicked=true;
     const edit=tab.playwright.getByRole('dialog').getByText(entry.editLabel,{exact:true});await edit.waitFor({state:'visible',timeoutMs:15000});if(await edit.count()!==1)throw Error('RESUME_EDIT_ENTRY_NOT_UNIQUE');await edit.click({timeoutMs:10000});
     const deadline=Date.now()+15000;let found;
     do{const matches=(await tabs()).filter(t=>{const u=new URL(t.url);return u.pathname===entry.formPath&&u.searchParams.get(entry.formIdParameter)===args.expectedRoleId;});if(matches.length>1)throw Error('AMBIGUOUS_ROLE_FORM');if(matches.length===1){found=matches[0];break;}await new Promise(r=>setTimeout(r,50));}while(Date.now()<deadline);
     if(!found)throw Error('ROLE_FORM_NOT_OPEN');target=await get(found.id);
    }
    const after=scope(await target.url());if(after.origin!==before.origin||after.pathname!==entry.formPath||after.searchParams.get(entry.formIdParameter)!==args.expectedRoleId)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
    await target.playwright.locator(entry.formReadySelector).waitFor({state:'visible',timeoutMs:15000});if(await readAccount()!==args.expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    await target.markHandoff();await tab.markHandoff();return {pageId:target.id,pageUrl:after.href,roleIdentity:{parameter:entry.formIdParameter,value:args.expectedRoleId},roleTitle:null,entryClicked:clicked,accountMatched:true,submission:'not_performed'};
   }
   const {detail,form,expectedApplyPath:expectedPath}=matchEntryPath(entry,before.pathname);
   if((!detail&&!form)||!args.expectedTitle||!args.expectedAccount||!args.accountSelector||!args.roleSelector)throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
   if(args.sessionAccountPageUrl&&scope(args.sessionAccountPageUrl).origin!==before.origin)throw Error('APPLICATION_ENTRY_ACCOUNT_SCOPE_CHANGED');
   const readAccount=async()=>{
    if(!args.sessionAccountPageUrl)return (await tab.playwright.locator(args.accountSelector).innerText()).trim();
    const candidates=(await tabs()).filter(t=>t.url===args.sessionAccountPageUrl);
    if(candidates.length!==1)throw Error('SESSION_IDENTITY_PAGE_NOT_UNIQUE');
    const identityTab=await get(candidates[0].id),identity=identityTab.playwright.locator(args.accountSelector);
    if(await identity.count()!==1)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
    return (await identity.innerText()).trim();
   };
   if(await readAccount()!==args.expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
   if(detail){
    const meta=(await tabs()).find(t=>t.id===args.pageId);if(!meta?.title.startsWith(args.expectedTitle+entry.detailTitleSeparator))throw Error('APPLICATION_ENTRY_ROLE_CHANGED');
    const button=tab.playwright.getByRole(entry.entryButton.role,{name:entry.entryButton.name,exact:true});if(await button.count()!==1)throw Error('APPLICATION_ENTRY_BUTTON_CHANGED');await button.click({timeoutMs:10000});
   }else if(before.pathname!==expectedPath)throw Error('APPLICATION_ENTRY_PATH_REQUIRED');
   try{await tab.playwright.locator(args.roleSelector).waitFor({state:'visible',timeoutMs:READY_TIMEOUT_MS});}catch{throw Error('PAGE_NOT_READY');}
   const after=scope(await tab.url());if(after.origin!==before.origin||after.pathname!==expectedPath)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
   if((await tab.playwright.locator(args.roleSelector).innerText()).trim()!==args.expectedTitle)throw Error('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
   if(await readAccount()!==args.expectedAccount)throw Error('APPLICATION_ENTRY_ACCOUNT_CHANGED');
   return {pageId:args.pageId,pageUrl:after.href,roleTitle:args.expectedTitle,entryClicked:detail,accountMatched:true,submission:'not_performed'};
  }
  if(method==='roleSnapshot'){
   const tab=await get(args.pageId);return tab.playwright.evaluate(({roleSelector,accountSelector,loginRoot,roleIdentity})=>{const read=s=>{if(!s)return null;const ns=document.querySelectorAll(s);return ns.length===1?ns[0].innerText?.trim()||null:null;};return {pageUrl:location.href,...(roleIdentity?{roleIdentity:{parameter:roleIdentity.parameter,value:new URL(location.href).searchParams.get(roleIdentity.parameter)}}:{}),roleTitle:read(roleSelector),account:read(accountSelector),loginFormPresent:!!document.querySelector(loginRoot),readAt:new Date().toISOString()};},args);
  }
  if(!['existingPage','inventory','observe','act','ensureGroups','assertLocation','wait'].includes(method))throw Error('UNSUPPORTED_HOST_BROWSER_METHOD');
  scope(args.pageUrl);const p=await adapter(args.pageUrl);
  if(method==='existingPage')return {found:true};
  if(method==='inventory')return p.inventory(args.plan);
  if(method==='observe')return p.observe(args.plan);
  if(method==='assertLocation')return p.assertLocation(args.origin,args.prefix);
  if(method==='wait')return p.wait(args.selector);
  if(method==='ensureGroups')return p.ensureGroups(args.groups);
  if(args.action?.method==='upload'&&typeof fileUpload!=='function')throw Error('HOST_FILE_CHOOSER_ADAPTER_REQUIRED');
  return p.act(args.action,args.value,args.files);
 };
 const pending=[];
 // Some hosts require browser calls to originate inside the currently active
 // tool invocation. Queue RPC work and let that invocation explicitly pump it;
 // an HTTP callback retaining a previous invocation is not a durable executor.
 const execute=(method,args)=>deferBrowserCalls&&method!=='status'?new Promise((resolve,reject)=>pending.push({method,args,resolve,reject})):dispatch(method,args);
 const pump=async()=>{const job=pending.shift();if(!job)return false;try{job.resolve(await dispatch(job.method,job.args));}catch(e){job.reject(e);}return true;};
 const server=http.createServer(async(req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/health'){res.end(JSON.stringify({mode:'iab',protocolVersion:4,state:'connected'}));return;}if(req.method!=='POST'||req.url!=='/rpc'){res.writeHead(404).end('{}');return;}try{const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8*1024*1024)throw Error('REQUEST_TOO_LARGE');chunks.push(c);}const {method,args={}}=JSON.parse(Buffer.concat(chunks));res.end(JSON.stringify({data:await execute(method,args)??null}));}catch(e){onError(e);res.end(JSON.stringify({error:/^[A-Z_]+$/.test(e.message)?e.message:'HOST_BROWSER_OPERATION_FAILED'}));}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);return {socketPath,server,mode:'iab',pump,pendingCount:()=>pending.length};
}
export async function withHostBrowserBridge(options,run){
 const bridge=await startHostBrowserBridge(options);
 try{return await run({socketPath:bridge.socketPath});}
 finally{await new Promise(resolve=>bridge.server.close(resolve));const {unlink}=await import('node:fs/promises');await unlink(bridge.socketPath).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
