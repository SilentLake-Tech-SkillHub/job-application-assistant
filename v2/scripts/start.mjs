import {serveRemoteMcp} from '../shared/mcp-proxy.mjs';
const mode=process.argv[2];if(!['login','application'].includes(mode))throw Error('SELECT_LOGIN_OR_APPLICATION_MCP');
await serveRemoteMcp(mode);
