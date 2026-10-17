import {performAntDay} from './ant-date.mjs';
import {sharedRecordKey} from './shared-record.mjs';
import http from 'node:http';
import {canonicalizeInventory,remapSpec} from './feishu-selectors.mjs';
export class BrokerBrowserAdapter {
  constructor(socketPath,{requestTimeoutMs=45000}={}){this.socketPath=socketPath;this.requestTimeoutMs=requestTimeoutMs;}
  async request(method,args={}){
    const data=JSON.stringify({method,args});
    const result=await new Promise((resolve,reject)=>{
      const req=http.request({socketPath:this.socketPath,path:'/rpc',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(data)}},res=>{
        const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks)));}catch{reject(Error('INVALID_BROWSER_HOST_RESPONSE'));}});
      });req.on('error',()=>reject(Error('BROWSER_HOST_NOT_AVAILABLE')));req.setTimeout(this.requestTimeoutMs,()=>req.destroy(Error('BROWSER_HOST_OPERATION_TIMEOUT')));req.end(data);
    });
    if(result.error)throw Error(result.error);return result.data;
  }
  status(){return this.request('status');}
  tabs(){return this.request('tabs');}
  async existingPage(pageUrl){await this.request('existingPage',{pageUrl});return new BrokerPage(this,pageUrl);}
}
class BrokerPage {
  constructor(browser,pageUrl){Object.assign(this,{browser,pageUrl});}
  call(method,args={}){return this.browser.request(method,{pageUrl:this.pageUrl,...args});}
  assertLocation(origin,prefix){return this.call('assertLocation',{origin,prefix});}
  wait(selector){return this.call('wait',{selector});}
  async inventory(plan){
    const fields=await this.call('inventory',{plan:{...plan,rawKeys:true}});
    if(plan?.provider!=='feishu')return fields;
    const canonical=canonicalizeInventory(fields);this.rowKeys=canonical.logicalToRuntime;return canonical.fields;
  }
  async observe(plan){
    if(plan.provider==='feishu'){
      if(!this.rowKeys)await this.inventory(plan);
      plan={...remapSpec(plan,this.rowKeys),selectorsResolved:true};
    }
    return this.call('observe',{plan});
  }
  async assertSingleEditor(){const key=sharedRecordKey(this.pageUrl);if(!key)return;const tabs=await this.browser.tabs();if(tabs.some(t=>t.url!==this.pageUrl&&sharedRecordKey(t.url)===key))throw Error('SHARED_RESUME_HAS_OTHER_OPEN_EDITORS');}
  async act(action,value,files){if(!['capture_wecruit_schema','wait','ant_dropdown_inspect','ud_dropdown_inspect'].includes(action.method))await this.assertSingleEditor();if(action.method==='ant_day')return performAntDay(this,action,value);return this.call('act',{action:action.provider==='feishu'?{...remapSpec(action,this.rowKeys||{}),selectorsResolved:true}:action,value,files});}
  async ensureGroups(groups){if(groups?.length)await this.assertSingleEditor();return this.call('ensureGroups',{groups});}
}
