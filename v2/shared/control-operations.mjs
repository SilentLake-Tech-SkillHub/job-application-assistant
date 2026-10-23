import {choiceProofDOM,confirmChoiceEvidence} from './choice-proof.mjs';
import {selectorAliasDOM} from './selector-aliases.mjs';
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
 const verifyOnly=action.method.endsWith('_verify');
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
 if(family==='ant'){
  const parent=l.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]');
  if(await parent.count()===1){const display=parent.locator('.ant-select-selector, .ant-select-selection').filter({visible:true});trigger=await display.count()===1?display:parent;}
 }
 const initial=(await trigger.innerText()).trim();let search=null,initialQuery,queryApplied=false;
 const expanded=await l.evaluate(n=>n.getAttribute('aria-expanded'));
 if(expanded!=='true')await trigger.click({timeout:10000});
 try{
  let menus=page.locator(action.menuSelector||(family==='ud'?'.ud__select__list':family==='ant'?'.ant-select-dropdown':'[role="listbox"]')).filter({visible:true});
  const owned=await l.evaluate(n=>n.getAttribute('aria-controls')||n.getAttribute('aria-owns'));
  if(owned){
   const id='[id='+JSON.stringify(owned)+']';
   // rc-select's aria list may be a hidden accessibility mirror. Scope to its
   // actual popup ancestor, whose rendered options carry the click targets.
   menus=page.locator(family==='ant'?'.ant-select-dropdown'+id+', .ant-select-dropdown:has('+id+')':id).filter({visible:true});
  }
  if(await l.evaluate(n=>n.getAttribute('aria-expanded'))==='false')throw Error('CHOICE_TRIGGER_NOT_EXPANDED');
  await menus.waitFor({state:'visible',timeout:3000});
  if(await menus.count()!==1)throw Error('CHOICE_MENU_NOT_UNIQUE');
  const candidates=family==='ant'?[page.locator('.ant-select-open input.ant-select-search__field, .ant-select-open input.ant-select-selection-search-input').filter({visible:true})]:family==='ud'?[menus.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]').filter({visible:true}),l.filter({visible:true})]:[menus.locator('input[type="search"], input[role="combobox"], input[placeholder*="搜索"], input[placeholder*="Search"]').filter({visible:true}),l.filter({visible:true})];
  for(const candidate of candidates){if(await candidate.count()===1&&await candidate.evaluate(n=>n.tagName==='INPUT'&&!n.readOnly&&!n.disabled&&(n.type==='search'||n.getAttribute('role')==='combobox'||/搜索|search/i.test(n.getAttribute('placeholder')||n.className||'')))){search=candidate;break;}}
  const searchable=!!search;
  if(searchable){initialQuery=await search.evaluate(n=>n.value);if(action.query||!action.method.endsWith('_inspect')){await search.fill(action.query||String(value),{timeout:10000});await assertValue(search,action.query||String(value));queryApplied=true;}}
  const tree=family==='ud'&&await menus.evaluate(n=>!!n.classList?.contains('ud__treeSelect__overlay')||!!n.querySelector?.('.ud__tree'));
  let optionSelector=tree?UD_TREE_LEAF_LABEL:family==='ud'?'.ud__select__list__item':family==='ant'?'.ant-select-item-option, .ant-select-dropdown-menu-item':'[role="option"]';
  // Prefer actual renderer rows; the hidden rc-select ARIA mirror is not a click target.
  if(family==='ant'&&await menus.locator(optionSelector).filter({visible:true}).count()===0)optionSelector='[role="option"]';
  const options=menus.locator(optionSelector).filter({visible:true});
  if(tree&&action.method.endsWith('_inspect')&&await options.count()===0){
   const treeEvidence=await menus.evaluate(treeChoiceDOM);
   if(queryApplied&&initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000});await dismiss();await menus.waitFor({state:'hidden',timeout:3000});
   return {options:[],tree:treeEvidence,renderer:'ud_tree_select',restored:(await trigger.innerText()).trim()===initial&&await menus.count()===0,searchable,queryApplied,scope:'rendered_tree_branches',coverage:{complete:false,reason:'no_rendered_leaf_options'},status:'branches_only'};
  }
  const emptyEvidence=()=>menus.evaluate(n=>{
   const selectors='.ant-empty-description,.ant-select-item-empty,.ant-select-not-found,.ant-select-dropdown-menu-item-disabled,.ud__select__empty,[role="status"]';
   return [...n.querySelectorAll(selectors)].filter(e=>e.getClientRects().length).map(e=>e.textContent.trim()).filter(t=>/暂无数据|无匹配|无结果|未找到|not found|no (?:data|options|results)/i.test(t));
  });
  let empty=await emptyEvidence();
  if(!empty.length||await options.count()){
   try{await options.first().waitFor({state:'visible',timeout:3000});}catch(error){empty=await emptyEvidence();if(!action.method.endsWith('_inspect')||!queryApplied||!empty.length)throw error;}
  }
  if(action.method.endsWith('_inspect')&&queryApplied&&await options.count()===0&&empty.length){
   if(initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000});
   await dismiss();await menus.waitFor({state:'hidden',timeout:3000});
   return {options:[],optionRecords:[],restored:(await trigger.innerText()).trim()===initial&&await menus.count()===0,searchable,queryApplied,scope:'exact_search_results',coverage:{complete:true,reason:'observed_no_results',emptyEvidence:empty},status:'captured_empty_search'};
  }
  const optionText=action.optionTextMap?.[value]||String(value);
  const captured=await collectChoiceViews({read:()=>choiceViewport(menus,options,optionSelector),press:key=>(search||l).press(key),target:action.method.endsWith('_inspect')?undefined:optionText});
  const values=captured.options;
  if(action.method.endsWith('_inspect')){
   const treeEvidence=tree?await menus.evaluate(treeChoiceDOM):null;
   if(queryApplied&&initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000});
   await dismiss();
   await menus.waitFor({state:'hidden',timeout:3000});
   const restored=(await trigger.innerText()).trim()===initial&&await menus.count()===0;
   return {options:values,optionRecords:captured.optionRecords,restored,searchable,queryApplied,...(tree?{renderer:'ud_tree_select',tree:treeEvidence}:{}),scope:queryApplied&&action.query?'exact_search_results':tree?'rendered_tree_leaves':captured.complete?'all_menu_options':captured.steps?'partial_menu_options':'current_visible_menu',coverage:{complete:tree?false:captured.complete,reason:tree?'rendered_leaf_paths_only':captured.reason,keyboardSteps:captured.steps},status:'captured'};
  }
  if(action.optionTextMap&&(!action.observedOptionTexts?.includes(optionText)))throw Error('CHOICE_ALIAS_REQUIRES_CAPTURED_OPTION_TEXT');
  if(!action.options?.includes(String(value))||!values.includes(optionText))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
  let option=options.filter({hasText:exact(optionText)});
  if(await option.count()!==1)option=menus.locator(':is('+optionSelector+')[title='+JSON.stringify(optionText)+']').filter({visible:true});
  if(await option.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
  const candidate=await option.evaluate(choiceProofDOM);
  if(candidate.disabled)throw Error('CHOICE_OPTION_DISABLED');
  if(action.expectedOptionValue!=null&&candidate.value!==action.expectedOptionValue)throw Error('CHOICE_OPTION_VALUE_CHANGED');
  if(!verifyOnly)await option.click({timeout:10000});
  if(queryApplied&&initialQuery!==undefined&&verifyOnly)await search.fill(initialQuery,{timeout:10000});
  await dismiss();await menus.waitFor({state:'hidden',timeout:3000});
  const blurredLabel=(await trigger.innerText()).trim();
  if(blurredLabel!==optionText)throw Error('CHOICE_SELECTED_LABEL_MISMATCH');
  if(verifyOnly){const proof=confirmChoiceEvidence(candidate,candidate,{expectedLabel:optionText,blurredLabel});return {performed:false,selectionProof:proof,verification:'requires_independent_readback'};}
  // Reopen with no click on the option. Keyboard highlight or a search result
  // must not be confused with the portal's actual selected state.
  const checked=await performChoice(adapter,{...action,method:action.method+'_verify'},value,family);
  const proof=confirmChoiceEvidence(candidate,{...checked.selectionProof,selected:checked.selectionProof.reopenedOptionSelected},{expectedLabel:optionText,blurredLabel});
  return {performed:true,selectionProof:proof,verification:'requires_independent_readback'};
 }catch(e){if(queryApplied&&search&&initialQuery!==undefined)await search.fill(initialQuery,{timeout:10000}).catch(()=>{});await dismiss().catch(()=>{});throw e;}
}
async function performAntMulti(adapter,action,value){
 if(!Array.isArray(value)||new Set(value).size!==value.length||value.some(v=>!action.options?.includes(v)))throw Error('CAPTURED_MULTISELECT_VALUES_REQUIRED');
 const l=await locateControl(adapter.page,action),root=l.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]');
 if(await root.count()!==1||!await root.evaluate(n=>n.classList.contains('ant-select-multiple')||!!n.querySelector('.ant-select-selection--multiple,.ant-select-selection-overflow')))throw Error('OBSERVED_MULTISELECT_REQUIRED');
 const content='.ant-select-selection-item-content, .ant-select-selection__choice__content',read=()=>root.evaluate((n)=>[...n.querySelectorAll('.ant-select-selection-item-content, .ant-select-selection__choice__content')].map(e=>e.textContent.trim()));
 let current=await read();if(JSON.stringify(current)===JSON.stringify(value))return {performed:false,verification:'requires_independent_readback'};
 if(new Set(current).size!==current.length)throw Error('MULTISELECT_CHIPS_AMBIGUOUS');
 // Remove only observed selection chips in this question, never résumé rows.
 for(const text of current){const chip=root.locator('.ant-select-selection-item, .ant-select-selection__choice').filter({has:adapter.page.locator(content).filter({hasText:exact(text)})});if(await chip.count()!==1)throw Error('MULTISELECT_CHIP_NOT_UNIQUE');const remove=chip.locator('.ant-select-selection-item-remove, .ant-select-selection__choice__remove');if(await remove.count()!==1)throw Error('MULTISELECT_REMOVE_CONTROL_REQUIRED');await remove.click({timeout:10000});current=current.filter(v=>v!==text);await waitCommit(read,current);}
 for(const text of value)await performChoice(adapter,{...action,method:'ant_dropdown',query:action.queryMap?.[text]||text},text,'ant');
 await waitCommit(read,value);return {performed:true,verification:'requires_independent_readback'};
}
export async function performControl(adapter,action,value,files={}){

    if(!CONTROL_METHODS[action.method]){const url=new URL('./control-registry.mjs',import.meta.url);url.searchParams.set('revision',String((await stat(url)).mtimeMs));if(!(await import(url.href)).CONTROL_METHODS[action.method])throw Error('UNKNOWN_ACTION');}
    if(action.method==='capture_wecruit_schema')return captureWecruitSchema(adapter.page,action);
    if(!['wait','dropdown_inspect','ant_dropdown_inspect','ud_dropdown_inspect','ant_dropdown_verify','ud_dropdown_verify','dropdown_verify'].includes(action.method))await adapter.assertSingleEditor();
    if(action.method==='ant_day'){
      const url=new URL('./ant-date.mjs',import.meta.url);url.searchParams.set('revision',String((await stat(url)).mtimeMs));
      return (await import(url.href)).performAntDay(adapter,action,value);
    }
    if(action.method==='remove_uploaded_file'){
      const {performAttachmentRemoval}=await import(new URL('./uploaded-file-removal.mjs',import.meta.url));return performAttachmentRemoval(adapter,action);
    }
    if(action.method==='authorized_submit'){
      if(!/^[a-f0-9]{64}$/.test(action.approvalHash||'')||!action.button?.label)throw Error('ROLE_SUBMISSION_AUTHORIZATION_REQUIRED');
      if(!action.button.selector)throw Error('CAPTURED_SUBMISSION_BUTTON_REQUIRED');
      const button=adapter.page.locator(action.button.selector);
      if(await button.count()!==1||!await button.isEnabled())throw Error('SUBMISSION_BUTTON_NOT_UNIQUE_OR_ENABLED');
      const actual=await button.evaluate(n=>({label:(n.innerText||n.value||'').trim(),tag:n.tagName,type:n.type||'',disabled:!!n.disabled||n.getAttribute('aria-disabled')==='true'}));
      const {selector,...captured}=action.button;
      if(JSON.stringify(actual)!==JSON.stringify(captured)||actual.disabled||!await button.isVisible())throw Error('SUBMISSION_BUTTON_CHANGED');
      await button.click({timeout:10000});return {clicked:true};
    }
    if(action.provider==='feishu'&&!action.selectorsResolved)action=await adapter.page.evaluate(remapFeishuSpecDOM,action);
    action=await adapter.resolveSpec(action);
    if(action.method==='wait'&&action.operation==='compare_control_aliases'){
      if(!Array.isArray(action.alternatives)||!Array.isArray(action.references)||action.alternatives.length>600||action.references.length>600)throw Error('BOUNDED_SELECTOR_REFERENCES_REQUIRED');
      return adapter.page.evaluate(selectorAliasDOM,{alternatives:action.alternatives,references:action.references});
    }
    if(action.method==='wait')return adapter.wait(action.selector);
    if(action.method==='ant_multiselect')return performAntMulti(adapter,action,value);
    const l=await locateControl(adapter.page,action);
    const meta=await l.evaluate(n=>({tag:n.tagName,type:n.type||n.getAttribute('type'),role:n.getAttribute('role'),label:n.getAttribute('aria-label')||n.querySelector(':scope > .ant-form-item-label')?.innerText?.replace(/[＊*\s:：]+$/gu,'').trim()||n.textContent?.trim(),readonly:n.readOnly}));
    if(['ant_dropdown','ant_dropdown_inspect','ant_dropdown_verify'].includes(action.method))return performChoice(adapter,action,value,'ant');
    if(['ud_dropdown','ud_dropdown_inspect','ud_dropdown_verify'].includes(action.method))return performChoice(adapter,action,value,'ud');
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
    if(action.method==='select_multiple'){if(meta.tag!=='SELECT'||!await l.evaluate(n=>n.multiple)||!Array.isArray(value)||value.some(v=>!action.options?.includes(v)))throw Error('NATIVE_MULTISELECT_REQUIRED');await l.selectOption(value.map(label=>({label})));await l.press('Tab');await waitCommit(()=>l.evaluate(n=>[...n.selectedOptions].map(o=>o.textContent.trim())),value);return;}
    if(action.method==='select'){if(meta.tag!=='SELECT')throw Error('NATIVE_SELECT_REQUIRED');await l.selectOption({label:String(value)});await l.press('Tab');await waitCommit(()=>l.evaluate(n=>n.selectedOptions[0]?.textContent?.trim()),String(value));return;}
    if(['dropdown','dropdown_inspect','dropdown_verify'].includes(action.method))return performChoice(adapter,action,value,'aria');
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
