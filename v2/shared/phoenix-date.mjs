import {annotateRecoveredControl} from './control-recovery.mjs';
import {validDate} from './value-contract.mjs';
import {readPhoenixSelectedValue} from './phoenix-selection.mjs';
const popup='.common-unmodeled-layer:has(.phoenix-date-picker)';
export function phoenixDayCellsDOM(panel){
 const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const selected=n=>n.getAttribute('aria-selected')==='true'||String(n.className).split(/\s+/).some(c=>/^(?:phoenix-calendar-selected-day|phoenix-calendar-selected-date)$/.test(c));
 const valid=(year,month,day)=>{const d=new Date(Date.UTC(year,month-1,day));return year>=1000&&d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day;};
 const format=(y,m,d)=>y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
 const records=[],seen=new Set();
 for(const n of [...panel.querySelectorAll('[title],[data-date],[aria-label]')].filter(visible)){
  const cell=n.closest('td,[role="gridcell"],.phoenix-calendar-cell');if(!cell||seen.has(cell))continue;
  for(const attribute of ['title','data-date','aria-label']){
   const raw=n.getAttribute(attribute),m=raw?.match(/^(\d{4})(?:-(\d{1,2})-(\d{1,2})|年(\d{1,2})月(\d{1,2})日)$/);if(!m)continue;
   const [year,month,day]=[Number(m[1]),Number(m[2]||m[4]),Number(m[3]||m[5])];if(!valid(year,month,day))continue;
   records.push({date:format(year,month,day),selector:'['+attribute+'='+JSON.stringify(raw)+']',disabled:/disabled/.test(cell.className),selected:selected(cell),source:'rendered_full_date_attribute'});seen.add(cell);break;
  }
 }
 const years=[...panel.querySelectorAll('.phoenix-calendar-year-select')].filter(visible),months=[...panel.querySelectorAll('.phoenix-calendar-month-select')].filter(visible);
 if(years.length===1&&months.length===1){
  const y=String(years[0].innerText||years[0].textContent||'').trim().match(/^(\d{4})年?$/),m=String(months[0].innerText||months[0].textContent||'').trim().match(/^(\d{1,2})月$/);
  if(y&&m){const year=Number(y[1]),month=Number(m[1]);
   for(const cell of [...panel.querySelectorAll('.phoenix-calendar-cell')].filter(visible)){
    if(seen.has(cell))continue;const classes=String(cell.className).split(/\s+/);
    if(classes.includes('phoenix-calendar-last-month-cell')||classes.includes('phoenix-calendar-next-month-btn-day'))continue;
    const dayLabel=String(cell.innerText||cell.textContent||'').trim();if(!/^\d{1,2}$/.test(dayLabel)||!valid(year,month,Number(dayLabel)))continue;
    records.push({date:format(year,month,Number(dayLabel)),selector:'.phoenix-calendar-cell:not(.phoenix-calendar-last-month-cell):not(.phoenix-calendar-next-month-btn-day)',selectorRequiresText:true,dayLabel,headerYear:year,headerMonth:month,disabled:/disabled/.test(cell.className),selected:selected(cell),source:'rendered_unique_header_and_current_month_cell'});seen.add(cell);
   }
  }
 }
 // Duplicate actual cells for one date are ambiguous; never disambiguate by DOM order.
 return new Set(records.map(r=>r.date)).size===records.length?records:[];
}

