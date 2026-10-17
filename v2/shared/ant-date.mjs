import {validDate} from './value-contract.mjs';
// Compose captured UI operations so an already running broker need not reconnect
// or restart Chrome to gain this driver. No DOM value injection or inferred days.
export async function performAntDay(page,action,value){
 if(!validDate(value,'day')||!action.openSelector||!action.openLabel)throw Error('ANT_DAY_CONTRACT_REQUIRED');
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
