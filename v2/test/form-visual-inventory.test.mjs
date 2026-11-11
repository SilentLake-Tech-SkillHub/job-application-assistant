import test from 'node:test';
import assert from 'node:assert/strict';
import {recordVisualRows,primaryCandidates,reconcilePrimaryControls,requiredExpansionIds,currentPrimaryContinuation,retainReviewedPrimary} from '../shared/form-visual-inventory.mjs';

const page={pageId:'chrome:test',pageUrl:'https://example.test/apply',generation:'one',sessionId:'broker'};
const visual=(rows,previous=[],screenshotId='snapshot')=>recordVisualRows({rows:previous,current:{page,screenshotId}},screenshotId,rows);
const structure=(table,controls,entrances=[])=>({visualPage:page,visualInventoryHash:table.current.inventoryHash,visualScreenshotId:table.current.screenshotId,contentHash:'rea-evidence',primaryCandidates:primaryCandidates({controls,entrances})});
test('a secondary locator changing after repeat expansion does not restart the primary comparison',()=>{
 const table=visual([{label:'Works',kind:'expander'}]),old=[{selector:'#file',label:'File',type:'file'}],initial=structure(table,old,[{title:'Works',selector:'#add',childSelectors:['#file']}]);
 const parent=initial.primaryCandidates.find(row=>row.kind==='expander'),child=initial.primaryCandidates.find(row=>row.kind==='field');
 const review=reconcilePrimaryControls(table,initial,{matches:[{visualId:table.rows[0].id,reaId:parent.id}],secondary:[{reaId:child.id,parentReaId:parent.id}]}),coverage={review,expansions:{[parent.id]:{status:'verified',proof:'children_already_rendered',screenshotId:review.screenshotId,structureHash:review.structureHash}}};
 const controls=[{selector:'#rows .row:nth-child(1) input',label:'File',type:'file'},{selector:'#rows .row:nth-child(2) input',label:'File',type:'file'}],next={...structure(table,controls,[{title:'Works',selector:'#add',childSelectors:controls.map(control=>control.selector)}]),controls};
 assert.equal(retainReviewedPrimary(next,initial,table,coverage).primaryContentHash,review.structureHash);
});
test('a currently displayed declared conditional child stays outside primary comparison; branch testing remains separate',()=>{
 const table=visual([{label:'Channel',kind:'field'}]);table.current.surveyRevision=2;
 const base=[{selector:'#channel',label:'Channel',type:'radio_group'}],initial=structure(table,base),review=reconcilePrimaryControls(table,initial,{matches:[{visualId:table.rows[0].id,reaId:initial.primaryCandidates[0].id}]}),coverage={review,expansions:{}};
 const child={selector:'#code',label:'Code',type:'text',required:false},controls=[...base,child],asset={...structure(table,controls),controls,companyId:'C00001',pageUrl:page.pageUrl};
 const template={id:'C00001',evidence:{sourceUrl:page.pageUrl},pages:[{fields:[{source:'channel',kind:'choice',control:{options:['Referral']},inventorySelectors:['#channel']},{when:{source:'channel',equals:'Referral'},inventorySelectors:['#code'],inventoryLabel:'Code',inventoryType:'text',required:false}]}]};
 assert.equal(retainReviewedPrimary(asset,initial,table,coverage,{template}).primaryContentHash,review.structureHash);
 template.pages[0].fields[0].inventorySelectors=['#unobserved-parent'];assert.equal(retainReviewedPrimary(asset,initial,table,coverage,{template}).primaryContentHash,undefined);
});

test('child REA retains the passed primary comparison when an actually expanded add entrance disappears',()=>{
 const table=visual([{label:'Name',kind:'field'},{label:'Summary',kind:'expander'}]);table.current.surveyRevision=2;
 const controls=[{selector:'#name',label:'Name',type:'text'}],initial=structure(table,controls,[{title:'Summary',selector:'#add',childSelectors:[]}]);
 const review=reconcilePrimaryControls(table,initial,{matches:table.rows.map((row,index)=>({visualId:row.id,reaId:initial.primaryCandidates[index].id}))}),entry=review.expansionIds[0];
 const coverage={review,expansions:{[entry]:{status:'verified',screenshotId:review.screenshotId,structureHash:review.structureHash,selectors:['#summary','#file']}}};
 const fields=[...controls,{selector:'#summary',label:'Summary',type:'textarea'},{selector:'#file',label:'File',type:'file'}],next={...structure(table,fields),controls:fields,contentHash:'new-child-rea'};
 const continued=retainReviewedPrimary(next,initial,table,coverage);
 assert.equal(continued.primaryContentHash,review.structureHash);assert.equal(currentPrimaryContinuation(table,coverage,continued,page).status,'primary_already_verified');assert.equal(continued.controls.length,3);
 const moved={...next,primaryCandidates:primaryCandidates({controls:fields,entrances:[{title:'Summary',selector:'#add-after-first-row',childSelectors:['#summary','#file']}]})};
 assert.equal(retainReviewedPrimary(moved,initial,table,coverage).primaryContentHash,review.structureHash);
 const repeatedCoverage=structuredClone(coverage);repeatedCoverage.expansions[entry]={...repeatedCoverage.expansions[entry],proof:'children_already_rendered'};delete repeatedCoverage.expansions[entry].selectors;
 const withRecord={...next,primaryCandidates:primaryCandidates({controls:fields,entrances:[{title:'Summary',selector:'#add-after-record-expansion',childSelectors:fields.map(field=>field.selector)}]})};
 assert.equal(retainReviewedPrimary(withRecord,initial,table,repeatedCoverage).primaryContentHash,review.structureHash);
 for(const mutate of [x=>x.controls.shift(),x=>x.primaryCandidates.push(...primaryCandidates({controls:[{selector:'#unproved',label:'Unproved',type:'text'}]})),x=>x.visualPage={...page,generation:'other'}]){const bad=structuredClone(next);mutate(bad);if(!bad.controls.some(c=>c.selector==='#name'))bad.primaryCandidates=bad.primaryCandidates.filter(row=>!row.selectors?.includes('#name'));assert.equal(retainReviewedPrimary(bad,initial,table,coverage).primaryContentHash,undefined);}
 const unproved=structuredClone(coverage);unproved.expansions[entry].status='attempted';assert.equal(retainReviewedPrimary(next,initial,table,unproved).primaryContentHash,undefined);
});

