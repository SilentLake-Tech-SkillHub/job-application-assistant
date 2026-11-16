// 首版入口配置的浏览器侧观察（C39）。2026-11-16 用户决定（“2.同意 3A”）：和首版登录配置一样，
// 组件读出岗位标题和投递按钮，直接写入第一版，接着点一次入口；点进去落的不是申请表或登录页，就按原来的报错处理。
// 同一失败第二次交 Agent 浏览器兜底（2026-11-16 “按B。推进”），兜底前后的只读盘点也在这里。
// 本模块只在本任务绑定的岗位页上读标题、盘点候选按钮、按规则点一次，报告落到哪张标签、哪个地址；
// 不写配置、不填写、不提交。Chrome（browser.mjs）和宿主内置浏览器（host-browser-bridge.mjs）共用，
// 站点差异只来自 catalog/first-entry.json，代码不写任何域名或站点名。
import {readFileSync} from 'node:fs';
import {READY_TIMEOUT_MS} from './entry-recipe.mjs';
import {inspectEntryPage} from './entry-inspection.mjs';
export const FIRST_ENTRY=JSON.parse(readFileSync(new URL('../catalog/first-entry.json',import.meta.url),'utf8'));
if(FIRST_ENTRY.schemaVersion!==1||!Array.isArray(FIRST_ENTRY.entryLabels)||!FIRST_ENTRY.entryLabels.length||FIRST_ENTRY.entryLabels.some(l=>typeof l!=='string'||!l.trim())||typeof FIRST_ENTRY.formFieldSelector!=='string'||!FIRST_ENTRY.formFieldSelector.trim())throw Error('FIRST_ENTRY_CATALOG_INVALID');
const fail=(code,details)=>{const e=Error(code);if(details)e.details={phase:'first_entry',...details};throw e;};
const originOf=u=>{try{return new URL(u).origin;}catch{return null;}};
const summary=pool=>pool.map(({role,label,count})=>({...(role?{role}:{}),label,count}));
// 与 entry-inspection 相同的结构路径（nth-of-type），用于标题不在 h1–h3 里的页面。
const domPath=element=>{const parts=[];for(let node=element;node&&node!==document.documentElement;node=node.parentElement){if(node===document.body){parts.unshift('body');break;}let position=1;for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling)if(sibling.tagName===node.tagName)position++;parts.unshift(node.tagName.toLowerCase()+':nth-of-type('+position+')');}return parts.join(' > ');};
// 与已确认岗位名完全一致的唯一标题，只返回纯 CSS 写法（打开页面、读快照时用 document.querySelectorAll）。
// heading：h1/h2/h3/[role=heading] 这类不随版式变的写法；path：结构路径，版式一变就失效，只在地址里没有岗位编号时才用。
export async function titleSelectors(page,expectedTitle,stage){
 const url=await page.url(),view={url:()=>url,locator:s=>page.locator(s)};
 const {candidates}=await inspectEntryPage(view,{entry:{form:{}},expectedTitle,stage});
 let heading=null,path=null;
 for(const c of candidates){
  const plain=c.roleSelector.replace(/:visible$/,'');
  if(!heading&&!plain.includes(':')){const l=page.locator(plain);if(await l.count()===1&&(await l.innerText()).trim()===expectedTitle)heading=plain;}
  if(!path&&c.domSelector)path=c.domSelector;
 }
 if(!heading&&!path){
  const l=page.getByText(expectedTitle,{exact:true});
  if(await l.count()===1&&await l.isVisible()){const p=await l.evaluate(domPath);const n=page.locator(p);if(await n.count()===1&&(await n.innerText()).trim()===expectedTitle)path=p;}
 }
 return {heading,path};
}
// 点之前核对按钮能不能点到（C42）：滚到视野中间，看按钮中心点上最上层的元素是不是按钮自己；被挡住或不可用时不点，记下挡住它的元素类型、是否对话框。
const hitTest=el=>{el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2),covered=!top||!(top===el||el.contains(top));
 return {covered,disabled:el.disabled===true||el.getAttribute('aria-disabled')==='true',coverTag:covered&&top?top.tagName.toLowerCase():null,coverDialog:covered&&!!top?.closest('[role="dialog"],[aria-modal="true"],dialog')};};
