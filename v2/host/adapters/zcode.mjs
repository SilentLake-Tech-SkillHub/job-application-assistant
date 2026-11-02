// ZCode (Z.ai). The agent can use a browser and the plugin marketplace has browser automation;
// public docs do not say whether plugins or MCP servers can drive it.
export const adapter={
 id:'zcode',displayName:'ZCode',
 mcpConfig:{format:'json',project:'.zcode/config.json',serversPath:['mcp','servers'],entryExtras:{startupTimeoutSec:15,toolTimeoutSec:120}},
 browsers:{
  iab:{declared:true,exposure:'unverified',evidence:'agent browser use documented; plugin/MCP access not documented'}
 },
 vision:{sampling:'unverified',evidence:'not documented'}
};
