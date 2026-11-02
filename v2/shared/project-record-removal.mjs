import {stat} from 'node:fs/promises';
export function projectConfirmationDOM({removeSelector,expectedName}){
 const visible=node=>!!node?.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';
 const triggers=[...document.querySelectorAll(removeSelector)].filter(visible);if(triggers.length!==1)return null;
 const anchor=triggers[0].getBoundingClientRect(),matches=[];
 const selector=node=>{if(node.id&&document.querySelectorAll('#'+CSS.escape(node.id)).length===1)return '#'+CSS.escape(node.id);const parts=[];for(let n=node;n&&n!==document.body;n=n.parentElement){let i=1;for(let p=n.previousElementSibling;p;p=p.previousElementSibling)if(p.tagName===n.tagName)i++;parts.unshift(n.tagName.toLowerCase()+':nth-of-type('+i+')');}return 'body > '+parts.join(' > ');};
 for(const confirm of [...document.querySelectorAll('.phoenix-popconfirm')].filter(visible)){
  const popover=confirm.closest('.phoenix-popover'),message=confirm.querySelector('.phoenix-popconfirm__message')?.textContent?.trim()||'';
  if(!visible(popover)||!/删除|delete|remove/i.test(message)||/提交|投递|协议|授权|submit|consent|agreement/i.test(message))continue;
  const box=popover.getBoundingClientRect(),dx=Math.max(box.left-anchor.right,anchor.left-box.right,0),dy=Math.max(box.top-anchor.bottom,anchor.top-box.bottom,0);
  if(dx>24||dy>32)continue;
  const buttons=[...confirm.querySelectorAll('.phoenix-popconfirm__footerButton .phoenix-button__wraper--primary')].filter(visible).filter(button=>/^(?:是|确定|确认|确认删除|yes|ok|confirm|delete)$/i.test(button.textContent?.trim()||'')&&!/disabled/i.test(button.className||'')&&button.getAttribute('aria-disabled')!=='true');
  if(buttons.length===1)matches.push({associated:true,renderer:'phoenix_popconfirm',targetName:expectedName,message,confirmLabel:buttons[0].textContent.trim(),confirmSelector:selector(buttons[0])});
 }
 return matches.length===1?matches[0]:null;
}
export async function inspectProjectRecordRemoval(adapter,action){
 const reader=new URL('./control-dom.mjs',import.meta.url);reader.searchParams.set('revision',String((await stat(reader)).mtimeMs));const {controlDOM}=await import(reader.href);
 const current=await adapter.page.evaluate(controlDOM,{operation:'projectRemovalSnapshot',section:action.section,label:action.label,expectedName:action.expectedName});
 if(current?.removeSelector)current.confirmation=await adapter.page.evaluate(projectConfirmationDOM,{removeSelector:current.removeSelector,expectedName:action.expectedName});
 return current;
}
export async function performProjectRecordRemoval(adapter,action){
 if(action.authorized!==true||!action.expectedName||!action.selector?.startsWith('phoenixq:'))throw Error('PROJECT_REMOVAL_AUTHORIZATION_REQUIRED');
 const ref=JSON.parse(action.selector.slice(9));if(ref.label!==action.label||ref.section!==action.section)throw Error('PROJECT_REMOVAL_SCOPE_MISMATCH');
 const snapshot=()=>inspectProjectRecordRemoval(adapter,action);
 const before=await snapshot();if(!before||before.names?.filter(n=>n===action.expectedName).length!==1||!before.removeSelector)throw Error('PROJECT_RECORD_REMOVE_TARGET_REQUIRED');
 if(!action.confirmationOnly&&before.confirmation?.associated===true)return {status:'awaiting_confirmation',currentNames:before.names,confirmation:before.confirmation};
 if(action.confirmationOnly&&before.confirmation?.associated!==true)throw Error('PROJECT_CONFIRMATION_NOT_OBSERVED');
 const button=adapter.page.locator(action.confirmationOnly?before.confirmation.confirmSelector:before.removeSelector);if(await button.count()!==1)throw Error('PROJECT_REMOVE_ACTION_NOT_UNIQUE');
 // Do not retry this click. A timeout is an uncertain result to inspect.
 await button.click({timeout:10000});
 const expected=before.names.filter(name=>name!==action.expectedName),until=Date.now()+3000;
 do{const after=await snapshot();if(JSON.stringify(after?.names)===JSON.stringify(expected)){const stable=await snapshot();if(JSON.stringify(stable?.names)===JSON.stringify(expected))return {status:'removed_verified',removedName:action.expectedName,remainingNames:expected,readbackStable:true};}if(!action.confirmationOnly&&after?.confirmation?.associated===true)return {status:'awaiting_confirmation',currentNames:after.names,confirmation:after.confirmation};if(Date.now()>=until)break;await new Promise(resolve=>setTimeout(resolve,30));}while(true);
 throw Error('PROJECT_REMOVAL_RESULT_UNCERTAIN');
}