test('an empty expandable section is an independent primary item and requires actual expansion evidence',()=>{
 const table=visual([{label:'账号',kind:'expander'}]);
 const missing=reconcilePrimaryControls(table,structure(table,[]),{matches:[]});
 assert.deepEqual(missing.findings.map(f=>f.kind),['missing_in_rea']);
 const rea=structure(table,[],[{title:'账号',selector:'#add',childSelectors:[]}]);
 const [row]=rea.primaryCandidates;
 const result=reconcilePrimaryControls(table,rea,{matches:[{visualId:table.rows[0].id,reaId:row.id}]});
 assert.equal(result.status,'passed');
 assert.deepEqual(requiredExpansionIds(result),[row.id]);
 assert.deepEqual(requiredExpansionIds(result,{[row.id]:{status:'verified',screenshotId:'old',structureHash:rea.contentHash}}),[row.id]);
 assert.deepEqual(requiredExpansionIds(result,{[row.id]:{status:'verified',screenshotId:table.current.screenshotId,structureHash:rea.contentHash}}),[]);
});

test('the company visual table is incremental, while the comparison uses the current page and verified parent ownership',()=>{
 const prior=visual([{label:'Other role question',kind:'field'}]);
 const table=visual([{label:'账号',kind:'expander'},{label:'渠道',kind:'field'}],prior.rows,'new');
 const rea=structure(table,[{selector:'#account',label:'用户名',type:'text'},{selector:'#r1',questionSelector:'#radio',label:'渠道',type:'radio'},{selector:'#r2',questionSelector:'#radio',label:'渠道',type:'radio'}],[{title:'账号',selector:'#add',childSelectors:['#account']}]);
 assert.equal(table.rows.length,3);
 assert.equal(rea.primaryCandidates.length,3);
 const [child,radio,add]=rea.primaryCandidates;
 const [,account,channel]=table.rows;
 const matches=[{visualId:account.id,reaId:add.id},{visualId:channel.id,reaId:radio.id}];
 assert.equal(reconcilePrimaryControls(table,rea,{matches,secondary:[{reaId:child.id,parentReaId:add.id}]}).status,'passed');
 assert.throws(()=>reconcilePrimaryControls(table,rea,{matches,secondary:[{reaId:child.id,parentReaId:radio.id}]}),/SECONDARY_CONTROL_PARENT_NOT_OBSERVED/);
 assert.throws(()=>reconcilePrimaryControls(table,{...rea,visualPage:{...page,generation:'changed'}},{matches}),/CURRENT_VISUAL_REA_PAIR_REQUIRED/);
});

test('a single visible date range label covers the two bound inputs without combining separate records',()=>{
 const controls=[0,1].flatMap(index=>['Begin','End'].map(part=>({selector:`[data-cy="education[${index}].datesInput${part}"]`,label:'起止时间',type:'month',part})));
 const candidates=primaryCandidates({controls});
 assert.equal(candidates.length,2);
 assert.deepEqual(candidates.map(candidate=>candidate.selectors.length),[2,2]);
});

test('secondary work cannot restart a passed same-document primary survey, while changed evidence permits recapture',()=>{
 const table=visual([{label:'账号',kind:'expander'}]);table.current.surveyRevision=2;
 const rea=structure(table,[],[{title:'账号',selector:'#add',childSelectors:[]}]);
 const review=reconcilePrimaryControls(table,rea,{matches:[{visualId:table.rows[0].id,reaId:rea.primaryCandidates[0].id}]});
 const coverage={review,expansions:{}};
 assert.deepEqual(currentPrimaryContinuation(table,coverage,rea,page).nextTools,['form_expand_sections']);
 coverage.expansions[review.expansionIds[0]]={status:'verified',screenshotId:review.screenshotId,structureHash:review.structureHash};
 assert.deepEqual(currentPrimaryContinuation(table,coverage,rea,page).nextTools,['form_review_completeness']);
 assert.equal(currentPrimaryContinuation(table,coverage,rea,{...page,generation:'reopened'}),null);
 assert.equal(currentPrimaryContinuation(table,coverage,{...rea,contentHash:'new-primary-structure'},page),null);
});
