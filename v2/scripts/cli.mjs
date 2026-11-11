#!/usr/bin/env node
// Independent component entry: the same business core used by the MCP adapter.
import {readFile} from 'node:fs/promises';
import {CoreClient} from '../shared/core-client.mjs';
const args=process.argv.slice(2),at=args.indexOf('--workspace'),workspace=at>=0?args.splice(at,2)[1]:undefined;
const [mode,operation,inputFile]=args;
if(args.includes('--help')||!mode){console.log('Usage: node scripts/cli.mjs [--workspace /absolute/path] application|login list|runtime|operation [input.json]');process.exit(0);}
const core=new CoreClient(mode,{workspace});
try{
 const input=inputFile?JSON.parse(await readFile(inputFile,'utf8')):{};
 const result=operation==='list'?await core.listOperations():operation==='runtime'?await core.control(input.action||'status'):await core.execute(operation,input);
 console.log(JSON.stringify(result));if(result?.isError)process.exitCode=1;
}catch(error){console.error(JSON.stringify({error:error.message}));process.exitCode=1;}
