// Serializable shared DOM policy. Reads rendered state only; no expected answers.
export function controlDOM(spec){
 const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const diagnosticSelector = n => {
  if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1)return '#'+CSS.escape(n.id);
  const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
  return 'body > '+parts.join(' > ');
 };
 const uploadRoots=()=>[...document.querySelectorAll('input[type="file"]')].flatMap(input=>{
  if(!input.closest('.ant-upload'))return [];
  for(let root=input.parentElement;root&&root!==document.body;root=root.parentElement){
   if(root.querySelectorAll('input[type="file"]').length!==1)break;
   const headings=[...root.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].filter(h=>visible(h)&&!h.closest('.ant-upload'));
   const label=headings[0]?.innerText?.trim();if(label)return [{input,root,label}];
  }return [];
 });
 const uploadRef=(entry,part='input')=>'uploadq:'+JSON.stringify({label:entry.label,occurrence:uploadRoots().filter(x=>x.label===entry.label).findIndex(x=>x.input===entry.input),part});
 if(spec?.operation==='resolveUpload')return (spec.references||[]).map(reference=>{const ref=JSON.parse(reference.slice(8)),entry=uploadRoots().filter(x=>x.label===ref.label)[ref.occurrence];if(!entry)return null;const root=diagnosticSelector(entry.root);return ref.part==='container'?root:ref.part==='uploaded'?root+' .ant-upload-list-item-done':diagnosticSelector(entry.input);});
 const eligible=n=>visible(n)||!!n&&['checkbox','radio'].includes(n.type)&&visible(n.closest('label'));
 // Phoenix question references are based on rendered section/label identity.
 // Structural selectors are produced only for the current operation.
 const phoenixRoots=()=>[...document.querySelectorAll('.form-item--phoenix')].filter(visible);
 const phoenixLabel=n=>n.querySelector('.form-item__title .form-item__text')?.textContent?.trim()||'';
 const phoenixSection=n=>{const body=n.closest('.form-part-body'),section=body?.parentElement;if(!section)return '';const heading=[...section.children].filter(c=>c!==body&&!c.contains(body)).map(c=>c.innerText?.trim()).find(Boolean);return heading?.split('\n')[0]?.trim()||'';};
 const phoenixParts=n=>{const radio=n.querySelector('.phoenix-radio-group');if(radio)return [{node:radio,part:'radio',type:'radio',renderer:'phoenix_radio'}];const select=n.querySelector('.phoenix-select');if(select)return [{node:select,part:'select',type:'combobox',renderer:n.querySelector('[id$="field_date_time_picker"]')?'phoenix_date_picker':'phoenix_select'}];const fields=[...n.querySelectorAll('input,textarea,select')].filter(x=>x.type!=='hidden'&&(visible(x)||x.type==='file'||['radio','checkbox'].includes(x.type)));if(fields.length)return fields.map((node,index)=>({node,part:'native',index,type:node.closest('.phoenix-auto-complete-container')?'combobox':node.type||node.tagName.toLowerCase(),renderer:node.closest('.phoenix-auto-complete-container')?'phoenix_autocomplete':'phoenix_native'}));return [{node:n.querySelector('.form-item__control')||n,part:'custom',type:'custom_question',renderer:'phoenix_unknown'}];};
 const phoenixResolve=reference=>{let r;try{r=JSON.parse(reference.slice(9));}catch{throw Error('PHOENIX_REFERENCE_INVALID');}const roots=phoenixRoots().filter(n=>phoenixLabel(n)===r.label&&phoenixSection(n)===r.section);if(!Number.isInteger(r.occurrence)||r.occurrence<0||r.occurrence>=roots.length)throw Error('PHOENIX_QUESTION_NOT_FOUND');const root=roots[r.occurrence],part=phoenixParts(root).filter(p=>p.part===r.part&&(p.index||0)===(r.controlIndex||0));if(part.length!==1)throw Error('PHOENIX_CONTROL_CHANGED');const node=part[0].node,parts=[];for(let p=node;p&&p!==document.body;p=p.parentElement){let i=1;for(let prev=p.previousElementSibling;prev;prev=prev.previousElementSibling)if(prev.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}return 'body > '+parts.join(' > ');};
 if(spec?.operation==='resolvePhoenix')return (spec.references||[]).map(phoenixResolve);
 const one=s=>{const nodes=s?[...document.querySelectorAll(s)]:[],shown=nodes.filter(eligible);return shown.length===1?shown[0]:shown.length===0&&nodes.length===1?nodes[0]:null;};
 if(Array.isArray(spec?.fields)){

  const text=n=>n?.innerText?.trim()??null;
  const errors=ss=>(ss||[]).flatMap(s=>[...document.querySelectorAll(s)].filter(visible).map(()=>({selector:s})));
  const fields={};
  for(const f of spec.fields){
    const r=f.read,n=one(r.selector);
    const o={present:!!n && (r.presenceSelector?visible(one(r.presenceSelector)):eligible(n)),value:null,errors:errors(r.errorSelectors)};
    if(f.userOnly){fields[f.id]={present:!!n && eligible(n),userOnly:true};continue;}
    if(n){
      if(r.kind==='value')o.value=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent?.trim()??null:n.value??null;
      else if(r.kind==='text')o.value=text(n);
      else if(r.kind==='checked')o.value=typeof n.checked==='boolean'?n.checked:n.getAttribute('aria-checked')==='true';
      else if(r.kind==='attribute')o.value=n.getAttribute(r.attribute);
      else if(r.kind==='month'){
        const y=n.querySelector('[data-cy="year"]'),m=n.querySelector('[data-cy="month"]');
        o.value=text(n)==='至今'?'至今':y&&m?`${text(y)}-${text(m)}`:null;
      }else if(r.kind==='radio'){
        o.value=(()=>{const selected=[...n.querySelectorAll('input:checked,[role=\"radio\"][aria-checked=\"true\"]')].filter(eligible);return selected.length===1?(selected[0].closest('label')?.textContent||selected[0].getAttribute('aria-label')||selected[0].textContent)?.trim()??null:null;})();
      }else if(r.kind==='files'){
        const names=r.filenameSelector?[...n.querySelectorAll(r.filenameSelector)].filter(visible).map(text):[];
        o.value=names;
        // A file input / FileList can never prove the server rendered an upload.
        o.uploadState=n.tagName!=='INPUT' && names.length && r.uploadedSelector && visible(one(r.uploadedSelector))?'site_rendered_uploaded':'unverified';
      }
      if(r.normalize==='ant_choice'&&n.closest('.ant-select')?.querySelector('.ant-select-selection__placeholder'))o.value=null;
      if(r.normalize==='phone_cn')o.value=String(o.value??'').replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
      if(f.kind==='choice'||f.kind==='date'){
        o.selected=n.tagName==='SELECT'?!!n.selectedOptions.length&&n.selectedOptions[0].value!=='':
          !!r.selectedSelector && visible(one(r.selectedSelector));
        if(f.kind==='choice'&&n.tagName!=='SELECT'){const marker=one(r.selectedSelector);if(!marker||['INPUT','TEXTAREA'].includes(marker.tagName)||marker.isContentEditable)o.selected=false;}
      }
    }
    fields[f.id]=o;
  }
  const groups={};
  for(const g of spec.groups||[])groups[g.id]=[...document.querySelectorAll(g.selector)].filter(n=>visible(n)&&(!g.containsSelector||!!one(g.containsSelector)&&n.contains(one(g.containsSelector)))).length;
  const sections=spec.sectionDiscovery?[...document.querySelectorAll(spec.sectionDiscovery.selector)].filter(visible).map(n=>{
    const root=spec.sectionDiscovery.parentContainer?n.parentElement:n;
    return {title:text(n.querySelector(spec.sectionDiscovery.titleSelector)),unexpanded:!!spec.sectionDiscovery.unexpandedSelector&&[...root.querySelectorAll(spec.sectionDiscovery.unexpandedSelector)].some(visible)};
  }):undefined;
  return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:location.href,
    roleTitle:text(one(spec.roleSelector)),fields,groups,sections,pageErrors:errors(spec.errorSelectors),saveEvidence:'not_verified'};

 }


  // Prefer semantic question identity. A structural path is retained only for
  // diagnostics; builders must not silently promote it to a reusable locator.
  const selector = n => {
    const unique = s => {try {const ns=document.querySelectorAll(s);return ns.length===1&&ns[0]===n;}catch{return false;}};
    if(n.id && unique('#'+CSS.escape(n.id)))return '#'+CSS.escape(n.id);
    for(const attribute of ['name','data-testid','aria-label','placeholder']){const value=n.getAttribute(attribute);if(value){const candidate=n.tagName.toLowerCase()+'['+attribute+'='+JSON.stringify(value)+']';if(unique(candidate))return candidate;}}
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
    if(['checkbox','radio'].includes(n.type)){
      const tail='input[type='+JSON.stringify(n.type)+']';
      for(let parent=n.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
        const anchors=[];
        if(parent.id)anchors.push('#'+CSS.escape(parent.id));
        for(const key of ['data-field','data-question-id','data-form-question','data-cy','aria-label']){
          const v=parent.getAttribute(key);if(v)anchors.push('['+key+'='+JSON.stringify(v)+']');
        }
        const classes=[...parent.classList].filter(c=>/^[a-zA-Z_][\w-]*$/.test(c)&&!/(?:^|[-_])[a-f0-9]{6,}(?:$|[-_])/.test(c)&&!/^(active|checked|selected|disabled|hidden|focus|open)$/i.test(c)&&/[-_]/.test(c)&&!/^ud(?:__|-)|^atsx-(?:checkbox|radio)/.test(c));
        for(const c of classes)anchors.push(parent.tagName.toLowerCase()+'.'+CSS.escape(c));
        for(const anchor of anchors){const candidate=anchor+' '+tail;if(unique(candidate))return candidate;}
      }
    }
    return diagnosticSelector(n);
  };
  const phoenixFields=phoenixRoots().flatMap(root=>{
    const label=phoenixLabel(root),section=phoenixSection(root),peers=phoenixRoots().filter(n=>phoenixLabel(n)===label&&phoenixSection(n)===section),occurrence=peers.indexOf(root);
    return phoenixParts(root).map(p=>({selector:'phoenixq:'+JSON.stringify({section,label,occurrence,part:p.part,controlIndex:p.index||0}),locatorStrategy:'semantic_question',tag:p.node.tagName.toLowerCase(),type:p.type,label,required:!!root.querySelector('.form-item__title .form-item__required'),readonly:!!p.node.readOnly,disabled:!!p.node.disabled,accept:p.node.getAttribute('accept'),placeholder:p.node.getAttribute('placeholder'),contextProvider:'.form-item--phoenix',group:section||null,repeatIndex:occurrence,renderer:p.renderer,options:p.part==='radio'?[...p.node.querySelectorAll('.phoenix-radio__radio-text')].filter(visible).map(n=>n.textContent.trim()):undefined,constructionBlockers:p.renderer==='phoenix_native'?[]:[p.renderer==='phoenix_radio'?'PHOENIX_RADIO_DRIVER_REQUIRED':p.renderer==='phoenix_unknown'?'PHOENIX_CONTROL_UNSUPPORTED':'PHOENIX_OPTIONS_AND_DRIVER_REQUIRED'],userOnly:p.type==='password'||/证件号码|身份证|护照号|验证码|密码/.test(label)}));
  });
  const controls=[...document.querySelectorAll('input,textarea,select,[role="combobox"],[role="checkbox"],[role="radio"]')]
    // Styled checkbox/radio inputs can have zero layout rectangles while their labels remain visible.
    .filter(n=> !n.closest('.form-item--phoenix')&&(visible(n)||n.type==='file'||(['checkbox','radio'].includes(n.type)&&visible(n.closest('label')))) && n.type!=='hidden');
  // Some custom selectors and read-only answers contain no native/ARIA input.
  // Register their labeled question container so they cannot disappear from coverage.
  const containers=[...document.querySelectorAll('.atsx-form-item,[data-form-question],.ud-formily-item')]
    .filter(n=>visible(n)&&(n.querySelector('label')||n.querySelector(':scope > .ud-formily-item-label'))&&!controls.some(c=>n.contains(c)));
  return [...controls,...containers]
    .map(n=>({selector:selector(n),locatorStrategy:selector(n).startsWith('body > ')?'structural_diagnostic':'anchored_unique',tag:n.tagName.toLowerCase(),type:n.type||n.getAttribute('role')||'custom_question',label:[...(n.labels||[])].map(l=>l.textContent.trim()).join(' ')||n.closest('.atsx-form-item,[data-form-question]')?.querySelector('label')?.textContent.trim()||n.getAttribute('aria-label')||'',placeholder:n.getAttribute('placeholder'),required:!!n.required||n.getAttribute('aria-required')==='true'||!!n.closest('.atsx-form-item')?.querySelector('.atsx-form-item-required'),readonly:!!n.readOnly,disabled:!!n.disabled,accept:n.getAttribute('accept'),role:n.getAttribute('role'),options:n.tagName==='SELECT'?[...(n.options||[])].filter(o=>!o.disabled&&o.value!=='').map(o=>o.textContent.trim()):undefined}))
    .map(f=>({...f,userOnly:f.type==='password'||/otp|验证码|password|密码|token|captcha|身份证|护照号|银行卡/i.test(f.label+' '+f.selector)}))
    .map((f,i)=>{
      const n=[...controls,...containers][i];
      if(n.type==='file'){const entry=uploadRoots().find(x=>x.input===n);if(entry)return {...f,observationSelector:f.selector,selector:uploadRef(entry),actionSelector:uploadRef(entry),label:entry.label,section:entry.label,locatorStrategy:'semantic_question',contextProvider:'.ant-upload',uploadContainerSelector:uploadRef(entry,'container'),filenameSelector:'.ant-upload-list-item-name',uploadedSelector:uploadRef(entry,'uploaded')};}
      const root=n.closest('.ud-formily-item');if(!root)return f;
      const label=root.querySelector(':scope > .ud-formily-item-label')?.innerText?.trim();
      const group=n.closest('[id^="formily-item-"][id$="_list"]'),row=n.closest('.register-form-group-wrapper');
      return {...f,label:label?.replace(/[＊*\s]+$/gu,'')||f.label,required:f.required||!!label&&/[＊*]/u.test(label),readonly:f.readonly||f.type==='custom_question',contextProvider:'.ud-formily-item',questionSelector:selector(root),labelSelector:selector(root)+' > .ud-formily-item-label',selectedSelector:root.querySelector('.ud__select__selector')?selector(root)+' .ud__select__selector':null,multiple:n.getAttribute('aria-multiselectable')==='true'||!!root.querySelector('.ud__select--multiple'),group:group?.id?.replace('formily-item-','')||null,groupSelector:group?selector(group):null,rowSelector:row?selector(row):null,repeatIndex:group&&row?[...group.querySelectorAll('.register-form-group-wrapper')].indexOf(row):null,fieldKey:root.id?.replace('formily-item-','')||null,controlIndex:[...root.querySelectorAll('input,textarea,select,[role="combobox"]')].indexOf(n)};
    }).concat(phoenixFields);

}

// Normalize legacy URL-encoded transport in Node, never inside the DOM sandbox.
export function normalizePhoenixReference(reference){if(!reference?.startsWith('phoenixq:'))return reference;const raw=reference.slice(9);let value;try{value=JSON.parse(raw);}catch{try{value=JSON.parse(decodeURIComponent(raw));}catch{throw Error('PHOENIX_REFERENCE_INVALID');}}return 'phoenixq:'+JSON.stringify(value);}
