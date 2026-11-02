import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
// Every Chromium-family main process counts: a fake built-in browser may start Chromium, Chrome for
// Testing, Edge or Brave rather than Google Chrome.
const CHROMIUM_FAMILY=/^\s*(\d+)\s+(.+\/(?:Google Chrome|Google Chrome for Testing|Chromium|Microsoft Edge|Brave Browser)\.app\/Contents\/MacOS\/(?:Google Chrome|Google Chrome for Testing|Chromium|Microsoft Edge|Brave Browser))(?:\s+(.*))?$/;
export async function readChromeProcessInventory({run=execute}={}){try{const {stdout}=await run('ps',['-ww','-axo','pid=,args='],{maxBuffer:8*1024*1024,timeout:3000,env:{...process.env,LC_ALL:process.platform==='darwin'?'en_US.UTF-8':'C.UTF-8'}});const processes=stdout.split('\n').flatMap(line=>{const hit=line.match(CHROMIUM_FAMILY);if(!hit||/--type=/.test(hit[3]||''))return [];const args=hit[3]||'',flag=key=>{const value=args.match(new RegExp('--'+key+'=(.*?)(?=\\s--|$)'));return value?value[1].replace(/\s(?:about:|https?:\/\/).*$/,''):null;},proxy=flag('proxy-server');let proxyEndpoint=null;try{if(proxy){const url=new URL(proxy.includes('://')?proxy:'http://'+proxy);proxyEndpoint=url.protocol+'//'+url.host;}}catch{}return [{pid:Number(hit[1]),executable:hit[2],profileDir:flag('user-data-dir'),profileExplicit:!!flag('user-data-dir'),debugPort:Number(flag('remote-debugging-port'))||null,explicitProxy:!!proxy,proxyEndpoint,proxyPacConfigured:!!flag('proxy-pac-url'),source:'local_process_inventory'}];});return {available:true,processes,reason:null};}catch(error){return {available:false,processes:[],reason:error.code||'PROCESS_INVENTORY_UNAVAILABLE'};}}
export function executorCapability(status,channel){
 const executor=status?.executor;
 const provider=channel==='iab'?'official_host_browser_sdk':null;
 const valid=channel==='iab'?status?.mode==='iab'&&executor?.provider===provider:status?.mode==='managed'&&executor?.provider==='managed_chrome'||status?.mode==='cdp'&&executor?.provider==='local_cdp_chrome'||status?.mode==='host_chrome'&&executor?.provider==='official_host_browser_sdk';
 const verified=valid&&executor?.verified===true&&typeof executor.sessionId==='string'&&!!executor.sessionId;
 return {available:!!verified,provider:executor?.provider||null,sessionId:verified?executor.sessionId:null,reason:verified?null:channel==='iab'?'IAB_HOST_BRIDGE_REQUIRED':'BROWSER_EXECUTOR_IDENTITY_REQUIRED'};
}
