// Pure rendered-DOM reader/resolver. Logical question references are persisted;
// DOM hierarchy paths are generated only for the current operation, never stored
// as a company's execution identity.
export function antDOM({operation='inventory',reference,references}={}){
 const formNodes=[...document.querySelectorAll('form.ant-form')];if(formNodes.length!==1)throw Error('ANT_FORM_NOT_UNIQUE');
 const form=formNodes[0],visible=n=>!!n?.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const clean=s=>(s||'').replace(/[＊*？?\s]+$/gu,'').trim();
 const all=[...form.querySelectorAll('input,textarea,select,[role="combobox"],[role="checkbox"],[role="radio"]')].filter(n=>!n.classList.contains('ant-select-search__field')&&n.type!=='hidden'&&(visible(n)||n.type==='file'||(['checkbox','radio'].includes(n.type)&&visible(n.closest('label')))));
 const question=n=>n.closest('.ant-form-item');
 const sectionCache=new Map(),titleCache=new Map(),labelCache=new Map(),peerCache=new Map(),rowCache=new Map();
 const section=q=>{if(sectionCache.has(q))return sectionCache.get(q);let n=q;while(n?.parentElement&&n.parentElement!==form)n=n.parentElement;sectionCache.set(q,n);return n;};
 const sectionTitle=n=>{if(!titleCache.has(n))titleCache.set(n,clean(n?.innerText?.split('\n').map(s=>s.trim()).find(Boolean)));return titleCache.get(n);};
 const label=q=>{if(!labelCache.has(q))labelCache.set(q,clean(q?.querySelector(':scope > .ant-form-item-label')?.innerText));return labelCache.get(q);};
 const questions=[...new Set(all.map(question).filter(Boolean))];
 const sectionOf=q=>sectionTitle(section(q));
 const peers=q=>{const key=JSON.stringify([sectionOf(q),label(q)]);if(!peerCache.has(key))peerCache.set(key,questions.filter(x=>sectionOf(x)===sectionOf(q)&&label(x)===label(q)));return peerCache.get(key);};
 const controls=q=>all.filter(n=>question(n)===q);
 const encode=o=>'antq:'+JSON.stringify(o);
 const decode=s=>s.startsWith('{')?s:s.replace(/(?:%[0-9a-f]{2})+/gi,seq=>{const bytes=seq.match(/%[0-9a-f]{2}/gi).map(x=>parseInt(x.slice(1),16));let out='';for(let i=0;i<bytes.length;){const a=bytes[i++];if(a<128){out+=String.fromCharCode(a);continue;}const n=a<224?1:a<240?2:3;let cp=a&((1<<(6-n))-1);for(let j=0;j<n;j++)cp=(cp<<6)|(bytes[i++]&63);out+=String.fromCodePoint(cp);}return out;});
 const ref=(q,part='question',index=0)=>encode({section:sectionOf(q),label:label(q),occurrence:peers(q).indexOf(q),part,index});
 const row=q=>{if(rowCache.has(q))return rowCache.get(q);let n=q;const same=peers(q);while(n.parentElement&&n.parentElement!==form&&same.filter(x=>n.parentElement.contains(x)).length===1)n=n.parentElement;rowCache.set(q,n);return n;};
 const physical=n=>{
  if(n===form)return 'form.ant-form';
  const parts=[];for(let p=n;p&&p!==form;p=p.parentElement){let i=1;for(let s=p.previousElementSibling;s;s=s.previousElementSibling)if(s.tagName===p.tagName)i++;parts.unshift(p.tagName.toLowerCase()+':nth-of-type('+i+')');}
  return 'form.ant-form > '+parts.join(' > ');
 };
 const removal=q=>{
  if(peers(q).length<2)return null;
  const root=row(q),selectors='[aria-label="delete"],[title="删除"],.anticon-delete,.delete-item,.deleteIcon,.delete-icon,.del-btn';
  const nodes=[...root.querySelectorAll(selectors)].filter(visible);return nodes.length===1?nodes[0]:null;
 };
 const resolve=reference=>{
  const x=JSON.parse(decode(reference.slice(5))),qs=questions.filter(q=>sectionOf(q)===x.section&&label(q)===x.label),q=qs[x.occurrence];
  if(x.part==='section'||x.part==='add'){const sections=[...form.children].filter(s=>sectionTitle(s)===x.section);if(sections.length!==1)return null;if(x.part==='section')return physical(sections[0]);const nodes=[...sections[0].querySelectorAll('*')].filter(n=>visible(n)&&n.textContent.trim()===x.addLabel&&!n.querySelector('*'));return nodes.length===1?physical(nodes[0]):null;}
  if(x.part==='allQuestions')return qs.map(physical).join(',')||null;
  if(!q)return null;let n;
  if(x.part==='question')n=q;
  else if(x.part==='label')n=q.querySelector(':scope > .ant-form-item-label');
  else if(x.part==='row')n=row(q);
  else if(x.part==='remove')n=removal(q);
  else if(x.part==='control')n=controls(q)[x.index];
  else if(x.part==='selected'){
   const c=controls(q)[x.index];
   n=c?.type==='radio'?q.querySelector('label.ant-radio-wrapper-checked'):
    c?.readOnly&&/^\d{4}-\d{2}-\d{2}$/.test(c.value)?c:
     c?.closest('.ant-select')?.querySelector('.ant-select-selection-selected-value');
  }
  return n?physical(n):null;
 };
 if(operation==='resolve')return references?references.map(resolve):resolve(reference);
 return all.filter(n=>question(n)).map(n=>{
  const q=question(n),cs=controls(q),i=cs.indexOf(n),qlabel=label(q),s=section(q),r=row(q);
  return {selector:ref(q,'control',i),questionSelector:ref(q),labelSelector:ref(q,'label'),selectedSelector:ref(q,'selected',i),rowSelector:ref(q,'row'),rowDeleteSelector:removal(q)?ref(q,'remove'):null,sectionSelector:encode({section:sectionTitle(s),part:'section'}),section:sectionTitle(s),repeatIndex:peers(q).indexOf(q),controlIndex:i,
   locatorStrategy:'semantic_question',tag:n.tagName.toLowerCase(),type:n.type||n.getAttribute('role')||'custom_question',label:qlabel,placeholder:n.getAttribute('placeholder'),required:!!n.required||!!q.querySelector('.ant-form-item-required'),readonly:!!n.readOnly,multiple:!!n.closest('.ant-select')?.querySelector('.ant-select-selection--multiple'),disabled:!!n.disabled||n.getAttribute('aria-disabled')==='true'||!!n.closest('.ant-select-disabled'),accept:n.getAttribute('accept'),contextProvider:'.ant-form-item',userOnly:n.type==='password'||/证件号码|身份证|护照号|验证码|密码/.test(qlabel),rowQuestionCount:questions.filter(x=>r.contains(x)).length};
 });
}
export function antReference(reference,part){const x=JSON.parse(decodeURIComponent(reference.slice(5)));return 'antq:'+JSON.stringify({...x,part});}
