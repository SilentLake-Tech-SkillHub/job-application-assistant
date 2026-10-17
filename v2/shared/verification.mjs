import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
async function challengeFrame(page){
  const owner=page.locator('iframe[src^="https://rmc.bytedance.com/verifycenter/captcha/v2"]');
  if(await owner.count()!==1)return null;
  const handle=await owner.elementHandle();const frame=await handle.contentFrame();
  if(!frame)return null;
  // Chrome's live-profile CDP may omit the child frame URL. Verify the actual
  // rendered document origin instead of guessing from an empty Frame.url().
  const identity=await frame.locator('body').evaluate(()=>({origin:location.origin,path:location.pathname}),undefined,{timeout:5000});
  if(identity.origin!=='https://rmc.bytedance.com'||identity.path!=='/verifycenter/captcha/v2')throw Error('VERIFICATION_FRAME_SCOPE_MISMATCH');
  return {frame,fingerprint:hash(await owner.getAttribute('src'))};
}
export async function inspectVerification(adapter){
  const page=adapter.page;
  if(new URL(page.url()).origin!=='https://arashivision.jobs.feishu.cn')throw Error('VERIFICATION_PAGE_SCOPE_MISMATCH');
  const target=await challengeFrame(page);if(!target)return {status:'not_ready'};
  const {frame}=target;
  const ui=await frame.evaluate(()=>{
    const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
    const box=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
    return {text:document.body?.innerText?.replace(/\d{20,}/g,'[request reference]')||'',elements:[...document.querySelectorAll('button,[role="button"],img,[class*="slide"],[class*="Slide"],[class*="drag"],[class*="Drag"],[class*="rotate"],[class*="Rotate"]')].filter(visible).map(n=>({tag:n.tagName,id:n.id,className:typeof n.className==='string'?n.className:'',role:n.getAttribute('role'),text:n.tagName==='IMG'?'':n.textContent?.trim().slice(0,90),box:box(n)})).slice(0,80)};
  });
  return {status:ui.text.includes('拖动')?'ready':'frame_loading',frameOrigin:'https://rmc.bytedance.com',framePath:'/verifycenter/captcha/v2',ui,inspectedAt:new Date().toISOString()};
}
