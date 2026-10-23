import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {performPhoenixDate,phoenixDayCellsDOM,phoenixInlineOngoingDOM} from '../shared/phoenix-date.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';import {validateTemplate} from '../shared/engine.mjs';
import {verifyDateRanges} from '../shared/date-range-verification.mjs';
function fixture({missingMarker=false,ongoing=false,precision='month',initial='',dayWithoutAttributes=false,duplicateDay=false,missingHeader=false}={}){
 let year=2026,month=10,value=initial,opened=false,writes=0,checked=false,opens=0;
 const locator=extra=>({count:async()=>1,filter(){return this;},waitFor:async()=>{},...extra}),pad=n=>String(n).padStart(2,'0');
 const node=(kind,chosen)=>({className:missingMarker?'phoenix-calendar-'+kind+'-panel-current-cell':kind==='day'?'phoenix-calendar-selected-day':'phoenix-calendar-'+kind+'-panel-selected-cell',getAttribute:()=>null,closest:()=>null});
 const choose=v=>{value=v;opened=false;writes++;};
 const trigger=locator({click:async()=>{opened=true;opens++;},innerText:async()=>value?value+'\n'+value:'请选择',locator:s=>{assert.equal(s,'.phoenix-select__content');return locator({innerText:async()=>value});}}),label=locator({click:async()=>{opened=false;}});
 const panel=locator({count:async()=>opened?1:0,innerText:async()=>year+'年 '+month+'月',evaluate:async()=>precision==='day'&&!missingHeader?Array.from({length:new Date(Date.UTC(year,month,0)).getUTCDate()},(_,i)=>({date:year+'-'+pad(month)+'-'+pad(i+1),selector:dayWithoutAttributes?'.phoenix-calendar-cell:not(.phoenix-calendar-last-month-cell):not(.phoenix-calendar-next-month-btn-day)':'[title="'+year+'-'+pad(month)+'-'+pad(i+1)+'"]',...(dayWithoutAttributes?{selectorRequiresText:true,dayLabel:String(i+1),headerYear:year,headerMonth:month}:{} )})):[],locator:selector=>{
  if(selector==='.phoenix-calendar-month-panel')return locator({count:async()=>precision==='month'?1:0});
  if(selector==='.phoenix-calendar-year-calendar')return locator({count:async()=>precision==='year'?1:0});
  if(selector==='.phoenix-date-picker-special-text input')return locator({count:async()=>ongoing?1:0,inputValue:async()=>'至今'});
  if(selector==='.phoenix-date-picker-special-check input[type="checkbox"]')return locator({count:async()=>ongoing?1:0,setChecked:async v=>{checked=v;choose(v?'至今':'');},isChecked:async()=>checked});
  if(selector==='.phoenix-calendar-month-panel-year-select-content'||selector==='.phoenix-calendar-year-select')return locator({innerText:async()=>String(year)+(precision==='day'?'年':'')});
  if(selector==='.phoenix-calendar-month-select')return locator({innerText:async()=>month+'月'});
  if(selector.includes('prev-year-btn')||selector.includes('next-year-btn'))return locator({click:async()=>{year+=selector.includes('prev')?-1:1;}});
  if(selector==='.phoenix-calendar-prev-month-btn'||selector==='.phoenix-calendar-next-month-btn')return locator({click:async()=>{month+=selector.includes('prev')?-1:1;}});
  if(selector.includes('prev-decade-btn')||selector.includes('next-decade-btn'))return locator({click:async()=>{year+=selector.includes('prev')?-10:10;}});
  if(selector==='.phoenix-calendar-year-panel-cell'){let chosen;return locator({allTextContents:async()=>Array.from({length:10},(_,i)=>String(Math.floor(year/10)*10+i)),filter(opts){if(opts.hasText)chosen=Array.from({length:10},(_,i)=>Math.floor(year/10)*10+i).find(n=>opts.hasText.test(String(n)));return this;},click:async()=>choose(String(chosen)),evaluate:async fn=>fn(node('year'))});}
  if(selector==='.phoenix-calendar-month-panel-cell'){let chosen;return locator({filter({hasText}){chosen=Array.from({length:12},(_,i)=>i+1).find(n=>hasText.test(n+'月'));return this;},click:async()=>{month=chosen;choose(year+'-'+pad(month));},evaluate:async fn=>fn(node('month'))});}
  if(selector.startsWith('.phoenix-calendar-cell:not')){let day;return locator({filter(opts){if(opts.hasText)day=Array.from({length:31},(_,i)=>i+1).find(n=>opts.hasText.test(String(n)));return this;},count:async()=>duplicateDay?2:1,click:async()=>choose(year+'-'+pad(month)+'-'+pad(day)),evaluate:async fn=>fn(node('day'))});}
  if(selector.startsWith('[title=')){const target=JSON.parse(selector.slice(7,-1));return locator({click:async()=>choose(target),evaluate:async fn=>fn(node('day'))});}
  throw Error('unexpected test locator '+selector);
 }});
 return {adapter:{page:{locator:selector=>selector==='#date'?trigger:selector==='#label'?label:panel}},state:()=>({year,month,value,opened,writes}),counts:()=>({opens})};
}
test('Phoenix date discovery reads actual precision and restores without changing a value',async()=>{
 for(const precision of ['month','day','year']){const f=fixture({precision}),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label',operation:'inspect'});assert.equal(r.dateOptions.precision,precision);assert.equal(r.restored,true);assert.equal(f.state().writes,0);}
});
test('Phoenix month selection navigates actual year and independently reopens selected month',async()=>{const f=fixture(),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label'},'2027-08');assert.equal(r.selectionVerified,true);assert.deepEqual(f.state(),{year:2027,month:8,value:'2027-08',opened:false,writes:1});});
test('matching date text and today marker cannot substitute for actual selected state',async()=>{
 for(const [precision,value]of [['month','2026-10'],['day','2026-10-12'],['year','2026']]){const f=fixture({missingMarker:true,precision});await assert.rejects(performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label'},value),/SELECTION_NOT_VERIFIED/);assert.equal(f.state().writes,1);}
});
test('ongoing dates require the real displayed option and checked checkbox',async()=>{const f=fixture({ongoing:true}),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label'},'至今');assert.equal(r.selectionVerified,true);assert.equal(f.state().value,'至今');const absent=fixture();await assert.rejects(performPhoenixDate(absent.adapter,{selector:'#date',labelSelector:'#label'},'至今'),/OPTION_NOT_CAPTURED/);assert.equal(absent.state().writes,0);});
test('day/year execution selects and independently verifies the captured precision',async()=>{
 for(const [precision,value]of [['day','2027-08-15'],['year','2035']]){const f=fixture({precision}),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label',precision},value);assert.equal(r.selectionVerified,true);assert.equal(r.precision,precision);assert.equal(f.state().value,value);assert.equal(f.state().writes,1);}
 const day=fixture({precision:'day'});await assert.rejects(performPhoenixDate(day.adapter,{selector:'#date',labelSelector:'#label'},'2021'),/VALUE_PRECISION_MISMATCH/);assert.equal(day.state().writes,0);
 await assert.rejects(performPhoenixDate(day.adapter,{selector:'#date',labelSelector:'#label',precision:'year'},'2021'),/PRECISION_CHANGED/);
});
test('day evidence requires an actual full date title and rejects current-day as selected proof',()=>{
 const cell={className:'phoenix-calendar-current-day',getAttribute:()=>null},node={getClientRects:()=>[{}],getAttribute:()=> '2026年10月9日',closest:()=>cell};
 const records=vm.runInNewContext('('+phoenixDayCellsDOM.toString()+')(panel)',{panel:{querySelectorAll:()=>[node]},getComputedStyle:()=>({visibility:'visible'})});
 assert.equal(records[0].date,'2026-10-09');assert.equal(records[0].selected,false);assert.equal(records[0].selector,'[title="2026年10月9日"]');
 node.getAttribute=()=> '9';assert.equal(vm.runInNewContext('('+phoenixDayCellsDOM.toString()+')(panel)',{panel:{querySelectorAll:()=>[node]},getComputedStyle:()=>({visibility:'visible'})}).length,0);
});
test('builder produces valid day/month/year text readback contracts from restored panel evidence only',()=>{
 for(const precision of ['day','month','year']){
  const capture={companyId:'sample',captureId:'capture',pageUrl:'https://example.test/form',observedAt:new Date().toISOString(),controls:[{selector:'#date',selectedSelector:'#display',labelSelector:'#label',label:'Date',renderer:'phoenix_date_picker',tag:'div',type:'combobox',constructionBlockers:['PHOENIX_OPTIONS_AND_DRIVER_REQUIRED']}]};
  const args={capture,profile:{facts:{date:{status:'known',value:precision==='day'?'2026-10-09':precision==='month'?'2026-10':'2026'}}},mappings:[{selector:'#date',factKey:'date'}],choices:[{selector:'#date',status:'captured_date_options',restored:true,dateOptions:{precision,ongoingLabel:null}}],page:{roleTitle:'Example Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Dates'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}},templateId:'dates'};
  const b=buildFormTemplate(args);assert.equal(b.readyToRegister,true);validateTemplate(b.template);assert.equal(b.template.pages[0].fields[0].read.kind,'text');assert.equal(b.template.pages[0].fields[0].actions[0].precision,precision);
  args.choices[0].restored=false;assert.equal(buildFormTemplate(args).readyToRegister,false);
 }
});
test('independent Phoenix date proof must match the frozen precision and current value',async()=>{
 const field={id:'date',source:'date',precision:'month',actions:[{method:'phoenix_date',selector:'#date',labelSelector:'#label'}]},plan={fields:[field]},task={values:{date:'2026-10'}};
 const page={act:async action=>{assert.equal(action.precision,'month');return {selectionVerified:true,value:'2026-10',precision:'month'};}};
 assert.equal((await verifyDateRanges(page,plan,task)).date.status,'verified');
 page.act=async()=>({selectionVerified:true,value:'2026-10',precision:'day'});assert.equal((await verifyDateRanges(page,plan,task)).date.status,'failed');
 page.act=async()=>({selectionVerified:true,value:'2026-09',precision:'month'});assert.equal((await verifyDateRanges(page,plan,task)).date.status,'failed');
 field.when={source:'active',equals:true};page.act=async()=>{throw Error('INACTIVE_FIELD_VISITED');};assert.deepEqual(await verifyDateRanges(page,plan,task),{});
});

function inlineFixture({checked=false,valid=true,disabled=false,initial=''}={}){
 const base=fixture({initial}),original=base.adapter.page.locator;let check=checked,changes=0;
 const checkbox={count:async()=>1,evaluate:async fn=>{const input={tagName:'INPUT',type:'checkbox',checked:check,disabled};const col={textContent:'结束日期 至今',parentElement:null,querySelectorAll:selector=>selector==='.form-item--phoenix'?[{}]:[input]};const marker={textContent:valid?'至今':'其他条件',parentElement:col,querySelectorAll:()=>[input]};const box={textContent:'',parentElement:marker,querySelectorAll:()=>[input]};input.parentElement=box;input.closest=selector=>selector==='.fields-col'?col:null;return fn(input);},setChecked:async v=>{check=v;changes++;}};
 base.adapter.page.locator=selector=>selector==='#inline-ongoing'?checkbox:original(selector);
 return {...base,inline:()=>({checked:check,changes})};
}
const inlineAction={selector:'#date',labelSelector:'#label',ongoingSelector:'#inline-ongoing',precision:'month'};
test('inline ongoing is read from a real checkbox even when calendar has no ongoing option',async()=>{
 const f=inlineFixture(),r=await performPhoenixDate(f.adapter,inlineAction,'至今');assert.equal(r.selectionVerified,true);assert.equal(r.ongoingChecked,true);assert.equal(r.ongoingSource,'captured_inline_checkbox');assert.deepEqual(f.inline(),{checked:true,changes:1});assert.equal(f.state().writes,0);
 const verify=await performPhoenixDate(f.adapter,{...inlineAction,operation:'verify'},'至今');assert.equal(verify.value,'至今');assert.equal(f.inline().changes,1);
});
test('calendar selection clears a real inline ongoing checkbox and independently proves it remains clear',async()=>{
 const f=inlineFixture({checked:true,initial:'2024-01'}),r=await performPhoenixDate(f.adapter,inlineAction,'2027-08');assert.equal(r.selectionVerified,true);assert.equal(r.ongoingChecked,false);assert.deepEqual(f.inline(),{checked:false,changes:1});assert.equal(f.state().value,'2027-08');assert.equal(f.state().writes,1);
});
test('independent date verification cannot clear an inconsistent inline ongoing answer',async()=>{
 const f=inlineFixture({checked:true,initial:'2026-10'});await assert.rejects(performPhoenixDate(f.adapter,{...inlineAction,operation:'verify'},'2026-10'),/ONGOING_STILL_SELECTED/);assert.deepEqual(f.inline(),{checked:true,changes:0});assert.equal(f.state().writes,0);
 const unchecked=inlineFixture();await assert.rejects(performPhoenixDate(unchecked.adapter,{...inlineAction,operation:'verify'},'至今'),/ONGOING_NOT_SELECTED/);assert.deepEqual(unchecked.inline(),{checked:false,changes:0});
});
test('inspection preserves both displayed date and current inline checkbox state',async()=>{
 const f=inlineFixture(),r=await performPhoenixDate(f.adapter,{...inlineAction,operation:'inspect'});assert.equal(r.restored,true);assert.equal(r.dateOptions.precision,'month');assert.equal(r.dateOptions.ongoingLabel,null);assert.deepEqual(r.dateOptions.inlineOngoing,{label:'至今',selected:false,source:'captured_inline_checkbox'});assert.deepEqual(f.inline(),{checked:false,changes:0});
});
test('inline checkbox requires its actual exact ongoing label and is not a generic toggle',async()=>{
 const wrong=inlineFixture({valid:false});await assert.rejects(performPhoenixDate(wrong.adapter,inlineAction,'至今'),/EVIDENCE_CHANGED/);assert.equal(wrong.inline().changes,0);
 const disabled=inlineFixture({disabled:true});await assert.rejects(performPhoenixDate(disabled.adapter,inlineAction,'至今'),/DISABLED/);assert.equal(disabled.inline().changes,0);
 assert.equal(phoenixInlineOngoingDOM({tagName:'DIV',type:'checkbox',checked:true}).valid,false);
});
test('builder freezes captured inline ongoing action and readback selectors without needing a panel ongoing entry',()=>{
 const capture={companyId:'sample',captureId:'capture',pageUrl:'https://example.test/form',observedAt:new Date().toISOString(),controls:[{selector:'#date',selectedSelector:'#display',labelSelector:'#label',label:'结束日期',renderer:'phoenix_date_picker',tag:'div',type:'combobox',inlineOngoing:{label:'至今',selector:'#inline-ongoing'}}]};
 for(const value of ['至今','2026-10']){
 const b=buildFormTemplate({capture,profile:{facts:{date:{status:'known',value}}},mappings:[{selector:'#date',factKey:'date'}],choices:[{selector:'#date',status:'captured_date_options',restored:true,dateOptions:{precision:'month',ongoingLabel:null}}],page:{roleTitle:'Example Role',roleSelector:'h1',readySelector:'form',sections:[{title:'Dates'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}},templateId:'dates'});
 assert.equal(b.readyToRegister,true);validateTemplate(b.template);const field=b.template.pages[0].fields[0];assert.equal(field.read.ongoingSelector,'#inline-ongoing');assert.equal(field.actions[0].ongoingSelector,'#inline-ongoing');
 }
});

test('inline marker climbs nested checkbox decoration but stops at the unique date column',()=>{
 const input={tagName:'INPUT',type:'checkbox',checked:true,disabled:false};
 const outside={textContent:'至今',parentElement:null,querySelectorAll:()=>[input]};
 let questions=1,boxes=1;
 const col={textContent:'结束日期 至今',parentElement:outside,querySelectorAll:s=>s==='.form-item--phoenix'?Array.from({length:questions},()=>({})):Array.from({length:boxes},()=>input)};
 const marker={textContent:'至今',parentElement:col,querySelectorAll:()=>[input]};
 const decorated={textContent:'',parentElement:marker,querySelectorAll:()=>[input]};
 input.parentElement=decorated;input.closest=()=>col;
 assert.equal(phoenixInlineOngoingDOM(input).valid,true);assert.equal(phoenixInlineOngoingDOM(input).checked,true);
 questions=2;assert.equal(phoenixInlineOngoingDOM(input).valid,false);questions=1;boxes=2;assert.equal(phoenixInlineOngoingDOM(input).valid,false);boxes=1;
 marker.textContent='至 今';assert.equal(phoenixInlineOngoingDOM(input).valid,false);
 marker.textContent='普通条件';assert.equal(phoenixInlineOngoingDOM(input).valid,false);
});

function renderedCalendar({year=2024,month=2,headers=1,duplicate=false}={}){
 const node=(text,classes,attrs={})=>({innerText:text,textContent:text,className:classes,getClientRects:()=>[{}],getAttribute:k=>attrs[k]??null,closest(){return this;}});
 const cells=[node('29','phoenix-calendar-cell phoenix-calendar-last-month-cell'),node('1','phoenix-calendar-cell phoenix-calendar-selected-date phoenix-calendar-selected-day'),node('2','phoenix-calendar-cell'),node('29','phoenix-calendar-cell'),node('31','phoenix-calendar-cell'),node('1','phoenix-calendar-cell phoenix-calendar-next-month-btn-day')];
 if(duplicate)cells.push(node('1','phoenix-calendar-cell'));
 const panel={querySelectorAll:s=>s==='[title],[data-date],[aria-label]'?[]:s==='.phoenix-calendar-year-select'?Array.from({length:headers},()=>node(year+'年','')):s==='.phoenix-calendar-month-select'?Array.from({length:headers},()=>node(month+'月','')):s==='.phoenix-calendar-cell'?cells:[]};
 const read=()=>vm.runInNewContext('('+phoenixDayCellsDOM.toString()+')(panel)',{panel,getComputedStyle:()=>({visibility:'visible'})});
 return {cells,panel,read,node};
}
test('day cells without full-date attributes use actual unique header and exact current-month text',()=>{
 const f=renderedCalendar(),rows=f.read();assert.deepEqual(Array.from(rows,r=>r.date),['2024-02-01','2024-02-02','2024-02-29']);assert.equal(rows[0].dayLabel,'1');assert.equal(rows[0].selectorRequiresText,true);assert.equal(rows[0].selected,true);assert.equal(rows[0].headerYear,2024);assert.equal(rows[0].headerMonth,2);assert.equal(rows[0].selector.includes(':nth'),false);
 f.cells[1].className='phoenix-calendar-cell phoenix-calendar-current-day';assert.equal(f.read()[0].selected,false);
});
test('day-cell inference rejects absent/ambiguous headers and duplicate current-month day cells',()=>{
 assert.equal(renderedCalendar({headers:0}).read().length,0);assert.equal(renderedCalendar({headers:2}).read().length,0);assert.equal(renderedCalendar({duplicate:true}).read().length,0);assert.equal(renderedCalendar({month:13}).read().length,0);
});
test('actual full-date attributes take priority and need no guessed calendar headers',()=>{
 const f=renderedCalendar({headers:0}),cell=f.node('1','phoenix-calendar-cell',{'data-date':'2026-10-01'});const original=f.panel.querySelectorAll;f.panel.querySelectorAll=s=>s==='[title],[data-date],[aria-label]'?[cell]:original(s);const rows=f.read();assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-10-01');assert.equal(rows[0].selector,'[data-date="2026-10-01"]');assert.equal(rows[0].selectorRequiresText,undefined);
});
test('execution selects unique current-month day text and independently reopens its selection',async()=>{
 const f=fixture({precision:'day',dayWithoutAttributes:true}),r=await performPhoenixDate(f.adapter,{selector:'#date',labelSelector:'#label',precision:'day'},'2027-08-15');assert.equal(r.selectionVerified,true);assert.equal(r.value,'2027-08-15');assert.equal(f.state().writes,1);assert.ok(f.counts().opens>=2);
 const duplicate=fixture({precision:'day',dayWithoutAttributes:true,duplicateDay:true});await assert.rejects(performPhoenixDate(duplicate.adapter,{selector:'#date',labelSelector:'#label'},'2026-10-15'),/CELL_NOT_AVAILABLE/);assert.equal(duplicate.state().writes,0);
 const badMarker=fixture({precision:'day',dayWithoutAttributes:true,missingMarker:true});await assert.rejects(performPhoenixDate(badMarker.adapter,{selector:'#date',labelSelector:'#label'},'2026-10-15'),/SELECTION_NOT_VERIFIED/);assert.equal(badMarker.state().writes,1);
});
