import test from 'node:test';import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {parse} from 'yaml';
import {dshRuntimeEnvironment,installHost,RETIRED_ENV} from '../scripts/install-host.mjs';
const toml=`# keep me
[mcp_servers."recruiting-login-v2"]
command = "/old/node"
args = ["/old/start.mjs", "login"]
[mcp_servers."recruiting-login-v2".env]
RECRUITING_BROWSER_MODE = "managed"
RECRUITING_BROWSER_INITIALIZE = "0"
RECRUITING_EXTRA = "kept"

[mcp_servers."campus-search"]
command = "/py"
`;
test('every host gets the same capability file, clone profile and port; only host id and role differ; retired keys are dropped',async()=>{
 const ws=await mkdtemp(path.join(os.tmpdir(),'install-'));try{
  await mkdir(path.join(ws,'.codex'));await writeFile(path.join(ws,'.codex/config.toml'),toml);
  const c=await installHost({host:'codex',workspace:ws,role:'maintainer',node:'/n',component:'/c',uid:501,write:true});
  assert.equal(c.written,true);const text=await readFile(path.join(ws,'.codex/config.toml'),'utf8');
  assert.ok(text.startsWith('# keep me'));assert.ok(text.includes('[mcp_servers."campus-search"]'));assert.ok(text.includes('RECRUITING_EXTRA = "kept"'));
  for(const k of RETIRED_ENV)assert.equal(text.includes(k+' ='),false,k);
  assert.equal(text.match(/\[mcp_servers\."recruiting-login-v2"\]/g).length,1);assert.ok(text.includes('[mcp_servers."recruiting-application-v2".env]'));assert.ok(text.includes('RECRUITING_BROWSER_CDP_PORT = "9333"'));
  const z=await installHost({host:'zcode',workspace:ws,node:'/n',component:'/c',uid:501,write:true});
  const zc=JSON.parse(await readFile(path.join(ws,'.zcode/config.json'),'utf8')).mcp.servers['recruiting-application-v2'];
  assert.equal(zc.env.RECRUITING_HOST_ID,'zcode');assert.equal(zc.env.RECRUITING_HOST_ROLE,'executor');assert.equal(zc.startupTimeoutSec,15);
  for(const k of ['RECRUITING_BROWSER_CAPABILITY_FILE','RECRUITING_BROWSER_PROFILE_DIR','RECRUITING_BROWSER_CDP_PORT'])assert.equal(zc.env[k],c.env[k]);
  assert.equal((await installHost({host:'zcode',workspace:ws,node:'/n',component:'/c',uid:501,write:true})).written,false);
  const home=path.join(ws,'home'),cc=await installHost({host:'claude-code',workspace:ws,node:'/n',component:'/c',uid:501,home,write:false});assert.equal(cc.written,false);
  await assert.rejects(installHost({host:'kimi-code',workspace:ws,node:'/n',component:'/c',uid:501,home,scope:'user',write:true}),/SHA_REQUIRED/);
  const pre=await installHost({host:'kimi-code',workspace:ws,node:'/n',component:'/c',uid:501,home,scope:'user'});
  assert.equal((await installHost({host:'kimi-code',workspace:ws,node:'/n',component:'/c',uid:501,home,scope:'user',write:true,expectSha:pre.currentSha})).written,true);
  await assert.rejects(installHost({host:'dsh',workspace:ws,node:'/n',component:'/c',uid:501,home,scope:'project'}),/SCOPE_UNAVAILABLE/);
  const d=await installHost({host:'dsh',workspace:ws,node:'/n',component:'/c',uid:501,home,write:true});assert.equal(d.written,false);const [login]=parse(d.preview)[0].insert;assert.equal(login.id,'mcp-recruiting-login-v2');assert.equal(login.config.env.RECRUITING_HOST_ID,'dsh');assert.equal(login.config.failOnStartupError,false);assert.equal(login.config.cwd,ws);
 }finally{await rm(ws,{recursive:true,force:true});}
});
import {mergeToml,serverEntries,hostEnv} from '../scripts/install-host.mjs';
import {loadAdapter} from '../host/adapters/registry.mjs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tomlParses=text=>{try{return JSON.parse(execFileSync('python3',['-c','import sys,tomllib,json;print(json.dumps(tomllib.loads(sys.stdin.read())))'],{input:text}).toString());}catch(e){if(e.code==='ENOENT')return 'no-python';throw Error('TOML_PARSE_FAILED: '+String(e.stderr||e.message).slice(0,300));}};
test('Codex role changes keep shell and both MCPs consistent; reinstall preserves the chosen role',async()=>{
 const ws=await mkdtemp(path.join(os.tmpdir(),'host-role-install-'));
 try{
  const file=path.join(ws,'.codex/config.toml');await mkdir(path.dirname(file));
  const opts={host:'codex',workspace:ws,node:'/n',component:'/c',uid:501,write:true};
  const fresh=await installHost(opts);assert.equal(fresh.env.RECRUITING_HOST_ROLE,'executor');assert.equal(fresh.roleSource,'default');
  for(const shell of ['', 'model = "synthetic"\n', '[shell_environment_policy]\ninherit = "core"\n', '[shell_environment_policy]\nset = { OTHER = "a,b#c" }\n', '[shell_environment_policy.set]\nOTHER = "a,b#c"\n', 'shell_environment_policy.set.OTHER = "a,b#c"\n', '[shell_environment_policy]\nset = { OTHER = "a,b#c", RECRUITING_HOST_ROLE = "maintainer" } # preserve\n', "[shell_environment_policy.set]\nOTHER = 'a,b#c'\nRECRUITING_HOST_ROLE = 'maintainer'\n", '[shell_environment_policy]\nset.OTHER = "a,b#c"\nset.RECRUITING_HOST_ROLE = "maintainer"\n']){
   await writeFile(file,shell+toml);
   for(const role of ['maintainer','executor']){
    await installHost({...opts,role});const parsed=tomlParses(await readFile(file,'utf8'));
    assert.equal(parsed.shell_environment_policy.set.RECRUITING_HOST_ROLE,role);
    for(const name of ['recruiting-login-v2','recruiting-application-v2'])assert.equal(parsed.mcp_servers[name].env.RECRUITING_HOST_ROLE,role);
    if(shell.includes('OTHER'))assert.equal(parsed.shell_environment_policy.set.OTHER,'a,b#c');
    if(shell.includes('model ='))assert.equal(parsed.model,'synthetic');
    if(shell.includes('inherit ='))assert.equal(parsed.shell_environment_policy.inherit,'core');
    assert.equal((await installHost(opts)).env.RECRUITING_HOST_ROLE,role);
    assert.equal((await installHost(opts)).written,false);
   }
  }
  await installHost({...opts,role:'maintainer'});
  const out=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/install-host.mjs',import.meta.url)),'--host','codex','--workspace',ws,'--node','/n','--write'],{encoding:'utf8'}));
  assert.equal(out.env.RECRUITING_HOST_ROLE,'maintainer');
 }finally{await rm(ws,{recursive:true,force:true});}
});
test('existing YAML installation requires an explicit role and only previews that deployment choice',async()=>{
 const ws=await mkdtemp(path.join(os.tmpdir(),'host-role-yaml-'));
 try{
  const file=path.join(ws,'host.yml');await writeFile(file,'plugins:\n  - id: mcp-recruiting-login-v2\n    role: maintainer\n');
  const opts={host:'dsh',workspace:ws,configFile:file,write:true};
  await assert.rejects(installHost(opts),/YAML_EXISTING_HOST_ROLE_REQUIRED/);
  const r=await installHost({...opts,role:'maintainer'});assert.equal(r.written,false);assert.equal(r.shellEnvironment.RECRUITING_HOST_ROLE,'maintainer');
  assert.ok(r.preview.includes('RECRUITING_HOST_ROLE: "maintainer"'));
 }finally{await rm(ws,{recursive:true,force:true});}
});
test('conflicting existing roles require an explicit choice and never partially rewrite the file',async()=>{
 const ws=await mkdtemp(path.join(os.tmpdir(),'host-role-conflict-'));
 try{
  const opts={host:'codex',workspace:ws,node:'/n',component:'/c',write:true};await installHost({...opts,role:'executor'});
  const file=path.join(ws,'.codex/config.toml'),before=(await readFile(file,'utf8')).replace('RECRUITING_HOST_ROLE = "executor"','RECRUITING_HOST_ROLE = "maintainer"');await writeFile(file,before);
  await assert.rejects(installHost(opts),/HOST_ROLE_CONFIG_CONFLICT/);assert.equal(await readFile(file,'utf8'),before);
  await installHost({...opts,role:'maintainer'});assert.equal((await installHost(opts)).env.RECRUITING_HOST_ROLE,'maintainer');
  const jsonOpts={host:'zcode',workspace:ws,node:'/n',component:'/c',write:true};await installHost({...jsonOpts,role:'maintainer'});
  assert.equal((await installHost(jsonOpts)).env.RECRUITING_HOST_ROLE,'maintainer');
 }finally{await rm(ws,{recursive:true,force:true});}
});
test('every legal spelling of the server tables is replaced in place, never duplicated; the result parses as TOML',async()=>{
 const adapter=await loadAdapter('codex'),entries=serverEntries({adapter,env:hostEnv({host:'codex',workspace:'/w',role:'maintainer',uid:501}),node:'/n',component:'/c'});
 const spellings={
  bare:'[mcp_servers.recruiting-login-v2]\ncommand = "/old"\n[mcp_servers.recruiting-login-v2.env]\nRECRUITING_EXTRA = "kept"\nRECRUITING_BROWSER_MODE = "managed"\n',
  spaced:'[ mcp_servers . "recruiting-login-v2" ]\ncommand = "/old"\n[ mcp_servers . "recruiting-login-v2" . env ]\nRECRUITING_EXTRA = "kept"\n',
  literal:"[mcp_servers.'recruiting-login-v2']\ncommand = '/old'\n[mcp_servers.'recruiting-login-v2'.env]\nRECRUITING_EXTRA = 'kept'\n",
  inlineEnv:'[mcp_servers.recruiting-login-v2]\ncommand = "/old"\nenv = { RECRUITING_EXTRA = "kept", RECRUITING_BROWSER_INITIALIZE = "0" }\n',
  dottedEnv:'[mcp_servers.recruiting-login-v2]\ncommand = "/old"\nenv.RECRUITING_EXTRA = "kept"\n',
  split:'[mcp_servers.recruiting-login-v2]\ncommand = "/old"\n\n[other]\nx = 1\n\n[mcp_servers.recruiting-login-v2.env]\nRECRUITING_EXTRA = "kept"\n'
 };
 for(const [label,before] of Object.entries(spellings)){
  const text='# head\n[shell_environment_policy]\nset = { RECRUITING_HOST_ROLE = "maintainer" }\n\n'+before+'\n[mcp_servers.campus-search]\ncommand = "/py"\n',out=mergeToml(text,{serversPath:['mcp_servers'],entries});
  const parsed=tomlParses(out);if(parsed==='no-python')continue;
  const login=parsed.mcp_servers['recruiting-login-v2'];
  assert.equal(login.command,'/n',label);assert.equal(login.env.RECRUITING_EXTRA,'kept',label);assert.equal(login.env.RECRUITING_HOST_ID,'codex',label);
  assert.equal('RECRUITING_BROWSER_MODE' in login.env,false,label);assert.equal('RECRUITING_BROWSER_INITIALIZE' in login.env,false,label);
  assert.equal(parsed.mcp_servers['campus-search'].command,'/py',label);assert.equal(parsed.shell_environment_policy.set.RECRUITING_HOST_ROLE,'maintainer',label);assert.ok(parsed.mcp_servers['recruiting-application-v2'],label);
  if(label==='split')assert.equal(parsed.other.x,1);
  assert.equal(mergeToml(out,{serversPath:['mcp_servers'],entries}),out,label+' is idempotent');
 }
});
test('a server defined through dotted keys or an inline table in a parent table is refused instead of duplicated',async()=>{
 const adapter=await loadAdapter('codex'),entries=serverEntries({adapter,env:hostEnv({host:'codex',workspace:'/w',uid:501}),node:'/n',component:'/c'});
 for(const text of ['[mcp_servers]\nrecruiting-login-v2.command = "/old"\n','[mcp_servers]\n"recruiting-login-v2" = { command = "/old" }\n','mcp_servers.recruiting-login-v2.command = "/old"\n'])
  assert.throws(()=>mergeToml(text,{serversPath:['mcp_servers'],entries}),/TOML_SERVER_DEFINED_INLINE/);
 // An unrelated server in the same parent table is fine.
 const ok=mergeToml('[mcp_servers]\nother.command = "/x"\n',{serversPath:['mcp_servers'],entries});assert.ok(ok.includes('[mcp_servers."recruiting-login-v2"]'));
});

