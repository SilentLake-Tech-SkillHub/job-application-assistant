// Host adapters answer one question: what can this executor host hand to the component?
// They never decide routing. Routing (dual / single channel, per-company assignment) stays in the
// component and reads only the capability file written from the adapter's answer.
//
// Adapter contract (host/adapters/<id>.mjs exports `adapter`):
//   id, displayName
//   mcpConfig: {format:'toml'|'json'|'yaml', project?:path relative to workspace, user?:'~/...', serversPath:[...keys], entryExtras?:{...}}
//   mcpConfig.shellRolePath?: string[] — native shell role key to update alongside both MCPs.
//   browsers: {iab:{declared:boolean, exposure:'code'|'agent_only'|'unverified', evidence:string}}
//             Only the host's built-in browser. The Chrome channel is the component's own dedicated
//             Chrome clone (shared/chrome-clone.mjs), identical on every host; extensions in the user's
//             daily Chrome are never part of the flow, so adapters do not describe them.
//   vision: {sampling:'supported'|'unsupported'|'unverified', evidence}
//   connect?: async (hostContext) => ({agent:{browsers:{list,get}}, fileUpload, screenshot})  only when some exposure is 'code'
export const HOST_IDS=['codex','claude-code','antigravity','kimi-code','zcode','dsh'];
export async function loadAdapter(id){
 if(!/^[a-z][a-z0-9-]{1,31}$/.test(id||''))throw Error('UNKNOWN_HOST_ADAPTER');
 if(!HOST_IDS.includes(id))return {
  id,displayName:id,mcpConfig:{format:'json',project:'.runtime/agent-mcp/'+id+'.json',serversPath:['mcpServers']},
  browsers:{iab:{declared:false,exposure:'unverified',evidence:'No installed adapter exposes this host browser.'}},
  vision:{sampling:'unverified',evidence:'No installed adapter exposes sampling.'}
 };
 const {adapter}=await import(new URL('./'+id+'.mjs',import.meta.url).href);
 validateAdapter(adapter,id);return adapter;
}
const EXPOSURES=['code','agent_only','unverified'];
export function validateAdapter(adapter,id=adapter?.id){
 if(!adapter||adapter.id!==id||typeof adapter.displayName!=='string')throw Error('HOST_ADAPTER_INVALID');
 if(!['toml','json','yaml'].includes(adapter.mcpConfig?.format)||!Array.isArray(adapter.mcpConfig.serversPath)||!adapter.mcpConfig.serversPath.length||!(adapter.mcpConfig.project||adapter.mcpConfig.user))throw Error('HOST_ADAPTER_MCP_CONFIG_INVALID');
 {if('chrome' in (adapter.browsers||{}))throw Error('HOST_ADAPTER_BROWSER_INVALID');const b=adapter.browsers?.iab;if(typeof b?.declared!=='boolean'||b.declared&&!EXPOSURES.includes(b.exposure)||typeof b.evidence!=='string')throw Error('HOST_ADAPTER_BROWSER_INVALID');}
 if(Object.values(adapter.browsers).some(b=>b.exposure==='code')&&typeof adapter.connect!=='function')throw Error('HOST_ADAPTER_CONNECT_REQUIRED');
 return true;
}
