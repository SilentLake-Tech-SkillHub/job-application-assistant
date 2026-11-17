export const adapter={
 id:'kimi-work',displayName:'Kimi Work',
 mainChromeExtension:{id:'kimi',name:'Kimi',transport:'webbridge'},
 mcpConfig:{format:'json',project:'.runtime/agent-mcp/kimi-work.json',serversPath:['mcpServers']},
 browsers:{iab:{declared:false,exposure:'agent_only',evidence:'Kimi Work extension uses its registered browser connection.'}},
 vision:{sampling:'unverified',evidence:'Actual host capability is checked at execution.'}
};
