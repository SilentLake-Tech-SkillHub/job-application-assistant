import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {createInterface} from 'node:readline';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const client=new Client({name:'v2-real-mcp-validation',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/start.mjs'),process.env.RECRUITING_MCP_MODE||'login'],env:Object.fromEntries(Object.entries(process.env).filter(([,v])=>typeof v==='string')),stderr:'pipe'});
transport.stderr?.on('data',()=>{});
await client.connect(transport);console.log(JSON.stringify({ready:true,tools:(await client.listTools()).tools.map(t=>t.name)}));
if(process.stdin.isTTY)process.stdin.setRawMode(true); // Do not echo ephemeral OTP to the PTY.
const rl=createInterface({input:process.stdin,terminal:false});
for await(const line of rl){
  try{const cmd=JSON.parse(line);if(cmd.close){await client.close();break;}
    const started=performance.now(),result=await client.callTool({name:cmd.name,arguments:cmd.arguments||{}},undefined,{timeout:45000});
    const value={tool:cmd.name,elapsedMs:Math.round(performance.now()-started),isError:!!result.isError,...JSON.parse(result.content[0].text)};
    if(process.env.RECRUITING_LOGIN_EVIDENCE_DIR){await mkdir(process.env.RECRUITING_LOGIN_EVIDENCE_DIR,{recursive:true,mode:0o700});await writeFile(path.join(process.env.RECRUITING_LOGIN_EVIDENCE_DIR,`${Date.now()}-${cmd.name}.json`),JSON.stringify(value,null,2),{mode:0o600});}
    // Never print or persist input arguments (particularly ephemeral OTP).
    console.log(JSON.stringify(value));
  }catch{console.log(JSON.stringify({error:'CLIENT_OPERATION_FAILED'}));}
}
await client.close();process.exit(0);
