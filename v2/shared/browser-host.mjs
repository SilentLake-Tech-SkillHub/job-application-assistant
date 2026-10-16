// One private local socket owns one Chrome connection across MCP client restarts.
// Managed Chrome by default; no REA, daily-profile attachment or automatic reconnect.
import http from 'node:http';
import {mkdir,chmod,lstat,unlink} from 'node:fs/promises';
import path from 'node:path';
import {BrowserAdapter} from './browser.mjs';
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
const browser=new BrowserAdapter(process.env.RECRUITING_BROWSER_MODE==='cdp'?(process.env.RECRUITING_CDP_URL||'chrome-default'):'managed-chrome',{profileDir:process.env.RECRUITING_BROWSER_PROFILE_DIR});
const status=()=>({pid:process.pid,protocolVersion:3,...browser.status()});
const methods=new Set(['assertLocation','wait','inventory','observe','act','ensureGroups','verificationInspect']);
const code=error=>/^[A-Z_]+$/.test(error.message)?error.message:'BROWSER_HOST_OPERATION_FAILED';
const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/health'){res.end(JSON.stringify(status()));return;}
  if(req.method!=='POST'||req.url!=='/rpc'){res.writeHead(404).end('{}');return;}
  try{
    const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8*1024*1024)throw Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
    const {method,args={}}=JSON.parse(Buffer.concat(chunks));let data;
    if(method==='status')data=status();
    else if(method==='tabs')data=await browser.tabs();
    else if(method==='openPage')data=await browser.openPage(args.pageUrl,args);
    else if(method==='pageIdentity')data=await browser.pageIdentity(args.pageId);
    else if(method==='roleSnapshot')data=await browser.roleSnapshot(args);
    else if(method==='screenshot')data=await browser.screenshot(args.pageId);
    else{
      if(method!=='existingPage'&&!methods.has(method))throw Error('UNKNOWN_BROWSER_HOST_METHOD');
      const page=await browser.existingPage(args.pageUrl);
      if(method==='existingPage')data={found:true};
      if(method==='assertLocation')data=await page.assertLocation(args.origin,args.prefix);
      if(method==='wait')data=await page.wait(args.selector);
      if(method==='inventory')data=await page.inventory(args.plan);
      if(method==='observe')data=await page.observe(args.plan);
      if(method==='act')data=await page.act(args.action,args.value,args.files);
      if(method==='ensureGroups')data=await page.ensureGroups(args.groups);
      if(method==='verificationInspect')data=await inspectVerification(page);
    }
    res.end(JSON.stringify({data:data??null}));
  }catch(error){res.end(JSON.stringify({error:code(error)}));}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});await chmod(socketPath,0o600);
console.log(JSON.stringify({status:'browser_host_ready',pid:process.pid,connectionAttempts:0,automaticRetries:0}));
process.once('SIGTERM',()=>{server.close();process.exit(0);});
