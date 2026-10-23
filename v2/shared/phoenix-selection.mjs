// The trigger may include duplicated layout-measurement text. Only the real
// selected-content element is a value readback; never fall back to its siblings.
export async function readPhoenixSelectedValue(trigger){
 const content=trigger.locator('.phoenix-select__content'),count=await content.count();
 if(count===0)throw Error('PHOENIX_SELECTED_CONTENT_REQUIRED');
 if(count!==1)throw Error('PHOENIX_SELECTED_CONTENT_NOT_UNIQUE');
 return String(await content.innerText()).trim();
}
