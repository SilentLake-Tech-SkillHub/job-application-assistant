import {AsyncLocalStorage} from 'node:async_hooks';
import {readFile,writeFile,mkdir,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
import {keyOK} from './ids.mjs';

const context=new AsyncLocalStorage();
export const withTaskRecords=(scope,fn)=>context.run(scope,fn);
export const taskRecordScope=()=>context.getStore()||{};
export function bindTaskRecordScope(taskId){const scope=context.getStore();if(!scope||!taskId)return;if(scope.taskId&&scope.taskId!==taskId)throw Error('TASK_RECORD_SCOPE_MISMATCH');scope.taskId=taskId;}
const durableAsset=/^(?:sealed-probe-|draft-probe-|capture-|form-structure-|form-visual-|form-coverage-|choices-|acquisition-|form-draft-|definition-|probe-|submission-proof-|submission-evidence-)/;
const read=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function write(file,value){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);}

// One physical file per task, with one current value per operation/field. The
// index contains references only; overwritten run IDs cannot read a newer run.
export class TaskRecords{
 constructor(root){this.root=root;this.index=path.join(root,'runs','task-record-index.json');}
 file(taskId){if(!keyOK(taskId))throw Error('INVALID_TASK_RECORD_KEY');return path.join(this.root,'runs','task-'+taskId+'.json');}
 async get(group,id){
  const index=await read(this.index,{entries:{}}),ref=index.entries?.[group+':'+id];if(!ref)return undefined;
  const task=await read(this.file(ref.taskId),null),record=task?.slots?.[ref.slot];
  if(!record||record.id!==id)throw Object.assign(Error('TASK_RECORD_SUPERSEDED'),{code:'ENOENT'});
  return record.value;
 }
 async put(group,id,value){
  // A company batch is shared across its tasks even when a company tool updates it.
  if(group==='runs'&&value.id===id&&typeof value.batchHash==='string'&&typeof value.queueId==='string'&&Array.isArray(value.companies))return false;
  const scope=context.getStore()||{},companyId=value.companyId||scope.companyId;
  const taskId=value.taskId||scope.taskId||(group==='runs'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(id)&&companyId?'company-'+companyId+'-'+(value.roleId||scope.roleId||'shared'):null);
  if(!taskId||!['runs','plans'].includes(group)||id.startsWith('batch-prepare-')||durableAsset.test(id)||value.operation==='internal_condition_probe')return false;
  if(!keyOK(taskId))throw Error('INVALID_TASK_RECORD_KEY');
  const operation=group==='plans'&&Number.isInteger(value.compilerVersion)?'execution_plan':value.operation||scope.tool||group;
  const identity=value.fieldId||value.selector||value.projectId||value.binding?.fieldId||(operation==='live_observation'?value.observation?.pageUrl:'')||'';
  const slot=JSON.stringify([group,operation,identity]);
  const release=await acquireLease(leasePath(defaultLeaseRoot(),'task-records:'+path.resolve(this.root)),{waitMs:30000,busyCode:'TASK_RECORD_BUSY'});
  try{
   const index=await read(this.index,{schemaVersion:1,entries:{}}),task=await read(this.file(taskId),{schemaVersion:1,taskId,slots:{}});
   const previous=task.slots[slot];if(previous)delete index.entries[group+':'+previous.id];
   task.slots[slot]={id,value};index.entries[group+':'+id]={taskId,slot};
   await write(this.file(taskId),task);await write(this.index,index);return true;
  }finally{await release();}
 }
 async clear(taskIds){
  const wanted=new Set(taskIds),release=await acquireLease(leasePath(defaultLeaseRoot(),'task-records:'+path.resolve(this.root)),{waitMs:30000,busyCode:'TASK_RECORD_BUSY'});
  try{
   const index=await read(this.index,{schemaVersion:1,entries:{}});
   for(const [id,ref] of Object.entries(index.entries))if(wanted.has(ref.taskId))delete index.entries[id];
   await write(this.index,index);
   for(const id of wanted)await unlink(this.file(id)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }finally{await release();}
 }
}
