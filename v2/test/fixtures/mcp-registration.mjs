import {executeWorkflowOperation,stageResult} from '../../shared/workflow-contract.mjs';
export function registerWorkflowTool(server,tool,definition,handler,env=process.env){
 stageResult(tool,{});
 return server.registerTool(tool,definition,async(args,context)=>{
  const result=await executeWorkflowOperation(tool,args,async()=>{
   const response=await handler(args,context),block=response.content?.find(x=>x.type==='text');
   if(!block)throw Error('WORKFLOW_RESPONSE_ENVELOPE_REQUIRED');
   return {...JSON.parse(block.text),...(response.isError?{isError:true}:{})};
  },{env,context});
  const {isError,...data}=result;return {...(isError?{isError:true}:{}),content:[{type:'text',text:JSON.stringify(data)}]};
 });
}
