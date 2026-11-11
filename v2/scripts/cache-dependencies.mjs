// Explicit installation step for slow/external package volumes. No browser or
// personal data access. Normal MCP calls only follow the installed symlink.
import {readdir,readFile,mkdir,copyFile,lstat,readlink,symlink,realpath,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';import {homedir,platform} from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
const argv=process.argv.slice(2),get=k=>argv.includes(k)?argv[argv.indexOf(k)+1]:null;
const root=path.resolve(get('--package-root')||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const cache=path.resolve(get('--cache-root')||path.join(homedir(),platform()==='darwin'?'Library/Caches':'.cache','job-application-assistant-v2'));
const source=path.join(root,'node_modules'),target=path.join(cache,'node_modules');
const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));
const dependencyHash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(lock.packages).filter(([key])=>key)))).digest('hex');
if(!argv.includes('--apply')){console.log(JSON.stringify({source,target,dependencyHash,action:'cache_generated_dependencies'}));process.exit(0);}
await mkdir(cache,{recursive:true,mode:0o700});
if(await realpath(source)===await realpath(target).catch(()=>null)){console.log(JSON.stringify({status:'already_cached',target}));process.exit(0);}
const info=await lstat(source);if(info.isSymbolicLink())throw Error('APPLY_TO_INSTALLED_PACKAGE_ROOT');
const files=[],links=[];
async function collect(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await collect(file);else if(entry.isSymbolicLink())links.push(file);else if(entry.isFile())files.push(file);}}
await collect(source);let index=0;
await Promise.all(Array.from({length:8},async()=>{while(index<files.length){const file=files[index++],dest=path.join(target,path.relative(source,file));await mkdir(path.dirname(dest),{recursive:true});await copyFile(file,dest);const [a,b]=await Promise.all([readFile(file),readFile(dest)]);if(!a.equals(b))throw Error('DEPENDENCY_COPY_CHANGED');}}));
for(const file of links){const dest=path.join(target,path.relative(source,file));await mkdir(path.dirname(dest),{recursive:true});await rm(dest,{force:true});await symlink(await readlink(file),dest);}
await writeFile(path.join(cache,'dependency-lock.sha256'),dependencyHash+'\n',{mode:0o600});
await rm(source,{recursive:true});await symlink(target,source,'dir');
console.log(JSON.stringify({status:'cached_and_verified',files:files.length,target}));
