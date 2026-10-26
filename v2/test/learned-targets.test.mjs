import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validTargetSelector,safeTargetCandidates,resolveTarget,addLearnedTarget,removeLearnedTarget,loadLearnedTargets,learnedTargetId} from '../shared/learned-targets.mjs';
import {safeControlErrorDetails} from '../shared/control-error-details.mjs';
import {technicalHandoffReasons} from '../shared/workflow-contract.mjs';

const candidate={tag:'svg',role:null,classes:['CheckboxUnchecked'],checked:false,selector:':scope > span.icon-container > svg.CheckboxUnchecked',matches:1};
test('learned selectors are row-relative structure only, never build-generated classes',()=>{
 assert.equal(validTargetSelector(':scope > span.icon-container > svg.CheckboxUnchecked'),true);
 for(const bad of ['.icon-container svg','body > div',':scope > div.sc-lkgTHX > svg',':scope > div.css-1q2w3e4',':scope > div[title="x"]',':scope > ',':scope > div:nth-child(2)'])assert.equal(validTargetSelector(bad),false,bad);
 assert.deepEqual(safeTargetCandidates([candidate,{...candidate,classes:['sc-fIosxK']},{...candidate,selector:'svg'},{...candidate,extra:'x'}]),[candidate,candidate]);
});
function row(counts,candidates=[candidate]){
 const clicks=[];return {clicks,locator:s=>({filter:()=>({count:async()=>counts[s]??0,click:async()=>clicks.push(s)})}),evaluate:async()=>candidates};
}
test('drivers use the built-in target first, then learned targets, then report the row candidates',async()=>{
 const learned={revision:1,targets:[{id:learnedTargetId('phoenix_list_popup.selection',candidate.selector),driver:'phoenix_list_popup.selection',selector:candidate.selector}]};
 const spec={driver:'phoenix_list_popup.selection',builtIn:':scope > .icon-container svg',code:'LIST_SELECTION_ACTION_TARGET_REQUIRED'};
 assert.equal((await resolveTarget(row({[spec.builtIn]:1,[candidate.selector]:1}),spec,{load:async()=>learned})).source,'built_in');
 const viaLearned=await resolveTarget(row({[spec.builtIn]:2,[candidate.selector]:1}),spec,{load:async()=>learned});assert.equal(viaLearned.source,'learned');assert.equal(viaLearned.learnedTargetId,learned.targets[0].id);
 await assert.rejects(resolveTarget(row({[spec.builtIn]:0}),spec,{load:async()=>({revision:1,targets:[]})}),error=>{assert.equal(error.message,'LIST_SELECTION_ACTION_TARGET_REQUIRED');assert.deepEqual(error.details,{phase:'driver_target_gap',driver:spec.driver,candidates:[candidate]});assert.deepEqual(safeControlErrorDetails(error.details),error.details);return true;});
});
test('a missing click target is a driver gap the executor hands to the maintainer',()=>{
 assert.deepEqual(technicalHandoffReasons({operation:'mcp_error',error:'LIST_SELECTION_ACTION_TARGET_REQUIRED'}),['LIST_SELECTION_ACTION_TARGET_REQUIRED']);
 assert.deepEqual(technicalHandoffReasons({operation:'role_prepare',results:[{errorCode:'AREA_SELECTION_ACTION_TARGET_REQUIRED'}]}),['AREA_SELECTION_ACTION_TARGET_REQUIRED']);
 assert.equal(safeControlErrorDetails({phase:'driver_target_gap',driver:'unknown.driver',candidates:[]}),null);
 assert.equal(safeControlErrorDetails({phase:'driver_target_gap',driver:'phoenix_area.selection',candidates:[{...candidate,selector:'body svg'}]}),null);
});
test('only a confirmed, evidenced entry is written; re-adding replaces, removal is explicit',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'lt-')),file=pathToFileURL(path.join(dir,'learned-targets.json'));
 await writeFile(file,JSON.stringify({revision:1,targets:[]}));
 const base={driver:'phoenix_list_popup.selection',selector:candidate.selector,evidence:{runId:'1a9b29fa-04a0-41ab-b763-930d117eb574',companyId:'keep'}};
 await assert.rejects(addLearnedTarget({...base,quote:''},file),/USER_CONFIRMATION_QUOTE_REQUIRED/);
 await assert.rejects(addLearnedTarget({...base,selector:':scope > div.sc-lkgTHX',quote:'确认'},file),/LEARNED_TARGET_INVALID/);
 const entry=await addLearnedTarget({...base,quote:'确认用第 0 个'},file);await addLearnedTarget({...base,quote:'确认'},file);
 const data=await loadLearnedTargets(file);assert.equal(data.targets.length,1);assert.equal(data.targets[0].id,entry.id);assert.equal(JSON.stringify(data).includes('确认'),false);
 await removeLearnedTarget(entry.id,file);assert.equal((await loadLearnedTargets(file)).targets.length,0);
 assert.equal(JSON.parse(await readFile(new URL('../catalog/learned-targets.json',import.meta.url),'utf8')).revision,1);
});
