// Codex (app + CLI). Evidence (2026-11 public docs): the Codex app's in-app browser is driven by the
// model; no SDK for plugins or MCP servers.
export const adapter={
 id:'codex',displayName:'Codex',
 mcpConfig:{format:'toml',project:'.codex/config.toml',user:'~/.codex/config.toml',serversPath:['mcp_servers'],shellRolePath:['shell_environment_policy','set','RECRUITING_HOST_ROLE'],entryExtras:{startup_timeout_sec:15,tool_timeout_sec:120}},
 browsers:{
  iab:{declared:true,exposure:'agent_only',evidence:'Codex app in-app browser is a model tool; no plugin/MCP API documented'}
 },
 vision:{sampling:'unverified',evidence:'third-party client directory lists sampling; not verified on the host'}
};
