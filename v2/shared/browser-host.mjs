import {genericSourceManifest} from './runtime-identity.mjs';
import {installBrokerDiagnostics} from './broker-diagnostics.mjs';
import {browserErrorCode,browserErrorDetails,retryBrowserOperation} from './browser-errors.mjs';
import {safeControlErrorDetails} from './control-error-details.mjs';
// One private local socket owns one Chrome connection across MCP client restarts.
// CDP mode attaches to the dedicated Chrome clone; managed (Playwright) Chrome remains only for tests
// and explicit configuration. No daily-profile attachment or automatic reconnect.
import http from 'node:http';
import {mkdir,chmod,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {BrowserAdapter} from './browser.mjs';
import {cloneConfig,launchClone} from './chrome-clone.mjs';
import {inspectVerification} from './verification.mjs';
const socketPath=process.argv[2];
if(!socketPath||!path.isAbsolute(socketPath)||Buffer.byteLength(socketPath)>100)throw Error('SHORT_ABSOLUTE_SOCKET_PATH_REQUIRED');
await mkdir(path.dirname(socketPath),{recursive:true,mode:0o700});
// Never replace a socket that has a live owner.
try{
  await lstat(socketPath);
  const alive=await new Promise(resolve=>{const req=http.get({socketPath,path:'/health'},res=>{res.resume();resolve(true);});req.on('error',()=>resolve(false));});
  if(alive){console.log(JSON.stringify({status:'existing_host_reused'}));process.exit(0);}
  await unlink(socketPath);
}catch(error){if(error.code!=='ENOENT')throw error;}
const diagnostics=installBrokerDiagnostics(path.join(path.dirname(socketPath),'broker-events.jsonl'));
const hostMode=process.env.RECRUITING_BROWSER_MODE||'managed';
if(hostMode==='iab')throw Error('IAB_HOST_BRIDGE_REQUIRED');
if(hostMode==='cdp'&&!process.env.RECRUITING_CDP_URL)throw Error('EXPLICIT_BROWSER_SESSION_REQUIRED');
// CDP mode = the dedicated Chrome clone: the broker attaches to it and, only in the explicit
// initialize/restore stages, starts it as a normal Chrome via shared/chrome-clone.mjs.
const cloneLauncher=hostMode==='cdp'?async({restoreLastSession}={})=>launchClone({config:cloneConfig(process.env),restoreLastSession}):null;
if(hostMode==='cdp'&&process.env.RECRUITING_BROWSER_PROFILE_DIR){const config=cloneConfig(process.env);if(new URL(process.env.RECRUITING_CDP_URL).port!==String(config.port))throw Error('CHROME_CLONE_CONFIG_MISMATCH');}
const browser=new BrowserAdapter(hostMode==='cdp'?(process.env.RECRUITING_CDP_URL):hostMode==='iab'?'managed-iab':'managed-chrome',{profileDir:process.env.RECRUITING_BROWSER_PROFILE_DIR,screenshotDir:path.join(path.dirname(socketPath),'screenshots'),cloneLauncher});
// pageTools：本进程代码支持的标签操作。浏览器主控进程不随 MCP 重载，旧进程没有这些操作；工具调用前按它判断。
const residentSource=await genericSourceManifest();
const status=()=>({sourceFingerprint:residentSource.sourceFingerprint,pid:process.pid,brokerPid:process.pid,protocolVersion:4,pageTools:['newPage','reload','closePage'],...browser.status(),runtimeHealth:diagnostics.isDegraded()?'degraded_read_only':'healthy'});
const methods=new Set(['assertLocation','wait','inventory','observe','act','ensureGroups','repeatDiscovery','verificationInspect']);
const code=browserErrorCode;
const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/health'){res.end(JSON.stringify(status()));return;}
  if(req.method!=='POST'||req.url!=='/rpc'){res.writeHead(404).end('{}');return;}
  let method,args;
  try{
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
    ({method,args={}}=JSON.parse(Buffer.concat(chunks)));let data;
    if(diagnostics.isDegraded()&&!['status','tabs','pageIdentity','roleSnapshot','entryInspection','failureSnapshot','existingPage','inventory','observe','screenshot','assertLocation'].includes(method))throw Error('BROKER_DEGRADED_WRITES_BLOCKED');
    const retrySafe=['tabs','pageIdentity','failureSnapshot','roleSnapshot','existingPage','inventory','observe','assertLocation','reaInspect','openPage','roleEnterApplication'].includes(method);
    data=await retryBrowserOperation(async()=>{let data;
    if(method==='status')data=status();
    else if(method==='initializeConfiguredChrome')data=await browser.initializeConfiguredChrome(args);
    else if(method==='restoreConfiguredChrome')data=await browser.restoreConfiguredChrome(args);
    else if(method==='tabs')data=await browser.tabs();
    else if(method==='openPage')data=await browser.openPage(args.pageUrl,args);
    else if(method==='entryInspection')data=await browser.entryInspection(args);
    else if(method==='failureSnapshot')data=await browser.failureSnapshot(args);
    else if(method==='pageIdentity')data=await browser.pageIdentity(args.pageId);
    else if(method==='reaInspect')data=await browser.reaInspect(args);
    else if(method==='roleEnterApplication')data=await browser.enterApplication(args);
    else if(method==='roleSnapshot')data=await browser.roleSnapshot(args);
    else if(method==='screenshot')data=await browser.screenshot(args.pageId,{selector:args.selector});
    else if(method==='closePage')data=await browser.closePage(args.pageId);
    else{
      if(method!=='existingPage'&&!methods.has(method))throw Error('UNKNOWN_BROWSER_HOST_METHOD');
      if(args.pageId&&args.readOnly&&!['existingPage','inventory','observe','assertLocation','wait','repeatDiscovery'].includes(method))throw Error('READ_ONLY_PAGE_MUTATION_FORBIDDEN');
      if(args.pageId&&!args.readOnly&&(!args.roleBinding||args.roleBinding.pageId!==args.pageId||!browser.executor.verified))throw Error('VERIFIED_ROLE_PAGE_BINDING_REQUIRED');
      const page=await browser.existingPage(args.pageUrl,{pageId:args.pageId,readOnly:args.readOnly,roleBinding:args.roleBinding});
      if(method==='existingPage'){const id=await browser.trackPage(page.page),identity=await browser.pageIdentity(id);data={found:true,...identity,executor:{...browser.executor}};}
      if(method==='assertLocation')data=await page.assertLocation(args.origin,args.prefix);
      if(method==='wait')data=await page.wait(args.selector);
      if(method==='inventory')data=await page.inventory(args.plan);
      if(method==='observe')data=await page.observe(args.plan);
      if(method==='act')data=await page.act(args.action,args.value,args.files);
      if(method==='repeatDiscovery')data=await page.repeatDiscovery(args.titles);
      if(method==='ensureGroups')data=await page.ensureGroups(args.groups);
      if(method==='verificationInspect')data=await inspectVerification(page);
    }
    return data;},{retrySafe,recover:error=>browser.recoverTransient(error,{...args,reopenRole:method==='openPage'||method==='roleEnterApplication'})});
    res.end(JSON.stringify({data:data??null}));
  }catch(error){diagnostics.record('operation_error',error,method);const details=safeControlErrorDetails(error.details)||(error.details?null:browserErrorDetails(error,{method,locator:args?.selector||args?.action?.selector||args?.entry?.entryLocator?.selector||args?.entry?.entryLocator?.text}));res.end(JSON.stringify({error:code(error),...(details?{details}:{})}));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);
console.log(JSON.stringify({status:'browser_host_ready',pid:process.pid,connectionAttempts:0,automaticRetries:0}));
process.once('SIGTERM',()=>{server.close();process.exit(0);});
