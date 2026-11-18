// Loaded afresh for one interface request. Business code is never resident in
// the host's MCP transport; the shared core owns all durable task state.
import {CoreClient} from './core-client.mjs';
import {withHookNotice} from './hook-receipt.mjs';
import {withHostCapabilities} from './sampling-bridge.mjs';
process.once('message',async ({mode,kind,operation,args,capabilities})=>{
 try{
  const core=new CoreClient(mode);
  const result=kind==='list'?await core.listOperations():kind==='control'?await core.control(operation):await core.execute(operation,args||{},capabilities||{});
  process.send({result:kind==='control'?await withHostCapabilities(capabilities,()=>withHookNotice(result)):result},()=>process.disconnect());
 }catch(error){process.send({result:await withHostCapabilities(capabilities,()=>withHookNotice({isError:true,error:error.message}))},()=>process.disconnect());}
});
