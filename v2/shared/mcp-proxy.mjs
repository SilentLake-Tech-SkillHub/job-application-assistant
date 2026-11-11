import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {openSamplingBridge} from './sampling-bridge.mjs';
import {readFile,stat} from 'node:fs/promises';import {createHash} from 'node:crypto';
const loadedTransportFingerprint=createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
const dispatcherUrl=new URL('./interface-call.mjs',import.meta.url);
const dispatcherHash=createHash('sha256').update(await readFile(dispatcherUrl)).digest('hex');
const {interfaceCall}=await import(dispatcherUrl.href+'?release='+dispatcherHash);
export async function serveRemoteMcp(mode,{clientState,beforeConnect}={}){
 const core={control:action=>interfaceCall({mode,kind:'control',operation:action}),listOperations:()=>interfaceCall({mode,kind:'list'}),execute:(operation,args,capabilities)=>interfaceCall({mode,kind:'execute',operation,args,capabilities})};const status=await core.control('status');if(status.isError)throw Error(status.error);
 const serverInfo={name:'recruiting-'+mode+'-v2',version:status.version};
 const server=new Server(serverInfo,{capabilities:{tools:{listChanged:true}}});
 server._recruitingTransportFingerprint=loadedTransportFingerprint;
 const sampling=await openSamplingBridge(server);server._recruitingDispose=()=>sampling.close();server.onclose=()=>{void sampling.close();};
 const management={name:'component_runtime',description:'管理本组件业务核心：读取状态、暂停、更新核心、恢复或停止空闲核心。浏览器保持运行。',inputSchema:{type:'object',properties:{action:{type:'string',enum:['status','pause','reload','update','resume','stop']}},required:['action'],additionalProperties:false}};
 server.setRequestHandler(ListToolsRequestSchema,async()=>{const operations=await core.listOperations();if(operations.isError)throw Error(operations.error);serverInfo.version=(await core.control('status')).version;return {tools:[...operations,management]};});
 server.setRequestHandler(CallToolRequestSchema,async request=>{
  let value;
  try{
  if(request.params.name==='component_runtime'){
   const action=request.params.arguments?.action;if(!['status','pause','reload','update','resume','stop'].includes(action))throw Error('INVALID_CORE_CONTROL');
   value={...await core.control(action),adapterPid:process.pid};if(['reload','update'].includes(action)&&!value.reloadRequested)await server.notification({method:'notifications/tools/list_changed'});
  }else value=await core.execute(request.params.name,request.params.arguments||{},{visionSocket:sampling.socket});
  }catch(error){value={isError:true,error:error.message};}
  serverInfo.version=(await core.control('status')).version;
  const {isError,...data}=value;
  const content=[{type:'text',text:JSON.stringify(data)}];
  if(request.params.name==='form_capture_visual'&&data.status==='visual_screenshot_ready'){
   // Paths come from the bound broker. Embed all captures or leave the set
   // available by path, so a partial preview cannot imply full coverage.
   const files=(data.screenshots||[]).map(screenshot=>screenshot.path);
   const info=await Promise.all(files.map(file=>stat(file).catch(()=>null)));
   if(info.every(item=>item?.isFile())&&info.reduce((size,item)=>size+item.size,0)<=16*1024*1024){
    const images=await Promise.all(files.map(file=>readFile(file).catch(()=>null)));
    const png=Buffer.from([137,80,78,71,13,10,26,10]);
    if(images.every(bytes=>bytes?.subarray(0,8).equals(png)))for(const bytes of images)content.push({type:'image',mimeType:'image/png',data:bytes.toString('base64')});
   }
  }
  return {...(isError?{isError:true}:{}),content};
 });
 if(clientState){server._clientCapabilities=clientState.capabilities;server._clientVersion=clientState.clientInfo;server._requestMessageId=clientState.requestId;}
 const transport=new StdioServerTransport();
 try{await beforeConnect?.();await server.connect(transport);}catch(e){await transport.close().catch(()=>{});await sampling.close();throw e;}process.stdin.resume();globalThis[Symbol.for('recruiting.activeTransport')]=server;return server;
}
