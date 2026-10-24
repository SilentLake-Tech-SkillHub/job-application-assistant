// Serializable shared DOM policy. Reads rendered state only; no expected answers.
export function controlDOM(spec){
 const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const diagnosticSelector = n => {
  if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1)return '#'+CSS.escape(n.id);
  const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
  return 'body > '+parts.join(' > ');
 };
 if(['submission_controls','submission_receipt'].includes(spec?.operation)){
  const candidates=[...document.querySelectorAll('button,input[type="submit"]')].filter(visible).map(n=>({label:(n.innerText||n.value||'').trim(),tag:n.tagName,type:n.type||'',disabled:!!n.disabled||n.getAttribute('aria-disabled')==='true'})).filter(n=>/^(?:确认提交|提交申请|提交简历|提交|确认投递|投递简历|立即投递|Submit|Submit application|Apply)$/i.test(n.label));
  const receiptPattern=/^(?:恭喜(?:您)?[，,\s]*)?(?:您的)?(?:简历|职位申请)?(?:提交成功|投递成功|申请成功|已成功投递|已成功提交|申请已提交)[！!。.]?$/;
  const receipts=[...document.querySelectorAll('h1,h2,h3,p,span,div,[role="status"],[role="alert"]')].filter(n=>visible(n)&&!n.closest('button')&&receiptPattern.test(n.innerText?.trim()||'')&&![...n.children].some(c=>visible(c)&&c.innerText?.trim()===n.innerText?.trim())).map(n=>({text:n.innerText.trim(),selector:diagnosticSelector(n)}));
  const buttons=[...document.querySelectorAll('button,input[type="submit"]')].filter(visible).flatMap(n=>{const data={label:(n.innerText||n.value||'').trim(),tag:n.tagName,type:n.type||'',disabled:!!n.disabled||n.getAttribute('aria-disabled')==='true'};return candidates.some(c=>JSON.stringify(c)===JSON.stringify(data))?[{...data,selector:diagnosticSelector(n)}]:[];});
  return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:location.href,buttons,receipt:receipts.length===1?receipts[0]:null,receiptCount:receipts.length,validationErrors:[...document.querySelectorAll('.ant-form-item-explain-error,.has-error .ant-form-explain,.ant-message-error')].filter(visible).length};
 }
 const fileCandidates=root=>[...new Set([...root.querySelectorAll('.ant-upload-list-item-name,[class*="file-name"]'),...[...root.querySelectorAll('a,span,p,h1,h2,h3,h4,div,[data-file-name],[data-filename]')].filter(n=>visible(n)&&/^[^\n]{1,200}\.(?:pdf|docx?|png|jpe?g)$/i.test(n.innerText?.trim()||''))])].filter(n=>visible(n)&&![...(n.children||[])].some(child=>visible(child)&&child.innerText?.trim()===n.innerText?.trim()));
 const uploadComplete=root=>[...root.querySelectorAll('*')].some(n=>visible(n)&&/^(?:[\d.]+\s*(?:KB|MB|K|M)\s*[·|]\s*)?(?:已完成|上传成功|completed|uploaded|done)$/i.test(n.innerText?.trim()||''));
 const uploadRoots=()=>[...document.querySelectorAll('input[type="file"]')].flatMap(input=>{
  const phoenix=input.closest('.file-uploader__wrapper')?.closest('.form-item--phoenix');
  if(phoenix&&visible(phoenix)){const label=phoenix.querySelector('.form-item__title .form-item__text')?.textContent?.trim();if(label&&phoenix.querySelectorAll('input[type="file"]').length===1)return [{input,root:phoenix,label,contextProvider:'.form-item--phoenix'}];}
  if(input.closest('.ant-upload'))for(let root=input.parentElement;root&&root!==document.body;root=root.parentElement){
   if(root.querySelectorAll('input[type="file"]').length!==1)break;
   const names=fileCandidates(root).map(n=>n.innerText?.trim());
   const headings=[...root.querySelectorAll('h1,h2,h3,h4,[role="heading"]')].filter(h=>visible(h)&&!h.closest('.ant-upload,.ant-upload-list')&&!names.includes(h.innerText?.trim()));
   const label=headings[0]?.innerText?.trim();if(label)return [{input,root,label,contextProvider:'.ant-upload'}];
  }
  // A standalone upload section can have an independent title beside its body.
  // Only a real heading or explicit upload-field identity establishes the title.
  for(let root=input.parentElement;root&&root!==document.body;root=root.parentElement){
   if(root.querySelectorAll('input[type="file"]').length!==1)break;
   const children=[...(root.children||[])].filter(visible);if(children.length!==2)continue;
   const [title,body]=children;if(title.contains(input)||!body.contains(input))continue;
   const heading=/^H[1-6]$/.test(title.tagName)||title.getAttribute('role')==='heading',semantic=/^special_field_[a-z0-9_]*(?:upload|attachment|file)[a-z0-9_]*$/i.test(title.id||'');
   const label=String(title.innerText||title.textContent||'').trim();
   if((heading||semantic)&&label&&label.length<=120&&!label.includes('\n')&&!/\.(?:pdf|docx?|png|jpe?g)$/i.test(label)&&!title.querySelector('input,textarea,select'))return [{input,root,label,contextProvider:null,layout:'adjacent_title_unique_file'}];
  }
  return [];
 });
 const uploadRef=(entry,part='input')=>'uploadq:'+JSON.stringify({label:entry.label,occurrence:uploadRoots().filter(x=>x.label===entry.label).findIndex(x=>x.input===entry.input),part});
 const removeFor=(row,textSpans=false)=>{const nodes=[...row.querySelectorAll('button,a,[role="button"],[role="img"],[title]'+(textSpans?',span':''))].filter(n=>visible(n)&&/^(删除文件|删除|移除|delete|remove|remove file)$/i.test((n.getAttribute('aria-label')||n.getAttribute('title')||n.innerText||'').trim())).map(n=>n.closest('button,a,[role="button"]')||n);return [...new Set(nodes)].length===1?nodes[0]:null;};
 const filenameSelector='.ant-upload-list-item-name,[class*="file-name"]';
 const uploadPending=root=>[root,...root.querySelectorAll('*')].some(n=>visible(n)&&(n.getAttribute('aria-busy')==='true'||n.getAttribute('role')==='progressbar'||/^(?:(?:正在上传(?:文件)?|上传中|uploading)(?:[.。…\s]*|\s*\d+(?:\.\d+)?%)|\d+(?:\.\d+)?%)$/i.test(n.innerText?.trim()||'')));
 const uploadError=root=>[root,...root.querySelectorAll('*')].some(n=>visible(n)&&(n.getAttribute('aria-invalid')==='true'||/^(?:上传失败|上传错误|upload failed|upload error)$/i.test(n.innerText?.trim()||'')));
 // Source-verified Phoenix HC renderer, module 98670: only done renders module
 // 30914 (download) / 79025 (preview). Filename, file-type and delete also occur
 // in non-done states. This hash documents the rule source, not a live hash read.
 const phoenixDoneEvidence=(entry,name,requiredIcon=null)=>{
  if(entry.contextProvider!=='.form-item--phoenix')return null;
  const base='https://acdn.bstatics.com/ux/ux-recruitment-portal-2022-form-pc/release/dist/',library=base+'beisen-phoenix-part2-502f98f31630e64ee05b.chk.js',bootstrap=base+'pcform-e1944db80b7bd4c43439.chunk.min.js';
  const assetUrl=value=>{try{return new URL(value,location.href).href;}catch{return value;}};
  const scripts=[...document.querySelectorAll('script[src]')].map(n=>assetUrl(n.getAttribute('src')));
  const resources=typeof performance!=='undefined'&&typeof performance.getEntriesByType==='function'?performance.getEntriesByType('resource').map(n=>assetUrl(n.name)):[];
  const loadedVersionEvidence=scripts.includes(library)||resources.includes(library)?'library_resource_url':scripts.includes(bootstrap)?'entry_script_known_chunk_map':null;
  if(!loadedVersionEvidence)return null;
  const card=name.closest('.sc-lkgTHX'),list=card?.parentElement;
  if(!card||!list?.matches('.file-uploader__list-view')||!entry.root.contains(card)||!visible(card)||fileCandidates(card).length!==1||fileCandidates(card)[0]!==name)return null;
  const row=card.children[0],parts=row?[...row.children]:[];
  if(card.children.length!==1||!row?.matches('.sc-jlRLRk')||parts.length!==3||!parts[0].matches('.sc-cbTzjv')||!parts[1].matches('.sc-dUbtfd')||!parts[1].contains(name)||!parts[2].matches('.sc-htJRVC'))return null;
  const paths={download:'M9.5 12.515c.748-.75 2.353-2.353 4.814-4.812l.707.707-5.303 5.303c-.39.39-1.028.387-1.415 0L3 8.41l.707-.707L8.5 12.496V2.383C8.5 2.17 8.724 2 9 2s.5.171.5.383v10.132zM2.404 16C2.18 16 2 15.776 2 15.5s.18-.5.404-.5h13.192c.223 0 .404.224.404.5s-.18.5-.404.5H2.404z',preview:'M.156 8.464c.117-.185.33-.487.633-.868.5-.628 1.079-1.254 1.735-1.841C4.437 4.042 6.608 3 9 3c2.38 0 4.549 1.042 6.466 2.754a15.213 15.213 0 0 1 1.74 1.84c.304.38.518.682.636.867a1 1 0 0 1-.002 1.081c-.118.184-.333.486-.64.866a15.36 15.36 0 0 1-1.744 1.839C13.535 13.958 11.37 15 9 15c-2.38 0-4.549-1.042-6.466-2.754a15.213 15.213 0 0 1-1.74-1.84c-.304-.38-.518-.682-.636-.867a1 1 0 0 1-.002-1.075zM1 9s3.2 5 8 5c4.775 0 8-5 8-5s-3.2-5-8-5C4.175 4 1 9 1 9zm5 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm1 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0z'};
  for(const action of parts[2].children){
   if(!action.matches('.sc-fIosxK')||!visible(action))continue;
   const svgs=[...action.querySelectorAll('svg')].filter(visible);if(svgs.length!==1)continue;
   const actual=[...svgs[0].querySelectorAll('path')].map(n=>n.getAttribute('d'));
   const icon=Object.keys(paths).find(key=>actual.length===2&&actual[0]==='M0 0h18v18H0z'&&actual[1]===paths[key]);
   if(icon&&(!requiredIcon||icon===requiredIcon))return {kind:'phoenix_done_action_icon',renderer:'beisen_phoenix_filecard_hc',icon,actionSelector:diagnosticSelector(action),loadedVersionEvidence,expectedLibraryUrl:library,contractSourceSha256:'601c6d6822be687de67c8dc69ffb4fccec5aca4c78699860175fa46c11304992'};
  }
  return null;
 };
 const replaceFor=row=>{const nodes=[...row.querySelectorAll('button,a,[role="button"],span')].filter(n=>visible(n)&&/^(?:重新上传|替换文件|reupload|replace file)$/i.test(n.innerText?.trim()||''));return nodes.length===1?nodes[0]:null;};
 const uploadRows=entry=>{
  const standalone=entry.layout==='adjacent_title_unique_file';if(uploadPending(entry.root)||uploadError(entry.root))return [];
  return fileCandidates(entry.root).map(name=>{const evidence=phoenixDoneEvidence(entry,name);if(evidence)return {row:name.closest('.sc-lkgTHX'),name,evidence};let row=name.parentElement;while(row){if(fileCandidates(row).length!==1)break;if(removeFor(row,standalone)||(standalone?replaceFor(row):uploadComplete(row)))return {row,name};if(row===entry.root)break;row=row.parentElement;}if(standalone)return null;const done=name.closest('.ant-upload-list-item-done');return done?{row:done,name}:null;}).filter(Boolean);
 };
 const uploadItems=entry=>uploadRows(entry).map(({row,name,evidence})=>{const filename=name.innerText?.trim(),remove=removeFor(row,entry.layout==='adjacent_title_unique_file');return {filename,...(evidence?{uploadEvidence:evidence}:{}),removeSelector:remove&&filename?'uploadq:'+JSON.stringify({...JSON.parse(uploadRef(entry).slice(8)),part:'remove',filename}):null};});
 if(spec?.operation==='resolveUploadDownload'){
  const roots=[...document.querySelectorAll(spec.containerSelector)].filter(visible);if(roots.length!==1)return null;
  const entry=uploadRoots().find(item=>item.root===roots[0]);if(!entry)return null;
  const rows=uploadRows(entry).filter(item=>item.name.innerText.trim()===spec.filename);if(rows.length!==1)return null;
  return phoenixDoneEvidence(entry,rows[0].name,'download')?.actionSelector||null;
 }
 if(spec?.operation==='resolveUpload')return (spec.references||[]).map(reference=>{const ref=JSON.parse(reference.slice(8)),entry=uploadRoots().filter(x=>x.label===ref.label)[ref.occurrence];if(!entry)return null;const root=diagnosticSelector(entry.root);if(ref.part==='filenames')return uploadRows(entry).map(({name})=>diagnosticSelector(name)).join(',')||null;if(ref.part==='remove'){const rows=uploadRows(entry).filter(({name})=>name.innerText?.trim()===ref.filename);const remove=rows.length===1?removeFor(rows[0].row,entry.layout==='adjacent_title_unique_file'):null;return remove?diagnosticSelector(remove):null;}return ref.part==='container'?root:ref.part==='uploaded'?uploadRows(entry).length?root:null:diagnosticSelector(entry.input);});
 const eligible=n=>visible(n)||!!n&&['checkbox','radio'].includes(n.type)&&visible(n.closest('label'));
 // Phoenix question references are based on rendered section/label identity.
 // Structural selectors are produced only for the current operation.
 const phoenixRoots=()=>[...document.querySelectorAll('.form-item--phoenix')].filter(visible);
 const phoenixLabel=n=>n.querySelector('.form-item__title .form-item__text')?.textContent?.trim()||'';
 const phoenixSection=n=>{
  const body=n.closest('.form-part-body'),section=body?.parentElement;
  const known=section&&[...section.children].filter(c=>c!==body&&!c.contains(body)).map(c=>c.innerText?.trim()).find(Boolean);if(known)return known.split('\n')[0].trim();
  for(let root=n.parentElement;root&&root!==document.body;root=root.parentElement){
   const children=[...(root.children||[])],owner=children.findIndex(c=>c===n||c.contains(n));if(owner<1)continue;
   if(root.querySelectorAll('.form-item--phoenix').length<2)continue;
   const headings=children.slice(0,owner).filter(c=>visible(c)&&!c.querySelector('input,textarea,select,[role="combobox"],[role="checkbox"],[role="radio"]')).map(c=>c.innerText?.trim()).filter(t=>t&&t.length<=60&&!t.includes('\n')&&!/^(添加|新增|删除|移除|展开|收起)/.test(t));
   if(headings.length===1)return headings[0];
  }
  return '';
 };
 const phoenixInlineOngoing=root=>{
  const col=root.closest('.fields-col');if(!col||col.querySelectorAll('.form-item--phoenix').length!==1)return null;
  const boxes=[...col.querySelectorAll('input[type="checkbox"]')].filter(eligible);if(boxes.length!==1)return null;
  const node=boxes[0];let marker=node.parentElement;
  while(marker&&marker!==col){if(visible(marker)&&marker.innerText?.trim()==='至今'&&marker.querySelectorAll('input[type="checkbox"]').length===1)return {node,scope:col,label:'至今',evidence:'same observed date column; one checkbox; exact rendered 至今 marker'};marker=marker.parentElement;}
  return null;
 };
 const phoenixParts=n=>{const radio=n.querySelector('.phoenix-radio-group');if(radio)return [{node:radio,part:'radio',type:'radio',renderer:'phoenix_radio'}];const select=n.querySelector('.phoenix-select');if(select)return [{node:select,part:'select',type:'combobox',renderer:n.querySelector('[id$="field_date_time_picker"]')?'phoenix_date_picker':'phoenix_select'}];const fields=[...n.querySelectorAll('input,textarea,select')].filter(x=>x.type!=='hidden'&&(visible(x)||x.type==='file'||['radio','checkbox'].includes(x.type)));if(fields.length)return fields.map((node,index)=>({node,part:'native',index,type:node.closest('.phoenix-auto-complete-container')?'combobox':node.type||node.tagName.toLowerCase(),renderer:node.closest('.phoenix-auto-complete-container')?'phoenix_autocomplete':'phoenix_native'}));return [{node:n.querySelector('.form-item__control')||n,part:'custom',type:'custom_question',renderer:'phoenix_unknown'}];};
 const phoenixResolve=reference=>{
  let r;try{r=JSON.parse(reference.slice(9));}catch{throw Error('PHOENIX_REFERENCE_INVALID');}
  if(['repeatRecords','repeatAdd'].includes(r.part)){
   if(!r.title||!r.headingSelector||!r.containerSelector||!r.recordSelector?.startsWith(':scope > ')||r.recordSelector.includes(','))throw Error('REPEAT_CAPTURED_SCOPE_REQUIRED');
   const headings=[...document.querySelectorAll(r.headingSelector)].filter(n=>visible(n)&&n.innerText?.trim()===r.title);
   if(headings.length!==1)throw Error('REPEAT_HEADING_NOT_UNIQUE');
   const root=headings[0].closest(r.containerSelector);if(!root||!visible(root))throw Error('REPEAT_SECTION_NOT_FOUND');
   if(r.part==='repeatRecords')return diagnosticSelector(root)+r.recordSelector.slice(6);
   const buttons=[...root.querySelectorAll(r.addSelector)].filter(n=>visible(n)&&n.innerText?.trim()===r.addLabel);
   if(buttons.length!==1)throw Error('REPEAT_ADD_CONTROL_CHANGED');return diagnosticSelector(buttons[0]);
  }
  const roots=phoenixRoots().filter(n=>phoenixLabel(n)===r.label&&phoenixSection(n)===r.section);
  if(!Number.isInteger(r.occurrence)||r.occurrence<0||r.occurrence>=roots.length)throw Error('PHOENIX_QUESTION_NOT_FOUND');
  const root=roots[r.occurrence];
  if(r.part==='ongoingInline'){const inline=phoenixInlineOngoing(root);return inline?diagnosticSelector(inline.node):null;}
  if(r.part==='documentType'){const prefix=root.querySelector('.form-item__control .phoenix-button__content');return prefix?diagnosticSelector(prefix):null;}
  if(r.part==='label')return diagnosticSelector(root.querySelector('.form-item__title .form-item__text'));
  if(r.part==='selected'){const content=root.querySelector('.phoenix-select__content');return content?diagnosticSelector(content):null;}
  const part=phoenixParts(root).filter(p=>p.part===r.part&&(p.index||0)===(r.controlIndex||0));
  if(part.length!==1)throw Error('PHOENIX_CONTROL_CHANGED');
  return diagnosticSelector(part[0].node);
 };
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
      const question=n.closest?.('.ant-form-item,.ud-formily-item,.atsx-form-item,.form-item--phoenix');
      const invalid=n.getAttribute?.('aria-invalid')==='true';
      const renderedErrors=question?[...question.querySelectorAll('.ant-form-item-explain-error,.has-error .ant-form-explain,.ud-formily-item-feedback-error')].filter(visible):[];
      if(invalid||renderedErrors.length)o.errors.push({scope:'question',source:invalid?'aria_invalid':'rendered_validation'});
      if(r.requireDisabled)o.disabled=n.disabled===true||n.getAttribute('aria-disabled')==='true'||!!n.closest('.ant-select-disabled,[aria-disabled="true"]');
      if(r.kind==='value')o.value=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent?.trim()??null:n.value??null;
      else if(r.kind==='text')o.value=r.ongoingSelector&&one(r.ongoingSelector)?.checked===true?'至今':text(n);
      else if(r.kind==='selected_values')o.value=n.tagName==='SELECT'?[...n.selectedOptions].filter(o=>o.value!=='').map(o=>o.textContent.trim()):[...n.querySelectorAll(r.itemSelector)].map(e=>e.textContent.trim());
      else if(r.kind==='checked')o.value=typeof n.checked==='boolean'?n.checked:n.getAttribute('aria-checked')==='true';
      else if(r.kind==='attribute')o.value=n.getAttribute(r.attribute);
      else if(r.kind==='month'){
        const y=n.querySelector('[data-cy="year"]'),m=n.querySelector('[data-cy="month"]');
        o.value=text(n)==='至今'?'至今':y&&m?`${text(y)}-${text(m)}`:null;
      }else if(r.kind==='radio'){
        o.value=(()=>{const custom=[...n.querySelectorAll('.phoenix-radio')].filter(e=>visible(e)&&/(?:--|__)checked(?:\s|$)/.test(e.className));if(custom.length===1)return custom[0].querySelector('.phoenix-radio__radio-text')?.textContent.trim()||null;const selected=[...n.querySelectorAll('input:checked,[role=\"radio\"][aria-checked=\"true\"]')].filter(eligible);return selected.length===1?(selected[0].closest('label')?.textContent||selected[0].getAttribute('aria-label')||selected[0].textContent)?.trim()??null:null;})();
      }else if(r.kind==='files'){
        const names=r.filenameSelector?[...n.querySelectorAll(r.filenameSelector)].filter(visible).map(text):[];
        o.value=names;
        // A file input / FileList can never prove the server rendered an upload.
        o.uploadState=n.tagName!=='INPUT' && names.length && r.uploadedSelector && visible(one(r.uploadedSelector))&&!uploadPending(n)&&!uploadError(n)?'site_rendered_uploaded':'unverified';
        const entry=uploadRoots().find(e=>e.root===n);if(entry)o.uploadEvidence=uploadRows(entry).flatMap(item=>item.evidence?[{filename:item.name.innerText.trim(),...item.evidence}]:[]);
      }
      if(r.normalize==='ant_choice'&&n.closest('.ant-select')?.querySelector('.ant-select-selection__placeholder'))o.value=null;
      if(r.normalize==='phone_cn')o.value=String(o.value??'').replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
      if(f.kind==='choice'||f.kind==='date'){
        o.selected=n.tagName==='SELECT'?!!n.selectedOptions.length&&n.selectedOptions[0].value!=='':
          !!r.selectedSelector && visible(one(r.selectedSelector));
        if(f.kind==='choice'&&n.tagName!=='SELECT'){const marker=one(r.selectedSelector);if(!marker||['INPUT','TEXTAREA'].includes(marker.tagName)||marker.isContentEditable)o.selected=false;}
      }
    }
    if(f.kind==='date'&&r.ongoingSelector){const ongoing=one(r.ongoingSelector);if(ongoing?.type==='checkbox'&&ongoing.checked===true&&eligible(ongoing)){o.present=true;o.value='至今';o.selected=true;}}
    fields[f.id]=o;
  }
  const groups={};
  for(const g of spec.groups||[])groups[g.id]=[...document.querySelectorAll(g.selector)].filter(n=>visible(n)&&(!g.containsSelector||!!one(g.containsSelector)&&n.contains(one(g.containsSelector)))).length;
  const sections=spec.sectionDiscovery?[...new Set((spec.sectionDiscovery.selectors||[spec.sectionDiscovery.selector]).flatMap(selector=>[...document.querySelectorAll(selector)]))].filter(visible).map(n=>{
    const root=spec.sectionDiscovery.parentContainer?n.parentElement:n;
    return {title:text(n.querySelector(spec.sectionDiscovery.titleSelector)),unexpanded:!!spec.sectionDiscovery.unexpandedSelector&&[...root.querySelectorAll(spec.sectionDiscovery.unexpandedSelector)].some(visible)};
  }):undefined;
  const roleNode=one(spec.roleSelector),rawRoleTitle=roleNode?.innerText??null;
  const hasRolePrefix=spec.rolePrefix!==undefined,prefixApplied=hasRolePrefix&&typeof spec.rolePrefix==='string'&&typeof rawRoleTitle==='string'&&rawRoleTitle.startsWith(spec.rolePrefix);
  const roleTitle=prefixApplied?rawRoleTitle.slice(spec.rolePrefix.length).trim():text(roleNode);
  return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:location.href,
    roleTitle,...(hasRolePrefix?{rawRoleTitle,prefixApplied}:{}),fields,groups,sections,pageErrors:errors(spec.errorSelectors),saveEvidence:'not_verified'};

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
    const label=phoenixLabel(root),section=phoenixSection(root),inline=phoenixInlineOngoing(root),peers=phoenixRoots().filter(n=>phoenixLabel(n)===label&&phoenixSection(n)===section),occurrence=peers.indexOf(root);
    return phoenixParts(root).map(p=>({inlineOngoing:p.renderer==='phoenix_date_picker'&&inline?{label:inline.label,evidence:inline.evidence,selector:'phoenixq:'+JSON.stringify({section,label,occurrence,part:'ongoingInline'})}:undefined,diagnosticSelector:diagnosticSelector(p.renderer==='phoenix_date_picker'&&inline?inline.scope:p.node),selector:'phoenixq:'+JSON.stringify({section,label,occurrence,part:p.part,controlIndex:p.index||0}),labelSelector:'phoenixq:'+JSON.stringify({section,label,occurrence,part:'label'}),selectedSelector:p.part==='select'?'phoenixq:'+JSON.stringify({section,label,occurrence,part:'selected'}):undefined,documentTypePrefix:/证件号码|身份证号码/.test(label)&&root.querySelector('.form-item__control .phoenix-button__content')?{label:root.querySelector('.form-item__control .phoenix-button__content').innerText?.trim(),selector:'phoenixq:'+JSON.stringify({section,label,occurrence,part:'documentType'})}:undefined,locatorStrategy:'semantic_question',tag:p.node.tagName.toLowerCase(),type:p.type,label,required:!!root.querySelector('.form-item__title .form-item__required'),readonly:!!p.node.readOnly,disabled:!!p.node.disabled,accept:p.node.getAttribute('accept'),placeholder:p.node.getAttribute('placeholder'),contextProvider:'.form-item--phoenix',group:section||null,repeatIndex:occurrence,renderer:p.renderer,options:p.part==='radio'?[...p.node.querySelectorAll('.phoenix-radio__radio-text')].filter(visible).map(n=>n.textContent.trim()):undefined,constructionBlockers:['phoenix_native','phoenix_select','phoenix_radio'].includes(p.renderer)?[]:[p.renderer==='phoenix_radio'?'PHOENIX_RADIO_DRIVER_REQUIRED':p.renderer==='phoenix_unknown'?'PHOENIX_CONTROL_UNSUPPORTED':'PHOENIX_OPTIONS_AND_DRIVER_REQUIRED'],userOnly:p.type==='password'||/证件号码|身份证|护照号|验证码|密码/.test(label)}));
  });
  const navigationScope=n=>{const nav=n.closest('nav,header,[role="navigation"],[role="search"],.print-nav');return nav&&!n.closest('.form-item--phoenix,.ant-form-item,.ud-formily-item,.atsx-form-item')?{reason:'outside_application_form',kind:'navigation',containerSelector:diagnosticSelector(nav),controlSelector:diagnosticSelector(n)}:null;};
  const dateAuxiliaries=new Set(phoenixRoots().filter(r=>r.querySelector('[id$="field_date_time_picker"]')).map(phoenixInlineOngoing).filter(Boolean).map(a=>a.node));
  const controls=[...document.querySelectorAll('input,textarea,select,[role="combobox"],[role="checkbox"],[role="radio"]')]
    // Styled checkbox/radio inputs can have zero layout rectangles while their labels remain visible.
    .filter(n=> !dateAuxiliaries.has(n)&&!n.closest('.form-item--phoenix')&&(visible(n)||n.type==='file'||(['checkbox','radio'].includes(n.type)&&visible(n.closest('label')))) && n.type!=='hidden');
  // Some custom selectors and read-only answers contain no native/ARIA input.
  // Register their labeled question container so they cannot disappear from coverage.
  const containers=[...document.querySelectorAll('.atsx-form-item,[data-form-question],.ud-formily-item')]
    .filter(n=>visible(n)&&(n.querySelector('label')||n.querySelector(':scope > .ud-formily-item-label'))&&!controls.some(c=>n.contains(c)));
  return [...controls,...containers]
    .map(n=>({outsideApplicationForm:navigationScope(n),diagnosticSelector:diagnosticSelector(n),selector:selector(n),locatorStrategy:selector(n).startsWith('body > ')?'structural_diagnostic':'anchored_unique',tag:n.tagName.toLowerCase(),type:n.type||n.getAttribute('role')||'custom_question',label:[...(n.labels||[])].map(l=>l.textContent.trim()).join(' ')||n.closest('.atsx-form-item,[data-form-question]')?.querySelector('label')?.textContent.trim()||n.getAttribute('aria-label')||'',placeholder:n.getAttribute('placeholder'),required:!!n.required||n.getAttribute('aria-required')==='true'||!!n.closest('.atsx-form-item')?.querySelector('.atsx-form-item-required'),readonly:!!n.readOnly,disabled:!!n.disabled,accept:n.getAttribute('accept'),role:n.getAttribute('role'),options:n.tagName==='SELECT'?[...(n.options||[])].filter(o=>!o.disabled&&o.value!=='').map(o=>o.textContent.trim()):undefined,optionRecords:n.tagName==='SELECT'?[...(n.options||[])].map(o=>({label:o.textContent.trim(),value:o.value,valueAttribute:'value',disabled:!!o.disabled||!!o.closest?.('optgroup')?.disabled,selected:!!o.selected})):undefined}))
    .map(f=>({...f,userOnly:f.type==='password'||/otp|验证码|password|密码|token|captcha|身份证|护照号|银行卡/i.test(f.label+' '+f.selector)}))
    .map((f,i)=>{
      const n=[...controls,...containers][i];
      if(n.type==='file'){const entry=uploadRoots().find(x=>x.input===n);if(entry)return {...f,observationSelector:f.selector,selector:uploadRef(entry),actionSelector:uploadRef(entry),label:entry.label,section:entry.label,locatorStrategy:'semantic_question',contextProvider:entry.contextProvider,uploadLayout:entry.layout||null,uploadContainerSelector:uploadRef(entry,'container'),filenameSelector:uploadRef(entry,'filenames'),uploadedSelector:uploadRef(entry,'uploaded'),uploadedItems:uploadItems(entry)};}
      const root=n.closest('.ud-formily-item');if(!root)return f;
      const label=root.querySelector(':scope > .ud-formily-item-label')?.innerText?.trim();
      const group=n.closest('[id^="formily-item-"][id$="_list"]'),row=n.closest('.register-form-group-wrapper');
      return {...f,label:label?.replace(/[＊*\s]+$/gu,'')||f.label,required:f.required||!!label&&/[＊*]/u.test(label),readonly:f.readonly||f.type==='custom_question',contextProvider:'.ud-formily-item',questionSelector:selector(root),labelSelector:selector(root)+' > .ud-formily-item-label',selectedSelector:root.querySelector('.ud__select__selector')?selector(root)+' .ud__select__selector':null,multiple:n.getAttribute('aria-multiselectable')==='true'||!!root.querySelector('.ud__select--multiple'),group:group?.id?.replace('formily-item-','')||null,groupSelector:group?selector(group):null,rowSelector:row?selector(row):null,repeatIndex:group&&row?[...group.querySelectorAll('.register-form-group-wrapper')].indexOf(row):null,fieldKey:root.id?.replace('formily-item-','')||null,controlIndex:[...root.querySelectorAll('input,textarea,select,[role="combobox"]')].indexOf(n)};
    }).concat(phoenixFields.map(f=>{
      if(f.type!=='file')return f;
      const actual=phoenixResolve(f.selector),input=actual&&document.querySelector(actual),entry=uploadRoots().find(e=>e.input===input);
      if(!entry)return f;
      return {...f,observationSelector:f.selector,selector:uploadRef(entry),actionSelector:uploadRef(entry),uploadContainerSelector:uploadRef(entry,'container'),filenameSelector:uploadRef(entry,'filenames'),uploadedSelector:uploadRef(entry,'uploaded'),uploadedItems:uploadItems(entry)};
    }));

}

// Normalize legacy URL-encoded transport in Node, never inside the DOM sandbox.
export function normalizePhoenixReference(reference){if(!reference?.startsWith('phoenixq:'))return reference;const raw=reference.slice(9);let value;try{value=JSON.parse(raw);}catch{try{value=JSON.parse(decodeURIComponent(raw));}catch{throw Error('PHOENIX_REFERENCE_INVALID');}}if(['repeatRecords','repeatAdd'].includes(value?.part)&&(!value.title||!value.headingSelector||!value.containerSelector||!value.recordSelector?.startsWith(':scope > ')||value.recordSelector.includes(',')))throw Error('REPEAT_CAPTURED_SCOPE_REQUIRED');return 'phoenixq:'+JSON.stringify(value);}
