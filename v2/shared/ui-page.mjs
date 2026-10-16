import {captureWecruitSchema} from './ats-schema.mjs';
import {sharedRecordKey} from './shared-record.mjs';
import {antDOM} from './ant-reference.mjs';
import {performAntDay} from './ant-date.mjs';
import {stat,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {observeDOM} from './observation.mjs';
import {inventoryFeishuDOM} from './feishu-inventory.mjs';
import {remapFeishuSpecDOM,canonicalizeInventory} from './feishu-selectors.mjs';

// This function only reads rendered DOM; no framework state, cookies, request interception or value injection.
export function inventoryDOM() {
  const visible = n => !!n?.getClientRects().length && getComputedStyle(n).visibility!=='hidden';
  const diagnosticSelector = n => {
    if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1)return '#'+CSS.escape(n.id);
    const parts=[];
    for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
    return 'body > '+parts.join(' > ');
  };
  // Prefer semantic question identity. A structural path is retained only for
  // diagnostics; builders must not silently promote it to a reusable locator.
  const selector = n => {
    const unique = s => {try {const ns=document.querySelectorAll(s);return ns.length===1&&ns[0]===n;}catch{return false;}};
    if(n.id && unique('#'+CSS.escape(n.id)))return '#'+CSS.escape(n.id);
    const question=n.closest('.ud-formily-item[id]');
    let anchor;
    if(question){
      const qid='[id="'+CSS.escape(question.id)+'"]';
      if(document.querySelectorAll(qid).length===1)anchor=qid;
      else if(!n.closest('[id^="formily-item-"][id$="_list"]')&&document.querySelectorAll(qid+':not([id$="_list"] .ud-formily-item)').length===1)anchor=qid+':not([id$="_list"] .ud-formily-item)';
      else {
        const group=n.closest('[id^="formily-item-"][id$="_list"]');
        const row=n.closest('.register-form-group-wrapper');
        const card=row?.parentElement?.parentElement;
        if(group&&card&&card.className.split(/\s+/).some(c=>c.startsWith('apply-form-array-card__'))){
          const index=[...card.parentElement.children].indexOf(card)+1;
          anchor='#'+CSS.escape(group.id)+' [class^="apply-form-array-card__"]:nth-child('+index+') '+qid;
        }
      }
    }
    if(anchor){
      if(unique(anchor))return anchor;
      const tag=n.tagName.toLowerCase();
      const type=n.getAttribute('type');
      const simple=anchor+' '+tag+(type?'[type="'+CSS.escape(type)+'"]':'');
      if(unique(simple))return simple;
      // Date ranges and radio groups share one question. Index only within that
      // captured question, never relative to the page body or unrelated banners.
      const parts=[];
      for(let p=n;p&&p!==question;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
      const local=anchor+' > '+parts.join(' > ');
      if(unique(local))return local;
    }
    if(n.type==='checkbox'&&n.classList.contains('atsx-checkbox-input')&&unique('input.atsx-checkbox-input[type="checkbox"]'))return 'input.atsx-checkbox-input[type="checkbox"]';
    return diagnosticSelector(n);
  };
  const controls=[...document.querySelectorAll('input,textarea,select,[role="combobox"],[role="checkbox"],[role="radio"]')]
    // Styled checkbox/radio inputs can have zero layout rectangles while their labels remain visible.
    .filter(n=> (visible(n)||n.type==='file'||(['checkbox','radio'].includes(n.type)&&visible(n.closest('label')))) && n.type!=='hidden');
  // Some custom selectors and read-only answers contain no native/ARIA input.
  // Register their labeled question container so they cannot disappear from coverage.
  const containers=[...document.querySelectorAll('.atsx-form-item,[data-form-question],.ud-formily-item')]
    .filter(n=>visible(n)&&(n.querySelector('label')||n.querySelector(':scope > .ud-formily-item-label'))&&!controls.some(c=>n.contains(c)));
  return [...controls,...containers]
    .map(n=>({selector:selector(n),locatorStrategy:selector(n).startsWith('body > ')?'structural_diagnostic':'anchored_unique',tag:n.tagName.toLowerCase(),type:n.type||n.getAttribute('role')||'custom_question',label:[...(n.labels||[])].map(l=>l.textContent.trim()).join(' ')||n.closest('.atsx-form-item,[data-form-question]')?.querySelector('label')?.textContent.trim()||n.getAttribute('aria-label')||'',placeholder:n.getAttribute('placeholder'),required:!!n.required||n.getAttribute('aria-required')==='true'||!!n.closest('.atsx-form-item')?.querySelector('.atsx-form-item-required'),readonly:!!n.readOnly,disabled:!!n.disabled,accept:n.getAttribute('accept')}))
    .map(f=>({...f,userOnly:f.type==='password'||/otp|验证码|password|密码|token|captcha|身份证|护照号|银行卡/i.test(f.label+' '+f.selector)}))
    .map((f,i)=>{
      const n=[...controls,...containers][i],root=n.closest('.ud-formily-item');if(!root)return f;
      const label=root.querySelector(':scope > .ud-formily-item-label')?.innerText?.trim();
      const group=n.closest('[id^="formily-item-"][id$="_list"]'),row=n.closest('.register-form-group-wrapper');
      return {...f,label:label?.replace(/[＊*\s]+$/gu,'')||f.label,required:f.required||!!label&&/[＊*]/u.test(label),readonly:f.readonly||f.type==='custom_question',contextProvider:'.ud-formily-item',questionSelector:selector(root),group:group?.id?.replace('formily-item-','')||null,groupSelector:group?selector(group):null,rowSelector:row?selector(row):null,repeatIndex:group&&row?[...group.querySelectorAll('.register-form-group-wrapper')].indexOf(row):null,fieldKey:root.id?.replace('formily-item-','')||null,controlIndex:[...root.querySelectorAll('input,textarea,select,[role="combobox"]')].indexOf(n)};
    });
}

export class PageAdapter {
  constructor(page,{listOpenPageUrls}={}){Object.assign(this,{page,listOpenPageUrls});}
  async assertSingleEditor(){
    const key=sharedRecordKey(this.page.url());if(!key)return;
    const urls=this.listOpenPageUrls?await this.listOpenPageUrls():this.page.context().pages().filter(p=>p!==this.page&&!p.isClosed()).map(p=>p.url());
    const peers=urls.filter(url=>url!==this.page.url()&&/^https?:/.test(url)&&sharedRecordKey(url)===key);
    if(peers.length)throw Error('SHARED_RESUME_HAS_OTHER_OPEN_EDITORS');
  }
  async assertLocation(origin,prefix){const u=new URL(this.page.url());if(u.origin!==origin||!u.pathname.startsWith(prefix))throw Error('PAGE_IDENTITY_CHANGED');}
  async resolveSelector(selector){if(!selector?.startsWith('antq:'))return selector;const actual=await this.page.evaluate(antDOM,{operation:'resolve',reference:selector});return actual||':not(*)';}
  async resolveSpec(spec){
    const refs=new Set();const collect=v=>{if(typeof v==='string'&&v.startsWith('antq:'))refs.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};collect(spec);if(!refs.size)return spec;
    const keys=[...refs],values=await this.page.evaluate(antDOM,{operation:'resolve',references:keys}),mapping=new Map(keys.map((k,i)=>[k,values[i]||':not(*)']));
    const walk=v=>typeof v==='string'?mapping.get(v)||v:Array.isArray(v)?v.map(walk):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)])):v;return walk(spec);
  }
  async wait(selector){selector=await this.resolveSelector(selector);await this.page.locator(selector).waitFor({state:'visible',timeout:10000});}
  async inventory(plan){if(plan?.provider==='ant')return this.page.evaluate(antDOM);const raw=await this.page.evaluate(plan?.provider==='feishu'?inventoryFeishuDOM:inventoryDOM);return plan?.provider==='feishu'&&!plan.rawKeys?canonicalizeInventory(raw).fields:raw;}
  async observe(plan){if(plan.provider==='ant')plan=await this.resolveSpec(plan);const result=await this.page.evaluate(observeDOM,plan.provider==='feishu'&&!plan.selectorsResolved?await this.page.evaluate(remapFeishuSpecDOM,plan):plan);if(plan.roleIdentity){const u=new URL(result.pageUrl);result.roleIdentity={parameter:plan.roleIdentity.parameter,value:u.searchParams.get(plan.roleIdentity.parameter)};}return result;}
  async ensureGroups(groups){
    if(groups?.length)await this.assertSingleEditor();
    for(const group of groups||[]){
      const groupSelector=()=>this.resolveSelector(group.selector);
      let count=await this.page.locator(await groupSelector()).count();
      if(count>group.count)throw Error('EXCESS_REPEAT_ENTRIES_REQUIRE_REVIEW');
      while(count<group.count){
        const addLabel=group.addLabel||'添加';
        const add=this.page.locator(await this.resolveSelector(group.addSelector)).filter({hasText:new RegExp('^'+addLabel+'$')});
        if(await add.count()!==1||(await add.innerText()).trim()!==addLabel)throw Error('REPEAT_ADD_CONTROL_CHANGED');
        await add.click({timeout:10000});
        const next=await this.page.locator(await groupSelector()).count();
        if(next!==count+1)throw Error('REPEAT_ADD_DID_NOT_CREATE_ONE_ENTRY');
        count=next;
      }
    }
  }
  async act(action,value,files){
    if(action.method==='capture_wecruit_schema')return captureWecruitSchema(this.page,action);
    if(!['wait','ant_dropdown_inspect','ud_dropdown_inspect'].includes(action.method))await this.assertSingleEditor();
    if(action.method==='ant_day')return performAntDay(this,action,value);
    if(action.provider==='feishu'&&!action.selectorsResolved)action=await this.page.evaluate(remapFeishuSpecDOM,action);
    action=await this.resolveSpec(action);
    const l=this.page.locator(action.selector);
    if(await l.count()!==1)throw Error('AMBIGUOUS_ACTION_TARGET');
    const meta=await l.evaluate(n=>({tag:n.tagName,type:n.type||n.getAttribute('type'),role:n.getAttribute('role'),label:n.getAttribute('aria-label')||n.textContent?.trim(),readonly:n.readOnly}));
    if(['ant_dropdown','ant_dropdown_inspect'].includes(action.method)){
      if(meta.role!=='combobox')throw Error('ANT_COMBOBOX_REQUIRED');
      const initial=(await l.innerText()).trim();await l.click({timeout:10000});
      const search=this.page.locator('.ant-select-open input.ant-select-search__field');
      const searchable=await search.count()===1;
      const query=action.query;
      if(query&&searchable)await search.fill(query,{timeout:10000});
      const choices=this.page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [role="option"]');
      if(action.method==='ant_dropdown_inspect'){
        let values=[];try{await choices.first().waitFor({state:'visible',timeout:1500});values=(await choices.allTextContents()).map(v=>v.trim());}catch{}
        await this.page.locator('form.ant-form .ant-form-item-label').first().click({timeout:10000});
        try{await this.page.locator('.ant-select-dropdown:visible').first().waitFor({state:'hidden',timeout:2000});}catch{}
        const menuStillVisible=!!(await this.page.locator('.ant-select-dropdown:visible').count()),selectionChanged=(await l.innerText()).trim()!==initial;
        const restored=!menuStillVisible&&!selectionChanged;
        return {options:values,searchable,restored,restorationDiagnostics:{menuStillVisible,selectionChanged},scope:query?'exact_search_results':searchable?'current_search_results':'visible_menu',status:values.length?'captured':'needs_query_or_parent'};
      }
      if(!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      if(searchable)await search.fill(String(value),{timeout:10000});
      const optionText=action.optionTextMap?.[value]||String(value);
      const option=choices.filter({hasText:new RegExp('^'+optionText.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
      await option.waitFor({state:'visible',timeout:5000});if(await option.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');await option.click({timeout:10000});await l.press('Tab');return;
    }
    if(['ud_dropdown','ud_dropdown_inspect'].includes(action.method)){
      if(meta.role!=='combobox'||!action.labelSelector)throw Error('UD_CHOICE_CONTRACT_REQUIRED');
      const dismiss=()=>this.page.locator('p').filter({hasText:/^基本信息$/}).click({timeout:10000});
      await dismiss();
      await l.click({timeout:10000});
      const options=this.page.locator('.ud__select__list__item:visible');
      await options.first().waitFor({state:'visible',timeout:3000});
      if(action.method==='ud_dropdown_inspect'){
        const values=(await options.allTextContents({timeoutMs:10000})).map(s=>s.trim());
        await dismiss();
        await options.first().waitFor({state:'hidden',timeout:3000});
        return {options:values,restored:(await options.count())===0};
      }
      if(!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      const option=options.filter({hasText:new RegExp('^'+String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')});
      if(await option.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');await option.click({timeout:10000});await l.press('Tab');return;
    }
    if(action.method==='ud_date'){
      if(meta.tag!=='INPUT'||meta.readonly||meta.type!=='text'||!/^(?:\d{4}|\d{4}-\d{2}|至今)$/.test(String(value)))throw Error('UD_DATE_CONTRACT_REQUIRED');
      await l.fill(String(value),{timeout:10000});await l.press('Enter');await l.press('Tab');return;
    }
    if(action.method==='wait'){await this.wait(action.selector);return;}
    if(action.method==='click'){
      if(!action.label||meta.label!==action.label)throw Error('CLICK_LABEL_CHANGED');
      if(/提交|投递|撤回|删除|同意|签名|submit|apply|withdraw|delete|agree|consent/i.test(meta.label)||meta.type==='submit'||(meta.tag==='BUTTON'&&!meta.type))throw Error('POTENTIAL_SUBMISSION_BLOCKED');
      await l.click({timeout:10000});return;
    }
    if(action.method==='fill'){
      if(meta.readonly||['date','month','password','file','radio','checkbox'].includes(meta.type))throw Error('CONTROL_REQUIRES_SPECIFIC_ACTION');
      await l.fill(String(value),{timeout:10000});await l.press('Tab');return;
    }
    if(action.method==='select'){if(meta.tag!=='SELECT')throw Error('NATIVE_SELECT_REQUIRED');await l.selectOption({label:String(value)});return;}
    if(action.method==='dropdown'){
      if(meta.role!=='combobox'||!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      await l.click({timeout:10000});
      const option=this.page.getByRole('option',{name:String(value),exact:true});
      if(await option.count()!==1)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');
      await option.click({timeout:10000});await l.press('Tab');return;
    }
    if(action.method==='radio'){
      if(!action.options?.includes(String(value)))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
      await l.getByRole('radio',{name:String(value),exact:true}).check();return;
    }
    if(action.method==='feishu_month'){
      if(value!=='至今'&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value)))throw Error('INVALID_MONTH_VALUE');
      await l.click({timeout:10000});
      const base='.atsx-date-picker-period-month-panel-list-item';
      if(value==='至今')await this.page.locator(`${base}[data-cy="-"]:visible`).click({timeout:10000});
      else{
        const [year,month]=String(value).split('-');
        await this.page.locator(`${base}[data-cy="${year}"]:visible`).click({timeout:10000});
        await this.page.locator(`${base}[data-cy="${month}"]:visible`).click({timeout:10000});
      }
      return;
    }
    if(action.method==='feishu_year'){
      if(!/^\d{4}$/.test(String(value)))throw Error('INVALID_YEAR_VALUE');
      await l.click({timeout:10000});
      await this.page.locator('.atsx-date-picker-panel-body-cell-content:visible').filter({hasText:new RegExp(`^${value}$`)}).click({timeout:10000});
      await l.press('Tab');return;
    }
    if(action.method==='check'){if(typeof value!=='boolean')throw Error('BOOLEAN_REQUIRED');await l.setChecked(value);return;}
    if(action.method==='upload'){
      const asset=files[value];
      if(!asset?.paths?.length||!asset.displayNames?.length||asset.paths.length!==asset.displayNames.length)throw Error('FILE_REFERENCE_MISSING');
      for(const [index,file]of asset.paths.entries()){
        if(!path.isAbsolute(file)||!(await stat(file)).isFile())throw Error('INVALID_FILE_REFERENCE');
        if(!asset.sha256?.[index]||createHash('sha256').update(await readFile(file)).digest('hex')!==asset.sha256[index])throw Error('UPLOAD_FILE_HASH_MISMATCH');
      }
      await l.setInputFiles(asset.paths);
      if(action.successSelector)await this.page.locator(action.successSelector).waitFor({state:'visible',timeout:30000});
      return;
    }
    throw Error('UNKNOWN_ACTION');
  }
  async readBatch(fields){
    return this.page.evaluate(specs=>{
      const out={};
      for(const f of specs){
        const nodes=document.querySelectorAll(f.read.selector);
        if(nodes.length!==1){out[f.id]=null;continue;}
        const n=nodes[0];
        if(f.read.kind==='value')out[f.id]=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent?.trim():n.value??null;
        else if(f.read.kind==='checked')out[f.id]=typeof n.checked==='boolean'?n.checked:n.getAttribute('aria-checked')==='true';
        else if(f.read.kind==='text')out[f.id]=n.innerText?.trim()??null;
        else if(f.read.kind==='attribute')out[f.id]=n.getAttribute(f.read.attribute);
        // Only site-rendered attachment rows prove uploaded state; FileList merely proves local selection.
        else if(f.read.kind==='files')out[f.id]=f.read.filenameSelector?[...n.querySelectorAll(f.read.filenameSelector)].map(e=>e.innerText.trim()):null;
      }
      return out;
    },fields);
  }
  async validationErrors(selectors){return this.page.evaluate(ss=>ss.flatMap(s=>[...document.querySelectorAll(s)].filter(n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden').map(()=>({selector:s,visible:true}))),selectors);}
}
