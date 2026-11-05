import {recordOutcome} from '../shared/stop-loss.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {browserErrorCode,retryBrowserOperation,sanitizeBrowserMessage} from '../shared/browser-errors.mjs';
import http from 'node:http';import {writeFile,mkdir} from 'node:fs/promises';
import {BrowserAdapter} from '../shared/browser.mjs';
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {READY_TIMEOUT_MS} from '../shared/entry-recipe.mjs';
test('transport deadline covers the bounded navigation retry budget so it cannot mask the final operation error',()=>{
 const rpc=new BrokerBrowserAdapter('/tmp/synthetic-unused.sock');assert.ok(rpc.requestTimeoutMs>3*READY_TIMEOUT_MS+1000);assert.ok(rpc.requestTimeoutMs<120000);
});
test('browser errors retain categories and diagnostics remove personal values',()=>{
 assert.equal(browserErrorCode(Object.assign(Error('timeout'),{name:'TimeoutError'})),'BROWSER_OPERATION_TIMEOUT');
 assert.equal(browserErrorCode(Error('Target page, context or browser has been closed')),'BROWSER_PAGE_CLOSED');
 assert.equal(browserErrorCode(Error('Navigation interrupted by another navigation')),'BROWSER_NAVIGATION_INTERRUPTED');
 assert.equal(browserErrorCode(Error('ECONNRESET')),'BROWSER_CONNECTION_LOST');
 assert.equal(browserErrorCode(Error('element not found')),'BROWSER_ELEMENT_NOT_FOUND');
 const text=sanitizeBrowserMessage('fill("SENSITIVE_NAME") id=123456789012345678 email=a@b.com https://x/form?userId=123');
 for(const value of ['SENSITIVE_NAME','123456789012345678','a@b.com','userId=123'])assert.equal(text.includes(value),false);
});
test('read-only browser fingerprint contains no captured content and cannot write or launch',async()=>{
 const b=new BrowserAdapter('http://127.0.0.1:9223');let evaluations=0;
 b.pageIds.set('bound',{isClosed:()=>false,url:()=> 'https://example.test/form',evaluate:async()=>{evaluations++;return {title:'SYNTHETIC-PRIVATE-NAME',controls:[]};}});
 const snapshot=await b.failureSnapshot({pageId:'bound'});assert.match(snapshot.fingerprint,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(snapshot).includes('SYNTHETIC-PRIVATE-NAME'),false);assert.equal(evaluations,1);assert.equal(b.connectionAttempts,0);
});
test('lost broker tracking observes only the same native target and never aliases another same-URL page',async()=>{
 const b=new BrowserAdapter('managed-chrome'),url='https://example.test/form';let observations=0;
 const page=id=>({url:()=>url,isClosed:()=>false,evaluate:async()=>{assert.equal(id,'old');observations++;return {ready:'complete',controls:[]};},goto:async()=>{throw Error('MUST_NOT_NAVIGATE');},context:()=>({newCDPSession:async()=>({send:async()=>({targetInfo:{targetId:id}}),detach:async()=>{}})})});
 const original=page('old');b.connection={contexts:()=>[{pages:()=>[original]}]};
 const recovered=await b.failureSnapshot({pageId:'old',knownUrls:[url]});assert.match(recovered.fingerprint,/^[a-f0-9]{64}$/);assert.equal(b.pageIds.get('old'),original);assert.equal(observations,1);
 b.pageIds.clear();b.connection={contexts:()=>[{pages:()=>[]}]};const missing=await b.failureSnapshot({pageId:'old',knownUrls:[url]});assert.notEqual(missing.fingerprint,recovered.fingerprint);
 b.connection={contexts:()=>[{pages:()=>[page('replacement')]}]};const different=await b.failureSnapshot({pageId:'old',knownUrls:[url]});assert.equal(different.fingerprint,missing.fingerprint);assert.equal(b.pageIds.has('old'),false);assert.deepEqual([...b.pageIds.keys()],['replacement']);assert.equal(observations,1);assert.equal(b.connectionAttempts,0);
});
test('failure observation never attaches a daily Chrome profile',async()=>{
 let connections=0;const b=new BrowserAdapter('http://127.0.0.1:9223',{profileDir:path.join(os.homedir(),'Library/Application Support/Google/Chrome'),endpointProbe:async()=>true,connector:async()=>{connections++;}});
 await assert.rejects(b.failureSnapshot({pageId:'missing',knownUrls:[]}),/PRIVATE_AUTOMATION_PROFILE_REQUIRED/);assert.equal(connections,0);
});
test('transient failures do not accumulate and bounded backoff recovers without repeating irreversible operations',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'transient-'));try{
 const options={env:{RECRUITING_PRIVATE_DIR:dir},args:{taskId:'task'},tool:'role_open',phase:'login',result:{error:'BROWSER_OPERATION_TIMEOUT',continuation:{owner:'agent'}}};
 for(let i=0;i<4;i++)assert.equal((await recordOutcome(options)).repeatedFailure,undefined);
 let calls=0;const delays=[];
 const result=await retryBrowserOperation(async()=>{if(++calls<3)throw Object.assign(Error('operation timed out'),{name:'TimeoutError'});return 'ok';},{retrySafe:true,sleep:async ms=>delays.push(ms)});
 assert.equal(result,'ok');assert.equal(calls,3);assert.deepEqual(delays,[250,750]);
 calls=0;await assert.rejects(retryBrowserOperation(async()=>{calls++;throw Object.assign(Error('timeout'),{name:'TimeoutError'});},{retrySafe:false}));assert.equal(calls,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