test('agent registration serializes allocation and keeps member identity across sessions',async()=>{
 const {registerAgent}=await import('../shared/agent-registry.mjs');
 const workspace=await mkdtemp(path.join(os.tmpdir(),'recruiting-agents-'));
 try{
  const first={workspace,host:'other-agent',instance:'member-one',mode:'multi_agent',group:'project-team'};
  const second={...first,instance:'member-two'};
  const agents=await Promise.all([registerAgent(first),registerAgent(second),registerAgent(first)]);
  assert.deepEqual(agents[0],agents[2]);
  assert.deepEqual(agents.slice(0,2).map(a=>a.id).sort(),['A0001','A0002']);
  assert.equal(agents[1].mode,'multi_agent');
  const configFile=path.join(workspace,'agent-mcp.json');
  const installed=await installHost({...first,agent:agents[0],configFile,write:true});
  assert.equal(installed.written,true);
  const conf=JSON.parse(await readFile(configFile,'utf8'));
  assert.equal(conf.mcpServers['recruiting-login-v2'].env.RECRUITING_AGENT_ID,agents[0].id);
  await assert.rejects(installHost({...second,agent:agents[1],configFile,write:true}),/AGENT_CONFIG_BOUND_TO_OTHER_INSTANCE/);
 }finally{await rm(workspace,{recursive:true,force:true});}
});

