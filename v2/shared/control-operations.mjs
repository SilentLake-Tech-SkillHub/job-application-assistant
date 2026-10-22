import {validDate} from './value-contract.mjs';
import {remapFeishuSpecDOM} from './feishu-selectors.mjs';
import {CONTROL_METHODS} from './control-registry.mjs';
import {isRedactedReadback,REDACTED_READBACK_REASON} from './readback-state.mjs';
import {captureWecruitSchema} from './ats-schema.mjs';
import {performAntDay} from './ant-date.mjs';
import {stat,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {collectChoiceViews,choiceViewport} from './choice-inventory.mjs';
import {UD_TREE_LEAF_LABEL,treeChoiceDOM} from './tree-choice.mjs';
const exact = value => new RegExp('^'+String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$');
export async function locateControl(page,action){
 let l=page.locator(action.selector);
 // Hidden native file/boolean inputs remain legitimate targets. Ambiguous
 // targets are never silently accepted through first().
 if(await l.count()!==1){
  l=l.filter({visible:true});
  if(await l.count()!==1)throw Error('AMBIGUOUS_ACTION_TARGET');
 }
 return l;
}
async function waitCommit(read,expected){const end=Date.now()+2000;do{if(JSON.stringify(await read())===JSON.stringify(expected))return;if(Date.now()>=end)throw Error('CONTROL_COMMIT_NOT_VERIFIED');await new Promise(r=>setTimeout(r,20));}while(true);}
async function assertValue(l,value,{deferRedacted=false}={}){
 if(!deferRedacted)return waitCommit(()=>l.evaluate(n=>n.value),value);
 const end=Date.now()+2000;
 do{const actual=await l.evaluate(n=>n.value);
  if(isRedactedReadback(actual))return {status:'deferred_readback',reason:REDACTED_READBACK_REASON};
  if(JSON.stringify(actual)===JSON.stringify(value))return;
  if(Date.now()>=end)throw Error('CONTROL_COMMIT_NOT_VERIFIED');
  await new Promise(r=>setTimeout(r,20));
 }while(true);
}
async function performChoice(adapter,action,value,family){
 const page=adapter.page,l=await locateControl(page,action);
 if(await l.evaluate(n=>n.getAttribute('role'))!=='combobox')throw Error('CHOICE_COMBOBOX_REQUIRED');
 const root=action.labelSelector?.replace(/ > \.ud-formily-item-label$/,'');
 let trigger=l;
 if(family==='ud'){
  if(!root||root===action.labelSelector)throw Error('UD_QUESTION_ANCHOR_REQUIRED');
  // The actual interactive display is inside the captured question container.
  const display=page.locator(root+' .ud__select__selector');
  if(await display.count()===1)trigger=display;
 }
 const dismiss=async()=>{if(action.labelSelector){const label=await locateControl(page,{selector:action.labelSelector});await label.click({timeout:10000});}else{await l.press('Escape');await l.press('Tab');}};
 if(family==='ant'){const parent=l.locator('xpath=ancestor::*[contains(@class, "ant-select")][1]');if(await parent.count()===1)trigger=parent;}
 const initial=(await trigger.innerText()).trim();let search=null,initialQuery,queryApplied=false;
 await trigger.click({timeout:10000});
 try{
  let menus=page.locator(action.menuSelector||(family==='ud'?'.ud__select__list':family==='ant'?'.ant-select-dropdown':'[role="listbox"]')).filter({visible:true});
  const owned=await l.evaluate(n=>n.getAttribute('aria-controls')||n.getAttribute('aria-owns'));
  if(owned){menus=page.locator('[id='+JSON.stringify(owned)+']').filter({visible:true});}
  await menus.waitFor({state:'visible',timeout:3000});
  if(await menus.count()!==1)throw Error('CHOICE_MENU_NOT_UNIQUE');
  const candidates=family==='ant'?[page.locator('.ant-select-open input.ant-select-search__field, .ant-select-open input.ant-select-selection-search-input').filter({visible:true})]:family==='ud'?[menus.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]').filter({visible:true}),l.filter({visible:true})]:[];
  for(const candidate of candidates){if(await candidate.count()===1&&await candidate.evaluate(n=>n.tagName==='INPUT'&&!n.readOnly&&!n.disabled&&(n.type==='search'||/搜索|search/i.test(n.getAttribute('placeholder')||n.className||'')))){search=candidate;break;}}
  const searchable=!!search;
  if(searchable){initialQuery=await search.evaluate(n=>n.value);if(action.query||!action.method.endsWith('_inspect')){await search.fill(action.query||String(value),{timeout:10000});await assertValue(search,action.query||String(value));queryApplied=true;}}
  const tree=family==='ud'&&await menus.evaluate(n=>!!n.classList?.contains('ud__treeSelect__overlay')||!!n.querySelector?.('.ud__tree'));
  const options=menus.locator(tree?UD_TREE_LEAF_LABEL:family==='ud'?'.ud__select__list__item':family==='ant'?'[role="option"], .ant-select-item-option':'[role="option"]').filter({visible:true});
  if(tree&&action.method.endsWith('_inspect')&&await options.count()===0){
   const treeEvidence=await menus.evaluate(treeChoiceDOM);
   if(queryApplied&&initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000});await dismiss();await menus.waitFor({state:'hidden',timeout:3000});
   return {options:[],tree:treeEvidence,renderer:'ud_tree_select',restored:(await trigger.innerText()).trim()===initial&&await menus.count()===0,searchable,queryApplied,scope:'rendered_tree_branches',coverage:{complete:false,reason:'no_rendered_leaf_options'},status:'branches_only'};
  }
  await options.first().waitFor({state:'visible',timeout:3000});
  const optionText=action.optionTextMap?.[value]||String(value);
  const captured=await collectChoiceViews({read:()=>choiceViewport(menus,options),press:key=>(search||l).press(key),target:action.method.endsWith('_inspect')?undefined:optionText});
  const values=captured.options;
  if(action.method.endsWith('_inspect')){
   const treeEvidence=tree?await menus.evaluate(treeChoiceDOM):null;
   if(queryApplied&&initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000});
   await dismiss();
   await menus.waitFor({state:'hidden',timeout:3000});
   const restored=(await trigger.innerText()).trim()===initial&&await menus.count()===0;
   return {options:values,restored,searchable,queryApplied,...(tree?{renderer:'ud_tree_select',tree:treeEvidence}:{}),scope:queryApplied&&action.query?'exact_search_results':tree?'rendered_tree_leaves':captured.complete?'all_menu_options':captured.steps?'partial_menu_options':'current_visible_menu',coverage:{complete:tree?false:captured.complete,reason:tree?'rendered_leaf_paths_only':captured.reason,keyboardSteps:captured.steps},status:'captured'};
  }
  if(action.optionTextMap&&(!action.observedOptionTexts?.includes(optionText)))throw Error('CHOICE_ALIAS_REQUIRES_CAPTURED_OPTION_TEXT');
  if(!action.options?.includes(String(value))||!values.includes(optionText))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
  const option=options.filter({hasText:exact(optionText)});
  if(await option.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
  await option.click({timeout:10000});await dismiss();await menus.waitFor({state:'hidden',timeout:3000});
  // Full field readback remains independently enforced by Engine/verifyForm.
  return {performed:true,verification:'requires_independent_readback'};
 }catch(e){if(queryApplied&&search&&initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000}).catch(()=>{});await dismiss().catch(()=>{});throw e;}
}
export async function performControl(adapter,action,value,files={}){

    if(!CONTROL_METHODS[action.method])throw Error('UNKNOWN_ACTION');
    if(action.method==='capture_wecruit_schema')return captureWecruitSchema(adapter.page,action);
    if(!['wait','dropdown_inspect','ant_dropdown_inspect','ud_dropdown_inspect'].includes(action.method))await adapter.assertSingleEditor();
    if(action.method==='ant_day')return performAntDay(adapter,action,value);
    if(action.provider==='feishu'&&!action.selectorsResolved)action=await adapter.page.evaluate(remapFeishuSpecDOM,action);
    action=await adapter.resolveSpec(action);
    if(action.method==='wait')return adapter.wait(action.selector);
    const l=await locateControl(adapter.page,action);
    const meta=await l.evaluate(n=>({tag:n.tagName,type:n.type||n.getAttribute('type'),role:n.getAttribute('role'),label:n.getAttribute('aria-label')||n.querySelector(':scope > .ant-form-item-label')?.innerText?.replace(/[＊*\s:：]+$/gu,'').trim()||n.textContent?.trim(),readonly:n.readOnly}));
    if(['ant_dropdown','ant_dropdown_inspect'].includes(action.method))return performChoice(adapter,action,value,'ant');
    if(['ud_dropdown','ud_dropdown_inspect'].includes(action.method))return performChoice(adapter,action,value,'ud');
    if(action.method==='native_date'){
      const precision=meta.type==='date'?'day':meta.type==='month'?'month':null;
      if(meta.tag!=='INPUT'||meta.readonly||!precision||!validDate(value,precision))throw Error('NATIVE_DATE_CONTRACT_REQUIRED');
      await l.fill(value,{timeout:10000});await l.press('Tab');await assertValue(l,value);return;
    }
    if(action.method==='ud_date'){
      if(meta.tag!=='INPUT'||meta.readonly||meta.type!=='text'||!(value==='至今'||validDate(value,String(value).length===4?'year':'month')))throw Error('UD_DATE_CONTRACT_REQUIRED');
      await l.fill(String(value),{timeout:10000});await l.press('Enter');await l.press('Tab');await assertValue(l,String(value));return;
    }
    if(action.method==='click'){
      if(!action.label||meta.label!==action.label)throw Error('CLICK_LABEL_CHANGED');
      if(/提交|投递|撤回|删除|同意|签名|submit|apply|withdraw|delete|agree|consent/i.test(meta.label)||meta.type==='submit'||(meta.tag==='BUTTON'&&!meta.type))throw Error('POTENTIAL_SUBMISSION_BLOCKED');
      await l.click({timeout:10000});return;
    }
    if(action.method==='fill'){
      if(meta.readonly||['date','month','password','file','radio','checkbox'].includes(meta.type))throw Error('CONTROL_REQUIRES_SPECIFIC_ACTION');
      if(action.inputMode==='keyboard'){await l.fill('',{timeout:10000});await l.pressSequentially(String(value),{timeout:10000});}else await l.fill(String(value),{timeout:10000});if(action.selector==='.ant-calendar-input')await l.press('Enter');await l.press('Tab');return assertValue(l,String(value),{deferRedacted:true});
    }
    if(action.method==='select'){if(meta.tag!=='SELECT')throw Error('NATIVE_SELECT_REQUIRED');await l.selectOption({label:String(value)});await l.press('Tab');await waitCommit(()=>l.evaluate(n=>n.selectedOptions[0]?.textContent?.trim()),String(value));return;}
    if(['dropdown','dropdown_inspect'].includes(action.method))return performChoice(adapter,action,value,'aria');
    if(action.method==='radio'){
      if(!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      const choice=l.getByRole('radio',{name:String(value),exact:true});if(await choice.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');await choice.check();await waitCommit(()=>choice.evaluate(n=>n.checked===true||n.getAttribute('aria-checked')==='true'||n.querySelector('input')?.checked===true),true);return;
    }
    if(action.method==='feishu_month'){
      if(value!=='至今'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)))throw Error('INVALID_MONTH_VALUE');
      await l.click({timeout:10000});
      const base='.atsx-date-picker-period-month-panel-list-item';
      if(value==='至今')await adapter.page.locator(`${base}[data-cy="-"]:visible`).click({timeout:10000});
      else{
        const [year,month]=String(value).split('-');
        await adapter.page.locator(`${base}[data-cy="${year}"]:visible`).click({timeout:10000});
        await adapter.page.locator(`${base}[data-cy="${month}"]:visible`).click({timeout:10000});
      }
      return;
    }
    if(action.method==='feishu_year'){
      if(!/^\d{4}$/.test(String(value)))throw Error('INVALID_YEAR_VALUE');
      await l.click({timeout:10000});
      await adapter.page.locator('.atsx-date-picker-panel-body-cell-content:visible').filter({hasText:new RegExp(`^${value}$`)}).click({timeout:10000});
      await l.press('Tab');return;
    }
    if(action.method==='check'){if(typeof value!=='boolean')throw Error('BOOLEAN_REQUIRED');await l.setChecked(value);await waitCommit(()=>l.evaluate(n=>typeof n.checked==='boolean'?n.checked:n.getAttribute('aria-checked')==='true'),value);return;}
    if(action.method==='upload'){
      const asset=files[value];
      if(!asset?.paths?.length||!asset.displayNames?.length||asset.paths.length!==asset.displayNames.length)throw Error('FILE_REFERENCE_MISSING');
      for(const [index,file]of asset.paths.entries()){
        if(!path.isAbsolute(file)||!(await stat(file)).isFile())throw Error('INVALID_FILE_REFERENCE');
        if(!asset.sha256?.[index]||createHash('sha256').update(await readFile(file)).digest('hex')!==asset.sha256[index])throw Error('UPLOAD_FILE_HASH_MISMATCH');
      }
      await l.setInputFiles(asset.paths);
      if(action.successSelector)await adapter.page.locator(action.successSelector).waitFor({state:'visible',timeout:30000});
      return;
    }
    throw Error('UNKNOWN_ACTION');

}
