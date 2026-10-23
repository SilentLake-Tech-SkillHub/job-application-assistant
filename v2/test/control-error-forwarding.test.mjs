import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';import http from 'node:http';import {mkdtemp,rm,writeFile,unlink} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {withHostBrowserBridge} from '../shared/host-browser-bridge.mjs';import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {Engine,hash} from '../shared/engine.mjs';
const pageUrl='https://example.test/form',code='AUTOCOMPLETE_COMMIT_NOT_VERIFIED',secret='synthetic-private-control-value';
const digest=value=>createHash('sha256').update(value).digest('hex');
const details=()=>({phase:'after_option_click',expectedValueHash:digest('expected'),observedValueHash:digest('observed'),valueMatches:false,readbackAvailable:true});
const failure=payload=>Object.assign(Error(code),{details:payload});
async function temp(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'err-rpc-'));try{return await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
function rawRequest(socket,args){return new Promise((resolve,reject)=>{const req=http.request({socketPath:socket,path:'/rpc',method:'POST',headers:{'content-type':'application/json'}},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks))));});req.on('error',reject);req.end(JSON.stringify({method:'act',args}));});}
test('real IAB RPC wire and client reconstruction forward safe details and drop raw payloads',()=>temp(async dir=>{
 let payload=details();class MockPage{async act(){throw failure(payload);}}
 const browser={tabs:{list:async()=>[{id:'tab',url:pageUrl}],get:async()=>({id:'tab',url:async()=>pageUrl,playwright:{}})}};
 await withHostBrowserBridge({browser,socketPath:path.join(dir,'iab.sock'),allowedOrigins:['https://example.test'],pageAdapter:MockPage},async({socketPath})=>{
  const rpc=new BrokerBrowserAdapter(socketPath),args={pageUrl,action:{method:'fill',selector:'#field'},value:'synthetic'};
  const wire=await rawRequest(socketPath,args);assert.equal(wire.error,code);assert.deepEqual(wire.details,payload);
  await assert.rejects(rpc.request('act',args),error=>{assert.equal(error.message,code);assert.deepEqual(error.details,payload);return true;});
  payload={...details(),rawValue:secret,url:'https://private.invalid/'};
  const bad=await rawRequest(socketPath,args);assert.deepEqual(bad,{error:code});assert.equal(JSON.stringify(bad).includes(secret),false);
  await assert.rejects(rpc.request('act',args),error=>error.message===code&&error.details===undefined);
 });
}));
test('candidate-resolution eight-field diagnostics survive real IAB HTTP and RPC without widening other phases',()=>temp(async dir=>{
 const candidateCode='CHOICE_NOT_UNIQUE_OR_NOT_PRESENT';let payload={...details(),phase:'candidate_resolution',candidateCount:3,exactCandidateCount:1,visibleTargetCount:0};
 class MockPage{async act(){throw Object.assign(Error(candidateCode),{details:payload});}}
 const browser={tabs:{list:async()=>[{id:'tab',url:pageUrl}],get:async()=>({id:'tab',url:async()=>pageUrl,playwright:{}})}};
 await withHostBrowserBridge({browser,socketPath:path.join(dir,'counts.sock'),allowedOrigins:['https://example.test'],pageAdapter:MockPage},async({socketPath})=>{
  const rpc=new BrokerBrowserAdapter(socketPath),args={pageUrl,action:{method:'fill',selector:'#field'},value:'synthetic'};
  const wire=await rawRequest(socketPath,args);assert.equal(wire.error,candidateCode);assert.deepEqual(wire.details,payload);assert.equal(Object.keys(wire.details).length,8);
  await assert.rejects(rpc.request('act',args),error=>{assert.equal(error.message,candidateCode);assert.deepEqual(error.details,payload);return true;});
  const validCandidate={...payload};
  for(const invalid of [{...validCandidate,rawValue:secret},{...validCandidate,url:'https://private.invalid/'},{...validCandidate,visibleTargetCount:1001},{...validCandidate,phase:'after_blur'}]){
   payload=invalid;const rejected=await rawRequest(socketPath,args);assert.deepEqual(rejected,{error:candidateCode});assert.equal(JSON.stringify(rejected).includes(secret),false);
   await assert.rejects(rpc.request('act',args),error=>error.message===candidateCode&&error.details===undefined);
  }
 });
}));
test('RPC client independently rejects details from a nonconforming host',()=>temp(async dir=>{
 const socketPath=path.join(dir,'untrusted.sock'),server=http.createServer((req,res)=>{req.resume();res.end(JSON.stringify({error:code,details:{...details(),raw:secret}}));});
 await new Promise(resolve=>server.listen(socketPath,resolve));
 try{await assert.rejects(new BrokerBrowserAdapter(socketPath).request('act'),error=>error.message===code&&error.details===undefined);}
 finally{await new Promise(resolve=>server.close(resolve));await unlink(socketPath).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}));
test('actual CDP host HTTP catch preserves only allowlisted diagnostics without connecting a browser',()=>temp(async dir=>{
 const preload=path.join(dir,'mock.mjs'),socketPath=path.join(dir,'cdp.sock'),browserModule=new URL('../shared/browser.mjs',import.meta.url).href;
 await writeFile(preload,`import {BrowserAdapter} from ${JSON.stringify(browserModule)};\nBrowserAdapter.prototype.connect=async()=>{throw Error('MUST_NOT_CONNECT_BROWSER');};\nBrowserAdapter.prototype.existingPage=async()=>({act:async(action)=>{const error=Error(${JSON.stringify(code)});error.details=${JSON.stringify(details())};if(action.unsafe)error.details.raw=${JSON.stringify(secret)};throw error;}});\n`);
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,fileURLToPath(new URL('../shared/browser-host.mjs',import.meta.url)),socketPath],{stdio:['ignore','pipe','pipe'],env:{...process.env,RECRUITING_BROWSER_MODE:'managed',RECRUITING_BROWSER_PROFILE_DIR:path.join(dir,'synthetic-profile')}});
 let stdout='',stderr='';child.stderr.on('data',c=>{stderr+=c;});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SYNTHETIC_HOST_START_TIMEOUT '+stderr)),10000);child.stdout.on('data',c=>{stdout+=c;if(stdout.includes('browser_host_ready')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('SYNTHETIC_HOST_EXITED '+stderr));});});
  const rpc=new BrokerBrowserAdapter(socketPath);await assert.rejects(rpc.request('act',{pageUrl,action:{method:'fill'}}),error=>error.message===code&&JSON.stringify(error.details)===JSON.stringify(details()));
  const unsafe=await rawRequest(socketPath,{pageUrl,action:{method:'fill',unsafe:true}});assert.deepEqual(unsafe,{error:code});assert.equal(JSON.stringify(unsafe).includes(secret),false);
  await assert.rejects(rpc.request('act',{pageUrl,action:{method:'fill',unsafe:true}}),error=>error.message===code&&error.details===undefined);
 }finally{if(child.exitCode===null&&!child.signalCode){child.kill('SIGTERM');await once(child,'exit');}}
}));
function kernelFixture(payload){
 const field={id:'field',source:'school',label:'School',kind:'text',required:true,inventorySelectors:['#field'],inventoryLabel:'School',inventoryType:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#field',kind:'value'},actions:[{method:'fill',selector:'#field'}]},plan={pathPrefix:'/form',readySelector:'form',roleTitle:'Example Role',roleSelector:'h1',sections:[{title:'Details'}],sectionDiscovery:{selector:'section',titleSelector:'h2'},fields:[field]},template={id:'sample',version:1,evidence:{sourceUrl:pageUrl,observedAt:'synthetic'},pages:[plan]};
 let writes=0;const page={assertLocation:async()=>{},wait:async()=>{},inventory:async()=>[{selector:'#field',label:'School',tag:'input',type:'text',required:true,locatorStrategy:'semantic_question'}],observe:async()=>({pageUrl,roleTitle:'Example Role',fields:{field:{present:true,value:'before',errors:[]}}}),act:async()=>{writes++;throw failure(payload);}};
 const runs=[],store={put:async(group,id,value)=>runs.push(structuredClone(value)),get:async()=>template},company={id:'sample',origin:'https://example.test',templateId:'sample'},engine=new Engine({store,companies:[company],browser:{existingPage:async()=>page}});
 const job={task:{companyId:'sample',pageUrl,values:{school:'expected'}},company,template,prepared:{id:'prepared',planHash:'plan',files:{},pages:[{fields:[{...field,disposition:'fill',value:'expected'}]}]}};
 return {engine,job,runs,writes:()=>writes};
}
test('Engine failed control result retains safe phase details without changing errorCode or completion',async()=>{
 const f=kernelFixture(details()),result=await f.engine.runCompany(f.job,{});assert.equal(f.writes(),1);assert.equal(result.errorCode,code);assert.deepEqual(result.errorDetails,details());assert.equal(result.status,'needs_attention');assert.equal(result.submission,'not_performed');assert.equal(result.continuation.owner,'agent');
 const bad=kernelFixture({...details(),rawValue:secret}),blocked=await bad.engine.runCompany(bad.job,{});assert.equal(blocked.errorCode,code);assert.equal(blocked.errorDetails,undefined);assert.equal(JSON.stringify(blocked).includes(secret),false);
});
test('Engine probe failure persists and returns the same safe diagnostic schema',async()=>{
 const f=kernelFixture({...details(),phase:'independent_verify'});f.engine.withCompanyLease=async(company,run)=>run();f.engine.browser.existingPage=async()=>{throw failure({...details(),phase:'independent_verify'});};
 const r=await f.engine.probeCompany({companyId:'sample',pageUrl,templateHash:hash(f.job.template)},{probe:true,evidence:'synthetic construction authorization'});
 assert.equal(r.errorCode,code);assert.equal(r.errorDetails.phase,'independent_verify');assert.ok(f.runs.some(run=>run.errorDetails?.phase==='independent_verify'));assert.equal(r.status,'needs_attention');
});
