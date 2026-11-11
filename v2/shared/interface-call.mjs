import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
// This bridge only transports requests. Each request loads the installed
// dispatcher in its own process, so interface execution changes take effect.
export function interfaceCall(request,{env=process.env}={}){
 return new Promise((resolve,reject)=>{
  const child=fork(fileURLToPath(new URL('./interface-worker.mjs',import.meta.url)),[],{env,execArgv:[],stdio:['ignore','ignore','pipe','ipc']});
  let done=false;const timer=setTimeout(()=>{child.kill();finish(Error('INTERFACE_REQUEST_TIMEOUT'));},150000);
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
  child.once('error',error=>finish(error));child.once('exit',()=>finish(Error('INTERFACE_WORKER_EXITED')));
  child.once('message',message=>finish(null,message.result));child.send(request);
 });
}
