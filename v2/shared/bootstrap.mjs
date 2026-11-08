import {spawn} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {acquireLease,leasePath,defaultLeaseRoot} from '../shared/leases.mjs';
import {executorCapability} from '../shared/browser-environment.mjs';
import {capabilityFile,capabilityHostId,hostCapability,refreshChromeVersion} from '../shared/browser-capability.mjs';
import {genericSourceManifest} from '../shared/runtime-identity.mjs';
import {hostRole} from '../shared/host-role.mjs';
import {configurePaths} from './runtime-paths.mjs';
export async function bootstrapRuntime(options={}){
configurePaths(options);

// The once-detected capability file decides the browser channels; startup never re-inspects browsers.
let capability;try{const file=capabilityFile(),host=capabilityHostId();await refreshChromeVersion({file}).catch(()=>{});capability=await hostCapability({file,host,env:process.env});}catch(error){capability={status:'not_configured',reason:/^[A-Z_]+$/.test(error.message)?error.message:'BROWSER_CAPABILITY_UNREADABLE'};}
process.env.RECRUITING_BROWSER_CAPABILITY_JSON=JSON.stringify(capability);
// The Chrome channel is the dedicated Chrome clone, attached over CDP (shared/chrome-clone.mjs). Its
// endpoint, profile and port come from the capability file, the same for every host. A host whose own
// profile/port differ (config_mismatch) gets no Chrome broker at all rather than a second Chrome.
const clone=capability.status==='detected'&&capability.entry?.chrome?.result==='usable'?capability.entry.chrome:null;
if(clone)Object.assign(process.env,{RECRUITING_CDP_URL:clone.call.url,RECRUITING_BROWSER_PROFILE_DIR:clone.profileDir,RECRUITING_BROWSER_CDP_PORT:String(clone.cdpPort),RECRUITING_CHROME_EXECUTABLE:clone.executable});
else if(capability.status==='config_mismatch')delete process.env.RECRUITING_CDP_URL;
const browserMode=clone||capability.status==='config_mismatch'?'cdp':process.env.RECRUITING_BROWSER_MODE||'managed';
if(!['managed','cdp','host'].includes(browserMode))throw Error('INVALID_BROWSER_MODE');
const socket=process.env.RECRUITING_BROWSER_SOCKET||`/tmp/recruiting-form-v2-${browserMode}-${process.getuid()}/browser.sock`;
process.env.RECRUITING_BROWSER_SOCKET=socket;
const healthFor=sock=>new Promise(resolve=>{const r=http.get({socketPath:sock,path:'/health'},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{resolve(null);}});});r.on('error',()=>resolve(null));r.setTimeout(1000,()=>{r.destroy();resolve(null);});});
const health=()=>healthFor(socket);
const profileDir=process.env.RECRUITING_BROWSER_PROFILE_DIR||null;
// A maintainer host never starts, attaches or autostarts a browser.
if(hostRole()==='maintainer'){process.env.RECRUITING_WORKER_SOURCE_SHA256=(await genericSourceManifest()).sourceFingerprint;return;}
else{
const release=await acquireLease(leasePath(defaultLeaseRoot(),'v2-browser-start:'+socket),{waitMs:5000,busyCode:'V2_BROWSER_START_BUSY'});
try{
 let status=await health();
 // This process owns only the dormant RPC broker. It never calls connect();
 // Chrome launch/attach is reachable only through the explicit authorized stage.
 if(!status&&browserMode!=='host'&&(browserMode!=='cdp'||process.env.RECRUITING_CDP_URL)){
 const child=spawn(process.execPath,[fileURLToPath(new URL('../shared/browser-host.mjs',import.meta.url)),socket],{detached:true,stdio:'ignore',env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:browserMode,...(profileDir?{RECRUITING_BROWSER_PROFILE_DIR:profileDir}:{}),...Object.fromEntries(['RECRUITING_CDP_URL','RECRUITING_BROWSER_CDP_PORT','RECRUITING_CHROME_EXECUTABLE'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))}});child.unref();for(let i=0;i<30&&!status;i++){await new Promise(r=>setTimeout(r,100));status=await health();}}
 // Runtime inspection remains available without a browser. Stage operations
 // require an initialized, verified executor and never start one implicitly.
 if(status?.protocolVersion!==4||status.mode!==browserMode&&!(browserMode==='host'&&status.mode==='host_chrome'))status=null;
 const iabSocket=process.env.RECRUITING_IAB_SOCKET;
 if(iabSocket&&path.resolve(iabSocket)===path.resolve(socket))throw Error('IAB_EXECUTOR_CHANNEL_MISMATCH');
 // IAB exists only when a live trusted host SDK bridge is registered. A missing
 // bridge is reported as unavailable; never launch a second Chromium as IAB.
 const iabStatus=iabSocket?await healthFor(iabSocket):null;
 process.env.RECRUITING_BROWSER_CAPABILITY_JSON=JSON.stringify({...capability,live:{chrome:executorCapability(status,'chrome'),iab:executorCapability(iabStatus,'iab')}});
}finally{await release();}
process.env.RECRUITING_WORKER_SOURCE_SHA256=(await genericSourceManifest()).sourceFingerprint;
return;
}
}
