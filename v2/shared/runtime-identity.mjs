import {readFile,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';
// Read only generic package code. Freeze at process startup so editing files
// cannot make an old resident worker advertise the new code as already loaded.
export async function genericSourceManifest(){
 const files=['package.json','package-lock.json'];
 for(const dir of ['shared','login','application','catalog'])for(const name of await readdir(new URL('../'+dir+'/',import.meta.url)))if(/\.(?:mjs|json)$/.test(name))files.push(dir+'/'+name);
 const digest=createHash('sha256');for(const file of files.sort())digest.update(file).update('\0').update(await readFile(new URL('../'+file,import.meta.url)));
 return {sourceFingerprint:digest.digest('hex'),fingerprintFileCount:files.length,fingerprintScope:'generic_code_dependencies_and_catalog'};
}
export async function runtimeIdentity(module){
 const manifest=await genericSourceManifest(),expected=process.env.RECRUITING_WORKER_SOURCE_SHA256;
 if(expected&&manifest.sourceFingerprint!==expected)throw Error('RUNTIME_SOURCE_CHANGED_DURING_STARTUP');
 return {module,processId:process.pid,nodeVersion:process.version,startedAt:new Date(Date.now()-process.uptime()*1000).toISOString(),...manifest,startupConsistency:expected?'launcher_checked':'direct_entry_snapshot'};
}
