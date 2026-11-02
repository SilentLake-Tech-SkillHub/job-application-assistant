// 浏览器执行端的标签工具：新开页面不复用别的同址标签；刷新留在原标签；关闭只关指定标签，且不关最后一张（不关浏览器）。
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {BrowserAdapter} from '../shared/browser.mjs';import {withHostBrowserBridge} from './fixtures/host-browser.mjs';import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
const url='https://example.test/job/detail?jobAdId=a';
function playwright(urls){const pages=urls.map(u=>({u,closed:false,reloads:0,url(){return this.u;},isClosed(){return this.closed;},async goto(x){this.u=x;},async reload(){this.reloads++;},async bringToFront(){},async close(){this.closed=true;},context:()=>ctx,async waitForFunction(){}}));
 const ctx={pages:()=>pages.filter(p=>!p.closed),newPage:async()=>{const p={...pages[0],u:'about:blank',closed:false,reloads:0};pages.push(p);return p;}};
 const b=new BrowserAdapter('managed-chrome');b.state='connected';b.connection={contexts:()=>[ctx]};return {b,pages};}
test('Chrome executor: newPage never reuses a same-address tab; reload stays in the tab; close refuses the last tab',async()=>{
 const {b,pages}=playwright([url]);const first=await b.openPage(url);assert.equal(first.reused,true);
 const fresh=await b.openPage(url,{newPage:true});assert.notEqual(fresh.pageId,first.pageId);assert.equal(pages.length,2);
 const r=await b.openPage(url,{pageId:first.pageId,reload:true});assert.equal(r.pageId,first.pageId);assert.equal(pages[0].reloads,1);
 assert.deepEqual(await b.closePage(fresh.pageId),{pageId:fresh.pageId,closed:true});await assert.rejects(b.closePage(first.pageId),/LAST_PAGE_NOT_CLOSABLE/);
});
test('IAB executor: same rules through the host bridge; a host without tab close says so',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'page-tools-'));const tabs=new Map();let n=0;
 const mk=(u,closable=true)=>{const id='t'+(++n),t={id,u,gotos:0,url:async()=>t.u,goto:async x=>{t.u=x;t.gotos++;},markHandoff:async()=>{},...(closable?{close:async()=>{tabs.delete(id);}}:{})};tabs.set(id,t);return t;};
 const a=mk(url),c=mk('https://example.test/',false);
 const browser={tabs:{list:async()=>[...tabs.values()].map(t=>({id:t.id,url:t.u})),get:async id=>tabs.get(id),new:async()=>mk('about:blank')}};
 try{await withHostBrowserBridge({browser,socketPath:path.join(dir,'b.sock'),allowedOrigins:['https://example.test']},async({socketPath})=>{const rpc=new BrokerBrowserAdapter(socketPath);
  const o=await rpc.request('openPage',{pageUrl:url,newPage:true});assert.notEqual(o.pageId,a.id);
  await rpc.request('openPage',{pageId:a.id,pageUrl:url,reload:true});assert.equal(a.gotos,1);
  assert.equal((await rpc.request('closePage',{pageId:o.pageId})).closed,true);assert.equal(tabs.has(o.pageId),false);
  await assert.rejects(rpc.request('closePage',{pageId:c.id}),/HOST_TAB_CLOSE_UNSUPPORTED/);
 });}finally{await rm(dir,{recursive:true,force:true});}
});
