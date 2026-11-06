import test from 'node:test';import assert from 'node:assert/strict';import {brokerErrorRecord} from '../shared/broker-diagnostics.mjs';import {BrowserAdapter} from '../shared/browser.mjs';
test('broker diagnostics retain frames and classification without raw exception content or values',()=>{const e=new Error('sensitive OTP 123456 or bearer token');const r=brokerErrorRecord(e,'operation_error','act'),s=JSON.stringify(r);assert.equal(r.code,'BROWSER_OPERATION_FAILED');assert.equal(s.includes('123456'),false);assert.equal(s.includes('bearer token'),false);assert.ok(r.stackFrames.length);});
test('read-only tab listing and existing-page lookup cannot launch a second managed browser',async()=>{let launches=0;const b=new BrowserAdapter('managed-chrome',{profileDir:'/tmp/synthetic-only',launcher:async()=>{launches++;throw Error('UNEXPECTED_LAUNCH');}});assert.deepEqual(await b.tabs(),[]);await assert.rejects(b.existingPage('https://example.test/form'),/EXISTING_BROWSER_SESSION_REQUIRED/);assert.equal(launches,0);});

test('native broker admits repeat discovery while keeping an unconnected browser untouched',{timeout:12000},async()=>{
 const {spawn}=await import('node:child_process');
 const {mkdtemp,rm}=await import('node:fs/promises');
 const http=await import('node:http');
 const dir=await mkdtemp('/tmp/repeat-rpc-'),socket=dir+'/b.sock';
 const child=spawn(process.execPath,['shared/browser-host.mjs',socket],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:'cdp',RECRUITING_CDP_URL:'http://127.0.0.1:9'},stdio:['ignore','pipe','pipe']});
 const request=(method,body)=>new Promise((resolve,reject)=>{
  const req=http.request({socketPath:socket,path:method==='GET'?'/health':'/rpc',method},res=>{
   let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>{try{resolve(JSON.parse(text));}catch(error){reject(error);}});
  });req.on('error',reject);req.end(body&&JSON.stringify(body));
 });
 try{
  await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('broker exited '+code)));});
  const result=await request('POST',{method:'repeatDiscovery',args:{pageUrl:'https://example.test/form',titles:['Education']}});
  assert.notEqual(result.error,'UNKNOWN_BROWSER_HOST_METHOD');
  assert.equal(result.error,'EXISTING_BROWSER_SESSION_REQUIRED');
  const health=await request('GET');
  assert.equal(health.connectionAttempts,0);
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
  await rm(dir,{recursive:true,force:true});
 }
});
