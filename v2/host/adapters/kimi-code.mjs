// Kimi Code CLI. No built-in browser. (Kimi WebBridge drives the user's daily Chrome through an
// extension; extensions in the daily Chrome are not part of the application flow and are not recorded.)
export const adapter={
 id:'kimi-code',displayName:'Kimi Code',
 mcpConfig:{format:'json',project:'.kimi-code/mcp.json',user:'~/.kimi-code/mcp.json',serversPath:['mcpServers'],entryExtras:{startupTimeoutMs:15000,toolTimeoutMs:120000}},
 browsers:{
  iab:{declared:false,evidence:'no built-in browser'}
 },
 vision:{sampling:'unverified',evidence:'not documented'}
};
