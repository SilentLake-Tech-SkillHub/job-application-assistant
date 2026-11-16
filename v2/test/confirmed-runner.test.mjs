import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm,readdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createConfirmedRunner} from '../shared/confirmed-runner.mjs';
test('independent runner pauses for login and stores references without duplicating business results',async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'runner-core-'));let login=false;const appCalls=[];
 const task={companyId:'C00001',roleId:'J000001',taskId:'synthetic-task',url:'https://example.test/apply'};
 const clients={login:{execute:async(name)=>name==='role_queue_import'?{queueId:'queue',queueHash:'hash',tasks:[task]}:name==='role_screenshot'?{path:'synthetic.png'}:login?{status:'ready_to_fill'}:{status:'needs_user_login',continuation:{requiresUser:true}}},application:{execute:async name=>{appCalls.push(name);return name==='role_prepare'?{status:'ready_for_user_review',fillRunId:'fill',verifyRunId:'verify',facts:{private:'not duplicated'}}:{id:'verify',status:'verified',fields:{private:'not duplicated'}};}}};
 try{const runner=await createConfirmedRunner({workspace:d,authorization:'Synthetic user authorization',clients});await runner.start();assert.equal(runner.status().stage,'waiting_for_user_login');login=true;await runner.resume();assert.equal(runner.status().stage,'ready_for_user_review');
 const dir=path.join(d,'.runtime/application/runs');assert.deepEqual(await readdir(dir),['confirmed-runner-current.json']);const saved=JSON.parse(await readFile(path.join(dir,'confirmed-runner-current.json')));assert.equal(saved.completedTasks[0].verifyRunId,'verify');assert.equal(JSON.stringify(saved).includes('not duplicated'),false);assert.equal(saved.currentTask.url,undefined);
 // C34（D4）：role_prepare 已含独立整表核验，不再紧跟 role_verify。
 assert.deepEqual(appCalls,['role_prepare']);
 }finally{await rm(d,{recursive:true,force:true});}
});
