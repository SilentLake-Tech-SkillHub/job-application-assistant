import {withHostBrowserBridge as withRealBridge} from '../../shared/host-browser-bridge.mjs';
// Test-only trusted host inventory and observed document-generation adapter.
// The production bridge still refuses callers supplying mode without inventory.
export async function withHostBrowserBridge(options,run){
 const browser={...options.browser,browserId:'test-host-iab',tabs:{...options.browser.tabs,get:async id=>{const tab=await options.browser.tabs.get(id),evaluate=tab.playwright?.evaluate;return {...tab,id,playwright:{...tab.playwright,evaluate:async(fn,...args)=>String(fn).includes('performance.timeOrigin')?{url:await tab.url(),generation:'test-document-'+id}:evaluate?.call(tab.playwright,fn,...args)}};}}};
 return withRealBridge({...options,browser,inventory:async()=>[{id:'test-host-iab',type:'iab',metadata:{codexSessionId:'test-host-session'}}]},run);
}
