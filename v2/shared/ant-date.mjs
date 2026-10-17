import {validDate} from './value-contract.mjs';
// Compose captured UI operations so an already running broker need not reconnect
// or restart Chrome to gain this driver. No DOM value injection or inferred days.
export async function performAntDay(page,action,value){
 if(!validDate(value,'day')||!action.openSelector)throw Error('ANT_DAY_CONTRACT_REQUIRED');
 const before=await page.observe({provider:'ant',fields:[{id:'target',read:{selector:action.selector,kind:'value'}},{id:'readonly',read:{selector:action.selector,kind:'attribute',attribute:'readonly'}}]});
 if(!before.fields.target?.present||before.fields.readonly?.value===null)throw Error('ANT_READONLY_DATE_INPUT_REQUIRED');
 const openTarget=await page.resolveSelector(action.openSelector);
 await page.locator(openTarget).click({timeout:10000});
 await page.wait('.ant-calendar-input');
 const calInput=page.locator('.ant-calendar-input');
 await calInput.fill(value,{timeout:10000});
 await calInput.press('Enter');
 let current=await page.observe({provider:'ant',fields:[{id:'target',read:{selector:action.selector,kind:'value'}},{id:'panel',read:{selector:'.ant-calendar',kind:'attribute',attribute:'class'}}]});
 if(current.fields.target?.value!==value||current.fields.panel?.present){
  const [year,month,day]=value.split('-').map(Number),selector=`.ant-calendar td[title="${year}年${month}月${day}日"]`;
  const cell=await page.observe({provider:'ant',fields:[{id:'cell',read:{selector,kind:'text'}}]});
  if(cell.fields.cell?.present===true&&cell.fields.cell.value===String(day)){
   await page.locator(selector).click({timeout:10000});
  }
 }
 current=await page.observe({provider:'ant',fields:[{id:'target',read:{selector:action.selector,kind:'value'}}]});
 if(current.fields.target?.value!==value)throw Error('ANT_DATE_COMMIT_NOT_VERIFIED');
 return {committed:true,precision:'day'};
}
