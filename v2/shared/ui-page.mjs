import {performControl} from './control-operations.mjs';
import {readRoleIdentity} from './role-identity.mjs';
import {sharedRecordKey} from './shared-record.mjs';
import {antDOM} from './ant-reference.mjs';
import {observeDOM} from './observation.mjs';
import {remapFeishuSpecDOM,canonicalizeInventory} from './feishu-selectors.mjs';
import {stat} from 'node:fs/promises';

export {controlDOM as inventoryDOM} from './control-dom.mjs';
import {controlDOM as inventoryDOM,normalizePhoenixReference} from './control-dom.mjs';
const currentReader=async(file,name)=>{const url=new URL(file,import.meta.url),info=await stat(url);url.searchParams.set('revision',String(info.mtimeMs));return (await import(url.href))[name];};
const currentAnt=()=>currentReader('./ant-reference.mjs','antDOM');
const currentNative=()=>currentReader('./control-dom.mjs','controlDOM');
const currentFeishu=()=>currentReader('./feishu-inventory.mjs','inventoryFeishuDOM');
export function uncoveredControlsDOM({coveredSelectors,controls,primary=[]}){
 const covered=new Map(coveredSelectors.flatMap((s,i)=>s?[...document.querySelectorAll(s)].map(n=>[n,i]):[])),result=[...primary];
 for(const c of controls){let nodes;try{nodes=[...document.querySelectorAll(c.observationSelector||c.selector)];}catch{nodes=[];}
  const index=nodes.length===1?covered.get(nodes[0]):undefined;
  if(index===undefined)result.push(c);
  else if(c.type==='file'&&c.uploadContainerSelector)result[index]={...result[index],...Object.fromEntries(['actionSelector','uploadContainerSelector','filenameSelector','uploadedSelector'].map(k=>[k,c[k]])),label:result[index].label||c.label};
 }
 return result;
}

export async function resolveLiveReferences(page,reader,args,{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=2000}={}){
 const original=page.url?.(),end=now()+timeoutMs;
 for(;;){try{if(typeof original==='string'&&page.url()!==original)throw Error('PAGE_IDENTITY_CHANGED');const result=await page.evaluate(reader,args);if(typeof original==='string'&&page.url()!==original)throw Error('PAGE_IDENTITY_CHANGED');return result;}catch(error){
  const match=String(error.message||'').match(/(?:^|Error:\s*)(PHOENIX_QUESTION_NOT_FOUND|PHOENIX_CONTROL_CHANGED|REPEAT_SECTION_NOT_FOUND)(?:\b|$)/);
  if(!match||typeof original!=='string')throw error;
  if(page.url()!==original)throw Error('PAGE_IDENTITY_CHANGED');
  if(now()>=end)throw Error(match[1]);
  await sleep(Math.min(50,end-now()));
 }}
}

