import {spawn} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {acquireLease,leasePath,defaultLeaseRoot} from '../shared/leases.mjs';
const mode=process.argv[2];if(!['login','application'].includes(mode))throw Error('SELECT_LOGIN_OR_APPLICATION_MCP');
const browserMode=process.env.RECRUITING_BROWSER_MODE||'managed';
if(!['managed','cdp'].includes(browserMode))throw Error('INVALID_BROWSER_MODE');
const socket=process.env.RECRUITING_BROWSER_SOCKET||`/tmp/recruiting-form-v2-${browserMode}-${process.getuid()}/browser.sock`;
process.env.RECRUITING_BROWSER_SOCKET=socket;
const health=()=>new Promise(resolve=>{const r=http.get({socketPath:socket,path:'/health'},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{resolve(null);}});});r.on('error',()=>resolve(null));r.setTimeout(1000,()=>{r.destroy();resolve(null);});});
const release=await acquireLease(leasePath(defaultLeaseRoot(),'v2-browser-start:'+socket),{waitMs:5000,busyCode:'V2_BROWSER_START_BUSY'});
try{
 let status=await health();
 if(!status){
 if(process.env.RECRUITING_BROWSER_INITIALIZE!=='1')throw Error('BROWSER_SESSION_SELECTION_REQUIRED');
 const profileDir=process.env.RECRUITING_BROWSER_PROFILE_DIR||(process.env.RECRUITING_PROFILE_JSON?path.join(path.dirname(process.env.RECRUITING_PROFILE_JSON),'.browser-profile'):null);
 if(browserMode==='managed'&&!profileDir)throw Error('PRIVATE_AUTOMATION_PROFILE_REQUIRED');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../shared/browser-host.mjs',import.meta.url)),socket],{detached:true,stdio:'ignore',env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:browserMode,...(profileDir?{RECRUITING_BROWSER_PROFILE_DIR:profileDir}:{}),...(process.env.RECRUITING_CDP_URL?{RECRUITING_CDP_URL:process.env.RECRUITING_CDP_URL}:{})}});child.unref();for(let i=0;i<30&&!status;i++){await new Promise(r=>setTimeout(r,100));status=await health();}}
 if(!status)throw Error('V2_BROWSER_HOST_UNAVAILABLE');
 // Older hosts are left untouched; never kill or replace them to upgrade.
 if(status.protocolVersion!==4)throw Error('V2_BROWSER_PROTOCOL_REQUIRED_USE_SEPARATE_SOCKET');
 if(status.mode!==browserMode)throw Error('BROWSER_MODE_MISMATCH_USE_SEPARATE_SOCKET');
}finally{await release();}
await import(mode==='login'?'../login/server.mjs':'../application/server.mjs');