export function phoenixCalendarDiagnosticsDOM(panel){
 const visible=n=>n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 return {cells:[...panel.querySelectorAll('td,[role="gridcell"]')].filter(visible).slice(0,50).map(n=>({text:n.innerText?.trim(),class:n.className,attributes:Object.fromEntries(['title','data-date','aria-label','aria-selected'].filter(a=>n.hasAttribute(a)).map(a=>[a,n.getAttribute(a)])),childTitles:[...n.querySelectorAll('[title],[data-date]')].map(c=>({title:c.getAttribute('title'),date:c.getAttribute('data-date')}))})),navigation:[...panel.querySelectorAll('a,button')].filter(visible).slice(0,30).map(n=>({text:n.innerText?.trim(),class:n.className,title:n.getAttribute('title')}))};
}
export function phoenixInlineOngoingDOM(input){
 if(input?.tagName!=='INPUT'||input.type!=='checkbox')return {valid:false};
 const col=input.closest?.('.fields-col'),checkboxes=col?[...col.querySelectorAll('input[type="checkbox"]')]:[];
 if(!col||col.querySelectorAll('.form-item--phoenix').length!==1||checkboxes.length!==1||checkboxes[0]!==input)return {valid:false};
 const text=n=>String(n?.innerText||n?.textContent||'').trim();
 let marker=null,node=input.parentElement;const seen=new Set();
 while(node&&!seen.has(node)){
  seen.add(node);const own=[...node.querySelectorAll('input[type="checkbox"]')];
  if(text(node)==='至今'&&own.length===1&&own[0]===input){marker=node;break;}
  if(node===col)break;node=node.parentElement;
 }
 return {valid:!!marker,checked:input.checked===true,disabled:input.disabled===true,label:marker?'至今':null,...(marker?{scope:'unique_observed_date_column'}:{})};
}

