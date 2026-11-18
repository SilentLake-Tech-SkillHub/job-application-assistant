import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {loadFallbackRegistry,fallbackRegistryFile} from './gui-fallback.mjs';
import {resolveHostExtension} from './host-extension.mjs';
import {loadAdapter} from '../host/adapters/registry.mjs';
export const browserPreferencesFile=env=>env.RECRUITING_BROWSER_PREFERENCES_FILE||path.join(env.RECRUITING_WORKSPACE_ROOT,'产品管理','浏览器设置.json');
export async function browserPreferences({action='status',choice,quote}={},env=process.env){
 const file=browserPreferencesFile(env);let data;
 try{data=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;data={schemaVersion:1,choice:null};}
 if(action==='set'){
  if(!['clone','main'].includes(choice)||!quote?.trim())throw Error('BROWSER_CHOICE_AND_USER_QUOTE_REQUIRED');
  data={schemaVersion:1,choice,userQuote:quote,updatedAt:new Date().toISOString()};
 }
 if(action==='set'||action==='initialize'){
  await mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2)+'\n',{mode:0o600});await rename(tmp,file);
 }
 if(!data.choice)return {status:'needs_browser_choice',choices:['clone','main'],continuation:{state:'user_input',owner:'user',requiresUser:true,shouldContinue:false,nextTools:['browser_preferences']}};
 if(data.choice==='main'){
  const registry=await loadFallbackRegistry(fallbackRegistryFile(env)),entry=registry?.agents.find(x=>x.hostId===env.RECRUITING_HOST_ID),allowed=entry?.['浏览器']?.includes('chrome_main_extension')===true;
  let extension=null;if(allowed&&entry.mainChromeExtension)extension=resolveHostExtension({registry,hostId:env.RECRUITING_HOST_ID,capability:(await loadAdapter(env.RECRUITING_HOST_ID)).mainChromeExtension});
  return {status:allowed?'agent_browser_required':'browser_not_registered',choice:'main',agent:entry?.agent||null,allowed,
   extension,extensionRegistrationRequired:allowed&&!extension,
   instruction:allowed?'使用登记的主用 Chrome 插件操作当前已确认岗位；保留用户页面；不使用组件 CDP 连接主用 Chrome，不提交。':'当前执行端未登记主用 Chrome 插件，请用户选择可用浏览器。',
   continuation:{state:allowed?'agent_fallback':'user_input',owner:allowed?'agent':'user',requiresUser:!allowed,shouldContinue:allowed,nextTools:[]}};
 }
 return {status:'browser_selected',choice:'clone'};
}
