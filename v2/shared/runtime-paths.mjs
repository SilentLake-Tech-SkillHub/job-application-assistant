import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function resolveRuntimePaths({workspace,env=process.env}={}){
 const root=workspace||env.RECRUITING_WORKSPACE_ROOT||(env.RECRUITING_HANDOFF_DIR?path.dirname(env.RECRUITING_HANDOFF_DIR):null);
 if(!root||!path.isAbsolute(root))throw Error('WORKSPACE_ROOT_REQUIRED');
 const w=path.resolve(root),privateRoot=path.join(w,'.runtime');
 const paths={workspace:w,handoff:env.RECRUITING_HANDOFF_DIR||path.join(w,'岗位交接'),profile:env.RECRUITING_PROFILE_JSON||path.join(w,'产品管理','网申个人信息主档.json'),application:env.RECRUITING_PRIVATE_DIR||path.join(privateRoot,'application'),login:env.RECRUITING_LOGIN_PRIVATE_DIR||path.join(privateRoot,'login'),queue:env.RECRUITING_ROLE_QUEUE_DIR||path.join(privateRoot,'role-queue'),capability:env.RECRUITING_BROWSER_CAPABILITY_FILE||path.join(privateRoot,'browser-capability.json')};
 const packageRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 for(const [key,value]of Object.entries(paths)){if(!path.isAbsolute(value))throw Error('ABSOLUTE_RUNTIME_PATH_REQUIRED');paths[key]=path.resolve(value);if(key!=='workspace'&&(paths[key]===packageRoot||paths[key].startsWith(packageRoot+path.sep)))throw Error('USER_DATA_OUTSIDE_COMPONENT_REQUIRED');}
 return paths;
}
export function configurePaths(options={}){
 const p=resolveRuntimePaths(options),env=options.env||process.env;
 Object.assign(env,{RECRUITING_WORKSPACE_ROOT:p.workspace,RECRUITING_HANDOFF_DIR:p.handoff,RECRUITING_PROFILE_JSON:p.profile,RECRUITING_PRIVATE_DIR:p.application,RECRUITING_LOGIN_PRIVATE_DIR:p.login,RECRUITING_ROLE_QUEUE_DIR:p.queue,RECRUITING_BROWSER_CAPABILITY_FILE:p.capability});
 return p;
}
