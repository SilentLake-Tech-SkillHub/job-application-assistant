// Google Antigravity. Evidence: a browser subagent runs in a separate Chrome profile with the
// Antigravity browser extension (not the user's daily Chrome); public docs describe it only as an
// agent capability. Treated as unverified until checked on the host.
export const adapter={
 id:'antigravity',displayName:'Gemini Antigravity',
 mcpConfig:{format:'json',project:'.agent/mcp_config.json',user:'~/.gemini/antigravity/mcp_config.json',serversPath:['mcpServers']},
 browsers:{
  iab:{declared:true,exposure:'unverified',evidence:'browser subagent in a separate Chrome profile; no plugin/MCP API found in public docs'}
 },
 vision:{sampling:'unverified',evidence:'not documented'}
};