test('DSH writes an existing Cordis patch with the preview fingerprint and preserves other plugins and role',async()=>{
 const home=await mkdtemp(path.join(os.tmpdir(),'dsh-write-')),file=path.join(home,'cordis.patch.yml');
 const opts={host:'dsh',workspace:home,home,configFile:file,node:'/node',component:'/component'};
 const original=[{insert:[
  {id:'unrelated',name:'fixture',config:{preserve:['x','y']}},
  {id:'mcp-recruiting-login-v2',name:'@deepseek-ai/dsh-mcp-client',config:{serverName:'recruiting-login-v2',env:{RECRUITING_HOST_ROLE:'maintainer',OTHER:'kept'}}}
 ]}];
 try{
  await writeFile(file,JSON.stringify(original));
  const agent={id:'A0001',host:'dsh'},before=await installHost({...opts,agent});
  await assert.rejects(installHost({...opts,agent,write:true,expectSha:'stale'}),/SHA_REQUIRED/);
  const installed=await installHost({...opts,agent,write:true,expectSha:before.currentSha});
  assert.equal(installed.written,true);assert.equal(installed.roleSource,'existing');
  const plugins=parse(await readFile(file,'utf8')).flatMap(layer=>layer.insert);
  assert.deepEqual(plugins[0],original[0].insert[0]);
  assert.equal(plugins[1].config.env.OTHER,'kept');
  assert.deepEqual(plugins.slice(1).map(x=>x.config.env.RECRUITING_AGENT_ID),['A0001','A0001']);
  assert.deepEqual(plugins.slice(1).map(x=>x.config.env.RECRUITING_HOST_ROLE),['maintainer','maintainer']);
  assert.deepEqual(dshRuntimeEnvironment(await readFile(file,'utf8')),{RECRUITING_HOST_ID:'dsh',RECRUITING_HOST_ROLE:'maintainer',RECRUITING_AGENT_ID:'A0001'});
  const launch=fileURLToPath(new URL('../scripts/launch-dsh.mjs',import.meta.url));
  const env=JSON.parse(execFileSync(process.execPath,[launch,file,'--',process.execPath,'-e','console.log(JSON.stringify({role:process.env.RECRUITING_HOST_ROLE,id:process.env.RECRUITING_AGENT_ID,session:process.env.CODEX_THREAD_ID}))'],{env:{...process.env,RECRUITING_HOST_ROLE:'executor',CODEX_THREAD_ID:'parent'},encoding:'utf8'}));
  assert.deepEqual(env,{role:'maintainer',id:'A0001'});
  await assert.rejects(installHost({...opts,agent:{id:'A0002',host:'dsh'}}),/BOUND_TO_OTHER_INSTANCE/);
  assert.equal((await installHost({...opts,agent,write:true,expectSha:installed.newSha})).written,false);
 }finally{await rm(home,{recursive:true,force:true});}
});
