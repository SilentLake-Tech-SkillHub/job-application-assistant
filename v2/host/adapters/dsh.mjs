// DeepSeek Harness (DSH). MCP servers are Cordis plugin entries in ~/.dsh/profiles/web/cordis.patch.yml
// (`- id: mcp-<server> / name: '@deepseek-ai/dsh-mcp-client' / config: {serverName, transport, command,
// args, cwd, env, toolCallTimeoutMs, failOnStartupError}`), read on 2026-11-01 (task X1).
// Built-in browser, X1 evidence: ctx.browserUse is only a provider registry (no list/get, no upload);
// the stagehand native runtime keeps its handle inside its own plugin, its launch mode starts a new
// Chromium, and it is not loaded in the current DSH config; cua-macos is desktop control without tabs.
// So DSH hands no built-in browser to components: Chrome (the clone) is its only channel.
export const adapter={
 id:'dsh',displayName:'DeepSeek Harness',
 mcpConfig:{format:'yaml',user:'~/.dsh/profiles/web/cordis.patch.yml',serversPath:['plugins'],yamlShape:'dsh_plugin_list',entryExtras:{toolCallTimeoutMs:120000,failOnStartupError:false}},
 browsers:{
  iab:{declared:false,evidence:'X1 2026-11-01: no agent.browsers list/get or upload for plugins; browser-use plugins not loaded; stagehand launch would start a new Chromium'}
 },
 vision:{sampling:'unverified',evidence:'host/dsh-vision-bridge.mjs uses the DSH llm service through a private socket'}
};
