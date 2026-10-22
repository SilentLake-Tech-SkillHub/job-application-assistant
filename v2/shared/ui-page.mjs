import {performControl} from './control-operations.mjs';
import {readRoleIdentity} from './role-identity.mjs';
import {sharedRecordKey} from './shared-record.mjs';
import {antDOM} from './ant-reference.mjs';
import {observeDOM} from './observation.mjs';
import {inventoryFeishuDOM} from './feishu-inventory.mjs';
import {remapFeishuSpecDOM,canonicalizeInventory} from './feishu-selectors.mjs';

export {controlDOM as inventoryDOM} from './control-dom.mjs';
import {controlDOM as inventoryDOM,normalizePhoenixReference} from './control-dom.mjs';

export class PageAdapter {
  constructor(page,{listOpenPageUrls}={}){Object.assign(this,{page,listOpenPageUrls});}
  async assertSingleEditor(){
    const key=sharedRecordKey(this.page.url());if(!key)return;
    const urls=this.listOpenPageUrls?await this.listOpenPageUrls():this.page.context().pages().filter(p=>p!==this.page&&!p.isClosed()).map(p=>p.url());
    const peers=urls.filter(url=>url!==this.page.url()&&/^https?:/.test(url)&&sharedRecordKey(url)===key);
    if(peers.length)throw Error('SHARED_RESUME_HAS_OTHER_OPEN_EDITORS');
  }
  async assertLocation(origin,prefix){const u=new URL(this.page.url());if(u.origin!==origin||!u.pathname.startsWith(prefix))throw Error('PAGE_IDENTITY_CHANGED');}
  async resolveSelector(selector){if(selector?.startsWith('phoenixq:'))return (await this.page.evaluate(inventoryDOM,{operation:'resolvePhoenix',references:[normalizePhoenixReference(selector)]}))[0];if(!selector?.startsWith('antq:'))return selector;const actual=await this.page.evaluate(antDOM,{operation:'resolve',reference:selector});return actual||':not(*)';}
  async resolveSpec(spec){
    const refs=new Set();const collect=v=>{if(typeof v==='string'&&(v.startsWith('antq:')||v.startsWith('phoenixq:')))refs.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};collect(spec);if(!refs.size)return spec;
    const keys=[...refs],ant=keys.filter(k=>k.startsWith('antq:')),phoenix=keys.filter(k=>k.startsWith('phoenixq:'));
    const [antValues,phoenixValues]=await Promise.all([ant.length?this.page.evaluate(antDOM,{operation:'resolve',references:ant}):[],phoenix.length?this.page.evaluate(inventoryDOM,{operation:'resolvePhoenix',references:phoenix.map(normalizePhoenixReference)}):[]]);
    const mapping=new Map([...ant.map((k,i)=>[k,antValues[i]||':not(*)']),...phoenix.map((k,i)=>[k,phoenixValues[i]||':not(*)'])]);
    const walk=v=>typeof v==='string'?mapping.get(v)||v:Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)])):v;return walk(spec);
  }
  async wait(selector){selector=await this.resolveSelector(selector);await this.page.locator(selector).waitFor({state:'visible',timeout:10000});}
  async inventory(plan){if(plan?.provider==='ant')return this.page.evaluate(antDOM);const raw=await this.page.evaluate(plan?.provider==='feishu'?inventoryFeishuDOM:inventoryDOM);return plan?.provider==='feishu'&&!plan.rawKeys?canonicalizeInventory(raw).fields:raw;}
  async observe(plan){plan=await this.resolveSpec(plan);const result=await this.page.evaluate(observeDOM,plan.provider==='feishu'&&!plan.selectorsResolved?await this.page.evaluate(remapFeishuSpecDOM,plan):plan);if(plan.roleIdentity)result.roleIdentity=readRoleIdentity(plan.roleIdentity,result.pageUrl);return result;}
  async ensureGroups(groups){
    if(groups?.length)await this.assertSingleEditor();
    for(const group of groups||[]){
      const groupSelector=()=>this.resolveSelector(group.selector);
      let count=await this.page.locator(await groupSelector()).count();
      if(count>group.count)throw Error('EXCESS_REPEAT_ENTRIES_REQUIRE_REVIEW');
      while(count<group.count){
        const addLabel=group.addLabel||'添加';
        const add=this.page.locator(await this.resolveSelector(group.addSelector)).filter({hasText:new RegExp('^'+addLabel+'$')});
        if(await add.count()!==1||(await add.innerText()).trim()!==addLabel)throw Error('REPEAT_ADD_CONTROL_CHANGED');
        await add.click({timeout:10000});
        const next=await this.page.locator(await groupSelector()).count();
        if(next!==count+1)throw Error('REPEAT_ADD_DID_NOT_CREATE_ONE_ENTRY');
        count=next;
      }
    }
  }
  async act(action,value,files){return performControl(this,action,value,files);}
  async readBatch(fields){const o=await this.observe({fields});return Object.fromEntries(Object.entries(o.fields).map(([id,f])=>[id,f.value]));}
  async validationErrors(selectors){return this.page.evaluate(ss=>ss.flatMap(s=>[...document.querySelectorAll(s)].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(()=>({selector:s,visible:true}))),selectors);}
}
