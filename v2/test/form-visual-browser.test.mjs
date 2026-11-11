import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {PageAdapter} from '../shared/ui-page.mjs';
import {performControl} from '../shared/control-operations.mjs';
import {capturedChoiceAction} from '../shared/choice-actions.mjs';
import {inventoryFeishuDOM} from '../shared/feishu-inventory.mjs';
import {inspectCapturedChoice} from '../shared/choice-capture.mjs';
import {attachChoiceProofs} from '../shared/choice-verification.mjs';
import {performAutocompleteRestage,autocompleteValueHash} from '../shared/autocomplete-restage.mjs';
import {inferControl} from '../shared/form-construction.mjs';
import {primaryCandidates} from '../shared/form-visual-inventory.mjs';

const executablePath=process.env.RECRUITING_TEST_CHROME;
test('compound radio commits through its visible label and requires the rendered selection to agree', {skip:!executablePath},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<div id="radios"><label class="atsx-radio-wrapper">A<input type="radio"></label><label class="atsx-radio-wrapper atsx-radio-wrapper-checked">B<input type="radio" checked></label></div><script>
   const labels=[...document.querySelectorAll('label')];
   for(const label of labels){label.querySelector('input').onclick=e=>e.stopPropagation();label.onclick=()=>{for(const row of labels){row.classList.toggle('atsx-radio-wrapper-checked',row===label);row.querySelector('input').checked=row===label;}};}
  </script>`);
  const adapter=new PageAdapter(page);await performControl(adapter,{method:'radio',selector:'#radios',options:['A','B']},'A',{});
  const records=await adapter.observe({operation:'radioOptions',selector:'#radios'});assert.deepEqual(records.filter(row=>row.selected).map(row=>row.label),['A']);assert.equal(records[0].renderedChecked,true);
 }finally{await browser.close();}
});
test('UD compound inputs retain native identity while exposing date semantics, readonly value bodies and the visible upload title', {skip:!executablePath},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<section><div class="applyFormModuleWrapper-title">简历</div><div id="file" class="ud-formily-item"><div class="ud-formily-item-label" hidden>简历附件</div><div class="uploadFile"><input type="file"><div class="uploadFile-loadedWrapper"><p class="uploadFile-loadedFilename">approved.pdf</p></div></div></div></section><div id="phone" class="ud-formily-item"><div class="ud-formily-item-label">手机号码</div><div class="ud-formily-item-control-content-component">+86 182-0000-0000</div></div><div id="period" class="ud-formily-item"><div class="ud-formily-item-label">起止时间</div><div class="throne-biz-date-range-picker-input"><input value="2018-09"></div><div class="throne-biz-date-range-picker-input"><input value="2022-07"></div></div>');
  const adapter=new PageAdapter(page),controls=await adapter.inventory({});
  const date=controls.find(control=>control.semanticType==='month_picker');assert.equal(date.type,'text');assert.equal(inferControl(date),'month_picker');
  const file=controls.find(control=>control.type==='file');assert.equal(file.label,'简历附件');assert.equal(file.displayLabel,'简历');assert.equal(primaryCandidates({controls:[file]})[0].label,'简历');
  const phone=controls.find(control=>control.label==='手机号码');assert.equal(phone.readonly,true);
  const observed=await adapter.observe({fields:[{id:'phone',read:{selector:phone.readSelector,kind:'text'}},{id:'file',kind:'file',read:{selector:file.uploadContainerSelector,filenameSelector:file.filenameSelector,uploadedSelector:file.uploadedSelector,kind:'files'}}]});
  assert.equal(observed.fields.phone.value,'+86 182-0000-0000');assert.equal(observed.fields.file.uploadState,'site_rendered_uploaded');
 }finally{await browser.close();}
});
test('the upload collector preserves the rendered ATSX filename and verifies the loaded card', {skip:!executablePath},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<section class="uploadResume-section"><input type="file"><div class="uploadFile-loadedWrapper" hidden><p class="uploadFile-loadedFilename">approved.pdf</p></div></section>');
  const [control]=await page.evaluate(inventoryFeishuDOM),adapter=new PageAdapter(page);
  const plan={fields:[{id:'resume',kind:'file',read:{selector:control.uploadContainerSelector,filenameSelector:control.filenameSelector,uploadedSelector:control.uploadedSelector,kind:'files'}}]};
  assert.notEqual((await adapter.observe(plan)).fields.resume.uploadState,'site_rendered_uploaded');
  await page.locator('.uploadFile-loadedWrapper').evaluate(node=>{node.hidden=false;});
  const actual=(await adapter.observe(plan)).fields.resume;
  assert.equal(actual.uploadState,'site_rendered_uploaded');assert.deepEqual(actual.value,['approved.pdf']);
  await page.locator('.uploadFile-loadedWrapper').evaluate(node=>{node.insertAdjacentHTML('beforeend','<span role="progressbar">上传中</span>');});
  assert.notEqual((await adapter.observe(plan)).fields.resume.uploadState,'site_rendered_uploaded');
 }finally{await browser.close();}
});
test('searchable combobox containers use their own input and require the reopened option selection', {skip:!executablePath},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<div class="atsx-form-item" data-cy="education[0].school"><label>学校名称</label><div role="combobox" aria-expanded="false" aria-controls="results"><input></div></div><div id="results" role="listbox" hidden></div><script>
   let committed=false,clicks=0;
   const input=document.querySelector('input'),trigger=document.querySelector('[role=combobox]'),menu=document.getElementById('results');
   const open=()=>{if(!input.value)return;menu.innerHTML='<div role="option" aria-selected="'+committed+'">Example University</div>';menu.hidden=false;trigger.setAttribute('aria-expanded','true');menu.firstChild.onclick=()=>{clicks++;committed=true;input.value='Example University';menu.hidden=true;};};
   input.oninput=()=>{committed=false;open();};input.onclick=open;
   document.querySelector('label').onclick=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
   window.optionClickCount=()=>clicks;
   </script>`);
  const adapter=new PageAdapter(page),[field]=await page.evaluate(inventoryFeishuDOM);
  const inspected=await inspectCapturedChoice(adapter,{},field,'Example');
  assert.equal(inspected.restored,true);assert.deepEqual(inspected.options,['Example University']);
  const action={...capturedChoiceAction(field,'dropdown'),selectedSelector:field.selectedSelector,options:inspected.options};
  const filled=await performControl(adapter,action,'Example University',{});
  assert.equal(filled.selectionProof.reopenedOptionSelected,true);assert.equal(await page.evaluate(()=>window.optionClickCount()),1);
  const read=await adapter.observe({fields:[{id:'school',kind:'choice',read:{selector:field.searchSelector,kind:'value',selectedSelector:field.selectedSelector}}]});
  assert.equal(read.fields.school.value,'Example University');assert.equal(read.fields.school.selected,false);
  attachChoiceProofs(read,{school:{status:'verified',...filled.selectionProof}});assert.equal(read.fields.school.selected,true);
  read.fields.school.value='Typed only';read.fields.school.selected=false;
  attachChoiceProofs(read,{school:{status:'verified',...filled.selectionProof}});assert.equal(read.fields.school.selected,false);
  const restaged=await performAutocompleteRestage(adapter,{method:'aria_autocomplete_restage',selector:field.searchSelector,comboSelector:field.actionSelector,labelSelector:field.labelSelector,expectedPageUrl:page.url(),allowedBeforeValueHashes:[autocompleteValueHash('Example University')]},{sleep:async()=>{}});
  assert.equal(restaged.emptyVerified,true);assert.equal(restaged.selectionRestored,false);assert.equal(await page.locator('input').inputValue(),'');
 }finally{await browser.close();}
});
test('captured ARIA choices close by their question label when Escape only changes aria-expanded', {skip:!executablePath},async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<div class="atsx-form-item" data-cy="nation"><label>国家</label><div class="atsx-select-selection" role="combobox" tabindex="0" aria-expanded="false" aria-controls="countries"><span class="atsx-select-selection-selected-value">原值</span></div></div><div id="countries" role="listbox" hidden><div role="option">原值</div><div role="option">其他</div></div><script>
   const trigger=document.querySelector('[role=combobox]'),menu=document.getElementById('countries');
   trigger.onclick=()=>{menu.hidden=!menu.hidden;trigger.setAttribute('aria-expanded',String(!menu.hidden));};
   trigger.onkeydown=e=>{if(e.key==='Escape')trigger.setAttribute('aria-expanded','false');};
   document.querySelector('label').onclick=()=>{menu.hidden=true;trigger.setAttribute('aria-expanded','false');};
   </script>`);
  const [control]=await page.evaluate(inventoryFeishuDOM);
  const result=await inspectCapturedChoice(new PageAdapter(page),{},control);
  assert.equal(result.status,'captured');assert.equal(result.restored,true);
  assert.deepEqual(result.options,['原值','其他']);
  assert.equal(await page.locator('#countries').isVisible(),false);
  assert.equal(await page.locator('.atsx-select-selection-selected-value').innerText(),'原值');
 }finally{await browser.close();}
});
test('Chrome fixture discovers a zero-row section, replays its expansion, reads UD radio labels, and captures a typed search', {skip:!executablePath}, async()=>{
 const browser=await chromium.launch({executablePath,headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<main>
   <section id="accounts"><header><h2 id="heading">账号</h2><div><div><div><div><div><div><button id="add" type="button">＋ 添加</button></div></div></div></div></div></div></header><div id="account-fields"></div></section>
   <div id="referral" class="ud-formily-item"><div class="ud-formily-item-label">推荐方式</div>
     <label class="ud__radio"><input name="referral" type="radio" style="opacity:0">无</label>
     <label class="ud__radio"><input name="referral" type="radio" style="opacity:0">内推</label></div>
   <div class="atsx-form-item"><input id="school" role="combobox" aria-expanded="false" aria-controls="schools"><span id="selected"></span><div id="schools" role="listbox" hidden></div></div>
   </main><script>
   const el=id=>document.getElementById(id);
   el('add').onclick=()=>{el('account-fields').innerHTML='<label>账号地址 <input id="account"></label><input id="account-file" type="file" hidden>';};
   const input=el('school'),menu=el('schools');
   input.addEventListener('input',()=>{if(input.value==='Example'){menu.innerHTML='<div role="option">Example University</div>';menu.hidden=false;input.setAttribute('aria-expanded','true');}});
   input.addEventListener('keydown',e=>{if(e.key==='Escape'){menu.hidden=true;input.setAttribute('aria-expanded','false');}});
   </script>`);
  const adapter=new PageAdapter(page),initial=await adapter.inventory({});
  const {entrances}=await adapter.observe({acquisitionEntrances:{controls:initial}});
  assert.equal(entrances.find(e=>e.title==='账号')?.childSelectors.length,0);
  const entry=entrances.find(e=>e.title==='账号');
  await adapter.ensureGroups([{id:'accounts',selector:'#account',addSelector:entry.selector,addLabel:entry.triggerLabel,ownerSelector:entry.headingSelector,ownerTitle:entry.title,scopeSelector:entry.scopeSelector,count:1,visibleOnly:true}]);
  assert.equal((await adapter.inventory({})).filter(c=>c.selector==='#account').length,1);
  const expanded=await adapter.observe({fields:[],groups:[{id:'hidden-file-owner',selector:entry.scopeSelector,containsSelector:'#account-file'},{id:'outside-file-owner',selector:'#referral',containsSelector:'#account-file'}]});
  assert.equal(expanded.groups['hidden-file-owner'],1);assert.equal(expanded.groups['outside-file-owner'],0);
  assert.deepEqual(initial.filter(c=>c.type==='radio').map(c=>c.options),[['无','内推'],['无','内推']]);
  await performControl(adapter,{method:'radio',selector:'#referral',options:['无','内推']},'内推',{});
  assert.equal((await adapter.observe({fields:[{id:'referral',read:{selector:'#referral',kind:'radio'}}]})).fields.referral.value,'内推');
  const action=capturedChoiceAction({type:'school_text',contextProvider:'.atsx-form-item',selector:'#school'},'dropdown_inspect');
  const search=await performControl(adapter,{...action,selectedSelector:'#selected',query:'Example'},null,{});
  assert.deepEqual(search.options,['Example University']);assert.equal(search.restored,true);
  assert.equal(await page.locator('#school').inputValue(),'');
  await page.setContent('<main id="viewport" style="height:70vh;overflow:auto"><div style="height:2500px"><input></div></main>');
  const {surface}=await adapter.observe({acquisitionScroll:{}});
  assert.equal(surface.selector,'#viewport');
  const end=surface.extent-surface.height;
  assert.ok(end>1000);
  assert.equal((await adapter.observe({acquisitionScroll:{selector:surface.selector,top:end}})).surface.top,end);
  assert.equal((await adapter.observe({acquisitionScroll:{selector:surface.selector,top:surface.top}})).surface.top,surface.top);
 }finally{await browser.close();}
});
