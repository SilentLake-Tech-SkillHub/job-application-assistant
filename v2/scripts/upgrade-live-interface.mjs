import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath,pathToFileURL} from 'node:url';import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
export async function upgradeLiveInterface({pid,mode,endpoint}={}){
 if(!Number.isInteger(pid)||pid<=1||!['login','application'].includes(mode))throw Error('LIVE_TARGET_REQUIRED');
 const {stdout}=await promisify(execFile)('/bin/ps',['-p',String(pid),'-o','command=']);
 if(!stdout.includes(root)||!stdout.trim().endsWith('scripts/start.mjs '+mode))throw Error('LIVE_PROCESS_IDENTITY_MISMATCH');
 let opened=false;
 if(!endpoint){
  try{await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(500)});throw Error('INSPECTOR_PORT_ALREADY_OCCUPIED');}catch(e){if(e.message==='INSPECTOR_PORT_ALREADY_OCCUPIED')throw e;}
  process.kill(pid,'SIGUSR1');opened=true;
  for(let i=0;i<50&&!endpoint;i++){try{const list=await(await fetch('http://127.0.0.1:9229/json/list')).json();endpoint=list[0]?.webSocketDebuggerUrl;}catch{}if(!endpoint)await new Promise(r=>setTimeout(r,50));}
 }
 if(!endpoint||!/^ws:\/\/127\.0\.0\.1:\d+\//.test(endpoint))throw Error('LOCAL_INSPECTOR_REQUIRED');
 const ws=new WebSocket(endpoint),pending=new Map();let sequence=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const d=JSON.parse(e.data),p=pending.get(d.id);if(p){pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}};
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('LIVE_UPGRADE_TIMEOUT'));},45000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const d=await rpc('Runtime.evaluate',{expression,awaitPromise:true});if(d.exceptionDetails)throw Error(d.exceptionDetails.exception?.description||d.exceptionDetails.text);return d.result;};
 try{
  const actual=await evaluate('process.pid');if(actual.value!==pid)throw Error('INSPECTOR_PROCESS_MISMATCH');
  const sdk=pathToFileURL(path.join(root,'node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js')).href;
  const load=url=>`process.getBuiltinModule('vm').runInThisContext(${JSON.stringify('import('+JSON.stringify(url)+')')},{importModuleDynamically:process.getBuiltinModule('vm').constants.USE_MAIN_CONTEXT_DEFAULT_LOADER})`;
  const proxyHash=createHash('sha256').update(await readFile(new URL('../shared/mcp-proxy.mjs',import.meta.url))).digest('hex');
  const bridgeUrl=pathToFileURL(path.join(root,'shared/live-transport-upgrade.mjs')).href+'?release='+createHash('sha256').update(await readFile(new URL('../shared/live-transport-upgrade.mjs',import.meta.url))).digest('hex');
  const active=await evaluate("!!globalThis[Symbol.for('recruiting.activeTransport')]");
  if(active.value){
   const liveHash=await evaluate("globalThis[Symbol.for('recruiting.activeTransport')]._recruitingTransportFingerprint");
   if(liveHash.value!==proxyHash){const result=await evaluate(`(async()=>{const bridge=await ${load(bridgeUrl)};return bridge.upgradeLiveTransport(globalThis[Symbol.for('recruiting.activeTransport')],${JSON.stringify(mode)});})()`);const value=await rpc('Runtime.callFunctionOn',{objectId:result.objectId,functionDeclaration:'function(){return this;}',returnByValue:true});return value.result.value;}
   const result=await evaluate(`(async()=>{const m=await ${load(pathToFileURL(path.join(root,'shared/interface-call.mjs')).href)};const result=await m.interfaceCall({mode:${JSON.stringify(mode)},kind:'control',operation:'update'});if(result.isError)throw Error(result.error);globalThis[Symbol.for('recruiting.activeTransport')]._serverInfo.version=result.version;return {status:'updated',pid:process.pid,...result};})()`);
   const value=await rpc('Runtime.callFunctionOn',{objectId:result.objectId,functionDeclaration:'function(){return this;}',returnByValue:true});return value.result.value;
  }
  const prototype=await evaluate(`(async()=> (await ${load(sdk)}).McpServer.prototype)()`);
  const objects=await rpc('Runtime.queryObjects',{prototypeObjectId:prototype.objectId});
  const result=await rpc('Runtime.callFunctionOn',{objectId:objects.objects.objectId,functionDeclaration:`async function(){const live=this.filter(s=>s.server?._transport?._stdin===process.stdin);if(live.length!==1)throw Error('LIVE_SERVER_NOT_UNIQUE');const module=await ${load(bridgeUrl)};return module.upgradeLiveTransport(live[0],${JSON.stringify(mode)});}`,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
 }finally{
  if(opened)await evaluate("setTimeout(()=>process.getBuiltinModule('inspector').close(),100);true").catch(()=>{});
  ws.close();
  if(opened)for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:9229/json/list',{signal:AbortSignal.timeout(300)});await new Promise(r=>setTimeout(r,50));}catch{break;}}
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){try{const [mode,id]=process.argv.slice(2);console.log(JSON.stringify(await upgradeLiveInterface({mode,pid:Number(id)})));}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}}
