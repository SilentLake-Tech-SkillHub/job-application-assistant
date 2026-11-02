import {createHash} from 'node:crypto';
export const missingPageFailureState=pageId=>({fingerprint:createHash('sha256').update(JSON.stringify({pageId,missing:true})).digest('hex')});
// Do not collect field values, account labels or arbitrary page prose.
export function failureSnapshotDOM(){return {ready:document.readyState,title:document.title,headings:[...document.querySelectorAll('h1,h2,h3,[role=heading]')].map(e=>e.textContent),loadErrors:(document.body?.innerText||'').match(/加载失败|请刷新页面重试|请求失败|网络异常|正在加载/g)||[],controls:[...document.querySelectorAll('input,select,textarea,button,[role="button"]')].map(e=>[e.tagName,e.getAttribute('type'),e.getAttribute('name'),e.getAttribute('role'),!!e.disabled,!!e.readOnly])};}
export async function pageFailureState(page,pageId){
 const state=await page.evaluate(failureSnapshotDOM),url=await page.url();
 return {fingerprint:createHash('sha256').update(JSON.stringify({pageId,url,state})).digest('hex')};
}
