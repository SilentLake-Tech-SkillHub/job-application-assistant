import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {openSamplingBridge} from './sampling-bridge.mjs';
import {interfaceCall} from './interface-call.mjs';
export async function serveRemoteMcp(mode){
 const core={control:action=>interfaceCall({mode,kind:'control',operation:action}),listOperations:()=>interfaceCall({mode,kind:'list'}),execute:(operation,args,capabilities)=>interfaceCall({mode,kind:'execute',operation,args,capabilities})};const status=await core.control('status');if(status.isError)throw Error(status.error);
 const serverInfo={name:'recruiting-'+mode+'-v2',version:status.version};
 const server=new Server(serverInfo,{capabilities:{tools:{listChanged:true}}});
 const sampling=await openSamplingBridge(server);server.onclose=()=>{void sampling.close();};
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
  const {isError,...data}=value;return {...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(data)}]};
 });
 await server.connect(new StdioServerTransport());return server;
}
