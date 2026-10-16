import {appendFileSync,mkdirSync} from 'node:fs';import path from 'node:path';
export function brokerErrorRecord(error,event,method){
 const code=typeof error?.message==='string'&&/^[A-Z_]+$/.test(error.message)?error.message:'BROKER_RUNTIME_ERROR';
 return {at:new Date().toISOString(),pid:process.pid,event,...(method?{method}:{}),code,errorType:error?.name||'Error',stackFrames:String(error?.stack||'').split('\n').filter(s=>/^\s+at [^\n]+\([^)]+:\d+:\d+\)$/.test(s)).slice(0,6)};
}
export function installBrokerDiagnostics(file){
 mkdirSync(path.dirname(file),{recursive:true,mode:0o700});let degraded=false;
 const record=(event,error,method)=>{try{appendFileSync(file,JSON.stringify(brokerErrorRecord(error,event,method))+'\n',{mode:0o600});}catch{degraded=true;}};
 // Preserve Chrome and its unsaved pages, but fail closed for subsequent writes.
 const fatal=(event,error)=>{degraded=true;record(event,error);};
 process.on('unhandledRejection',error=>fatal('unhandled_rejection',error));process.on('uncaughtException',error=>fatal('uncaught_exception',error));
 return {record,isDegraded:()=>degraded};
}
