// Claude Code. Evidence: the desktop app browser pane is a model tool (no plugin/MCP API). MCP sampling is not supported (anthropics/claude-code#1785 open).
export const adapter={
 id:'claude-code',displayName:'Claude Code',
 mcpConfig:{format:'json',project:'.mcp.json',user:'~/.claude.json',serversPath:['mcpServers']},
 browsers:{
  iab:{declared:true,exposure:'agent_only',evidence:'desktop app browser pane tools are model tools'}
 },
 vision:{sampling:'unsupported',evidence:'session does not support sampling (issue #1785)'}
};
