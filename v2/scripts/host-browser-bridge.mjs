// Import this in the live, trusted host browser SDK tool context. It cannot
// discover a browser by a guessed mode, create a replacement browser or transfer
// login state. The supplied agent must be the actual initialized host runtime.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startHostBrowserBridge} from '../shared/host-browser-bridge.mjs';
import {capabilityFile,capabilityHostId,hostCapability,channelsOf,detectBrowserCapability} from '../shared/browser-capability.mjs';
import {loadAdapter} from '../host/adapters/registry.mjs';
import {loadFallbackRegistry,fallbackRegistryFile} from '../shared/gui-fallback.mjs';
import {resolveHostExtension,extensionSocketPath} from '../shared/host-extension.mjs';
import {configurePaths} from '../shared/runtime-paths.mjs';
import {collectHostReaPage} from '../shared/host-rea.mjs';
// Called INSIDE the actual host's extension tool runtime, never another host's daemon.
export async function registerMainChromeExtension({agent,browserId,allowedOrigins,fileUpload,reaInspect,reaPackageRoot,deferBrowserCalls=true,env=process.env}){
 env={...env};configurePaths({env});
 if(!agent?.browsers?.list||!agent?.browsers?.get||!browserId)throw Error('TRUSTED_HOST_BROWSER_RUNTIME_REQUIRED');
 const extension=resolveHostExtension({registry:await loadFallbackRegistry(fallbackRegistryFile(env)),hostId:env.RECRUITING_HOST_ID,capability:(await loadAdapter(env.RECRUITING_HOST_ID)).mainChromeExtension});
 if(extension.transport!=='host_sdk')throw Error('HOST_EXTENSION_TRANSPORT_MISMATCH');
 const inventory=()=>agent.browsers.list(),entry=(await inventory()).find(b=>b.id===browserId);
 if(entry?.type!=='extension')throw Error('HOST_BROWSER_PROVIDER_NOT_VERIFIED');
 const browser=await agent.browsers.get(browserId);
 const refreshExtension=async()=>{
  const instance=entry.metadata?.extensionInstanceId;
  const matches=(await inventory()).filter(candidate=>candidate.type==='extension'&&
   (instance?candidate.metadata?.extensionInstanceId===instance:candidate.id===entry.id));
  if(matches.length!==1)throw Error('BROWSER_EXTENSION_ORIGINAL_INSTANCE_UNAVAILABLE');
  return agent.browsers.get(matches[0].id);
 };
 const upload=fileUpload||(async({tab,selector,paths})=>{
  if(typeof tab.playwright?.waitForEvent!=='function')throw Error('HOST_FILE_CHOOSER_ADAPTER_REQUIRED');
  const chooser=tab.playwright.waitForEvent('filechooser');await tab.playwright.locator(selector).click();await (await chooser).setFiles(paths);
 });
 const packageRoot=reaPackageRoot||env.RECRUITING_REA_PACKAGE_ROOT;
 const capture=reaInspect||(packageRoot?async args=>{const hostObservation=await collectHostReaPage(args);return {hostObservation,reaPackageRoot:packageRoot,binding:hostObservation.binding};}:undefined);
 const bridge=await startHostBrowserBridge({browser,inventory,mode:'chrome',extension,refreshExtension,hostEnvironment:env,socketPath:extensionSocketPath(env.RECRUITING_BROWSER_SOCKET,env.RECRUITING_HOST_ID),allowedOrigins,fileUpload:upload,reaInspect:capture,deferBrowserCalls});
 return {...bridge,extension};
}
export async function registerHostBrowser({agent,browserId,channel='iab',socketPath,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls=true}){
 // Only the host's built-in browser is bridged. The Chrome channel is the component's own dedicated
 // Chrome clone, attached over CDP by the broker; no host plugin ever stands in for it.
 if(channel!=='iab')throw Error('ONLY_BUILT_IN_BROWSER_IS_BRIDGED');
 if(!agent?.browsers?.list||!agent?.browsers?.get||!browserId)throw Error('TRUSTED_HOST_BROWSER_RUNTIME_REQUIRED');
 const inventory=()=>agent.browsers.list(),entries=await inventory(),entry=entries.find(item=>item.id===browserId);
 if(!entry||entry.type!=='iab')throw Error('HOST_BROWSER_PROVIDER_NOT_VERIFIED');
 const browser=await agent.browsers.get(browserId);
 return startHostBrowserBridge({browser,inventory,mode:'iab',socketPath,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls});
}
// One-time detection for this host (three steps, see shared/browser-capability.mjs). Run it once per
// executor host, or again only when the user asks; the result file decides every later call.
export async function detectHostBrowsers({hostContext,agent,fileUpload,screenshot,env=process.env}){
 const host=capabilityHostId(env),adapter=await loadAdapter(host);
 // Only an adapter whose browsers are exposed to code can hand over a live browser SDK.
 const live=adapter.browsers.iab?.exposure==='code'?await adapter.connect(hostContext):{};
 return detectBrowserCapability({file:capabilityFile(env),host,adapter,agent:agent||live.agent,fileUpload:fileUpload||live.fileUpload,screenshot:screenshot||live.screenshot,env});
}
// Each session: bridge the built-in browser only when the capability file marks it usable. The Chrome
// clone needs no registration. A missing file is an explicit stop, never a guess.
export async function registerFromCapability({agent,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls=true,env=process.env}){
 const {status,entry,reason}=await hostCapability({file:capabilityFile(env),host:capabilityHostId(env),env});
 if(status!=='detected')throw Error(reason||'BROWSER_CAPABILITY_DETECTION_REQUIRED');
 const bridges={};
 if(channelsOf(entry).includes('iab')){
  const spec=entry.iab,found=(await agent.browsers.list()).filter(e=>e?.type==='iab');
  if(found.length!==1)throw Error('IAB_HOST_BROWSER_NOT_PRESENT');
  if(!spec.call?.socket)throw Error('BROWSER_CAPABILITY_SOCKET_REQUIRED');
  bridges.iab=await registerHostBrowser({agent,browserId:found[0].id,channel:'iab',socketPath:spec.call.socket,allowedOrigins,fileUpload,reaInspect,deferBrowserCalls});
 }
 return {channels:channelsOf(entry),bridges};
}
export async function pumpHostBrowser(bridge,{maxJobs=20,waitMs=0}={}){
 if(!bridge||typeof bridge.pump!=='function'||!Number.isInteger(maxJobs)||maxJobs<1||maxJobs>100)throw Error('HOST_BROWSER_PUMP_REQUIRED');
 if(!Number.isInteger(waitMs)||waitMs<0||waitMs>5000)throw Error('HOST_BROWSER_PUMP_WAIT_INVALID');
 let completed=0;const end=Date.now()+waitMs;while(completed<maxJobs){if(await bridge.pump())completed++;else if(Date.now()<end)await new Promise(r=>setTimeout(r,25));else break;}return {completed,pending:bridge.pendingCount(),executor:bridge.executor};
}

