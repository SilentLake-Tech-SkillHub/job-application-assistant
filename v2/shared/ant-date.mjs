import {validDate} from './value-contract.mjs';
const popupSelector='.ant-picker-dropdown:not(.ant-picker-dropdown-hidden), .ant-calendar-picker-container:not(.ant-calendar-picker-container-hidden)';
async function openPanel(page,input){
 await input.click({timeout:10000});
 const panel=page.page.locator(popupSelector).filter({visible:true});
 const until=Date.now()+3000;
 while(await panel.count()!==1){if(Date.now()>=until)throw Error('DATE_MENU_NOT_UNIQUE');await new Promise(r=>setTimeout(r,20));}
 await panel.waitFor({state:'visible',timeout:3000});
 if(typeof panel.getAttribute==='function'){
  const settledUntil=Date.now()+3000;
  while(/(?:^|\s)[\w-]+-(?:enter|appear|leave)-active(?:\s|$)/.test(await panel.getAttribute('class')||'')){
   if(Date.now()>=settledUntil)throw Error('ANT_DATE_PANEL_ANIMATION_NOT_SETTLED');await new Promise(r=>setTimeout(r,20));
  }
 }
 return panel;
}
async function pickRenderedDay(panel,value,{select=true}={}){
 const [year,month,day]=value.split('-').map(Number);
 const exact=`td[title=${JSON.stringify(value)}],td[title=${JSON.stringify(`${year}年${month}月${day}日`)}]`;
 for(let step=0;step<120;step++){
  const cells=panel.locator(exact).filter({visible:true});
  // Adjacent-month duplicates are visible in two panels. Only the real
  // in-month cell is an execution target; disabled cells never qualify.
  const states=await cells.evaluateAll(ns=>ns.map(n=>({inView:n.classList.contains('ant-picker-cell-in-view')||!n.className.includes('ant-picker-cell')&&!n.className.includes('last-month')&&!n.className.includes('next-month'),disabled:/disabled/.test(n.className)||n.getAttribute('aria-disabled')==='true'})));
  const indices=states.map((s,i)=>s.inView&&!s.disabled?i:-1).filter(i=>i>=0);
  if(indices.length===1){const cell=cells.nth(indices[0]);if(select)await cell.click({timeout:10000});return cell;}
  if(indices.length>1)throw Error('ANT_DATE_OPTION_NOT_UNIQUE');
  if(states.some(s=>s.inView&&s.disabled))throw Error('ANT_DATE_OPTION_DISABLED');
  // Popup visibility precedes rendered calendar headers during transitions.
  // Wait for actual headers rather than treating an intermediate empty frame
  // as missing navigation. Date cells/selected markers remain mandatory.
  let headers,months;const renderedUntil=Date.now()+2000;
  do{headers=await panel.locator('.ant-picker-header-view,.ant-calendar-header').filter({visible:true}).allTextContents();
   months=headers.map(text=>{const match=text.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);return match?Number(match[1])*12+Number(match[2])-1:null;}).filter(x=>x!==null);
   if(months.length||Date.now()>=renderedUntil)break;await new Promise(r=>setTimeout(r,20));
  }while(true);
  if(!months.length)throw Error('ANT_DATE_NAVIGATION_NOT_CAPTURED');
  const target=year*12+month-1,min=Math.min(...months),max=Math.max(...months);
  if(target>=min&&target<=max){
   // Header and body can update in separate React commits. The matching
   // day must actually render before reading its selected-range marker.
   if(typeof cells.first==='function'){try{await cells.first().waitFor({state:'visible',timeout:2000});continue;}catch{}}
   throw Error('ANT_DATE_OPTION_NOT_PRESENT');
  }
  const previous=target<min,distance=previous?min-target:target-max;
  const cls=distance>=12?(previous?'.ant-picker-header-super-prev-btn':'.ant-picker-header-super-next-btn'):(previous?'.ant-picker-header-prev-btn':'.ant-picker-header-next-btn');
  const candidates=panel.locator(cls),navigation=await candidates.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect(),style=getComputedStyle(n);return {visible:r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none',disabled:n.disabled||n.getAttribute('aria-disabled')==='true'};}));
  const active=navigation.map((node,index)=>node.visible&&!node.disabled?index:-1).filter(index=>index>=0);
  if(active.length!==1)throw Error('ANT_DATE_NAVIGATION_NOT_UNIQUE');
  const buttons=candidates.nth(active[0]);
  if(!await buttons.isEnabled())throw Error('ANT_DATE_NAVIGATION_NOT_UNIQUE');
  const before=headers.join('|');try{await buttons.press('Enter',{timeout:3000});}catch(error){
   const state=await buttons.evaluate(n=>{const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,cover=document.elementFromPoint(x,y);return {outside:x<0||y<0||x>innerWidth||y>innerHeight,intercepted:!!cover&&cover!==n&&!n.contains(cover),hidden:getComputedStyle(n).visibility==='hidden',pointerNone:getComputedStyle(n).pointerEvents==='none'};}).catch(()=>({detached:true}));
   const logCause=/element is not stable/i.test(error.message)?'UNSTABLE':/intercepts pointer events/i.test(error.message)?'INTERCEPTED':/outside of the viewport/i.test(error.message)?'OUTSIDE_VIEWPORT':/element is not visible/i.test(error.message)?'HIDDEN':/not attached|detached/i.test(error.message)?'DETACHED':null;
   throw Error('ANT_DATE_NAVIGATION_'+(logCause||(state.detached?'DETACHED':state.outside?'OUTSIDE_VIEWPORT':state.hidden?'HIDDEN':state.pointerNone?'POINTER_DISABLED':state.intercepted?'INTERCEPTED':'TIMED_OUT')));
  }
  const until=Date.now()+2000;
  while((await panel.locator('.ant-picker-header-view,.ant-calendar-header').filter({visible:true}).allTextContents()).join('|')===before){if(Date.now()>=until)throw Error('ANT_DATE_NAVIGATION_NOT_CHANGED');await new Promise(r=>setTimeout(r,20));}
 }
 throw Error('ANT_DATE_NAVIGATION_LIMIT');
}
async function performRange(page,action,value){
 const selector=await page.resolveSelector(action.selector),peerSelector=await page.resolveSelector(action.rangePeerSelector);
 if(!validDate(action.rangePeerValue,'day')||![0,1].includes(action.rangeIndex))throw Error('ANT_DATE_RANGE_FROZEN_PEER_REQUIRED');
 const input=page.page.locator(selector),peer=page.page.locator(peerSelector);
 if(await input.count()!==1||await peer.count()!==1)throw Error('ANT_DATE_RANGE_INPUTS_NOT_UNIQUE');
 const same=await input.evaluate((n,{peerSelector,index})=>{const p=n.closest('.ant-calendar-picker,.ant-picker'),other=document.querySelector(peerSelector),inputs=p?[...p.querySelectorAll('input')]:[];return !!p&&inputs.length===2&&inputs[index]===n&&inputs[1-index]===other;},{peerSelector,index:action.rangeIndex});
 if(!same)throw Error('ANT_DATE_RANGE_CAPTURE_CHANGED');
 const inputs=action.rangeIndex===0?[input,peer]:[peer,input],values=action.rangeIndex===0?[value,action.rangePeerValue]:[action.rangePeerValue,value];
 if(values[0]>values[1])throw Error('DATE_RANGE_ORDER_INVALID');
 try{
  let pairCommitted=false;
  if(action.operation!=='verify'&&typeof inputs[0].fill==='function'&&typeof inputs[1].fill==='function'){
   await openPanel(page,inputs[0]);
   if((await inputs[0].evaluate(n=>!n.readOnly&&!n.disabled))&&(await inputs[1].evaluate(n=>!n.readOnly&&!n.disabled))){
    await inputs[0].fill(values[0],{timeout:3000});await inputs[0].press('Tab');
    await inputs[1].fill(values[1],{timeout:3000});await inputs[1].press('Enter');await inputs[1].press('Tab');
    pairCommitted=(await inputs[0].inputValue())===values[0]&&(await inputs[1].inputValue())===values[1];
   }
  }
  if(action.operation!=='verify'&&!pairCommitted)for(let i=0;i<2;i++){const panel=await openPanel(page,inputs[i]);await pickRenderedDay(panel,values[i]);}
  await inputs[1].press('Tab');
  if((await inputs[0].inputValue())!==values[0]||(await inputs[1].inputValue())!==values[1])throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
  // Reopen both endpoints. Text alone is insufficient: actual calendar cells
  // must carry the range-start/range-end selected markers.
  for(let i=0;i<2;i++){
   const panel=await openPanel(page,inputs[i]);
   const cell=await pickRenderedDay(panel,values[i],{select:false}),marker=i===0?'ant-picker-cell-range-start':'ant-picker-cell-range-end';
   if(!await cell.evaluate((n,marker)=>n.classList.contains(marker),marker))throw Error('ANT_DATE_RANGE_SELECTION_NOT_VERIFIED');
   await inputs[i].press('Escape');await inputs[i].press('Tab');
  }
  if((await inputs[0].inputValue())!==values[0]||(await inputs[1].inputValue())!==values[1])throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
  return {committed:true,precision:'day',rangeVerified:true};
 }catch(error){await input.press('Escape').catch(()=>{});await input.press('Tab').catch(()=>{});throw error;}
}
// Compose captured UI operations so an already running broker need not reconnect
// or restart Chrome to gain this driver. No DOM value injection or inferred days.
export async function performAntDay(page,action,value){
 if(action.operation==='inspect'||value==='至今'){
  const selector=await page.resolveSelector(action.selector),input=page.page.locator(selector);
  if(await input.count()!==1||!await input.evaluate(n=>n.tagName==='INPUT'&&!!n.closest('.ant-calendar-picker,.ant-picker')))throw Error('ANT_DATE_INPUT_NOT_CAPTURED');
  const before=await input.evaluate(n=>n.value);await input.click({timeout:10000});
  const menuSelector=popupSelector,panel=page.page.locator(menuSelector).filter({visible:true});
  try{
   await panel.waitFor({state:'visible',timeout:3000});if(await panel.count()!==1)throw Error('DATE_MENU_NOT_UNIQUE');
   const panelText=(await panel.innerText()).trim();
   const structure=typeof panel.evaluate==='function'?await panel.evaluate(n=>({
    className:n.className,editors:[...n.querySelectorAll('input')].map(x=>({className:x.className,placeholder:x.getAttribute('placeholder'),readonly:x.readOnly,disabled:x.disabled})),
    navigation:[...n.querySelectorAll('.ant-picker-header button')].map(button=>{const r=button.getBoundingClientRect(),style=getComputedStyle(button),cover=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {className:button.className,disabled:button.disabled,visibility:style.visibility,pointerEvents:style.pointerEvents,rect:{x:r.x,y:r.y,width:r.width,height:r.height},covered:!!cover&&cover!==button&&!button.contains(cover),coverTag:cover?.tagName,coverClass:typeof cover?.className==='string'?cover.className:null};}),
    panels:[...n.querySelectorAll('.ant-calendar-range-part,.ant-picker-panel')].map(x=>({className:x.className,header:x.querySelector('.ant-calendar-header,.ant-picker-header-view')?.textContent?.trim(),cells:[...x.querySelectorAll('td[title]')].map(c=>({title:c.title,className:c.className}))}))
   })):null;
   const labels=[...new Set((await panel.locator('button,a,[role="button"],label,span').filter({visible:true}).allTextContents()).map(s=>s.trim()).filter(Boolean))];
   const ongoing=labels.filter(s=>/^(至今|Present|Ongoing)$/i.test(s));
   if(action.operation==='inspect'){
    await input.press('Escape');await input.press('Tab');await panel.waitFor({state:'hidden',timeout:3000});
    return {status:'captured_date_options',options:[],dateOptions:{labels,panelText,ongoingLabel:ongoing.length===1?ongoing[0]:null,menuSelector,structure},restored:await input.evaluate(n=>n.value)===before};
   }
   if(!action.ongoingLabel||!ongoing.includes(action.ongoingLabel))throw Error('ONGOING_DATE_OPTION_NOT_CAPTURED');
   const option=panel.getByText(action.ongoingLabel,{exact:true});if(await option.count()!==1)throw Error('ONGOING_DATE_OPTION_NOT_UNIQUE');
   await option.click({timeout:10000});await input.press('Tab');
   if(await input.evaluate(n=>n.value)!=='至今')throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
   return {committed:true,precision:'day',ongoing:true};
  }catch(error){await input.press('Escape').catch(()=>{});await input.press('Tab').catch(()=>{});throw error;}
 }
 if(!validDate(value,'day')||!action.openSelector||!action.openLabel)throw Error('ANT_DAY_CONTRACT_REQUIRED');
 if(action.rangePeerSelector)return performRange(page,action,value);
 if(action.openKind==='captured_date_input'){
  const selector=await page.resolveSelector(action.selector),input=page.page.locator(selector);
  if(await input.count()!==1||!await input.evaluate(n=>n.tagName==='INPUT'&&!!n.closest('.ant-calendar-picker,.ant-picker')))throw Error('ANT_DATE_INPUT_NOT_CAPTURED');
  if(!await input.evaluate(n=>n.readOnly)){
   await input.fill(value,{timeout:10000});await input.press('Enter');await input.press('Tab');
   if(await input.evaluate(n=>n.value)!==value)throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
   return {committed:true,precision:'day'};
  }
  await input.click({timeout:10000});
  const editor=page.page.locator('.ant-calendar-input').filter({visible:true});
  if(await editor.count()===1){await editor.fill(value,{timeout:10000});await editor.press('Enter');await input.press('Tab');}
  else{
   // Only choose a date actually rendered by this panel; never synthesize DOM values.
   const panel=page.page.locator(popupSelector).filter({visible:true});await pickRenderedDay(panel,value);await input.press('Tab');
  }
  if(await input.evaluate(n=>n.value)!==value)throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
  return {committed:true,precision:'day'};
 }
 const before=await page.observe({provider:'ant',fields:[{id:'target',read:{selector:action.selector,kind:'value'}},{id:'readonly',read:{selector:action.selector,kind:'attribute',attribute:'readonly'}}]});
 if(!before.fields.target?.present||before.fields.readonly?.value===null)throw Error('ANT_READONLY_DATE_INPUT_REQUIRED');
 await page.act({method:'click',selector:action.openSelector,label:action.openLabel},null,{});
 await page.wait('.ant-calendar-input');
 await page.act({method:'fill',selector:'.ant-calendar-input'},value,{});
 let current=await page.observe({provider:'ant',fields:[{id:'target',read:{selector:action.selector,kind:'value'}},{id:'panel',read:{selector:'.ant-calendar',kind:'attribute',attribute:'class'}}]});
 if(current.fields.target?.value!==value||current.fields.panel?.present){
  const [year,month,day]=value.split('-').map(Number),selector=`.ant-calendar td[title="${year}年${month}月${day}日"]`;
  const cell=await page.observe({provider:'ant',fields:[{id:'cell',read:{selector,kind:'text'}}]});
  if(cell.fields.cell?.present!==true||cell.fields.cell.value!==String(day))throw Error('ANT_DATE_OPTION_NOT_PRESENT');
  await page.act({method:'click',selector,label:String(day)},null,{});
 }
 current=await page.observe({provider:'ant',fields:[{id:'target',read:{selector:action.selector,kind:'value'}}]});
 if(current.fields.target?.value!==value)throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
 return {committed:true,precision:'day'};
}
