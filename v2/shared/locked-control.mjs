// Observe a genuinely disabled, already selected value. Never guess its parent
// dependency or turn an empty disabled widget into a resolved answer.
export async function captureLockedChoice(page,field){
 const selector=field.selectedSelector||field.readSelector;
 if(!selector)return {options:[],status:'disabled_by_parent',restored:true};
 const spec={fields:[{id:'locked',kind:'choice',read:{selector,selectedSelector:selector,kind:'text',requireDisabled:true}}]};
 const before=await page.observe(spec),after=await page.observe(spec),a=before.fields?.locked,b=after.fields?.locked;
 if(!a?.present||!b?.present||a.disabled!==true||b.disabled!==true||a.selected!==true||b.selected!==true||typeof b.value!=='string'||!b.value.trim()||a.value!==b.value)return {options:[],status:'disabled_by_parent',restored:true};
 return {options:[b.value],status:'captured_locked_value',restored:true,scope:'disabled_selected_value_only',lockedControl:{value:b.value,disabled:true,selected:true,selector,readAt:after.readAt}};
}
