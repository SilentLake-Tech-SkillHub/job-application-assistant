// Real-browser check: candidates from a multi-choice list row, then the learned
// selector resolves to exactly that icon. Run: node scripts/test-learned-targets-browser.mjs
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
import {targetCandidatesDOM,safeTargetCandidates,resolveTarget} from '../shared/learned-targets.mjs';
const browser=await chromium.launch(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:process.env.PW_EXECUTABLE?{executablePath:process.env.PW_EXECUTABLE}:{});
try{
 const page=await browser.newPage(),generated=['sc','fIosxK'].join('-');// a build-generated class the candidates must drop
 await page.setContent(`<div class="list-item-container"><span class="icon-container"><i class="wrap"><svg class="CheckboxUnchecked ${generated}" width="16" height="16"><rect width="16" height="16"/></svg></i></span><span class="item-text-label">互联网/电子商务</span><svg class="Arrow" width="8" height="8"><rect width="8" height="8"/></svg></div>`);
 const row=page.locator('.list-item-container');
 const candidates=safeTargetCandidates(await row.evaluate(targetCandidatesDOM));
 assert.deepEqual(candidates.map(c=>c.selector),[':scope > span.icon-container > i.wrap > svg.CheckboxUnchecked',':scope > svg.Arrow']);
 assert.ok(candidates.every(c=>c.matches===1));
 const learned={revision:1,targets:[{id:'lt-000000000000',driver:'phoenix_list_popup.selection',selector:candidates[0].selector}]};
 const target=await resolveTarget(row,{driver:'phoenix_list_popup.selection',builtIn:':scope > .icon-container > svg',code:'LIST_SELECTION_ACTION_TARGET_REQUIRED'},{load:async()=>learned});
 assert.equal(target.source,'learned');assert.equal(await target.locator.evaluate(n=>n.getAttribute('class')),'CheckboxUnchecked '+generated);
 const builtIn=await resolveTarget(row,{driver:'phoenix_list_popup.selection',builtIn:':scope > .icon-container svg',code:'LIST_SELECTION_ACTION_TARGET_REQUIRED'},{load:async()=>({revision:1,targets:[]})});assert.equal(builtIn.source,'built_in');
 console.log('ok',JSON.stringify(candidates));
}finally{await browser.close();}
