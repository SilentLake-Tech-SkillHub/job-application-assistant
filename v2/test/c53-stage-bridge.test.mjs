import test from 'node:test';
import assert from 'node:assert/strict';
import {runHostBrowserStage} from '../scripts/host-browser-bridge.mjs';

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
