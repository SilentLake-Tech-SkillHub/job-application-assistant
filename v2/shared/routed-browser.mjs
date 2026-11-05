import {samePage} from './page-scope.mjs';
import {BrokerBrowserAdapter} from './browser-rpc.mjs';
import {executorCapability} from './browser-environment.mjs';
const recordedCapability=()=>{try{return JSON.parse(process.env.RECRUITING_BROWSER_CAPABILITY_JSON||'null');}catch{return null;}};
// URLs describe scope; an established page binding selects the executor.
export class RoutedBrowserAdapter{
 constructor({chromeSocket,iabSocket,store,brokerFactory=s=>new BrokerBrowserAdapter(s),capabilityReader=recordedCapability}){Object.assign(this,{store,capabilityReader});this.adapters={chrome:brokerFactory(chromeSocket),...(iabSocket?{iab:brokerFactory(iabSocket)}:{})};this.pages=new Map();}
 async bindings(){try{return await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;return {};}}
 async channel(args={}){if(args.pageId&&!/^(?:iab|chrome):.+/.test(args.pageId))throw Error('BROWSER_PAGE_CHANNEL_REQUIRED');if(args.pageId?.startsWith('iab:'))return 'iab';if(args.pageId?.startsWith('chrome:'))return 'chrome';if(args.pageUrl&&this.pages.has(args.pageUrl))return this.pages.get(args.pageUrl).channel;if(args.channel&&['iab','chrome'].includes(args.channel))return args.channel;if(args.pageUrl){const channel=(await this.bindings())[new URL(args.pageUrl).origin]?.channel;if(!channel)throw Error('BROWSER_CHANNEL_ASSIGNMENT_REQUIRED');return channel;}return 'chrome';}
 async adapter(channel){const a=this.adapters[channel];if(!a)throw Error('IAB_HOST_BRIDGE_REQUIRED');const s=await a.status();if(!executorCapability(s,channel).available)throw Error(channel==='iab'?'IAB_HOST_BRIDGE_REQUIRED':'BROWSER_EXECUTOR_IDENTITY_REQUIRED');return a;}
 async executionCapabilities(){const raw=await this.status(),channels=Object.fromEntries(['chrome','iab'].map(ch=>[ch,executorCapability(raw.channels[ch],ch)]));const recorded=this.capabilityReader();return {channels,capability:{status:recorded?.status||'not_configured',reason:recorded?.reason||null,channels:recorded?.entry?.channels||[],applicationChannels:recorded?.entry?.applicationChannels||recorded?.entry?.channels||[],searchChannels:recorded?.entry?.searchChannels||[],mode:recorded?.entry?.mode||null,detectedAt:recorded?.entry?.detectedAt||null,iab:recorded?.entry?.iab?.result||null,chrome:recorded?.entry?.chrome?.result||null,chromeVersion:recorded?.entry?.chrome?.version||null},browserExecuted:false};}
 async bindRolePage({taskId,companyId,pageId,pageUrl,sessionId}){if(!taskId||!pageUrl||!pageId)throw Error('VERIFIED_ROLE_PAGE_BINDING_REQUIRED');const channel=await this.channel({pageId}),a=await this.adapter(channel),status=await a.status(),localId=pageId.slice(channel.length+1);const identity=await a.request('pageIdentity',{pageId:localId});if(!samePage(identity.pageUrl,pageUrl))throw Error('ROLE_BOUND_PAGE_LOCATION_CHANGED');if(!identity.generation)throw Error('BROWSER_DOCUMENT_IDENTITY_REQUIRED');const binding={taskId,companyId,pageId:localId,pageUrl,sessionId:status.executor.sessionId,generation:identity.generation,kind:'verified_role'};this.pages.set(pageUrl,{channel,binding});return {...binding,pageId,provider:status.executor.provider};}
 async existingPage(pageUrl,{pageId,readOnly=false,roleBinding}={}){
  const channel=await this.channel({pageUrl,pageId}),a=await this.adapter(channel),status=await a.status();
  const observedPin=this.pages.get(pageUrl),localId=pageId?.slice(channel.length+1);
  // Explicit read-only inspection can observe a different original tab without
  // inheriting the current task's binding or changing that task's executor.
  const pinned=readOnly&&pageId&&!roleBinding&&(observedPin?.channel!==channel||observedPin?.binding.pageId!==localId)?null:observedPin;
  const rawBinding=roleBinding||pinned?.binding,binding=rawBinding?{...rawBinding,pageId:rawBinding.pageId?.startsWith(channel+':')?rawBinding.pageId.slice(channel.length+1):rawBinding.pageId}:null;
  if(binding&&localId&&binding.pageId!==localId)throw Error('ROLE_PAGE_BINDING_MISMATCH');
  const boundId=localId||pinned?.binding.pageId;
  const page=await a.existingPage(pageUrl,{...(boundId?{pageId:boundId}:{}),readOnly,roleBinding:binding});
  if(page.pageId){page.routedPageId=channel+':'+page.pageId;page.routedBinding=page.roleBinding?{...page.roleBinding,pageId:page.routedPageId}:null;}
  if(!observedPin&&!readOnly&&page.pageId&&page.roleBinding)this.pages.set(pageUrl,{channel,binding:page.roleBinding});return page;
 }

 async request(method,args={}){
  if(method==='status')return this.status();if(method==='tabs')return this.tabs(args.pageUrl||args.pageId?await this.channel(args):undefined);
  const channel=await this.channel(args),a=method==='initializeConfiguredChrome'||method==='restoreConfiguredChrome'&&args.authorization?.restore===true?this.adapters.chrome:await this.adapter(channel);if(!a)throw Error('BROWSER_HOST_NOT_AVAILABLE');const clean={...args};if(clean.pageId?.startsWith(channel+':'))clean.pageId=clean.pageId.slice(channel.length+1);if(clean.roleBinding?.pageId?.startsWith(channel+':'))clean.roleBinding={...clean.roleBinding,pageId:clean.roleBinding.pageId.slice(channel.length+1)};
  const result=await a.request(method,clean);
  if(method==='openPage'&&result?.pageId&&result.pageUrl){const s=await a.status(),identity=await a.request('pageIdentity',{pageId:result.pageId});this.pages.set(result.pageUrl,{channel,binding:{taskId:args.taskId||null,pageId:result.pageId,pageUrl:result.pageUrl,sessionId:s.executor.sessionId,generation:identity.generation,kind:'navigation'}});}
  return result?.pageId?{...result,pageId:channel+':'+result.pageId}:result;
 }
 async status(){const channels={};for(const ch of ['chrome','iab']){if(!this.adapters[ch]){channels[ch]={state:'host_bridge_required'};continue;}try{channels[ch]=await this.adapters[ch].status();}catch(e){channels[ch]={state:'unavailable',error:e.message};}}return {state:'channel_routed',channels};}
 async tabs(channel){const tabs=[];for(const ch of channel?[channel]:['chrome','iab']){if(!this.adapters[ch])continue;let a;try{a=await this.adapter(ch);}catch(error){if(channel)throw error;continue;}for(const t of await a.tabs())tabs.push({...t,browserChannel:ch});}return tabs;}
}
