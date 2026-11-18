import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createHostBrowserCliStage,runHostBrowserStage} from '../scripts/host-browser-bridge.mjs';

test('a component stage handles requests as they arrive and wakes immediately on completion',async()=>{
 const queue=[];let notified;
 const waiting=signal=>new Promise(resolve=>{
  const done=value=>{notified=null;signal.removeEventListener('abort',abort);resolve(value);};
  const abort=()=>done(false);
  if(queue.length)return done(true);
  if(signal.aborted)return abort();
  notified=()=>done(true);signal.addEventListener('abort',abort,{once:true});
 });
 const bridge={waitForRequest:waiting,pump:async()=>{const job=queue.shift();if(!job)return false;job();return true;}};
 const reply=await runHostBrowserStage(bridge,async()=>{
  for(let i=0;i<2;i++)await new Promise(resolve=>{queue.push(resolve);notified?.();});
  return {status:'ready'};
 });
 assert.equal(reply.result.status,'ready');
 assert.equal(reply.browserStage.requests,2);
 assert.equal(reply.browserStage.emptyWakeups,0);
});

test('the SDK awaits the fixed CLI receipt without spawning from the SDK context',async()=>{
 const stage=await createHostBrowserCliStage({test:true});
 const bridge={waitForRequest:signal=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve(false),{once:true})),pump:async()=>false};
 const cli=fileURLToPath(new URL('../scripts/cli.mjs',import.meta.url));
 try{
  const [child,reply]=await Promise.all([
   promisify(execFile)(process.execPath,[cli,'--stage-dir',stage.directory,'invalid_mode','testing',stage.inputFile]).catch(error=>error),
   stage.run(bridge,{signal:AbortSignal.timeout(10000)})
  ]);
  assert.equal(child.code,1);
  assert.deepEqual(reply.result,{exitCode:1,receipt:{error:'INVALID_CORE_MODE'}});
  assert.equal(reply.browserStage.emptyWakeups,0);
 }finally{await stage.dispose();}
});
