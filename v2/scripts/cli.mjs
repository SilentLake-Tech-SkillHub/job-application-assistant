#!/usr/bin/env node
// Independent component entry: the same business core used by the MCP adapter.
import {readFile} from 'node:fs/promises';
import {CoreClient} from '../shared/core-client.mjs';
import {loadCliWorkflowTarget,recordCliWorkflow} from '../shared/cli-workflow-receipt.mjs';
import {claimCliStage,writeCliStageReceipt} from '../shared/host-stage-receipt.mjs';
const args=process.argv.slice(2),at=args.indexOf('--workspace'),workspace=at>=0?args.splice(at,2)[1]:undefined;
const stageAt=args.indexOf('--stage-dir'),stageDir=stageAt>=0?args.splice(stageAt,2)[1]:undefined;
const [mode,operation,inputFile]=args;
if(args.includes('--help')||!mode){console.log('Usage: node scripts/cli.mjs [--workspace /absolute/path] [--stage-dir /private/temp/path] application|login list|runtime|operation [input.json]');process.exit(0);}
let stage;
try{
 if(stageAt>=0)stage=await claimCliStage(stageDir,process.getuid());
 const core=new CoreClient(mode,{workspace});
 let source='';
 if(inputFile==='-'){
  process.stdin.setEncoding('utf8');
  for await(const chunk of process.stdin){
   source+=chunk;
   if(source.length>8*1024*1024)throw Error('CLI_INPUT_TOO_LARGE');
  }
 }else if(inputFile)source=await readFile(inputFile,'utf8');
 const input=inputFile?JSON.parse(source):{};
 const target=await loadCliWorkflowTarget({workspace:workspace||process.env.RECRUITING_WORKSPACE_ROOT});
 const result=operation==='list'?await core.listOperations():operation==='runtime'?await core.control(input.action||'status'):await core.execute(operation,input);
 if(operation!=='list'&&operation!=='runtime'){
  try{await recordCliWorkflow({target,operation,input,result});}
  catch(error){result.warnings=[...(result.warnings||[]),{code:'CLI_WORKFLOW_RECEIPT_WRITE_FAILED',reason:error.code||'WRITE_FAILED'}];}
 }
 const exitCode=result?.isError?1:0;
 if(stage)await writeCliStageReceipt(stage,{exitCode,receipt:result});
 console.log(JSON.stringify(result));if(exitCode)process.exitCode=exitCode;
}catch(error){
 const receipt={error:error.message};
 if(stage)await writeCliStageReceipt(stage,{exitCode:1,receipt}).catch(()=>{});
 console.error(JSON.stringify(receipt));process.exitCode=1;
}