export class PageAdapter {
  constructor(page,{listOpenPageUrls}={}){Object.assign(this,{page,listOpenPageUrls});}
  async assertSingleEditor(){
    const key=sharedRecordKey(this.page.url());if(!key)return;
    const urls=this.listOpenPageUrls?await this.listOpenPageUrls():this.page.context().pages().filter(p=>p!==this.page&&!p.isClosed()).map(p=>p.url());
    const peers=urls.filter(url=>url!==this.page.url()&&/^https?:/.test(url)&&sharedRecordKey(url)===key);
    if(peers.length)throw Error('SHARED_RESUME_HAS_OTHER_OPEN_EDITORS');
  }
  async assertLocation(origin,prefix){const u=new URL(this.page.url());if(u.origin!==origin||!u.pathname.startsWith(prefix))throw Error('PAGE_IDENTITY_CHANGED');}
  async resolveSelector(selector){if(!['antq:','phoenixq:','uploadq:'].some(prefix=>selector?.startsWith(prefix)))return selector;return (await this.resolveSpec({selector})).selector;}
  async resolveSpec(spec,{readback=false,keepUploadReferences=false}={}){
    if(spec?.operation==='compare_control_aliases'&&Array.isArray(spec.alternatives)){
      const {alternatives,...required}=spec,resolved=await this.resolveSpec(required);
      const oldPhoenix=[...new Set(alternatives.filter(s=>typeof s==='string'&&s.startsWith('phoenixq:')))];
      const values=oldPhoenix.length?await this.page.evaluate(await currentNative(),{operation:'resolvePhoenixAliases',references:oldPhoenix.map(normalizePhoenixReference)}):[];
      const old=new Map(oldPhoenix.map((ref,i)=>[ref,values[i]||':not(*)']));
      return {...resolved,alternatives:await Promise.all(alternatives.map(s=>old.has(s)?old.get(s):this.resolveSelector(s)))};
    }
    const refs=new Set();const collect=v=>{if(typeof v==='string'&&['antq:','phoenixq:','uploadq:'].some(prefix=>v.startsWith(prefix))&&!(keepUploadReferences&&v.startsWith('uploadq:')))refs.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};collect(spec);if(!refs.size)return spec;
    const keys=[...refs],ant=keys.filter(k=>k.startsWith('antq:')),phoenix=keys.filter(k=>k.startsWith('phoenixq:')),uploads=keys.filter(k=>k.startsWith('uploadq:'));
    const [antValues,phoenixValues,uploadValues]=await Promise.all([ant.length?this.page.evaluate(await currentAnt(),{operation:'resolve',references:ant}):[],phoenix.length?resolveLiveReferences(this.page,await currentNative(),{operation:readback?'resolvePhoenixReadback':'resolvePhoenix',references:phoenix.map(normalizePhoenixReference)}):[],uploads.length?this.page.evaluate(await currentNative(),{operation:'resolveUpload',references:uploads}):[]]).catch(error=>{error.operationStep='resolve_control_reference';error.operationLocator=keys.join(' | ');throw error;});
    const mapping=new Map([...ant.map((k,i)=>[k,antValues[i]||':not(*)']),...phoenix.map((k,i)=>[k,phoenixValues[i]||':not(*)']),...uploads.map((k,i)=>[k,uploadValues[i]||':not(*)'])]);
    const walk=v=>typeof v==='string'?mapping.get(v)||v:Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)])):v;return walk(spec);
  }
  async wait(selector){selector=await this.resolveSelector(selector);await this.page.locator(selector).filter({visible:true}).first().waitFor({state:'visible',timeout:10000});}
  async inventory(plan){
   if(plan?.provider==='ant'){
    const reader=await currentAnt(),primary=await this.page.evaluate(reader),coveredSelectors=await this.page.evaluate(reader,{operation:'resolve',references:primary.map(c=>c.selector)});
    const controls=await this.page.evaluate(await currentNative());
    return this.page.evaluate(uncoveredControlsDOM,{coveredSelectors,controls,primary});
   }
   const raw=await this.page.evaluate(plan?.provider==='feishu'?await currentFeishu():await currentNative());return plan?.provider==='feishu'&&!plan.rawKeys?canonicalizeInventory(raw).fields:raw;
  }
  async observe(plan){
   // Only observation selectors participate in readback. Write selectors can
   // legitimately be absent until materials or a preceding action render them.
   const {fields,groups,after,...scope}=plan;
   const observation={
    ...scope,
    ...(fields?{fields:fields.map(({id,kind,read,userOnly})=>({id,kind,read,userOnly}))}:{}),
    ...(groups?{groups:groups.map(({id,title,selector,containsSelector})=>({id,title,selector,containsSelector}))}:{})
   };
   const resolved=await this.resolveSpec(observation,{readback:true,keepUploadReferences:true});
   const result=await this.page.evaluate(await currentNative(),resolved.provider==='feishu'&&!resolved.selectorsResolved?await this.page.evaluate(remapFeishuSpecDOM,resolved):resolved);
   if(resolved.roleIdentity)result.roleIdentity=readRoleIdentity(resolved.roleIdentity,result.pageUrl);
   return result;
  }
  async repeatDiscovery(titles){
    const args={operation:'repeatDiscovery',titles};
    const native=await this.page.evaluate(await currentNative(),args);
    const unresolved=titles.filter(title=>!native.some(item=>item.title===title));
    if(!unresolved.length)return native;
    const ant=await this.page.evaluate(await currentAnt(),{...args,titles:unresolved}).catch(error=>{
     if(!String(error.message).includes('ANT_FORM_NOT_OBSERVED'))throw error;
     return [];
    });
    return [...native,...ant];
  }
  async ensureGroups(groups){
    if(groups?.length)await this.assertSingleEditor();
    for(const group of groups||[]){
      const groupSelector=async()=>{const selector=await this.resolveSelector(group.selector);return group.visibleOnly?`:is(${selector}):visible`:selector;};
      let count=await this.page.locator(await groupSelector()).count();
      if(count>group.count)throw Error('EXCESS_REPEAT_ENTRIES_REQUIRE_REVIEW');
      while(count<group.count){
        const addLabel=group.addLabel||'添加';
        let addSelector=await this.resolveSelector(group.addSelector);
        if(group.ownerSelector){
         const owner=this.page.locator(group.ownerSelector).filter({visible:true});
         if(await owner.count()!==1||(await owner.innerText()).trim()!==group.ownerTitle)throw Error('REPEAT_ADD_CONTROL_CHANGED');
         addSelector=`:is(${group.scopeSelector}) :is(${addSelector})`;
        }
        const add=this.page.locator(addSelector).filter({hasText:new RegExp('^'+addLabel.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
        if(await add.count()!==1||(await add.innerText()).trim()!==addLabel)throw Error('REPEAT_ADD_CONTROL_CHANGED');
        await add.click({timeout:10000});
        if(group.visibleOnly)await this.page.locator(await groupSelector()).first().waitFor({state:'visible',timeout:3000});
        const next=await this.page.locator(await groupSelector()).count();
        if(next!==count+1)throw Error('REPEAT_ADD_DID_NOT_CREATE_ONE_ENTRY');
        count=next;
      }
    }
  }
  async act(action,value,files){return (await currentReader('./control-operations.mjs','performControl'))(this,action,value,files);}
  async readBatch(fields){const o=await this.observe({fields});return Object.fromEntries(Object.entries(o.fields).map(([id,f])=>[id,f.value]));}
  async validationErrors(selectors){return this.page.evaluate(ss=>ss.flatMap(s=>[...document.querySelectorAll(s)].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(()=>({selector:s,visible:true}))),selectors);}
}
