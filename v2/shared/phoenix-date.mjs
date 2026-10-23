import {validDate} from './value-contract.mjs';
const popup='.common-unmodeled-layer:has(.phoenix-date-picker)';
export async function performPhoenixDate(adapter,action,value){
 const trigger=adapter.page.locator(action.selector),label=adapter.page.locator(action.labelSelector);
 if(await trigger.count()!==1||await label.count()!==1)throw Error('PHOENIX_DATE_CAPTURE_REQUIRED');
 const read=async()=>(await trigger.innerText()).trim(),before=await read();
 const close=async()=>{await label.click({timeout:10000});};
 const open=async()=>{await trigger.click({timeout:10000});const p=adapter.page.locator(popup).filter({visible:true});await p.waitFor({state:'visible',timeout:3000});if(await p.count()!==1)throw Error('DATE_MENU_NOT_UNIQUE');return p;};
 const inspect=async panel=>{
  const month=panel.locator('.phoenix-calendar-month-panel').filter({visible:true}),special=panel.locator('.phoenix-date-picker-special-text input').filter({visible:true}),check=panel.locator('.phoenix-date-picker-special-check input[type="checkbox"]');
  const ongoing=await special.count()===1&&await check.count()===1&&await special.inputValue()==='至今'?'至今':null;
  return {precision:await month.count()===1?'month':null,ongoingLabel:ongoing,labels:(await panel.innerText()).trim().split(/\s+/).filter(Boolean)};
 };
 let panel;
 try{
  panel=await open();const options=await inspect(panel);
  if(action.operation==='inspect'){await close();await panel.waitFor({state:'hidden',timeout:3000});return {status:'captured_date_options',options:[],dateOptions:options,restored:await read()===before};}
  if(options.precision!=='month')throw Error('PHOENIX_DATE_PRECISION_NOT_SUPPORTED');
  if(value==='至今'){
   if(options.ongoingLabel!=='至今')throw Error('ONGOING_DATE_OPTION_NOT_CAPTURED');
   const checkbox=panel.locator('.phoenix-date-picker-special-check input[type="checkbox"]');
   if(action.operation!=='verify')await checkbox.setChecked(true);
   if(!await checkbox.isChecked())throw Error('PHOENIX_ONGOING_NOT_SELECTED');
  }else{
   if(!validDate(value,'month'))throw Error('INVALID_MONTH_VALUE');
   const [year,month]=value.split('-').map(Number),yearLabel=panel.locator('.phoenix-calendar-month-panel-year-select-content');
   for(let step=0;step<150;step++){
    if(await yearLabel.count()!==1)throw Error('PHOENIX_DATE_YEAR_NOT_CAPTURED');
    const current=Number((await yearLabel.innerText()).trim());if(current===year)break;
    if(!Number.isInteger(current)||step===149)throw Error('PHOENIX_DATE_NAVIGATION_LIMIT');
    const button=panel.locator(current>year?'.phoenix-calendar-month-panel-prev-year-btn':'.phoenix-calendar-month-panel-next-year-btn').filter({visible:true});
    if(await button.count()!==1)throw Error('PHOENIX_DATE_NAVIGATION_NOT_UNIQUE');await button.click({timeout:3000});
    const end=Date.now()+2000;while(Number((await yearLabel.innerText()).trim())===current){if(Date.now()>=end)throw Error('PHOENIX_DATE_NAVIGATION_NOT_CHANGED');await new Promise(r=>setTimeout(r,20));}
   }
   const cell=panel.locator('.phoenix-calendar-month-panel-cell').filter({hasText:new RegExp('^'+month+'月$')});
   if(await cell.count()!==1||await cell.evaluate(n=>/disabled/.test(n.className)))throw Error('PHOENIX_DATE_CELL_NOT_AVAILABLE');
   if(action.operation!=='verify')await cell.click({timeout:10000});
   else if(!await cell.evaluate(n=>/selected/.test(n.className)||n.getAttribute('aria-selected')==='true'))throw Error('PHOENIX_DATE_SELECTION_NOT_VERIFIED');
  }
  await close();const end=Date.now()+2000;while(await read()!==value){if(Date.now()>=end)throw Error('PHOENIX_DATE_COMMIT_NOT_VERIFIED');await new Promise(r=>setTimeout(r,20));}
  if(action.operation!=='verify')return performPhoenixDate(adapter,{...action,operation:'verify'},value);
  return {committed:true,precision:'month',selectionVerified:true,value};
 }catch(error){await close().catch(()=>{});throw error;}
}