export async function performPhoenixDate(adapter,action,value){
 const originalPage=adapter.page.url?.();
 const trigger=adapter.page.locator(action.selector),label=adapter.page.locator(action.labelSelector);
 if(await trigger.count()!==1||await label.count()!==1)throw Error('PHOENIX_DATE_CAPTURE_REQUIRED');
 const read=()=>readPhoenixSelectedValue(trigger),before=await read();
 const inline=action.ongoingSelector?adapter.page.locator(action.ongoingSelector):null;
 const readInline=async()=>{if(!inline)return null;if(await inline.count()!==1)throw Error('PHOENIX_INLINE_ONGOING_NOT_UNIQUE');const state=await inline.evaluate(phoenixInlineOngoingDOM);if(!state.valid||state.label!=='至今')throw Error('PHOENIX_INLINE_ONGOING_EVIDENCE_CHANGED');return state;};
 const inlineBefore=await readInline();
 if(inline&&action.operation!=='inspect'){
  if(value==='至今'){
   if(!['day','month','year'].includes(action.precision))throw Error('PHOENIX_DATE_PRECISION_REQUIRED');
   if(action.operation!=='verify'){if(inlineBefore.disabled)throw Error('PHOENIX_INLINE_ONGOING_DISABLED');await inline.setChecked(true);}
   if(!(await readInline()).checked)throw Error('PHOENIX_ONGOING_NOT_SELECTED');
   if(action.operation!=='verify')return performPhoenixDate(adapter,{...action,operation:'verify'},value);
   return {committed:true,precision:action.precision,selectionVerified:true,value,ongoingChecked:true,ongoingSource:'captured_inline_checkbox'};
  }
  if(inlineBefore.checked){if(action.operation==='verify')throw Error('PHOENIX_ONGOING_STILL_SELECTED');if(inlineBefore.disabled)throw Error('PHOENIX_INLINE_ONGOING_DISABLED');await inline.setChecked(false);if((await readInline()).checked)throw Error('PHOENIX_ONGOING_STILL_SELECTED');}
 }
 const close=async()=>{await label.click({timeout:10000});};
 const open=async()=>{await trigger.click({timeout:10000});const p=adapter.page.locator(popup).filter({visible:true});await p.waitFor({state:'visible',timeout:3000});if(await p.count()!==1)throw Error('DATE_MENU_NOT_UNIQUE');return p;};
 const inspect=async panel=>{
  const month=panel.locator('.phoenix-calendar-month-panel').filter({visible:true}),year=panel.locator('.phoenix-calendar-year-calendar').filter({visible:true}),special=panel.locator('.phoenix-date-picker-special-text input').filter({visible:true}),check=panel.locator('.phoenix-date-picker-special-check input[type="checkbox"]');
  const ongoing=await special.count()===1&&await check.count()===1&&await special.inputValue()==='至今'?'至今':null;
  const dayCells=await panel.evaluate(phoenixDayCellsDOM),precision=await year.count()===1?'year':await month.count()===1?'month':dayCells.some(c=>validDate(c.date,'day'))?'day':null;
  return {precision,ongoingLabel:ongoing,labels:(await panel.innerText()).trim().split(/\s+/).filter(Boolean),...(precision==='day'?{dayCells}:{}),...(!precision?{calendarDiagnostics:await panel.evaluate(phoenixCalendarDiagnosticsDOM)}:{}),coverage:{complete:true,source:'current_rendered_calendar'}};
 };
 const clickNavigation=async(panel,selector,current,readCurrent)=>{
  const button=panel.locator(selector).filter({visible:true});if(await button.count()!==1)throw Error('PHOENIX_DATE_NAVIGATION_NOT_UNIQUE');await button.click({timeout:3000});
  const end=Date.now()+2000;while(await readCurrent()===current){if(Date.now()>=end)throw Error('PHOENIX_DATE_NAVIGATION_NOT_CHANGED');await new Promise(r=>setTimeout(r,20));}
 };
 let panel;
 try{
  panel=await open();const options=await inspect(panel);if(inline)options.inlineOngoing={label:'至今',selected:(await readInline()).checked,source:'captured_inline_checkbox'};
  if(action.operation==='inspect'){await close();await panel.waitFor({state:'hidden',timeout:3000});return {status:'captured_date_options',options:[],dateOptions:options,restored:await read()===before&&(!inline||(await readInline()).checked===inlineBefore.checked)};}
  if(!options.precision)throw Error('PHOENIX_DATE_PRECISION_NOT_SUPPORTED');
  if(action.precision&&action.precision!==options.precision)throw Error('PHOENIX_DATE_PRECISION_CHANGED');
  if(value==='至今'){
   if(options.ongoingLabel!=='至今')throw Error('ONGOING_DATE_OPTION_NOT_CAPTURED');
   const checkbox=panel.locator('.phoenix-date-picker-special-check input[type="checkbox"]');
   if(action.operation!=='verify')await checkbox.setChecked(true);
   if(!await checkbox.isChecked())throw Error('PHOENIX_ONGOING_NOT_SELECTED');
  }else{
   if(!validDate(value,options.precision))throw Error('PHOENIX_DATE_VALUE_PRECISION_MISMATCH');
   const [year,month]=value.split('-').map(Number);let cell;
   if(options.precision==='year'){
    const cells=panel.locator('.phoenix-calendar-year-panel-cell').filter({visible:true}),readRange=async()=>JSON.stringify(await cells.allTextContents());
    for(let step=0;step<150;step++){
     const years=(await cells.allTextContents()).map(s=>s.trim()).filter(s=>/^\d{4}$/.test(s)).map(Number);if(!years.length)throw Error('PHOENIX_DATE_YEAR_NOT_CAPTURED');
     if(years.includes(year))break;if(step===149)throw Error('PHOENIX_DATE_NAVIGATION_LIMIT');
     await clickNavigation(panel,Math.min(...years)>year?'.phoenix-calendar-year-panel-prev-decade-btn':'.phoenix-calendar-year-panel-next-decade-btn',await readRange(),readRange);
    }
    cell=cells.filter({hasText:new RegExp('^'+year+'$')});
   }else{
    const yearLabel=panel.locator(options.precision==='month'?'.phoenix-calendar-month-panel-year-select-content':'.phoenix-calendar-year-select');
    const readYear=async()=>Number((await yearLabel.innerText()).trim().replace(/年$/,''));
    for(let step=0;step<150;step++){
     if(await yearLabel.count()!==1)throw Error('PHOENIX_DATE_YEAR_NOT_CAPTURED');const current=await readYear();if(current===year)break;
     if(!Number.isInteger(current)||step===149)throw Error('PHOENIX_DATE_NAVIGATION_LIMIT');
     await clickNavigation(panel,options.precision==='month'?(current>year?'.phoenix-calendar-month-panel-prev-year-btn':'.phoenix-calendar-month-panel-next-year-btn'):(current>year?'.phoenix-calendar-prev-year-btn':'.phoenix-calendar-next-year-btn'),current,readYear);
    }
    if(options.precision==='month')cell=panel.locator('.phoenix-calendar-month-panel-cell').filter({hasText:new RegExp('^'+month+'月$')});
    else{
     const monthLabel=panel.locator('.phoenix-calendar-month-select'),readMonth=async()=>Number((await monthLabel.innerText()).trim().replace(/月$/,''));
     for(let step=0;step<12;step++){
      if(await monthLabel.count()!==1)throw Error('PHOENIX_DATE_MONTH_NOT_CAPTURED');const current=await readMonth();if(current===month)break;
      if(!Number.isInteger(current)||current<1||current>12||step===11)throw Error('PHOENIX_DATE_NAVIGATION_LIMIT');
      await clickNavigation(panel,current>month?'.phoenix-calendar-prev-month-btn':'.phoenix-calendar-next-month-btn',current,readMonth);
     }
     const target=(await panel.evaluate(phoenixDayCellsDOM)).filter(c=>c.date===value);if(target.length!==1)throw Error('PHOENIX_DATE_CELL_NOT_AVAILABLE');
     if(target[0].disabled)throw Error('PHOENIX_DATE_CELL_NOT_AVAILABLE');
     cell=panel.locator(target[0].selector).filter({visible:true});if(target[0].selectorRequiresText){if(!/^\d{1,2}$/.test(target[0].dayLabel))throw Error('PHOENIX_DATE_CELL_IDENTITY_REQUIRED');cell=cell.filter({hasText:new RegExp('^'+target[0].dayLabel+'$')});}
    }
   }
   if(await cell.count()!==1||await cell.evaluate(n=>/disabled/.test((n.closest?.('td,[role="gridcell"]')||n).className)))throw Error('PHOENIX_DATE_CELL_NOT_AVAILABLE');
   if(action.operation!=='verify')await cell.click({timeout:10000});
   else if(!await cell.evaluate(n=>{const cell=n.closest?.('td,[role="gridcell"]')||n;return cell.getAttribute('aria-selected')==='true'||String(cell.className).split(/\s+/).some(c=>/^(?:phoenix-calendar-selected-(?:day|date)|phoenix-calendar-(?:month|year)-panel-selected-cell)$/.test(c));}))throw Error('PHOENIX_DATE_SELECTION_NOT_VERIFIED');
  }
  await close();const end=Date.now()+2000;while(await read()!==value){if(Date.now()>=end)throw Error('PHOENIX_DATE_COMMIT_NOT_VERIFIED');await new Promise(r=>setTimeout(r,20));}
  if(inline&&(await readInline()).checked)throw Error('PHOENIX_ONGOING_STILL_SELECTED');
  if(action.operation!=='verify')return performPhoenixDate(adapter,{...action,precision:options.precision,operation:'verify'},value);
  return {committed:true,precision:options.precision,selectionVerified:true,value,...(inline?{ongoingChecked:false,ongoingSource:'captured_inline_checkbox'}:{})};
 }catch(error){await close().catch(()=>{});if(inline){try{const current=await readInline();if(current.checked!==inlineBefore.checked&&!current.disabled)await inline.setChecked(inlineBefore.checked);}catch{}}throw await annotateRecoveredControl(error,{before,expected:String(value),read,isClosed:async()=>await adapter.page.locator(popup).filter({visible:true}).count()===0,samePage:async()=>typeof originalPage==='string'&&adapter.page.url()===originalPage,auxiliaryRestored:async()=>!inline||(await readInline()).checked===inlineBefore.checked});}
}
