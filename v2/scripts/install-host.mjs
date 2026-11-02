#!/usr/bin/env node
// 为一个执行端生成两个投递 MCP（recruiting-login-v2 / recruiting-application-v2）的注册配置。
// 所有执行端写入同一组浏览器值：同一个能力文件、同一个 Chrome 分身资料目录和调试端口，只有 RECRUITING_HOST_ID
// 与 RECRUITING_HOST_ROLE 按执行端不同。配置格式与位置来自 host/adapters/<id>.mjs。
//   工作区内的配置（.codex/config.toml、.zcode/config.json 等）：--write 直接写入；
//   用户目录下的配置（~/.dsh/...、~/.claude.json 等）：默认只打印预览和当前文件 sha256；
//     --write --expect-sha <sha> 且文件未变才写入（yaml 只出预览，按适配器结构人工粘贴）。
// 用法：
//   node scripts/install-host.mjs --host <id> --workspace <工作区绝对路径> [--role executor|maintainer] [--scope project|user] [--node <node 路径>] [--write] [--expect-sha <sha>]
//   （适配器同时有工作区配置和用户配置时默认写工作区配置）
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import path from 'node:path';
import {loadAdapter} from '../host/adapters/registry.mjs';
import {DEFAULT_CDP_PORT} from '../shared/chrome-clone.mjs';
export const SERVER_NAMES={login:'recruiting-login-v2',application:'recruiting-application-v2'};
// Keys that no code reads any more, or that would override the capability file. Removed on install.
export const RETIRED_ENV=['RECRUITING_BROWSER_MODE','RECRUITING_BROWSER_INITIALIZE','RECRUITING_CDP_URL','RECRUITING_BROWSER_ATTACH_ENDPOINT','RECRUITING_LOGIN_COMPANY_DIR'];
const sha=text=>createHash('sha256').update(text).digest('hex');
export function hostEnv({host,workspace,role='executor',uid=process.getuid?.()??501,cdpPort=DEFAULT_CDP_PORT}){
 if(!path.isAbsolute(workspace))throw Error('WORKSPACE_ABSOLUTE_PATH_REQUIRED');
 if(!['executor','maintainer'].includes(role))throw Error('INVALID_HOST_ROLE');
 const w=p=>path.join(workspace,p),tmp=`/tmp/ja-v2-clean-${uid}`;
 return {RECRUITING_HOST_ID:host,RECRUITING_HOST_ROLE:role,
  RECRUITING_PROFILE_JSON:w('产品管理/网申个人信息主档.json'),RECRUITING_PRIVATE_DIR:w('.runtime/application'),RECRUITING_LOGIN_PRIVATE_DIR:w('.runtime/login'),
  RECRUITING_HANDOFF_DIR:w('岗位交接'),RECRUITING_ROLE_QUEUE_DIR:w('.runtime/role-queue'),
  RECRUITING_BROWSER_CAPABILITY_FILE:w('.runtime/browser-capability.json'),
  RECRUITING_BROWSER_PROFILE_DIR:w('.runtime/chrome-profile'),RECRUITING_BROWSER_CDP_PORT:String(cdpPort),
  RECRUITING_BROWSER_SOCKET:`${tmp}/b.sock`,RECRUITING_IAB_SOCKET:`${tmp}/iab.sock`,RECRUITING_VISION_SOCKET:`${tmp}/vision.sock`};
}
export function serverEntries({adapter,env,node,component}){
 const out={};for(const [mode,name] of Object.entries(SERVER_NAMES))out[name]={command:node,args:[path.join(component,'scripts/start.mjs'),mode],...(adapter.mcpConfig.entryExtras||{}),env:{...env}};
 return out;
}
const mergeEnv=(old={},env)=>{const kept=Object.fromEntries(Object.entries(old).filter(([k])=>!RETIRED_ENV.includes(k)&&!(k in env)));return {...kept,...env};};
export function mergeJson(text,{serversPath,entries}){
 const doc=text.trim()?JSON.parse(text):{};let node=doc;for(const k of serversPath)node=node[k]??=({});
 for(const [name,entry] of Object.entries(entries))node[name]={...entry,env:mergeEnv(node[name]?.env,entry.env)};
 return JSON.stringify(doc,null,2)+'\n';
}
// TOML keys may be bare (recruiting-login-v2), "basic" or 'literal', with spaces around dots.
// Tables are compared by their parsed key path, never by spelling.
function tomlKeyPath(text){
 const keys=[];let i=0;const t=text.trim();
 while(i<t.length){
  while(t[i]===' '||t[i]==='\t')i++;
  if(t[i]==='"'){let j=i+1,raw='';while(j<t.length&&t[j]!=='"'){if(t[j]==='\\'){raw+=t[j]+t[j+1];j+=2;continue;}raw+=t[j++];}if(j>=t.length)return null;keys.push(JSON.parse('"'+raw+'"'));i=j+1;}
  else if(t[i]==="'"){const j=t.indexOf("'",i+1);if(j<0)return null;keys.push(t.slice(i+1,j));i=j+1;}
  else{const m=t.slice(i).match(/^[A-Za-z0-9_-]+/);if(!m)return null;keys.push(m[0]);i+=m[0].length;}
  while(t[i]===' '||t[i]==='\t')i++;
  if(i>=t.length)break;if(t[i]!=='.')return null;i++;
 }
 return keys.length?keys:null;
}
const tomlHeader=line=>{const m=line.match(/^\s*\[(?!\[)\s*([^\]]+?)\s*\]\s*(?:#.*)?$/);return m?tomlKeyPath(m[1]):null;};
const tomlArrayHeader=line=>/^\s*\[\[/.test(line);
const sameKeys=(a,b)=>a.length===b.length&&a.every((k,i)=>k===b[i]);
const startsWithKeys=(a,prefix)=>a.length>=prefix.length&&prefix.every((k,i)=>a[i]===k);
const tomlString=v=>JSON.stringify(String(v));
const tomlValue=v=>Array.isArray(v)?'['+v.map(tomlString).join(', ')+']':typeof v==='number'||typeof v==='boolean'?String(v):tomlString(v);
const tomlTable=(table,obj)=>[`[${table}]`,...Object.entries(obj).filter(([k])=>k!=='env').map(([k,v])=>`${k} = ${tomlValue(v)}`),`[${table}.env]`,...Object.entries(obj.env).map(([k,v])=>`${k} = ${tomlValue(v)}`)].join('\n');
const tomlScalar=raw=>{const v=raw.trim();if(v.startsWith('"'))try{return JSON.parse(v.match(/^"(?:[^"\\]|\\.)*"/)[0]);}catch{return null;}if(v.startsWith("'"))return v.slice(1,v.indexOf("'",1));return null;};
// Read only the string-valued environment settings that this installer owns.
// Unknown inline syntax is refused before writing, rather than guessing a role.
const stringToken=/^(?:"(?:[^"\\]|\\.)*"|'[^']*')/;
function inlineStrings(raw){
 const values={};let i=raw.indexOf('{')+1;
 if(i!==1)throw Error('HOST_ENV_TOML_INLINE_UNSUPPORTED');
 while(i<raw.length){
  while(/\s/.test(raw[i]||'')&&i<raw.length)i++;
  if(raw[i]==='}')return {values,end:i};
  const match=raw.slice(i).match(/^((?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*'))\s*=\s*/);
  if(!match)throw Error('HOST_ENV_TOML_INLINE_UNSUPPORTED');
  const key=tomlKeyPath(match[1])[0];i+=match[0].length;
  const token=raw.slice(i).match(stringToken)?.[0];
  if(!token||Object.hasOwn(values,key))throw Error('HOST_ENV_TOML_INLINE_UNSUPPORTED');
  values[key]={value:tomlScalar(token),start:i,end:i+token.length};i+=token.length;
  while(/\s/.test(raw[i]||'')&&i<raw.length)i++;
  if(raw[i]==='}')return {values,end:i};
  if(raw[i++]!==',')throw Error('HOST_ENV_TOML_INLINE_UNSUPPORTED');
 }
 throw Error('HOST_ENV_TOML_INLINE_UNSUPPORTED');
}
function tomlSettings(text){
 const rows=[];let scope=[];
 for(const [index,line] of text.split('\n').entries()){
  const header=tomlHeader(line);if(header||tomlArrayHeader(line)){scope=header;continue;}
  const match=line.match(/^(\s*([^=#]+?)\s*=\s*)(.*)$/),keys=match&&tomlKeyPath(match[2]);
  if(scope&&keys)rows.push({index,path:[...scope,...keys],prefix:match[1],raw:match[3]});
 }
 return rows;
}
function tomlSettingValue(rows,target){
 const values=[];
 for(const row of rows){
  if(sameKeys(row.path,target))values.push(tomlScalar(row.raw));
  else if(sameKeys(row.path,target.slice(0,-1)))values.push(inlineStrings(row.raw).values[target.at(-1)]?.value);
 }
 return values.filter(v=>v!==undefined);
}
function existingRoles(text,cfg){
 const roleKey='RECRUITING_HOST_ROLE';
 if(cfg.format==='json'){
  let servers=text.trim()?JSON.parse(text):{};for(const key of cfg.serversPath)servers=servers?.[key];
  return Object.values(SERVER_NAMES).map(name=>servers?.[name]?.env?.[roleKey]).filter(v=>v!==undefined);
 }
 if(cfg.format==='yaml'){
  // YAML is preview-only. Do not reinterpret an existing host's plugin tree.
  if(Object.values(SERVER_NAMES).some(name=>text.includes(name)))throw Error('YAML_EXISTING_HOST_ROLE_REQUIRED: pass --role executor|maintainer for this deployment');
  return [];
 }
 const rows=tomlSettings(text),roles=Object.values(SERVER_NAMES).flatMap(name=>tomlSettingValue(rows,[...cfg.serversPath,name,'env',roleKey]));
 if(cfg.shellRolePath)roles.push(...tomlSettingValue(rows,cfg.shellRolePath));
 return roles;
}
function mergeShellRole(text,target,role){
 const lines=text.split('\n'),rows=tomlSettings(text),bindings=rows.filter(row=>sameKeys(row.path,target)||sameKeys(row.path,target.slice(0,-1)));
 if(bindings.length>1)throw Error('HOST_SHELL_ROLE_CONFIG_AMBIGUOUS');
 if(bindings.length){
  const row=bindings[0];let raw=row.raw;
  if(sameKeys(row.path,target)){
   const token=raw.match(stringToken)?.[0];if(!token)throw Error('HOST_SHELL_ROLE_CONFIG_INVALID');
   raw=JSON.stringify(role)+raw.slice(token.length);
  }else{
   const parsed=inlineStrings(raw),old=parsed.values[target.at(-1)];
   if(old)raw=raw.slice(0,old.start)+JSON.stringify(role)+raw.slice(old.end);
   else raw=raw.slice(0,parsed.end).trimEnd()+(Object.keys(parsed.values).length?', ':' ')+target.at(-1)+' = '+JSON.stringify(role)+' '+raw.slice(parsed.end);
  }
  lines[row.index]=row.prefix+raw;
 }else{
  // Prefer an existing table; otherwise add a separate table after root keys.
  let insert=-1,keys=target;
  for(const [index,line] of lines.entries()){
   const header=tomlHeader(line);
   if(header&&header.length<target.length&&startsWithKeys(target,header)&&header.length>target.length-keys.length){insert=index+1;keys=target.slice(header.length);}
  }
  if(rows.some(row=>row.path.length<target.length-1&&startsWithKeys(target,row.path)))throw Error('HOST_SHELL_ROLE_CONFIG_UNSUPPORTED');
  if(insert<0){
   insert=lines.findIndex(line=>tomlHeader(line)||tomlArrayHeader(line));if(insert<0)insert=lines.length;
   if(rows.some(row=>startsWithKeys(row.path,target.slice(0,-1))))lines.splice(insert,0,target.join('.')+' = '+JSON.stringify(role));
   else lines.splice(insert,0,'['+target.slice(0,-1).join('.')+']',target.at(-1)+' = '+JSON.stringify(role),'');
  }
  else lines.splice(insert,0,keys.join('.')+' = '+JSON.stringify(role));
 }
 return lines.join('\n');
}
// Replace each server's table and all its subtables (.env) as one block, wherever and however they are
// spelled; everything else in the file stays. A server defined through dotted keys or inline tables in
// a parent table is not rewritten (that would duplicate it): the script stops instead.
export function mergeToml(text,{serversPath,entries}){
 let lines=text.split('\n');
 for(const [name,entry] of Object.entries(entries)){
  const target=[...serversPath,name],envPath=[...target,'env'];
  const blocks=[];let current=null,scope=[];
  lines.forEach((line,index)=>{
   const keys=tomlHeader(line);
   if(keys||tomlArrayHeader(line)){
    if(current){current.end=index;current=null;}
    scope=keys;  // null inside an array table: its keys never define this server
    if(keys&&startsWithKeys(keys,target)){current={start:index,keys};blocks.push(current);}
    return;
   }
   // Outside the server's own tables: a dotted key or inline table that reaches this server would be
   // a second definition next to the table this script writes.
   if(current||!scope)return;
   const lhs=line.match(/^\s*([^=#\[]+?)\s*=/),k=lhs&&tomlKeyPath(lhs[1]);
   if(k&&startsWithKeys([...scope,...k],target.slice(0,scope.length+k.length))&&scope.length+k.length>=target.length)throw Error('TOML_SERVER_DEFINED_INLINE_EDIT_BY_HAND');
  });
  if(current)current.end??=lines.length;
  const oldEnv={};
  for(const b of blocks){const isEnv=sameKeys(b.keys,envPath),isMain=sameKeys(b.keys,target);
   for(const line of lines.slice(b.start+1,b.end)){const m=line.match(/^\s*([^=#]+?)\s*=\s*(.+?)\s*$/);if(!m)continue;const k=tomlKeyPath(m[1]);if(!k)continue;
    if(isEnv&&k.length===1){const v=tomlScalar(m[2]);if(v!==null)oldEnv[k[0]]=v;}
    else if(isMain&&k.length===2&&k[0]==='env'){const v=tomlScalar(m[2]);if(v!==null)oldEnv[k[1]]=v;}
    else if(isMain&&k.length===1&&k[0]==='env'&&m[2].startsWith('{'))for(const pair of m[2].replace(/^\{|\}$/g,'').split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)){const pm=pair.match(/^\s*([^=]+?)\s*=\s*(.+?)\s*$/);if(pm){const pk=tomlKeyPath(pm[1]),pv=tomlScalar(pm[2]);if(pk?.length===1&&pv!==null)oldEnv[pk[0]]=pv;}}
   }}
  const table=[...serversPath.map(k=>/^[A-Za-z0-9_-]+$/.test(k)?k:JSON.stringify(k)),JSON.stringify(name)].join('.');
  const block=tomlTable(table,{...entry,env:mergeEnv(oldEnv,entry.env)}).split('\n');
  if(blocks.length){
   const first=blocks[0].start;let insertAt=first;
   for(const b of [...blocks].reverse()){let end=b.end;while(end>b.start+1&&!lines[end-1].trim())end--;lines.splice(b.start,end-b.start);if(b.start<first)insertAt-=end-b.start;}
   lines.splice(insertAt,0,...block);
  }else{while(lines.length&&!lines.at(-1).trim())lines.pop();lines.push('',...block,'');}
 }
 const out=lines.join('\n').replace(/\n{3,}/g,'\n\n').replace(/\n*$/,'\n');
 // Never hand back a file a TOML parser would reject for duplicate tables.
 const seen=new Set();for(const line of out.split('\n')){const k=tomlHeader(line);if(!k)continue;const id=JSON.stringify(k);if(seen.has(id))throw Error('TOML_DUPLICATE_TABLE');seen.add(id);}
 return out;
}
// DSH: one Cordis plugin entry per server, indented as list items of the existing plugin list.
function dshPluginEntries({entries,workspace}){
 const q=v=>JSON.stringify(String(v)),lines=[];
 for(const [name,e] of Object.entries(entries)){
  lines.push(`    - id: mcp-${name}`,`      name: '@deepseek-ai/dsh-mcp-client'`,`      config:`,`        serverName: ${name}`,`        transport: stdio`,`        command: ${e.command}`,`        args:`,...e.args.map(a=>`          - ${a}`),`        cwd: ${workspace}`,`        env:`);
  for(const [k,v] of Object.entries(e.env))lines.push(`          ${k}: ${q(v)}`);
  for(const k of ['toolCallTimeoutMs','failOnStartupError'])if(k in e)lines.push(`        ${k}: ${e[k]}`);
 }
 return lines.join('\n')+'\n';
}
export function yamlPreview({serversPath,entries}){
 const ind=n=>' '.repeat(n),q=v=>JSON.stringify(String(v)),lines=[];
 serversPath.forEach((k,i)=>lines.push(ind(i*2)+k+':'));const base=serversPath.length*2;
 for(const [name,e] of Object.entries(entries)){lines.push(ind(base)+name+':',ind(base+2)+'command: '+q(e.command),ind(base+2)+'args: ['+e.args.map(q).join(', ')+']',ind(base+2)+'env:');for(const [k,v] of Object.entries(e.env))lines.push(ind(base+4)+k+': '+q(v));}
 return lines.join('\n')+'\n';
}
export async function installHost({host,workspace,role,node=process.execPath,component=path.resolve(fileURLToPath(new URL('..',import.meta.url))),write=false,expectSha=null,home=homedir(),uid,scope,configFile}){
 const adapter=await loadAdapter(host),cfg=adapter.mcpConfig;
 if(scope&&!['project','user'].includes(scope)||scope==='project'&&!cfg.project||scope==='user'&&!cfg.user)throw Error('HOST_CONFIG_SCOPE_UNAVAILABLE');
 const inWorkspace=scope?scope==='project':!!cfg.project,target=configFile||(inWorkspace?path.join(workspace,cfg.project):path.join(home,cfg.user.replace(/^~\//,'')));
 const current=await readFile(target,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;}),currentSha=sha(current);
 const oldRoles=role===undefined?existingRoles(current,cfg):[];
 if(oldRoles.some(value=>!['executor','maintainer'].includes(value))||new Set(oldRoles).size>1)throw Error('HOST_ROLE_CONFIG_CONFLICT: choose --role executor|maintainer explicitly');
 const roleSource=role!==undefined?'explicit':oldRoles.length?'existing':'default';
 const env=hostEnv({host,workspace,role:role??oldRoles[0]??'executor',...(uid!==undefined?{uid}:{})}),entries=serverEntries({adapter,env,node,component});
 const shellEnvironment={RECRUITING_HOST_ROLE:env.RECRUITING_HOST_ROLE};
 if(cfg.format==='yaml')return {host,target,format:'yaml',written:false,currentSha,roleSource,shellEnvironment,preview:cfg.yamlShape==='dsh_plugin_list'?dshPluginEntries({entries,workspace}):yamlPreview({serversPath:cfg.serversPath,entries}),note:'paste under the existing structure by hand; YAML files are never rewritten by this script; set the same role in the host Hook/shell environment'};
 let next=cfg.format==='json'?mergeJson(current,{serversPath:cfg.serversPath,entries}):mergeToml(current,{serversPath:cfg.serversPath,entries});
 if(cfg.shellRolePath)next=mergeShellRole(next,cfg.shellRolePath,env.RECRUITING_HOST_ROLE);
 const result={host,target,format:cfg.format,inWorkspace,currentSha,changed:next!==current,env,roleSource,shellEnvironment,shellEnvironmentManaged:!!cfg.shellRolePath};
 if(!write)return {...result,written:false,preview:next};
 if(!inWorkspace&&expectSha!==currentSha)throw Error('USER_CONFIG_CHANGED_OR_SHA_REQUIRED');
 if(next===current)return {...result,written:false};
 await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,next);await rename(temp,target);
 return {...result,written:true,newSha:sha(next)};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const args=process.argv.slice(2),flag=n=>{const i=args.indexOf('--'+n);return i>=0?args[i+1]:undefined;};
 try{const r=await installHost({host:flag('host'),workspace:flag('workspace'),role:flag('role'),...(flag('node')?{node:flag('node')}:{}),write:args.includes('--write'),expectSha:flag('expect-sha')||null,...(flag('scope')?{scope:flag('scope')}:{})});
  const {preview,...rest}=r;console.log(JSON.stringify(rest,null,1));if(preview)console.log('\n--- preview ---\n'+preview);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
