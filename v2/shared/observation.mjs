// Serializable, read-only DOM extractor. The browser adapter supplies current DOM,
// never the expected values. Selectors come from the captured provider template.
export function observeDOM(spec) {
  const visible=n=>!!n?.getClientRects().length && getComputedStyle(n).visibility!=='hidden';
  const one=s=>{const ns=s?document.querySelectorAll(s):[];return ns.length===1?ns[0]:null;};
  const text=n=>n?.innerText?.trim()??null;
  const errors=ss=>(ss||[]).flatMap(s=>[...document.querySelectorAll(s)].filter(visible).map(()=>({selector:s})));
  const fields={};
  for(const f of spec.fields){
    const r=f.read,n=one(r.selector);
    const o={present:!!n && (r.presenceSelector?visible(one(r.presenceSelector)):visible(n)),value:null,errors:errors(r.errorSelectors)};
    if(f.userOnly){fields[f.id]={present:!!n && visible(n),userOnly:true};continue;}
    if(n){
      if(r.kind==='value')o.value=n.tagName==='SELECT'?n.selectedOptions[0]?.textContent?.trim()??null:n.value??null;
      else if(r.kind==='text')o.value=text(n);
      else if(r.kind==='checked')o.value=typeof n.checked==='boolean'?n.checked:n.getAttribute('aria-checked')==='true';
      else if(r.kind==='attribute')o.value=n.getAttribute(r.attribute);
      else if(r.kind==='month'){
        const y=n.querySelector('[data-cy="year"]'),m=n.querySelector('[data-cy="month"]');
        o.value=text(n)==='至今'?'至今':y&&m?`${text(y)}-${text(m)}`:null;
      }else if(r.kind==='radio'){
        o.value=n.querySelector('input:checked')?.closest('label')?.textContent.trim()??null;
      }else if(r.kind==='files'){
        const names=r.filenameSelector?[...n.querySelectorAll(r.filenameSelector)].filter(visible).map(text):[];
        o.value=names;
        // A file input / FileList can never prove the server rendered an upload.
        o.uploadState=n.tagName!=='INPUT' && names.length && r.uploadedSelector && visible(one(r.uploadedSelector))?'site_rendered_uploaded':'unverified';
      }
      if(r.normalize==='phone_cn')o.value=String(o.value??'').replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
      if(f.kind==='choice'||f.kind==='date'){
        o.selected=n.tagName==='SELECT'?!!n.selectedOptions.length&&n.selectedOptions[0].value!=='':
          !!r.selectedSelector && visible(one(r.selectedSelector));
      }
    }
    fields[f.id]=o;
  }
  const groups={};
  for(const g of spec.groups||[])groups[g.id]=[...document.querySelectorAll(g.selector)].filter(visible).length;
  const sections=spec.sectionDiscovery?[...document.querySelectorAll(spec.sectionDiscovery.selector)].filter(visible).map(n=>{
    const root=spec.sectionDiscovery.parentContainer?n.parentElement:n;
    return {title:text(n.querySelector(spec.sectionDiscovery.titleSelector)),unexpanded:!!spec.sectionDiscovery.unexpandedSelector&&[...root.querySelectorAll(spec.sectionDiscovery.unexpandedSelector)].some(visible)};
  }):undefined;
  return {source:'live_dom',readAt:new Date().toISOString(),pageUrl:location.href,
    roleTitle:text(one(spec.roleSelector)),fields,groups,sections,pageErrors:errors(spec.errorSelectors),saveEvidence:'not_verified'};
}

export function compileExpected(plan,task) {
  return {pageUrl:task.pageUrl,roleTitle:plan.roleTitle,contentPolicy:task.contentPolicy,groups:plan.groups||[],sections:plan.sections,fields:plan.fields.filter(f=>!f.when||task.values?.[f.when.source]===f.when.equals).map(f=>{
    let value=task.values?.[f.source];
    if(f.enumMap && value!==undefined)value=f.enumMap[value];
    if(f.ongoingSource&&task.values?.[f.ongoingSource]===true)value='至今';
    if(f.read.normalize==='phone_cn'&&value!==undefined)value=String(value).replace(/^\+86\s*/,'').replace(/[^0-9]/g,'');
    if(f.kind==='file')value=task.files?.[value]?.displayNames;
    return {id:f.id,label:f.label,kind:f.kind,value,required:!!f.required,sensitive:!!f.sensitive,userOnly:!!f.userOnly,precision:f.precision,allowOngoing:!!f.ongoingSource,omission:task.omissions?.[f.id]};
  })};
}

export function attachInventory(observation,plan,inventory){
  observation.inventoryIds=inventory.map(control=>{
    const f=plan.fields.find(f=>(f.inventorySelectors||[f.read.selector]).includes(control.selector));
    return f?.id||`unmapped:${control.selector}`;
  });
  return observation;
}
