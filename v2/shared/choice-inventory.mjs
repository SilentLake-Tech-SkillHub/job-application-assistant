// Read visible DOM state and use ordinary keyboard events only. Never set
// scrollTop, synthesize DOM events, or infer unseen options from an index.
export async function collectChoiceViews({read,press,target,maxSteps=48}){
 const seen=new Set();let view=await read(),steps=0,reason='current_visible_menu',complete=false,gap=false;
 const remember=()=>{if(!view.options.length||new Set(view.options).size!==view.options.length)throw Error('CHOICE_NOT_UNIQUE_OR_NOT_PRESENT');for(const text of view.options)seen.add(text);};
 const atEnd=()=>view.scroll&&view.scroll.top+view.scroll.viewport>=view.scroll.height-1;
 const moved=async(key)=>{const prior=JSON.stringify(view);await press(key);for(let i=0;i<6;i++){const next=await read();if(JSON.stringify(next)!==prior){view=next;return true;}if(i<5)await new Promise(r=>setTimeout(r,20));}return false;};
 if(view.scroll?.top>1){if(!await moved('Home')||view.scroll?.top>1){remember();return {options:[...seen],complete:false,reason:'keyboard_home_unavailable',steps};}}
 remember();
 while(true){
  if(target&&view.options.includes(target)){reason='target_visible';break;}
  if(view.scroll===null){complete=true;reason='non_scrollable_menu';break;}
  if(!view.scroll){reason='scroll_surface_unobserved';break;}
  if(atEnd()){complete=!gap;reason=gap?'keyboard_skipped_viewport':'keyboard_reached_end';break;}
  if(steps>=maxSteps){reason='keyboard_step_limit';break;}
  const before=view.scroll;steps++;
  if(!await moved('PageDown')){reason='keyboard_scroll_unavailable';break;}
  if(!view.scroll||view.scroll.surface!==before.surface||view.scroll.top<before.top){reason='scroll_surface_changed';break;}
  if(view.scroll.top-before.top>before.viewport+2)gap=true;
  remember();
 }
 return {options:[...seen],complete,reason,steps};
}

export async function choiceViewport(menu,options){
 const values=(await options.allTextContents()).map(s=>s.trim());
 // evaluate is deliberately read-only. Include the menu's popup parents because
// virtual lists often put the scroll viewport immediately above the list node.
 const scroll=typeof menu.evaluate==='function'?await menu.evaluate(n=>{
  const candidates=[n,...n.querySelectorAll('*')];let parent=n.parentElement;
  for(let i=0;parent&&i<2;i++,parent=parent.parentElement)if(!['BODY','HTML'].includes(parent.tagName))candidates.push(parent);
  const surfaces=candidates.filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1);
  const e=surfaces.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
  return e?{top:e.scrollTop,height:e.scrollHeight,viewport:e.clientHeight,surface:e.tagName+'|'+e.className+'|'+e.scrollHeight}:null;
 }):undefined;
 return {options:values,scroll};
}
