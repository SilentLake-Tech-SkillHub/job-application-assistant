import {installedRelease} from './runtime-release.mjs';
import {interfaceCall} from './interface-call.mjs';
// One-time bridge for installed pre-manager releases. The host keeps its stdin/
// stdout pipe and initialized MCP session; future updates use component_runtime.
export async function upgradeLiveTransport(wrapper,mode){
 const old=wrapper.server||wrapper,t=old._transport;
 if(!['login','application'].includes(mode)||!t||typeof t._ondata!=='function'||t._stdin!==process.stdin||t._stdout!==process.stdout)throw Error('LIVE_STDIO_TRANSPORT_REQUIRED');
 if(!(old._requestHandlerAbortControllers instanceof Map)||!(old._responseHandlers instanceof Map))throw Error('LIVE_SDK_CONTRACT_UNSUPPORTED');
 if(old._requestHandlerAbortControllers?.size||old._responseHandlers?.size)throw Error('LIVE_INTERFACE_BUSY');
 if(t._readBuffer?._buffer?.length)throw Error('LIVE_PARTIAL_REQUEST_PENDING');
 if(globalThis[Symbol.for('recruiting.activeTransport')]&&globalThis[Symbol.for('recruiting.activeTransport')]!==old)return {status:'already_upgraded',pid:process.pid};
 const release=await interfaceCall({mode,kind:'control',operation:'update'});if(release.isError||!release.verified)throw Error(release.error||'LIVE_RELEASE_NOT_VERIFIED');
 const current=await installedRelease();const {serveRemoteMcp}=await import(new URL('./mcp-proxy.mjs',import.meta.url).href+'?release='+current.sourceFingerprint);
 let detached=false;
 try{
  const server=await serveRemoteMcp(mode,{clientState:{capabilities:old._clientCapabilities,clientInfo:old._clientVersion,requestId:old._requestMessageId},beforeConnect:()=>{if(old._requestHandlerAbortControllers?.size||old._responseHandlers?.size)throw Error('LIVE_INTERFACE_BUSY');process.stdin.off('data',t._ondata);process.stdin.off('error',t._onerror);detached=true;}});
  await old._recruitingDispose?.();globalThis[Symbol.for('recruiting.activeTransport')]=server;
  await server.notification({method:'notifications/tools/list_changed'}).catch(()=>{});
  return {status:'upgraded',pid:process.pid,mode,version:server._serverInfo.version};
 }catch(error){if(detached){process.stdin.on('data',t._ondata);process.stdin.on('error',t._onerror);process.stdin.resume();}throw error;}
}
