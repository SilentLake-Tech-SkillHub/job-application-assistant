// Component-owned backend update: discover only adapters owned by this agent's
// app-server, migrate legacy transports, then update current managed cores.
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {upgradeLiveInterface} from './upgrade-live-interface.mjs';
export async function runtimeTargets(){
 const {stdout}=await promisify(execFile)('/bin/ps',['-axo','pid=,ppid=,command=']);const rows=stdout.split('\n').flatMap(line=>{const m=line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);return m?[{pid:Number(m[1]),ppid:Number(m[2]),command:m[3]}]:[];});
 const byId=new Map(rows.map(r=>[r.pid,r])),root=fileURLToPath(new URL('..',import.meta.url));let owner=byId.get(process.pid);
 while(owner&&owner.pid>1){
  const targets=rows.filter(r=>r.ppid===owner.pid&&r.command.includes(root)&&/scripts\/start\.mjs (login|application)$/.test(r.command));
  if(targets.length)return targets.map(r=>({pid:r.pid,mode:r.command.endsWith(' login')?'login':'application',ownerPid:owner.pid}));
  owner=byId.get(owner.ppid);
 }
 throw Error('CURRENT_HOST_MCP_TARGETS_NOT_FOUND');
}
const targets=await runtimeTargets();if(!targets.length)throw Error('CURRENT_HOST_MCP_TARGETS_NOT_FOUND');
if(process.argv.includes('--preview'))console.log(JSON.stringify({targets}));
else{const results=[];for(const target of targets){const result=await upgradeLiveInterface(target);results.push({...target,...result});}console.log(JSON.stringify({results}));}