export async function assertClickable(locator,codePrefix){
 const h=await locator.evaluate(hitTest);
 if(h.disabled)fail(codePrefix+'_DISABLED',{check:'button',disabled:true});
 if(h.covered)fail(codePrefix+'_COVERED',{check:'button',covered:true,...(h.coverTag?{coverTag:h.coverTag}:{}),coverDialog:h.coverDialog});
}
// 点了没换页时，页面上可见的对话框个数（没登录的站点常弹登录框）。
const dialogCount=async page=>{try{return await page.locator('body').evaluate(()=>[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],dialog[open]')].filter(n=>n.getClientRects().length).length);}catch{return 0;}};
const locatorFor=(page,{role,label})=>role?page.getByRole(role,{name:label,exact:true}):page.getByText(label,{exact:true});
// 候选入口按钮：先按按钮、链接的无障碍名称找，都没有再按完全一致的文字找。同一文字有多个时，按页面上从上到下的顺序给出各自的序号（domOrder）。
export async function entryInventory(page,labels=FIRST_ENTRY.entryLabels){
 const pool=[];
 for(const label of labels)for(const role of ['button','link']){const l=page.getByRole(role,{name:label,exact:true}),count=await l.count();if(count)pool.push({role,label,count,locator:l});}
 if(!pool.length)for(const label of labels){const l=page.getByText(label,{exact:true}),count=await l.count();if(count)pool.push({role:null,label,count,locator:l});}
 for(const c of pool){
  const tops=[];for(let i=0;i<Math.min(c.count,20);i++){let top=null;try{top=await c.locator.nth(i).evaluate(n=>{const r=n.getBoundingClientRect();return r.width||r.height?r.top+window.scrollY:null;});}catch{}tops.push({i,top});}
  c.domOrder=tops.filter(t=>t.top!==null).sort((a,b)=>a.top-b.top||a.i-b.i).map(t=>t.i);
 }
 return pool;
}
// 自动首版只点“恰好一个、可见、文字完全一致”的按钮（以后每次进入按同一标准点击，见 entry-transition）。
export async function entryButton(page,labels=FIRST_ENTRY.entryLabels){
 const pool=await entryInventory(page,labels);
 if(!pool.length)fail('APPLICATION_ENTRY_FIRST_BUTTON_NOT_FOUND',{check:'button',candidates:[]});
 if(pool.length!==1||pool[0].count!==1)fail('APPLICATION_ENTRY_FIRST_BUTTON_NOT_UNIQUE',{check:'button',candidates:summary(pool)});
 const [only]=pool;
 if(!await only.locator.isVisible()||(await only.locator.innerText()).trim()!==only.label)fail('APPLICATION_ENTRY_FIRST_BUTTON_NOT_USABLE',{check:'button',candidates:summary(pool)});
 return {locator:only.locator,entryLocator:only.role?{role:only.role,name:only.label,label:only.label}:{text:only.label,label:only.label}};
}
// 落地页是不是申请表：主页面可见的输入控件；同时数内嵌框架，申请表在框架里时组件看不到。
export async function landingFacts(target,expectedTitle,{wait=true}={}){
 let formFieldsVisible=true;
 try{await target.locator(FIRST_ENTRY.formFieldSelector).filter({visible:true}).first().waitFor({state:'visible',timeout:wait?READY_TIMEOUT_MS:1});}catch{formFieldsVisible=false;}
 const inputs=await target.locator(FIRST_ENTRY.formFieldSelector).count(),frames=await target.locator('iframe').count();
 const formTitle=formFieldsVisible?await titleSelectors(target,expectedTitle,'form'):{heading:null,path:null};
 return {pageUrl:await target.url(),formFieldsVisible,inputs,frames,formTitle};
}
export async function observeFirstEntry({pageId,expectedTitle,expectedRoleId},host){
 if(!expectedTitle||!expectedRoleId)fail('APPLICATION_ENTRY_IDENTITY_REQUIRED');
 const page=await host.getPage(pageId),detailUrl=await page.url(),origin=originOf(detailUrl);
 // 先确认这张页面是本岗位：读不到与岗位名完全一致的标题就不点（2026-11-16 首跑：读不到标题仍点击，落地不明）。
 const detailTitle=await titleSelectors(page,expectedTitle,'detail');
 if(!detailTitle.heading&&!detailTitle.path)fail('APPLICATION_ENTRY_FIRST_ROLE_TITLE_NOT_FOUND',{check:'title'});
 const button=await entryButton(page);
 await assertClickable(button.locator,'APPLICATION_ENTRY_FIRST_BUTTON');
 const before=new Set((await host.listPages()).map(p=>String(p.id)));
 try{await button.locator.click({timeout:10000});}catch(error){error.operationStep='first_entry_click';error.operationLocator=button.entryLocator.label;throw error;}
 const now=host.now||Date.now,deadline=now()+READY_TIMEOUT_MS;let landing=null;
 do{
  const fresh=(await host.listPages()).filter(p=>!before.has(String(p.id))&&originOf(p.url)===origin);
  if(fresh.length>1)fail('AMBIGUOUS_ROLE_FORM');
  if(fresh.length===1){landing={id:fresh[0].id,target:'new'};break;}
  if(await page.url()!==detailUrl){landing={id:pageId,target:'same'};break;}
  await host.pause(100);
 }while(now()<deadline);
 if(!landing)fail('APPLICATION_ENTRY_FIRST_NO_NAVIGATION',{check:'navigation',dialogs:await dialogCount(page)});
 const target=landing.target==='same'?page:await host.getPage(landing.id);
 const facts=await landingFacts(target,expectedTitle);
 await host.preserve?.(pageId);if(landing.id!==pageId)await host.preserve?.(landing.id);
 return {pageId:landing.id,target:landing.target,detailUrl,detailTitle,entryLocator:button.entryLocator,...facts,formFieldSelector:FIRST_ENTRY.formFieldSelector,entryClicked:true,configurationWritten:false,submission:'not_performed'};
}
// Agent 兜底开始前：只读盘点本岗位页（标题、候选入口按钮及同文字按钮的上下顺序），不点击。
// labels 不传时用通用文字表；兜底回报的文字不在表里时，在仍停在岗位页的标签上按那段文字再盘点一次。
export async function inventoryEntryPage({pageId,expectedTitle,labels},host){
 const page=await host.getPage(pageId);
 const detailTitle=await titleSelectors(page,expectedTitle,'detail'),pool=await entryInventory(page,labels||FIRST_ENTRY.entryLabels);
 return {pageId,pageUrl:await page.url(),detailTitle,candidates:pool.map(({role,label,count,domOrder})=>({...(role?{role}:{}),label,count,domOrder})),submission:'not_performed'};
}
// Agent 兜底点完后：只读落地页（不等待太久以外不做任何操作）。
export async function observeEntryLanding({pageId,expectedTitle},host){
 const target=await host.getPage(pageId);const facts=await landingFacts(target,expectedTitle);await host.preserve?.(pageId);
 return {pageId,...facts,formFieldSelector:FIRST_ENTRY.formFieldSelector,submission:'not_performed'};
}
// 组件代点（C41，2026-11-16 用户选择“A 作为第三种方式”“入口和表单控件都加”）：Agent 看截图选定按钮（文字 + 页面元素序号），
// 组件在绑定的岗位页上核对同文字按钮个数没变、目标可见且文字一致后点一次，报告落到哪张标签；不写配置、不填写、不提交。
export async function clickEntryCandidate({pageId,label,role,count,index,expectedTitle},host){
 if(typeof label!=='string'||!label.trim()||!Number.isInteger(count)||count<1||count>20||!Number.isInteger(index)||index<0||index>=count)throw Error('ENTRY_FALLBACK_REPORT_INVALID');
 const page=await host.getPage(pageId),detailUrl=await page.url(),origin=originOf(detailUrl);
 const all=locatorFor(page,{role,label}),l=count>1?all.nth(index):all;
 if(await all.count()!==count||!await l.isVisible()||(await l.innerText()).trim()!==label)throw Error('ENTRY_FALLBACK_BUTTON_CHANGED');
 await assertClickable(l,'ENTRY_FALLBACK_BUTTON');
 const before=new Set((await host.listPages()).map(p=>String(p.id)));
 try{await l.click({timeout:10000});}catch(error){error.operationStep='component_entry_click';error.operationLocator=label;throw error;}
 const now=host.now||Date.now,deadline=now()+READY_TIMEOUT_MS;let landing=null;
 do{
  const fresh=(await host.listPages()).filter(p=>!before.has(String(p.id))&&originOf(p.url)===origin);
  if(fresh.length>1)throw Error('ENTRY_FALLBACK_LANDING_NOT_UNIQUE');
  if(fresh.length===1){landing={id:fresh[0].id,target:'new'};break;}
  if(await page.url()!==detailUrl){landing={id:pageId,target:'same'};break;}
  await host.pause(100);
 }while(now()<deadline);
 if(!landing)fail('ENTRY_FALLBACK_NO_NAVIGATION',{check:'navigation',dialogs:await dialogCount(page)});
 await host.preserve?.(pageId);if(landing.id!==pageId)await host.preserve?.(landing.id);
 return {pageId:landing.id,target:landing.target,entryClicked:true,submission:'not_performed'};
}
