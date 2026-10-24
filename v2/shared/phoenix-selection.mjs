// The trigger may include duplicated layout-measurement text. Only the real
// selected-content element is a value readback; never fall back to its siblings.
export async function readPhoenixSelectedValue(trigger){
 const content=trigger.locator('.phoenix-select__content'),count=await content.count();
 if(count===0)throw Error('PHOENIX_SELECTED_CONTENT_REQUIRED');
 if(count!==1)throw Error('PHOENIX_SELECTED_CONTENT_NOT_UNIQUE');
 return String(await content.innerText()).trim();
}
export function phoenixSelectedDisplayDOM(node){
 const root=node.closest?.('.phoenix-select'),visible=n=>!!n?.getClientRects?.().length&&getComputedStyle(n).visibility!=='hidden';
 const editable=n=>!!n&&(['INPUT','TEXTAREA','SELECT'].includes(n.tagName)||n.isContentEditable===true);
 const values=[];
 for(const target of [node,root])for(const attribute of ['data-value','data-id','value']){const value=target?.getAttribute?.(attribute);if(typeof value==='string'&&value.trim())values.push({attribute,value});}
 return {label:String(node.innerText??node.textContent??'').trim(),visible:visible(node),rootValid:!!root&&!editable(root),nonEditable:!editable(node)&&![...(node.querySelectorAll?.('input,textarea,[contenteditable="true"]')||[])].some(visible),placeholderAbsent:![...(root?.querySelectorAll?.('[class*="placeholder"]')||[])].some(visible),disabled:!!root?.disabled||root?.getAttribute?.('aria-disabled')==='true',values};
}
export async function readPhoenixSelectedDisplay(trigger){
 const content=trigger.locator('.phoenix-select__content');if(await content.count()!==1)throw Error('PHOENIX_SELECTED_CONTENT_NOT_UNIQUE');
 return content.evaluate(phoenixSelectedDisplayDOM);
}
export function confirmPhoenixSelectedDisplay(candidate,display,{expectedLabel,blurredLabel}){
 if(candidate.disabled||display.disabled)throw Error('CHOICE_OPTION_DISABLED');
 if(!display.rootValid||!display.visible||!display.nonEditable||!display.placeholderAbsent)throw Error('PHOENIX_SELECTED_DISPLAY_REQUIRED');
 if(candidate.label!==expectedLabel||display.label!==expectedLabel||blurredLabel!==expectedLabel)throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
 let value=null,valueAttribute=null;
 if(candidate.value!=null){
  const current=[...new Set(display.values.filter(v=>v.attribute===candidate.valueAttribute).map(v=>v.value))];
  if(current.length!==1||current[0]!==candidate.value)throw Error('CHOICE_SELECTED_VALUE_MISMATCH');value=current[0];valueAttribute=candidate.valueAttribute;
 }else if(display.values.length)throw Error('PHOENIX_SELECTED_VALUE_COMPARISON_REQUIRED');
 return {kind:'selected_display',renderer:'phoenix_select',label:display.label,value,valueAttribute,blurConfirmed:true,reopenedOptionSelected:false,selectedDisplayConfirmed:true,nonEditable:true,placeholderAbsent:true,valueCompared:candidate.value!=null};
}