const runningStages=new WeakSet();
// Use inside the actual host SDK tool, with one fixed component invocation.
export async function runHostBrowserStage(bridge,run,{signal}={}){
 if(typeof bridge?.waitForRequest!=='function'||typeof bridge.pump!=='function'||typeof run!=='function')throw Error('HOST_BROWSER_STAGE_REQUIRED');
 if(runningStages.has(bridge))throw Error('HOST_BROWSER_STAGE_BUSY');
 signal?.throwIfAborted();
 const stop=new AbortController(),start=performance.now();
 let finished=false,completed=0,waitMs=0,emptyWakeups=0;
 const cancel=()=>stop.abort(signal.reason);
 signal?.addEventListener('abort',cancel,{once:true});
 runningStages.add(bridge);
 const execution=Promise.resolve().then(()=>run({signal:stop.signal})).finally(()=>{finished=true;stop.abort();});
 execution.catch(()=>{});
 try{
  while(!finished){
   const waiting=performance.now();
   const available=await bridge.waitForRequest(stop.signal);
   waitMs+=performance.now()-waiting;
   if(finished||signal?.aborted)break;
   if(!available)throw Error('HOST_BROWSER_STAGE_BRIDGE_CLOSED');
   if(await bridge.pump())completed++;else emptyWakeups++;
  }
  signal?.throwIfAborted();
  return {result:await execution,browserStage:{wallMs:Math.round(performance.now()-start),waitMs:Math.round(waitMs),requests:completed,emptyWakeups}};
 }finally{
  stop.abort();
  signal?.removeEventListener('abort',cancel);
  runningStages.delete(bridge);
 }
}


// Start the installed CLI directly, on stdin, without a shell wrapper, from
// the same host SDK invocation that services this stage's browser callbacks.
export async function runHostBrowserCliStage(bridge,{workspace,mode='application',operation,input={},env=process.env,signal}){
 if(typeof workspace!=='string'||!workspace.startsWith('/')||!['application','login'].includes(mode)||!/^[a-z][a-z0-9_]+$/.test(operation))throw Error('FIXED_WORKFLOW_CLI_REQUIRED');
 const cli=fileURLToPath(new URL('./cli.mjs',import.meta.url));
 return runHostBrowserStage(bridge,({signal:cancel})=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'--workspace',workspace,mode,operation,'-'],{cwd:workspace,env:{...process.env,...env},signal:cancel,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';
  child.once('error',reject);
  child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});
  child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
  child.stdin.once('error',reject);
  child.once('close',code=>{
   try{resolve({exitCode:code,receipt:JSON.parse(stdout.trim()||stderr.trim())});}
   catch{reject(Error('FIXED_WORKFLOW_CLI_RESULT_REQUIRED'));}
  });
  child.stdin.end(JSON.stringify(input));
 }),{signal});
}
