// Loaded afresh for one interface request. Business code is never resident in
// the host's MCP transport; the shared core owns all durable task state.
import {CoreClient} from './core-client.mjs';
process.once('message',async ({mode,kind,operation,args,capabilities})=>{
 try{
  const core=new CoreClient(mode);
  const result=kind==='list'?await core.listOperations():kind==='control'?await core.control(operation):await core.execute(operation,args||{},capabilities||{});
  process.send({result},()=>process.disconnect());
 }catch(error){process.send({result:{isError:true,error:error.message}},()=>process.disconnect());}
});
