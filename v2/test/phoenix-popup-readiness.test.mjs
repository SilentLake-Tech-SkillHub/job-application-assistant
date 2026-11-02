import test from 'node:test';
import assert from 'node:assert/strict';
import {phoenixPopupKind} from '../shared/control-operations.mjs';

function fixture({kind='list',delayed=true,wrong=false}={}){
 let ready=!delayed,waits=0,tick=0;
 const page={locator:selector=>({filter(){return this;},first(){return this;},
  waitFor:async()=>{if(selector==='.common-unmodeled-layer')return;waits++;if(wrong)throw Error('EXPECTED_POPUP_TIMEOUT');ready=true;},
  count:async()=>ready&&(kind==='both'&&/area-selector-container|list-item-container/.test(selector)||kind==='area'&&selector.includes('area-selector-container')||kind==='list'&&selector.includes('list-item-container')||kind==='select'&&selector.includes('phoenix-selectList'))?1:0
 })};
 return {page,options:{now:()=>tick,sleep:async ms=>{tick+=ms;ready=true;},timeoutMs:100},waits:()=>waits};
}
test('a visible popup shell waits for its frozen list renderer before choosing a driver',async()=>{
 const f=fixture();assert.equal(await phoenixPopupKind(f.page,{choiceRenderer:'phoenix_list_popup'},f.options),'list');assert.equal(f.waits(),1);
});
test('an unclassified shell waits for actual renderer contents instead of guessing a simple select',async()=>{
 const f=fixture({kind:'area'});assert.equal(await phoenixPopupKind(f.page,{},f.options),'area');
});
test('a missing frozen renderer or two visible renderer owners fail without fallback',async()=>{
 const wrong=fixture({wrong:true});await assert.rejects(phoenixPopupKind(wrong.page,{choiceRenderer:'phoenix_list_popup'},wrong.options),/EXPECTED_POPUP_TIMEOUT/);
 const both=fixture({kind:'both',delayed:false});await assert.rejects(phoenixPopupKind(both.page,{},both.options),/CHOICE_MENU_NOT_UNIQUE/);
});
