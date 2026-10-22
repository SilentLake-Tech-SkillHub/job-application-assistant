import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {withHostBrowserBridge} from '../shared/host-browser-bridge.mjs';
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {RoutedBrowserAdapter} from '../shared/routed-browser.mjs';
import {BrowserAdapter} from '../shared/browser.mjs';

test('explicit IAB capture selects one original tab among duplicate URLs and cannot mutate',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'readonly-page-'));
 const url='https://forms.example/resume/edit';let writes=0;
 const meta=[{id:'one',url},{id:'two',url}];
 const tabs=Object.fromEntries(meta.map(m=>[m.id,{id:m.id,url:async()=>m.url,playwright:{evaluate:async()=>m.id,locator:()=>({})}}]));
 class ReadAdapter{
  constructor(page){this.page=page;}
  inventory(){return this.page.evaluate();}
  observe(){return this.page.evaluate();}
  act(){writes++;}
  ensureGroups(){writes++;}
 }
 try{await withHostBrowserBridge({browser:{tabs:{list:async()=>meta,get:async id=>tabs[id]}},socketPath:path.join(dir,'b.sock'),allowedOrigins:['https://forms.example'],pageAdapter:ReadAdapter},async({socketPath})=>{
  const broker=new BrokerBrowserAdapter(socketPath);
  await assert.rejects(broker.existingPage(url),/AMBIGUOUS_PAGE/);
  await assert.rejects(broker.existingPage(url,{pageId:'one'}),/EXPLICIT_PAGE_REQUIRES_READ_ONLY/);
  const page=await broker.existingPage(url,{pageId:'one',readOnly:true});
  assert.equal(await page.inventory({}), 'one');assert.equal(await page.observe({}), 'one');
  await assert.rejects(page.act({method:'fill',selector:'input'},'value',{}),/READ_ONLY_PAGE_MUTATION_FORBIDDEN/);
  await assert.rejects(page.ensureGroups([]),/READ_ONLY_PAGE_MUTATION_FORBIDDEN/);
  for(const method of ['act','ensureGroups'])await assert.rejects(broker.request(method,{pageUrl:url,pageId:'one',readOnly:true,action:{method:'fill'}}),/READ_ONLY_PAGE_MUTATION_FORBIDDEN/);
  meta[0].url='https://forms.example/other';
  await assert.rejects(page.observe({}),/EXPLICIT_PAGE_URL_MISMATCH/);
  await assert.rejects(broker.existingPage(url,{pageId:'missing',readOnly:true}),/EXISTING_PAGE_NOT_FOUND/);
  assert.equal(writes,0);assert.equal(meta.length,2);
 });}finally{await rm(dir,{recursive:true,force:true});}
});

test('read-only page IDs must match the URL assignment channel before reaching a broker',async()=>{
 const calls=[];const b=new RoutedBrowserAdapter({chromeSocket:'chrome',iabSocket:'iab',store:{get:async()=>({'https://forms.example':{channel:'iab'}})},brokerFactory:s=>({status:async()=>({mode:s}),existingPage:async(...args)=>{calls.push({s,args});return 'selected';}})});
 const url='https://forms.example/resume/edit';
 for(const pageId of ['chrome:one','one'])await assert.rejects(b.existingPage(url,{pageId,readOnly:true}),/BROWSER_PAGE_CHANNEL_MISMATCH/);
 await assert.rejects(b.existingPage(url,{pageId:'iab:one'}),/EXPLICIT_PAGE_REQUIRES_READ_ONLY/);
 assert.equal(calls.length,0);assert.equal(await b.existingPage(url,{pageId:'iab:one',readOnly:true}),'selected');
 assert.deepEqual(calls,[{s:'iab',args:[url,{pageId:'one',readOnly:true}]}]);
});

test('Chrome explicit read-only capture uses its tracked original page and checks the full URL',async()=>{
 const url='https://forms.example/resume/edit',page={url:()=>url,isClosed:()=>false};
 const b=new BrowserAdapter('managed-chrome');b.state='connected';b.connection={};b.pageIds.set('one',page);
 assert.equal((await b.existingPage(url,{pageId:'one',readOnly:true})).page,page);
 await assert.rejects(b.existingPage(url+'?different=1',{pageId:'one',readOnly:true}),/EXPLICIT_PAGE_URL_MISMATCH/);
 await assert.rejects(b.existingPage(url,{pageId:'missing',readOnly:true}),/ROLE_BROWSER_PAGE_LOST/);
 await assert.rejects(b.existingPage(url,{pageId:'one'}),/EXPLICIT_PAGE_REQUIRES_READ_ONLY/);
});
