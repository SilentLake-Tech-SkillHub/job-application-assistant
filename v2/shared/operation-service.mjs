import {z} from 'zod';
import {executeWorkflowOperation} from './workflow-contract.mjs';

// Transport-independent application API. CLI and MCP share schema validation,
// workflow transitions, host-role rules and the same business handlers.
export class OperationService {
 constructor(info){this.info=info;this.operations=new Map();}
 registerOperation(name,definition,handler){
  if(this.operations.has(name))throw Error('DUPLICATE_OPERATION');
  const schema=definition.inputSchema?.safeParse?definition.inputSchema:z.object(definition.inputSchema||{});
  this.operations.set(name,{definition,schema,handler});
 }
 listOperations(){return [...this.operations].map(([name,{definition,schema}])=>({name,description:definition.description||'',annotations:definition.annotations,inputSchema:z.toJSONSchema(schema,{unrepresentable:'any'})}));}
 async execute(name,input={},context){
  const operation=this.operations.get(name);if(!operation)throw Error('UNKNOWN_OPERATION');
  const args=operation.schema.parse(input);
  return executeWorkflowOperation(name,args,operation.handler,{context});
 }
}
