// New Formily selectors expose a search input beneath a pointer-intercepting
// display. Use the observed question wrapper, retaining the broker's exact
// label checks and normal clicks; never force-click the hidden search input.
export async function performUdChoice(page,action,value){
 const root=action.labelSelector?.replace(/ > \.ud-formily-item-label$/,'');
 if(!root||root===action.labelSelector)throw Error('UD_QUESTION_ANCHOR_REQUIRED');
 const read=async()=>page.observe({fields:[{id:'question',read:{selector:root,kind:'text'}},{id:'heading',read:{selector:'.resumeEditForm-headerText',kind:'text'}}]});
 const before=await read();if(!before.fields.question.present||!before.fields.heading.present)throw Error('UD_QUESTION_NOT_PRESENT');
 const dismiss=()=>page.call('act',{action:{method:'click',selector:'.resumeEditForm-headerText',label:before.fields.heading.value},value:null,files:{}});
 const label=before.fields.question.value.replace(/\n/g,'');
 await page.call('act',{action:{method:'click',selector:root,label},value:null,files:{}});
 try{
  await page.wait('.ud__select__list:visible');
  const menu=await page.observe({fields:[],sectionDiscovery:{selector:'.ud__select__list__item',titleSelector:'span'}});
  const options=menu.sections.map(x=>x.title).filter(x=>typeof x==='string'&&x.trim());
  if(!options.length||new Set(options).size!==options.length)throw Error('UD_OPTIONS_NOT_UNIQUE_OR_PRESENT');
  if(action.method==='ud_dropdown_inspect'){
   await dismiss();const after=await read();
   let closed;const deadline=Date.now()+1500;
   do{closed=await page.observe({fields:[],groups:[{id:'menu',selector:'.ud__select__list__item'}]});if(closed.groups.menu===0)break;await new Promise(r=>setTimeout(r,40));}while(Date.now()<deadline);
   return {options,restored:after.fields.question.value===before.fields.question.value&&closed.groups.menu===0};
  }
  if(!action.options?.includes(value)||!options.includes(value))throw Error('UNSUPPORTED_CHOICE_NO_FALLBACK');
  await page.call('act',{action:{method:'click',selector:'.ud__select__list__item:has-text('+JSON.stringify(value)+')',label:value},value:null,files:{}});
  await dismiss();
 }catch(e){await dismiss().catch(()=>{});throw e;}
}
