// Serializable shared DOM policy. Reads rendered state only; no expected answers.
export function controlDOM(spec){
 const visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const diagnosticSelector = n => {
  if(n.id && document.querySelectorAll('#'+CSS.escape(n.id)).length===1)return '#'+CSS.escape(n.id);
  const parts=[];for(let p=n;p&&p!==document.body;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
  return 'body > '+parts.join(' > ');
 };
 if(spec?.entryHealth){
  const resources=performance.getEntriesByType('resource').filter(entry=>['fetch','xmlhttprequest','script'].includes(entry.initiatorType)).map(entry=>{
   let resource;
   try{const url=new URL(entry.name);resource=url.origin+url.pathname.replace(/\d{6,}/gu,'[id]');}catch{resource='unavailable';}
   return {resource,type:entry.initiatorType,durationMs:Math.round(entry.duration),status:Number.isFinite(entry.responseStatus)?entry.responseStatus:null};
  });
  const failed=resources.filter(entry=>entry.status>=400),slow=resources.filter(entry=>entry.durationMs>=3000);
  return {pageUrl:location.href,readyState:document.readyState,observedAt:new Date().toISOString(),elapsedMs:Math.round(performance.now()),visibleControls:[...document.querySelectorAll('input,textarea,select,[role="combobox"],[role="radio"]')].filter(visible).length,progressIndicators:[...document.querySelectorAll('[role="progressbar"],[aria-busy="true"],.ant-spin-spinning')].filter(visible).length,failedResources:failed.slice(-12),slowResources:slow.slice(-12),recentRequests:resources.filter(entry=>['fetch','xmlhttprequest'].includes(entry.type)).slice(-12),scope:'rendered_state_and_resource_timing_without_query_or_response_body'};
 }
 if(spec?.acquisitionScroll){
  const request=spec.acquisitionScroll;
  const surface=node=>({selector:diagnosticSelector(node),top:node.scrollTop,height:node.clientHeight,extent:node.scrollHeight});
  if(request.selector){
   const nodes=[...document.querySelectorAll(request.selector)];
   if(nodes.length!==1||!visible(nodes[0]))throw Error('VISUAL_SCROLL_SURFACE_CHANGED');
   const node=nodes[0];
   if(Number.isFinite(request.top))node.scrollTo({top:request.top,behavior:'instant'});
   return {pageUrl:location.href,surface:surface(node)};
  }
  const ranked=[...document.querySelectorAll('body *')].filter(node=>{
   if(!visible(node)||!/(?:auto|scroll|overlay)/u.test(getComputedStyle(node).overflowY))return false;
   const rect=node.getBoundingClientRect();
   return node.scrollHeight>node.clientHeight+40&&node.clientHeight>=innerHeight*0.35&&rect.width>=innerWidth*0.35&&!!node.querySelector('input,textarea,select,[role="combobox"],form');
  }).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight);
  return {pageUrl:location.href,surface:ranked[0]?surface(ranked[0]):null};
 }
 const radioRecords=root=>[...root.querySelectorAll('input[type="radio"],[role="radio"]')].filter(node=>{
  if(node.matches('[role="radio"]:not(input)')&&node.querySelector('input[type="radio"]'))return false;
  return visible(node)||visible(node.closest('label,.ud__radio,.ud__radio__wrapper,[role="radio"]'));
 }).map(node=>{
  const own=node.closest('label,.ud__radio,.ud__radio__wrapper,[role="radio"]');
  const wrapper=own&&own!==node&&own.querySelectorAll('input[type="radio"]').length===1?own:null;
  const labelled=(node.getAttribute('aria-labelledby')||'').split(/\s+/u).filter(Boolean).map(id=>document.getElementById(id)?.textContent.trim()).filter(Boolean).join(' ');
  const native=[...(node.labels||[])].filter(visible);
  const label=(node.getAttribute('aria-label')||labelled||native.map(n=>n.textContent.trim()).join(' ')||wrapper?.innerText||(node.getAttribute('role')==='radio'?node.innerText:'')||'').trim();
  const target=native[0]||wrapper||(visible(node)?node:null);
  const rendered=node.closest('.atsx-radio-wrapper');
  const renderedChecked=rendered?rendered.classList.contains('atsx-radio-wrapper-checked')||!!rendered.querySelector('.atsx-radio-checked'):null;
  return {label,selector:diagnosticSelector(node),targetSelector:target?diagnosticSelector(target):null,selected:(node.checked===true||node.getAttribute('aria-checked')==='true')&&renderedChecked!==false,nativeChecked:node.checked===true,ariaChecked:node.getAttribute('aria-checked'),renderedChecked,disabled:!!node.disabled||node.getAttribute('aria-disabled')==='true'};
 });
 if(spec?.operation==='radioOptions'){
  const roots=[...document.querySelectorAll(spec.selector)].filter(visible);
  return roots.length===1?radioRecords(roots[0]):[];
 }
 if(spec?.acquisitionEntrances){
  const fieldNodes=(spec.acquisitionEntrances.controls||[]).map(control=>{
   let nodes=[];
   try{nodes=[...document.querySelectorAll(control.diagnosticSelector||control.selector)];}catch{}
   return {...control,node:nodes.length===1?nodes[0]:null};
  });
  const targets=[...document.querySelectorAll('button,[role="button"],a,span,div')].filter(n=>{
   if(!visible(n)||n.closest('nav,footer,[role="navigation"],dialog,[role="dialog"]')||n.matches('button[type="submit"],a[href]:not([href^="#"])'))return false;
   const label=(n.innerText||'').trim();
   if(!/^(?:[+＋]\s*)?(?:添加|新增|展开|Add|Expand)(?:\s*[^\n]{1,20})?$/iu.test(label))return false;
   return ![...n.children].some(child=>visible(child)&&(child.innerText||'').trim()===label);
  });
  const knownHeaders='.createFormSection-title,.applyFormModuleWrapper-title,h2,h3,h4,legend,[role="heading"]';
  const entries=new Map();
  for(const textNode of targets){
   const button=textNode.closest('button,[role="button"],a,.createFormSection-addBtn,.formOperate-addBtn')||textNode;
   const label=(button.innerText||'').trim();
   if(!/^(?:[+＋]\s*)?(?:添加|新增|展开|Add|Expand)(?:\s*[^\n]{1,20})?$/iu.test(label))continue;
   let root=button.parentElement,heading;
   for(let i=0;root&&i<12&&!root.matches('body,form,main');i++,root=root.parentElement){
    const headings=[...root.querySelectorAll(knownHeaders)].filter(n=>visible(n)&&!n.contains(button)&&!button.contains(n));
    if(headings.length===1){heading=headings[0];break;}
    if(headings.length>1)break;
   }
   if(!heading||!root)continue;
   const title=heading.innerText.trim();
   const suffix=label.replace(/^(?:[+＋]\s*)?(?:添加|新增|展开|Add|Expand)\s*/iu,'');
   if(!title||suffix&&suffix!==title)continue;
   // A header and its button often share a small wrapper. Observe the full
   // section when the next wrapper still owns just this one heading.
   const parent=root.parentElement;
   if(parent&&!parent.matches('body,form,main')&&[...parent.querySelectorAll(knownHeaders)].filter(visible).length===1)root=parent;
   const selector=diagnosticSelector(button),scopeSelector=diagnosticSelector(root);
   const children=fieldNodes.filter(field=>field.node&&root.contains(field.node));
   entries.set(selector,{title,selector,scopeSelector,headingSelector:diagnosticSelector(heading),triggerLabel:label,expansionType:/^(?:[+＋]\s*)?(?:展开|expand)/iu.test(label)?'disclosure':'add',childSelectors:children.map(field=>field.selector),childControlIds:children.map(field=>field.id)});
  }
  return {pageUrl:location.href,entrances:[...entries.values()],controlPaths:fieldNodes.filter(field=>field.node).map(field=>({id:field.id,selector:diagnosticSelector(field.node)}))};
 }
 const imagePreview=root=>{
  const images=[...root.querySelectorAll('img')].filter(img=>visible(img)&&img.complete&&img.naturalWidth>=100&&img.naturalHeight>=100&&!/\.svg(?:[?#]|$)/i.test(img.currentSrc||img.src||''));
  if(images.length!==1)return {status:'unavailable',reason:images.length?'AMBIGUOUS_IMAGE_PREVIEW':'LOADED_IMAGE_PREVIEW_NOT_VISIBLE'};
  const img=images[0],box=img.getBoundingClientRect();return {status:'visible',resource:img.currentSrc||img.src,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,width:box.width,height:box.height,selector:diagnosticSelector(img)};
 };
 if(spec?.operation==='resolveImagePreview'){
  const roots=[...document.querySelectorAll(spec.containerSelector)].filter(visible);if(roots.length!==1)return null;
  const result=imagePreview(roots[0]);if(result.status!=='visible')return result;
  const img=document.querySelectorAll(result.selector)[0],ancestors=[];for(let node=img?.parentElement;node;node=node.parentElement){ancestors.push(node===document.body?'body':diagnosticSelector(node));if(node===document.body)break;}
  return {...result,ancestors};
 }
 if(['submission_controls','submission_receipt'].includes(spec?.operation)){
  const candidates=[...document.querySelectorAll('button,input[type="submit"]')].filter(visible).map(n=>({label:(n.innerText||n.value||'').trim(),tag:n.tagName,type:n.type||'',disabled:!!n.disabled||n.getAttribute('aria-disabled')==='true'})).filter(n=>/^(?:预览并提交|Preview and submit|确认提交|提交申请|提交简历|提交|确认投递|投递简历|立即投递|Submit|Submit application|Apply)$/i.test(n.label));
  const receiptPattern=/^(?:恭喜(?:您)?[，,\s]*)?(?:您的)?(?:简历|职位申请)?(?:提交成功|投递成功|申请成功|已成功投递|已成功提交|申请已提交)[！!。.]?$/;
  const receipts=[...document.querySelectorAll('h1,h2,h3,p,span,div,[role="status"],[role="alert"]')].filter(n=>visible(n)&&!n.closest('button')&&receiptPattern.test(n.innerText?.trim()||'')&&![...n.children].some(c=>visible(c)&&c.innerText?.trim()===n.innerText?.trim())).map(n=>({text:n.innerText.trim(),selector:diagnosticSelector(n)}));
  const buttons=[...document.querySelectorAll('button,input[type="submit"]')].filter(visible).flatMap(n=>{const data={label:(n.innerText||n.value||'').trim(),tag:n.tagName,type:n.type||'',disabled:!!n.disabled||n.getAttribute('aria-disabled')==='true'};return candidates.some(c=>JSON.stringify(c)===JSON.stringify(data))?[{...data,selector:diagnosticSelector(n)}]:[];});
  const scripts=[...document.scripts].map(n=>n.src).filter(Boolean);
  // Webpack removes successful dynamic script tags. Browser resource timing
  // retains actual script loads; a fetch/link entry is not script evidence.
  try{if(typeof performance!=='undefined'&&typeof performance.getEntriesByType==='function')for(const resource of performance.getEntriesByType('resource'))if(resource.initiatorType==='script'&&typeof resource.name==='string'&&resource.name)scripts.push(resource.name);}catch{}
  // Agreement/declaration checkboxes still on the page (for example on a site's summary step). Same
  // label rule as field-policy isAgreementCheckbox; preference questions such as 调剂 are excluded.
  const agreementLabel=/同意.*(?:协议|条款|政策|声明|须知|告知|授权书|承诺书)|已阅读|阅读并同意|已知悉|知情同意|承诺.{0,12}(?:真实|属实|准确|有效)|(?:信息|资料)(?:真实|属实)|consent|agreement|terms.of.service|privacy policy|declaration|I (?:have read|agree|confirm|certify)/i;
  const agreements=[...document.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].map(n=>{const holder=n.closest('label,.ant-checkbox-wrapper,.pc-privacy-agreement__container,.form-item--phoenix')||n.parentElement;return {node:n,holder,label:(holder?.innerText||n.getAttribute('aria-label')||'').trim().replace(/\s+/g,' ').slice(0,200)};}).filter(a=>(visible(a.node)||visible(a.holder))&&agreementLabel.test(a.label)&&!/调剂|调配|转岗|服从.{0,4}分配|接受.{0,6}调整/.test(a.label)).map(a=>({label:a.label,checked:a.node.checked===true||a.node.getAttribute('aria-checked')==='true',selector:diagnosticSelector(a.node)}));
  return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:location.href,buttons,agreements,scripts:[...new Set(scripts)],receipt:receipts.length===1?receipts[0]:null,receiptCount:receipts.length,validationErrors:[...document.querySelectorAll('.ant-form-item-explain-error,.has-error .ant-form-explain,.ant-message-error')].filter(visible).length};
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
 // Beisen Phoenix filecard adapter. Only the component's public BEM class
 // (file-uploader__list-view) and the card's relative structure are used; the
 // build-generated styled-components classes and bundle-hash URLs are not page
 // evidence. The done-only download/preview icons (public module 98670 renders
 // modules 30914 / 79025 only for done files) locate the card's actions; final
 // acceptance of an upload comes from content retrieval, not from these icons.
 const phoenixCard=(entry,name)=>{
  if(entry.contextProvider!=='.form-item--phoenix')return null;
  let card=name;while(card?.parentElement&&!card.parentElement.matches('.file-uploader__list-view'))card=card.parentElement;
  const list=card?.parentElement;
  if(!card||!list?.matches('.file-uploader__list-view')||!entry.root.contains(card)||!visible(card)||fileCandidates(card).length!==1||fileCandidates(card)[0]!==name)return null;
  const row=card.children[0],parts=row?[...row.children]:[];
  if(card.children.length!==1||parts.length!==3||!parts[1].contains(name))return null;
  return {card,actions:parts[2]};
 };
 const phoenixDoneEvidence=(entry,name,requiredIcon=null)=>{
  const filecard=phoenixCard(entry,name);if(!filecard)return null;
  const paths={download:'M9.5 12.515c.748-.75 2.353-2.353 4.814-4.812l.707.707-5.303 5.303c-.39.39-1.028.387-1.415 0L3 8.41l.707-.707L8.5 12.496V2.383C8.5 2.17 8.724 2 9 2s.5.171.5.383v10.132zM2.404 16C2.18 16 2 15.776 2 15.5s.18-.5.404-.5h13.192c.223 0 .404.224.404.5s-.18.5-.404.5H2.404z',preview:'M.156 8.464c.117-.185.33-.487.633-.868.5-.628 1.079-1.254 1.735-1.841C4.437 4.042 6.608 3 9 3c2.38 0 4.549 1.042 6.466 2.754a15.213 15.213 0 0 1 1.74 1.84c.304.38.518.682.636.867a1 1 0 0 1-.002 1.081c-.118.184-.333.486-.64.866a15.36 15.36 0 0 1-1.744 1.839C13.535 13.958 11.37 15 9 15c-2.38 0-4.549-1.042-6.466-2.754a15.213 15.213 0 0 1-1.74-1.84c-.304-.38-.518-.682-.636-.867a1 1 0 0 1-.002-1.075zM1 9s3.2 5 8 5c4.775 0 8-5 8-5s-3.2-5-8-5C4.175 4 1 9 1 9zm5 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0zm1 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0z'};
  for(const action of filecard.actions.children){
   if(!visible(action))continue;
   const svgs=[...action.querySelectorAll('svg')].filter(visible);if(svgs.length!==1)continue;
   const actual=[...svgs[0].querySelectorAll('path')].map(n=>n.getAttribute('d'));
   const icon=Object.keys(paths).find(key=>actual.length===2&&actual[0]==='M0 0h18v18H0z'&&actual[1]===paths[key]);
   if(icon&&(!requiredIcon||icon===requiredIcon))return {kind:'phoenix_done_action_icon',renderer:'beisen_phoenix_filecard',icon,actionSelector:diagnosticSelector(action),contractSourceSha256:'601c6d6822be687de67c8dc69ffb4fccec5aca4c78699860175fa46c11304992'};
  }
  return null;
 };
 // Generic retrieval of the current uploaded file, searched only inside that
 // file's own row: a uniquely named download control, then the filename as an
 // https link, then a framework adapter. None found = the site offers no
 // retrieval and completion stays UI-only.
 const downloadLabel=/^(?:下载|下载附件|下载文件|download|download file)$/i;
 const accessibleName=n=>(n.getAttribute('aria-label')||n.getAttribute('title')||n.innerText||'').trim();
 const fileUrl=a=>{
  const href=a?.getAttribute('href');let url=null;try{url=href?new URL(href,location.href):null;}catch{}
  return url&&url.protocol==='https:'&&url.href.split('#')[0]!==location.href.split('#')[0]?url.href:null;
 };
 const uploadRetrieval=(entry,row,name)=>{
  const named=[...new Set([...row.querySelectorAll('button,a,[role="button"],[title],[aria-label]')].filter(n=>visible(n)&&downloadLabel.test(accessibleName(n))).map(n=>n.closest('button,a,[role="button"]')||n))];
  if(named.length>1)return null;
  // A link is fetched with the page session instead of clicked: clicking may
  // open a viewer tab instead of a download.
  if(named.length===1){const url=named[0].tagName==='A'?fileUrl(named[0]):null;return url?{via:'file_link',url,selector:diagnosticSelector(named[0])}:{via:'named_download_control',selector:diagnosticSelector(named[0])};}
  const link=name.closest('a'),url=link&&row.contains(link)&&visible(link)?fileUrl(link):null;
  if(url)return {via:'file_link',url,selector:diagnosticSelector(link)};
  const phoenix=phoenixDoneEvidence(entry,name,'download');
  return phoenix?{via:'phoenix_download_icon',selector:phoenix.actionSelector}:null;
 };
 const replaceFor=row=>{const nodes=[...row.querySelectorAll('button,a,[role="button"],span')].filter(n=>visible(n)&&/^(?:重新上传|替换文件|reupload|replace file)$/i.test(n.innerText?.trim()||''));return nodes.length===1?nodes[0]:null;};
 const uploadRows=entry=>{
  const standalone=entry.layout==='adjacent_title_unique_file';if(uploadPending(entry.root)||uploadError(entry.root))return [];
  return fileCandidates(entry.root).map(name=>{const evidence=phoenixDoneEvidence(entry,name);if(evidence)return {row:phoenixCard(entry,name).card,name,evidence};let row=name.parentElement;while(row){if(fileCandidates(row).length!==1)break;if(removeFor(row,standalone)||(standalone?replaceFor(row):uploadComplete(row)))return {row,name};if(row===entry.root)break;row=row.parentElement;}if(standalone)return null;const done=name.closest('.ant-upload-list-item-done');return done?{row:done,name}:null;}).filter(Boolean);
 };
 const uploadItems=entry=>uploadRows(entry).map(({row,name,evidence})=>{const filename=name.innerText?.trim(),remove=removeFor(row,entry.layout==='adjacent_title_unique_file');return {filename,...(evidence?{uploadEvidence:evidence}:{}),removeSelector:remove&&filename?'uploadq:'+JSON.stringify({...JSON.parse(uploadRef(entry).slice(8)),part:'remove',filename}):null};});
 if(spec?.operation==='resolveAttachmentPreview'){
  const roots=[...document.querySelectorAll(spec.containerSelector)].filter(visible);if(roots.length!==1)return null;
  const root=roots[0],names=fileCandidates(root).filter(n=>n.innerText?.trim()===spec.filename);if(names.length!==1)return null;
  const picture=imagePreview(root);if(picture.status==='visible')return {via:'image',selector:picture.selector,resource:picture.resource};
  let entry=uploadRoots().find(item=>item.root===root);
  if(!entry&&root.matches('.form-item--phoenix')&&root.querySelector('.file-uploader__wrapper'))entry={root,contextProvider:'.form-item--phoenix'};
  if(entry){const proof=phoenixDoneEvidence(entry,names[0],'preview');if(proof)return {via:'preview_control',selector:proof.actionSelector};}
  let row=names[0].parentElement;
  while(row&&fileCandidates(row).length===1){
   const candidates=[...row.querySelectorAll('button,a,[role="button"],[title],[aria-label]')].filter(n=>visible(n)&&/^(?:预览|查看|查看附件|预览附件|preview|view|view file)$/i.test(accessibleName(n)));
   if(candidates.length>1)return null;if(candidates.length===1){const n=candidates[0];return {via:n.tagName==='A'?'preview_link':'preview_control',selector:diagnosticSelector(n),url:n.tagName==='A'?fileUrl(n):null};}
   if(row===root)break;row=row.parentElement;
  }return null;
 }
 if(spec?.operation==='resolveUploadDownload'){
  const roots=[...document.querySelectorAll(spec.containerSelector)].filter(visible);if(roots.length!==1)return null;
  let entry=uploadRoots().find(item=>item.root===roots[0]);
  if(!entry&&roots[0].matches('.form-item--phoenix')&&roots[0].closest('.ux-standard-form')&&!roots[0].querySelector('input[type="file"]')&&roots[0].querySelector('.form-item__control .file-uploader__wrapper'))entry={root:roots[0],contextProvider:'.form-item--phoenix'};
  if(!entry)return null;
  const rows=uploadRows(entry).filter(item=>item.name.innerText.trim()===spec.filename);if(rows.length!==1)return null;
  return uploadRetrieval(entry,rows[0].row,rows[0].name);
 }
 const resolveUpload=reference=>{const ref=JSON.parse(reference.slice(8)),entry=uploadRoots().filter(x=>x.label===ref.label)[ref.occurrence];if(!entry)return null;const root=diagnosticSelector(entry.root);if(ref.part==='filenames')return uploadRows(entry).map(({name})=>diagnosticSelector(name)).join(',')||null;if(ref.part==='remove'){const rows=uploadRows(entry).filter(({name})=>name.innerText?.trim()===ref.filename);const remove=rows.length===1?removeFor(rows[0].row,entry.layout==='adjacent_title_unique_file'):null;return remove?diagnosticSelector(remove):null;}return ref.part==='container'?root:ref.part==='uploaded'?uploadRows(entry).length?root:null:diagnosticSelector(entry.input);};
 if(spec?.operation==='resolveUpload')return (spec.references||[]).map(resolveUpload);
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
 if(spec?.operation==='projectRemovalSnapshot'){
  const questions=phoenixRoots().filter(root=>phoenixLabel(root)===spec.label&&phoenixSection(root)===spec.section),rows=questions.map(root=>({root,input:[...root.querySelectorAll('input[type="text"],textarea')].filter(visible)}));
  if(rows.some(row=>row.input.length!==1))return null;
  const names=rows.map(row=>row.input[0].value),hits=rows.filter(row=>row.input[0].value===spec.expectedName);
  if(hits.length!==1)return {names,removeSelector:null};
  for(let node=hits[0].root;node&&node!==document.body;node=node.parentElement){
   if(questions.filter(question=>node.contains(question)).length!==1)break;
   if(phoenixRoots().some(question=>node.contains(question)&&phoenixSection(question)!==spec.section))break;
   const candidates=[...node.querySelectorAll('button,a,[role="button"],span,div')].filter(button=>visible(button)&&/^(?:删除|删除项目|删除经历|移除|delete|remove)$/i.test((button.getAttribute('aria-label')||button.getAttribute('title')||button.innerText||'').trim())&&!button.querySelector('input,textarea,select')&&![...button.children].some(child=>visible(child)&&child.innerText?.trim()===button.innerText?.trim()));
   const buttons=[...new Set(candidates.map(button=>button.closest('button,a,[role="button"]')||button))];
   if(buttons.length===1)return {names,removeSelector:diagnosticSelector(buttons[0]),recordSelector:diagnosticSelector(node)};
   if(buttons.length>1)return {names,removeSelector:null};
  }
  return {names,removeSelector:null};
 }
 // Formily cards can each wrap their own record. Bind their action to the
 // owning list, including when the add button is inside the last card.
 const formilyRepeatGroup=(title,label)=>{
  if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(title))return null;
  const ownerSelector='#formily-item-'+title+'_list',selector=ownerSelector+' .register-form-group-wrapper';
  const owners=[...document.querySelectorAll(ownerSelector)].filter(visible);
  if(owners.length!==1)return null;
  const [owner]=owners,list='[id^="formily-item-"][id$="_list"]';
  const rows=[...document.querySelectorAll(selector)].filter(visible);
  if(!rows.length||rows.some(row=>row.closest(list)!==owner))return null;
  const buttons=[...owner.querySelectorAll('button')].filter(button=>{
   const text=button.innerText?.trim()||'';
   return visible(button)&&button.closest(list)===owner&&!rows.some(row=>row.contains(button))&&
    (label?text===label:text.length<80&&/^[+＋]?\s*(?:添加|新增|Add)(?:$|\s|[\p{Script=Han}])/iu.test(text));
  });
  return {selector,buttons};
 };
 const scopedRepeatCandidates=(rows,recordSelector,label)=>{
  for(let root=rows[0]?.parentElement,depth=0;root&&depth<4;root=root.parentElement,depth++){
   const other=[...root.querySelectorAll('.resumeEditForm-item,.register-form-group-wrapper,[class^="apply-form-array-card__"]')].some(n=>typeof n.matches==='function'&&!n.matches(recordSelector)&&!rows.some(row=>row.contains(n)));
   if(other)return [];
   const nodes=[...root.querySelectorAll('button,[role="button"],a,span,div')].filter(n=>{
    const text=n.innerText?.trim()||'';
    const insideRecord=rows.some(row=>row.contains(n));
    // Feishu renders its repeat action inside the final record. A field's own
    // add action is distinct and stays excluded from repeat discovery.
    const repeatAction=n.matches?.('.addMore-add')&&!n.closest?.('.atsx-form-item,.ud-formily-item,.ant-form-item,.form-item--phoenix');
    return visible(n)&&(!insideRecord||repeatAction)&&text.length<80&&(label?text===label:/^[+＋]?\s*(?:添加|新增|Add)(?:$|\s|[\p{Script=Han}])/iu.test(text));
   });
   const candidates=nodes.filter(n=>!nodes.some(other=>other!==n&&typeof n.contains==='function'&&n.contains(other)));
   if(candidates.length)return candidates;
   if(root===document.body)break;
  }
  return [];
 };
 const phoenixResolve=reference=>{
  let r;try{r=JSON.parse(reference.slice(9));}catch{throw Error('PHOENIX_REFERENCE_INVALID');}
  if(r.part==='formilyRepeatAdd'){
   if(!r.addLabel)throw Error('REPEAT_CAPTURED_SCOPE_REQUIRED');
   const group=formilyRepeatGroup(r.section,r.addLabel);
   if(!group)throw Error('REPEAT_SECTION_NOT_FOUND');
   if(group.buttons.length!==1)throw Error('REPEAT_ADD_CONTROL_CHANGED');
   return diagnosticSelector(group.buttons[0]);
  }
  if(r.part==='scopedRepeatAdd'){
   const rows=[...document.querySelectorAll(r.recordSelector)].filter(visible);
   if(!rows.length||rows.some(row=>row.parentElement!==rows[0].parentElement))throw Error('REPEAT_SECTION_NOT_FOUND');
   const candidates=scopedRepeatCandidates(rows,r.recordSelector,r.addLabel);
   if(candidates.length!==1)throw Error('REPEAT_ADD_CONTROL_CHANGED');
   return diagnosticSelector(candidates[0]);
  }
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
 if(spec?.operation==='repeatInspection'){
  // Only framework structure and add-control labels; never record answers.
  return (spec.groups||[]).map(group=>{
   const rows=[...document.querySelectorAll(group.selector)].filter(visible),ancestors=[];
   for(let root=rows[0],depth=0;root&&depth<5;root=root.parentElement,depth++){
    const adds=[...root.querySelectorAll('button,[role="button"],a,span,div')].filter(n=>visible(n)&&/^[+＋]?\s*(?:添加|新增|Add)(?:$|\s|[\p{Script=Han}])/iu.test(n.innerText?.trim()||'')&&(n.innerText?.trim()||'').length<80);
    const leaves=adds.filter(n=>!adds.some(other=>other!==n&&n.contains(other)));
    ancestors.push({depth,tag:root.tagName,classes:root.getAttribute('class')||'',selector:diagnosticSelector(root),records:rows.filter(row=>root===row||root.contains(row)).length,addControls:leaves.slice(0,12).map(n=>({tag:n.tagName,classes:n.getAttribute('class')||'',label:n.innerText.trim(),selector:diagnosticSelector(n),insideRecord:rows.some(row=>row.contains(n))}))});
    if(root===document.body)break;
   }
   return {title:group.title,selector:group.selector,count:rows.length,sameParent:rows.every(row=>row.parentElement===rows[0]?.parentElement),ancestors};
  });
 }
 if(spec?.operation==='repeatDiscovery'){
  // Read only. A section heading and its add button are tied by the id the form framework gives them.
  const found=[];
  for(const add of document.querySelectorAll('[id$="_addButton"]')){
   if(!visible(add))continue;
   const headingId=add.id.slice(0,-'_addButton'.length),heading=document.getElementById(headingId),title=heading?.innerText?.trim(),root=heading?.parentElement,addLabel=add.innerText?.trim();
   if(!title||!addLabel||!visible(heading)||!(spec.titles||[]).includes(title)||!root?.contains(add))continue;
   const path=[];
   for(let node=add.parentElement;node&&node!==root;node=node.parentElement){
    const tag=node.tagName.toLowerCase(),same=[...node.parentElement.children].filter(n=>n.tagName===node.tagName);
    path.unshift(same.length>1?`${tag}:nth-of-type(${same.indexOf(node)+1})`:tag);
   }
   const exact=`[id="${headingId}"]`;
   found.push({title,headingSelector:exact,containerSelector:`div:has(> ${exact})`,recordSelector:[':scope',...path,'div:not([id$="_addButton"])'].join(' > '),addSelector:`[id="${add.id}"]`,addLabel});
  }
  for(const title of spec.titles||[]){
   if(!/^[A-Za-z][A-Za-z0-9_]*$/.test(title))continue;
   const formily=formilyRepeatGroup(title);
   if(formily?.buttons.length===1){
    const addLabel=formily.buttons[0].innerText.trim();
    found.push({title,selector:formily.selector,addLabel,addSelector:'phoenixq:'+JSON.stringify({part:'formilyRepeatAdd',section:title,addLabel})});
    continue;
   }
   const selectors=[`.resumeEditForm-item.resumeEditForm-${title}`,`#formily-item-${title}_list [class^="apply-form-array-card__"]`];
   for(const selector of selectors){
    const rows=[...document.querySelectorAll(selector)].filter(visible);
    if(!rows.length||!rows[0].parentElement||rows.some(row=>row.parentElement!==rows[0].parentElement))continue;
    const candidates=scopedRepeatCandidates(rows,selector);
    if(candidates.length!==1)continue;
    const addLabel=candidates[0].innerText.trim();
    found.push({title,selector,addLabel,addSelector:'phoenixq:'+JSON.stringify({part:'scopedRepeatAdd',recordSelector:selector,addLabel})});
   }
  }
  return found.filter(item=>found.filter(other=>other.title===item.title).length===1);
 }
 if(spec?.operation==='resolvePhoenix')return (spec.references||[]).map(phoenixResolve);
 // Optional aliases and readback report an absent question as missing.
 // This never grants presence, equivalence or a successful field check.
 // Writes retain strict resolution; malformed or changed controls still fail.
 if(['resolvePhoenixAliases','resolvePhoenixReadback'].includes(spec?.operation))return (spec.references||[]).map(reference=>{
  // Old brokers can still send write targets in a readback request. The
  // add button is resolved strictly by the repeat writer after layout changes.
  if(spec.operation==='resolvePhoenixReadback'){
   let part;try{part=JSON.parse(reference.slice(9)).part;}catch{throw Error('PHOENIX_REFERENCE_INVALID');}
   if(['repeatAdd','scopedRepeatAdd','formilyRepeatAdd'].includes(part))return null;
  }
  try{return phoenixResolve(reference);}catch(error){if(error.message==='PHOENIX_QUESTION_NOT_FOUND')return null;throw error;}
 });
 if(spec?.operation==='recruiting_disclosure'){
  const nodes=[...document.querySelectorAll(spec.selector)].filter(eligible);if(nodes.length!==1)return {present:false,pageUrl:location.href};
  const node=nodes[0],question=node.closest('.ant-form-item,.ud-formily-item,.atsx-form-item,.form-item--phoenix,.pc-privacy-agreement__container')||node.closest('label');
  const text=question?.innerText?.trim()||node.getAttribute('aria-label')||'';
  return {present:!!question,selector:diagnosticSelector(node),pageUrl:location.href,checked:node.checked===true||node.getAttribute('aria-checked')==='true',text,terms:question?[...question.querySelectorAll('a,[role=\"link\"],.phoenix-text-button')].filter(visible).map(n=>({selector:diagnosticSelector(n),label:accessibleName(n),href:n.getAttribute('href')})):[]};
 }
 const one=s=>{const nodes=s?[...document.querySelectorAll(s)]:[],shown=nodes.filter(eligible);return shown.length===1?shown[0]:shown.length===0&&nodes.length===1?nodes[0]:null;};
 if(Array.isArray(spec?.fields)){

  const text=n=>n?.innerText?.trim()??null;
  const errors=ss=>(ss||[]).flatMap(s=>[...document.querySelectorAll(s)].filter(visible).map(()=>({selector:s})));
  const fields={};
  for(const f of spec.fields){
    const r=f.read.kind==='files'?{...f.read}:f.read;
    if(r.kind==='files')for(const key of ['selector','filenameSelector','uploadedSelector','presenceSelector']){
      if(r[key]?.startsWith('uploadq:'))r[key]=resolveUpload(r[key]);
    }
    const n=one(r.selector);
    const o={present:!!n && (r.presenceSelector?visible(one(r.presenceSelector)):eligible(n)),value:null,errors:errors(r.errorSelectors)};
    if(f.userOnly){fields[f.id]={present:!!n && eligible(n),userOnly:true};continue;}
    if(n){
      const question=n.closest?.('.ant-form-item,.ud-formily-item,.atsx-form-item,.form-item--phoenix');
      const invalid=n.getAttribute?.('aria-invalid')==='true';
      const renderedErrors=question?[...question.querySelectorAll('.ant-form-item-explain-error,.has-error .ant-form-explain,.ud-formily-item-feedback-error,[role="alert"],.form-item__error')].filter(visible):[];
      if(invalid||renderedErrors.length)o.errors.push({scope:'question',source:invalid?'aria_invalid':'rendered_validation'});
      if(['INPUT','TEXTAREA'].includes(n.tagName)){
       const nativeLimit=Number.isInteger(n.maxLength)&&n.maxLength>=0?n.maxLength:null;
       if(n.validity?.tooLong||nativeLimit!==null&&String(n.value??'').length>nativeLimit)o.errors.push({scope:'question',source:'native_text_limit'});
       const counter=n.closest?.('.phoenix-textarea')?.querySelector?.('.phoenix-textarea__bottomBar');
       const counts=counter&&visible(counter)?counter.innerText?.trim().match(/^(\d+)\s*\/\s*(\d+)$/):null;
       if(counts&&Number(counts[1])>Number(counts[2]))o.errors.push({scope:'question',source:'rendered_text_limit'});
      }
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
        o.value=(()=>{const custom=[...n.querySelectorAll('.phoenix-radio')].filter(e=>visible(e)&&/(?:--|__)checked(?:\s|$)/.test(e.className));if(custom.length===1)return custom[0].querySelector('.phoenix-radio__radio-text')?.textContent.trim()||null;if(n.closest('.ud-formily-item')||n.querySelector('.ud__radio,.ud__radio__wrapper')){const selected=radioRecords(n).filter(record=>record.selected);return selected.length===1?selected[0].label||null:null;}const selected=[...n.querySelectorAll('input:checked,[role="radio"][aria-checked="true"]')].filter(eligible);return selected.length===1?(selected[0].closest('label')?.textContent||selected[0].getAttribute('aria-label')||selected[0].textContent)?.trim()??null:null;})();
      }else if(r.kind==='files'){
        const names=r.filenameSelector?[...n.querySelectorAll(r.filenameSelector)].filter(visible).map(text):[];
        o.value=names;
        // A file input / FileList can never prove the server rendered an upload.
        const completionMarker=!!r.uploadedSelector&&visible(one(r.uploadedSelector)),pending=uploadPending(n),error=uploadError(n);
        o.uploadState=n.tagName!=='INPUT'&&names.length&&completionMarker&&!pending&&!error?'site_rendered_uploaded':'unverified';
        o.uploadReadback={renderedFilenameCount:names.length,completionMarker,pending,error};
        o.imagePreview=imagePreview(n);
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
    .filter(n=> !dateAuxiliaries.has(n)&&!n.closest('.form-item--phoenix')&&(visible(n)||n.type==='file'||(['checkbox','radio'].includes(n.type)&&visible(n.closest('label,.ud__radio,.ud__radio__wrapper,[role="radio"]')))) && n.type!=='hidden'&&!(n.tagName!=='INPUT'&&n.getAttribute('role')==='radio'&&n.querySelector('input[type="radio"]')));
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
      const radio=f.type==='radio'?radioRecords(root):[];
      const complete=radio.length&&radio.every(item=>item.label&&item.targetSelector)&&new Set(radio.map(item=>item.label)).size===radio.length;
      const radioOptions=radio.length?{options:complete?radio.map(item=>item.label):[],optionRecords:complete?radio.map(({label,disabled})=>({label,disabled})):[]}:{};
      const extra={};
      if(n.tagName==='INPUT'&&n.closest('.throne-biz-date-range-picker-input'))extra.semanticType=!n.value||/^\d{4}-\d{2}$|^至今$/u.test(n.value)?'month_picker':'unsupported_date_range';
      if(f.type==='custom_question'&&root.querySelector('.ud-formily-item-control-content-component'))extra.readSelector=selector(root)+' .ud-formily-item-control-content-component';
      if(f.type==='file'&&root.querySelector('.uploadFile')&&root.querySelectorAll('input[type="file"]').length===1){
       Object.assign(extra,{uploadContainerSelector:selector(root),filenameSelector:'.uploadFile-loadedFilename',uploadedSelector:selector(root)+' .uploadFile-loadedWrapper'});
       for(let owner=root;owner&&owner!==document.body;owner=owner.parentElement){
        if(owner.querySelectorAll('input[type="file"]').length!==1)break;
        const headings=[...owner.querySelectorAll('.applyFormModuleWrapper-title,.createFormSection-title,h2,h3,legend,[role="heading"]')].filter(visible);
        if(headings.length===1){extra.displayLabel=headings[0].innerText.trim().replace(/[＊*\s]+$/gu,'');break;}
        if(headings.length>1)break;
       }
      }
      return {...f,...radioOptions,...extra,label:label?.replace(/[＊*\s]+$/gu,'')||f.label,required:f.required||!!label&&/[＊*]/u.test(label),readonly:f.readonly||f.type==='custom_question',contextProvider:'.ud-formily-item',questionSelector:selector(root),labelSelector:selector(root)+' > .ud-formily-item-label',selectedSelector:root.querySelector('.ud__select__selector')?selector(root)+' .ud__select__selector':null,multiple:n.getAttribute('aria-multiselectable')==='true'||!!root.querySelector('.ud__select--multiple'),group:group?.id?.replace('formily-item-','')||null,groupSelector:group?selector(group):null,rowSelector:row?selector(row):null,repeatIndex:group&&row?[...group.querySelectorAll('.register-form-group-wrapper')].indexOf(row):null,fieldKey:root.id?.replace('formily-item-','')||null,controlIndex:[...root.querySelectorAll('input,textarea,select,[role="combobox"]')].indexOf(n)};
    }).concat(phoenixFields.map(f=>{
      if(f.type!=='file')return f;
      const actual=phoenixResolve(f.selector),input=actual&&document.querySelector(actual),entry=uploadRoots().find(e=>e.input===input);
      if(!entry)return f;
      return {...f,observationSelector:f.selector,selector:uploadRef(entry),actionSelector:uploadRef(entry),uploadContainerSelector:uploadRef(entry,'container'),filenameSelector:uploadRef(entry,'filenames'),uploadedSelector:uploadRef(entry,'uploaded'),uploadedItems:uploadItems(entry)};
    }));

}

// Normalize legacy URL-encoded transport in Node, never inside the DOM sandbox.
export function normalizePhoenixReference(reference){if(!reference?.startsWith('phoenixq:'))return reference;const raw=reference.slice(9);let value;try{value=JSON.parse(raw);}catch{try{value=JSON.parse(decodeURIComponent(raw));}catch{throw Error('PHOENIX_REFERENCE_INVALID');}}if(['repeatRecords','repeatAdd'].includes(value?.part)&&(!value.title||!value.headingSelector||!value.containerSelector||!value.recordSelector?.startsWith(':scope > ')||value.recordSelector.includes(',')))throw Error('REPEAT_CAPTURED_SCOPE_REQUIRED');return 'phoenixq:'+JSON.stringify(value);}
