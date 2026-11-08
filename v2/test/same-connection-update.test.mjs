import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,symlink,rm,appendFile} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const source=fileURLToPath(new URL('..',import.meta.url));
test('same MCP conversation updates dispatcher, core and manager, verifies CLI parity and resumes durable task',{timeout:30000},async()=>{
 const d=await mkdtemp('/tmp/same-connection-'),pkg=path.join(d,'component'),workspace=path.join(d,'workspace');
 const c=new Client({name:'same-conversation-regression',version:'1'});
 const env={PATH:process.env.PATH,RECRUITING_WORKSPACE_ROOT:workspace,RECRUITING_HOST_ROLE:'executor'};
 const call=async(name,args={})=>{const r=await c.callTool({name,arguments:args});return {...JSON.parse(r.content[0].text),isError:!!r.isError};};
 const release=async revision=>{await writeFile(path.join(pkg,'package.json'),JSON.stringify({type:'module',version:'fixture.'+revision}));await writeFile(path.join(pkg,'shared/fixture-business.mjs'),'export const revision='+revision+';');};
 try{
  for(const dir of ['shared','login','application','catalog','host','scripts'])await mkdir(path.join(pkg,dir),{recursive:true});await mkdir(workspace);
  const files=['core-client','core-host','runtime-release','runtime-identity','runtime-paths','leases','host-role','mcp-proxy','interface-call','interface-worker','sampling-bridge','attachment-visual-review','attachment-source-renderer'];
  for(const name of files)await copyFile(path.join(source,'shared',name+'.mjs'),path.join(pkg,'shared',name+'.mjs'));
  for(const name of ['start','cli'])await copyFile(path.join(source,'scripts',name+'.mjs'),path.join(pkg,'scripts',name+'.mjs'));
  await symlink(path.join(source,'node_modules'),path.join(pkg,'node_modules'));await writeFile(path.join(pkg,'package-lock.json'),'{}');await release(1);
  await writeFile(path.join(workspace,'task.json'),JSON.stringify({taskId:'original-task',pageId:'original-page',step:0}));
  await writeFile(path.join(pkg,'shared/core-worker.mjs'),`import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {installedRelease,requireSameRelease} from './runtime-release.mjs';import {revision} from './fixture-business.mjs';const loaded=await installedRelease(),file=path.join(process.env.RECRUITING_WORKSPACE_ROOT,'task.json');process.on('disconnect',()=>process.exit(0));process.on('message',async m=>{try{requireSameRelease(loaded,m.expected);requireSameRelease(loaded,await installedRelease());let result={...loaded,revision,pid:process.pid};if(m.operation==='task_continue'){const task=JSON.parse(await readFile(file));task.step++;await writeFile(file,JSON.stringify(task));result={...result,...task};}process.send({id:m.id,result});}catch(e){process.send({id:m.id,result:{isError:true,error:e.message}});}});process.send({ready:true,info:loaded,operations:['runtime_info','task_continue'].map(name=>({name,inputSchema:{type:'object',properties:{}}}))});`);
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(pkg,'scripts/start.mjs'),'application'],env,stderr:'pipe'}));
  const before=await call('component_runtime',{action:'status'});assert.equal((await call('task_continue')).step,1);
  for(const revision of [2,3]){
   await release(revision);await appendFile(path.join(pkg,'shared/core-client.mjs'),'\n// updated dispatcher '+revision+'\n');
   if(revision===3)await appendFile(path.join(pkg,'shared/core-host.mjs'),'\n// updated manager\n');
   const updated=await call('component_runtime',{action:'update'});assert.equal(updated.isError,false,JSON.stringify(updated));assert.equal(updated.verified,true);assert.equal(updated.adapterPid,before.adapterPid);
   const result=await call('task_continue');assert.equal(result.step,revision);assert.equal(result.revision,revision);assert.equal(result.pageId,'original-page');assert.equal(result.taskId,'original-task');
   const {stdout}=await promisify(execFile)(process.execPath,[path.join(pkg,'scripts/cli.mjs'),'application','runtime_info'],{env});const cli=JSON.parse(stdout);assert.equal(cli.version,result.version);assert.equal(cli.sourceFingerprint,result.sourceFingerprint);assert.equal(cli.pid,result.pid);
  }
  await writeFile(path.join(pkg,'shared/fixture-business.mjs'),'throw Error("synthetic startup failure");');const failed=await call('component_runtime',{action:'update'});assert.equal(failed.isError,true);assert.equal(JSON.parse(await readFile(path.join(workspace,'task.json'))).step,3);
  await release(4);assert.equal((await call('component_runtime',{action:'update'})).verified,true);assert.equal((await call('task_continue')).step,4);
  assert.equal((await call('component_runtime',{action:'status'})).adapterPid,before.adapterPid);
 }finally{await c.callTool({name:'component_runtime',arguments:{action:'stop'}}).catch(()=>{});await c.close();await rm(d,{recursive:true,force:true});}
});
