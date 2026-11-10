import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('..',import.meta.url));
test('a running client detects same-version code changes, updates core, and refuses stale interface code',{timeout:15000},async()=>{
 const d=await mkdtemp('/tmp/release-test-'),pkg=path.join(d,'component');let core;
 try{
  for(const dir of ['shared','login','application','catalog','host','scripts'])await mkdir(path.join(pkg,dir),{recursive:true});
  for(const name of ['shared/core-client.mjs','shared/core-host.mjs','shared/runtime-release.mjs','shared/runtime-identity.mjs','shared/agent-registry.mjs','shared/runtime-paths.mjs','shared/leases.mjs','shared/host-role.mjs','shared/mcp-proxy.mjs','scripts/start.mjs','scripts/cli.mjs'])await copyFile(path.join(source,name),path.join(pkg,name));
  await writeFile(path.join(pkg,'package.json'),JSON.stringify({type:'module',version:'synthetic.1'}));await writeFile(path.join(pkg,'package-lock.json'),'{}');
  await writeFile(path.join(pkg,'shared/core-worker.mjs'),`import {installedRelease,requireSameRelease} from './runtime-release.mjs';const loaded=await installedRelease();process.on('disconnect',()=>process.exit(0));process.on('message',async m=>{try{requireSameRelease(loaded,m.expected);requireSameRelease(loaded,await installedRelease());process.send({id:m.id,result:{...loaded,pid:process.pid}});}catch(e){process.send({id:m.id,result:{isError:true,error:e.message}});}});process.send({ready:true,info:loaded,operations:[]});`);
  const {CoreClient}=await import(pathToFileURL(path.join(pkg,'shared/core-client.mjs')));core=new CoreClient('application',{workspace:path.join(d,'workspace'),env:{PATH:process.env.PATH,RECRUITING_HOST_ROLE:'maintainer'}});
  const before=await core.execute('inspect');await writeFile(path.join(pkg,'shared/business.mjs'),'export const revision=2;');
  const after=await core.execute('inspect');assert.equal(after.version,before.version);assert.notEqual(after.sourceFingerprint,before.sourceFingerprint);assert.notEqual(after.pid,before.pid);
  const rejected=await core.request('/execute',{operation:'inspect',expected:before});assert.equal(rejected.error,'RUNTIME_VERSION_MISMATCH');
  const version=await core.request('/execute',{operation:'inspect'});assert.equal(version.error,'RUNTIME_FINGERPRINT_REQUIRED');
  await writeFile(path.join(pkg,'scripts/cli.mjs'),'// changed interface');await assert.rejects(core.execute('inspect'),/INTERFACE_CODE_STALE/);
 }finally{await core?.control('stop').catch(()=>{});await rm(d,{recursive:true,force:true});}
});
