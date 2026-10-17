import {BrokerBrowserAdapter} from './browser-rpc.mjs';
// An IAB assignment must never land in a Chrome tab with the same URL.
export class RoutedBrowserAdapter{
 constructor({chromeSocket,iabSocket,store,brokerFactory=s=>new BrokerBrowserAdapter(s)}){this.store=store;this.adapters={chrome:brokerFactory(chromeSocket),...(iabSocket?{iab:brokerFactory(iabSocket)}:{})};}
 async bindings(){try{return await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;return {};}}
 async channel(args={}){if(args.pageId?.startsWith('iab:'))return 'iab';if(args.pageId?.startsWith('chrome:'))return 'chrome';return args.pageUrl?(await this.bindings())[new URL(args.pageUrl).origin]?.channel||'chrome':'chrome';}
 async adapter(channel){const a=this.adapters[channel];if(!a)throw Error('IAB_HOST_BRIDGE_REQUIRED');if(channel==='iab'){const s=await a.status();if(s.mode!=='iab')throw Error('IAB_EXECUTOR_CHANNEL_MISMATCH');}return a;}
 async existingPage(pageUrl){const a=await this.adapter(await this.channel({pageUrl}));return a.existingPage(pageUrl);}
 async request(method,args={}){
  if(method==='status')return this.status();if(method==='tabs')return this.tabs(args.pageUrl||args.pageId?await this.channel(args):undefined);
  const channel=await this.channel(args),a=await this.adapter(channel);const clean={...args};if(clean.pageId?.startsWith(channel+':'))clean.pageId=clean.pageId.slice(channel.length+1);
  const result=await a.request(method,clean);return result?.pageId?{...result,pageId:channel+':'+result.pageId}:result;
 }
 async status(){const channels={};for(const ch of ['chrome','iab']){if(!this.adapters[ch]){channels[ch]={state:'host_bridge_required'};continue;}try{channels[ch]=await this.adapters[ch].status();}catch(e){channels[ch]={state:'unavailable',error:e.message};}}return {state:'channel_routed',channels};}
 async tabs(channel){const bindings=await this.bindings(),tabs=[];for(const ch of channel?[channel]:['chrome','iab']){if(!this.adapters[ch])continue;const a=await this.adapter(ch);for(const t of await a.tabs()){const expected=bindings[new URL(t.url).origin]?.channel;if(!expected||expected===ch)tabs.push({...t,browserChannel:ch});}}return tabs;}
}
