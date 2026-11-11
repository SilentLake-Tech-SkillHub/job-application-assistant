import {createHash} from 'node:crypto';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=value=>String(value||'').normalize('NFKC').trim().replace(/^[*\s]+|[*\s]+$/gu,'').replace(/\s+/gu,' ');
const rowKey=row=>digest([normalize(row.section),normalize(row.label),row.kind,row.occurrence??0]).slice(0,24);
export const sameVisualPage=(a,b)=>!!a&&!!b&&['pageId','pageUrl','generation','sessionId'].every(key=>a[key]&&a[key]===b[key]);
export const primaryStructureHash=structure=>structure?.primaryContentHash||structure?.contentHash;

// A later child inspection does not undo the independent primary comparison.
// Carry it only when every change belongs to a proved expansion on this page.
export function retainReviewedPrimary(asset,previous,table,coverage,{template}={}){
 const current=table?.current,review=coverage?.review;
 if(review?.status!=='passed'||!sameVisualPage(current?.page,asset.visualPage)||review.visualHash!==current.inventoryHash||review.screenshotId!==current.screenshotId)return asset;
 const proved=new Map(Object.entries(coverage.expansions||{}).filter(([,proof])=>proof.status==='verified'&&proof.screenshotId===review.screenshotId&&proof.structureHash===review.structureHash));
 const children=new Set([...proved.values()].flatMap(proof=>proof.selectors||[]));
 const reviewed=new Set([...(review.matches||[]).map(pair=>pair.reaId),...(review.secondary||[]).map(pair=>pair.reaId)]);
 if(template?.pages&&template.id===asset.companyId&&template.evidence?.sourceUrl===asset.pageUrl){
  const fields=template.pages.flatMap(page=>page.fields);
  for(const control of asset.controls)if(fields.some(field=>field.when&&field.inventorySelectors?.includes(control.selector)&&field.inventoryLabel===control.label&&field.inventoryType===control.type&&!!field.required===!!control.required&&fields.some(parent=>parent.source===field.when.source&&parent.kind==='choice'&&parent.control?.options?.includes(field.when.equals)&&asset.primaryCandidates.some(candidate=>reviewed.has(candidate.id)&&candidate.kind==='field'&&candidate.selectors.some(selector=>parent.inventorySelectors?.includes(selector))))))children.add(control.selector);
 }
 const candidates=new Map(asset.primaryCandidates.map(row=>[row.id,row])),prior=new Map((previous?.primaryCandidates||[]).map(row=>[row.id,row]));
 const movedEntrance=(row,sourceId)=>row.kind==='expander'&&[...proved].some(([id,proof])=>{
  if(sourceId&&sourceId!==id)return false;
  const pair=review.matches.find(pair=>pair.reaId===id),visual=table.rows?.find(item=>item.id===pair?.visualId);
  const label=/^(?:\+\s*)?(?:添加|新增|展开|add|expand)$/iu.test(normalize(visual?.label))?visual?.section:visual?.label;
  const retainedChild=asset.primaryCandidates.some(field=>field.kind==='field'&&reviewed.has(field.id)&&field.selectors.some(selector=>row.childSelectors?.includes(selector)));
  return normalize(label)===normalize(row.label)&&asset.primaryCandidates.filter(item=>item.kind==='expander'&&normalize(item.label)===normalize(row.label)).length===1&&(proof.selectors?.length?proof.selectors.every(selector=>row.childSelectors?.includes(selector)):proof.proof==='children_already_rendered'&&retainedChild);
 });
 for(const id of (review.matches||[]).map(pair=>pair.reaId)){
  const row=candidates.get(id),old=prior.get(id);
  if(!row){const proof=proved.get(id),replaced=asset.primaryCandidates.some(row=>movedEntrance(row,id)),consumed=proof?.selectors?.length&&proof.selectors.every(selector=>asset.controls.some(control=>control.selector===selector));if(!review.expansionIds.includes(id)||!proof||!replaced&&!consumed)return asset;}
  else if(old&&(row.kind!==old.kind||row.label!==old.label||row.controlType!==old.controlType))return asset;
 }
 for(const row of asset.primaryCandidates)if(row.kind==='expander'&&(reviewed.has(row.id)||movedEntrance(row)))for(const selector of row.childSelectors||[])children.add(selector);
 if(asset.primaryCandidates.some(row=>!reviewed.has(row.id)&&!movedEntrance(row)&&(row.kind!=='field'||!row.selectors.every(selector=>children.has(selector)))))return asset;
 return {...asset,primaryContentHash:review.structureHash};
}

export function recordVisualRows(table,screenshotId,rows){
 if(table?.current?.screenshotId!==screenshotId)throw Error('CURRENT_FORM_SCREENSHOT_REQUIRED');
 const current=rows.map(({label,section,kind,occurrence})=>({label:label.trim(),section:section?.trim()||null,kind,occurrence:occurrence??0})).map(row=>({...row,id:rowKey(row)}));
 if(!current.length||current.some(row=>!normalize(row.label))||new Set(current.map(row=>row.id)).size!==current.length)throw Error('VISUAL_PRIMARY_ROWS_NOT_UNIQUE');
 const inventory=new Map((table.rows||[]).map(row=>[row.id,row]));
 for(const row of current)inventory.set(row.id,row);
 return {...table,rows:[...inventory.values()],current:{...table.current,rowIds:current.map(row=>row.id),inventoryHash:digest(current)}};
}

export function primaryCandidates(capture){
 const fields=new Map();
 for(const control of capture.controls){
  const dateRangeKey=['Begin','End'].includes(control.part)?control.selector.replace(/Input(?:Begin|End)(?=")/u,'Input'):null;
  const key=control.type==='radio'&&control.questionSelector?control.questionSelector:dateRangeKey||control.selector;
  const existing=fields.get(key);
  if(existing){existing.selectors.push(control.selector);existing.reaNodeIds.push(...(control.reaCandidates||[]));continue;}
  const section=control.section||null;
  const label=control.displayLabel||control.label||control.placeholder||'';
  fields.set(key,{id:digest(['field',key]).slice(0,24),kind:'field',label,section,controlType:control.type,selectors:[control.selector],reaNodeIds:[...(control.reaCandidates||[])]});
 }
 return [...fields.values(),...(capture.entrances||[]).map(entrance=>({id:digest(['expander',entrance.selector]).slice(0,24),kind:'expander',label:entrance.title,section:entrance.section||null,...entrance}))];
}

// The visual list is supplied independently from the DOM/REA list. Every
// current row and every candidate must be accounted for exactly once.
export function reconcilePrimaryControls(table,structure,{matches,secondary=[]}){
 if(!table?.current?.inventoryHash||!sameVisualPage(table.current.page,structure?.visualPage)||structure.visualInventoryHash!==table.current.inventoryHash||structure.visualScreenshotId!==table.current.screenshotId)throw Error('CURRENT_VISUAL_REA_PAIR_REQUIRED');
 const rows=new Map(table.rows.filter(row=>table.current.rowIds.includes(row.id)).map(row=>[row.id,row]));
 const candidates=new Map(structure.primaryCandidates.map(row=>[row.id,row]));
 const usedRows=new Set(),usedCandidates=new Set(),accepted=[],findings=[];
 for(const {visualId,reaId} of matches){
  const visual=rows.get(visualId),rea=candidates.get(reaId);
  if(!visual||!rea||usedRows.has(visualId)||usedCandidates.has(reaId))throw Error('PRIMARY_CONTROL_PAIR_INVALID');
  usedRows.add(visualId);usedCandidates.add(reaId);
  const visualLabel=visual.kind==='expander'&&/^(?:\+\s*)?(?:添加|新增|展开|add|expand)$/iu.test(normalize(visual.label))?visual.section:visual.label;
  if(visual.kind!==rea.kind||normalize(visualLabel)!==normalize(rea.label)||visual.section&&rea.section&&normalize(visual.section)!==normalize(rea.section))findings.push({kind:'primary_identity_differs',visualId,reaId});
  else accepted.push({visualId,reaId});
 }
 const expanded=new Set(accepted.filter(pair=>rows.get(pair.visualId).kind==='expander').map(pair=>pair.reaId));
 for(const {reaId,parentReaId} of secondary){
  const child=candidates.get(reaId),parent=candidates.get(parentReaId);
  if(!child||child.kind!=='field'||!expanded.has(parentReaId)||usedCandidates.has(reaId)||!parent.childSelectors?.some(selector=>child.selectors.includes(selector)))throw Error('SECONDARY_CONTROL_PARENT_NOT_OBSERVED');
  usedCandidates.add(reaId);
 }
 for(const [id,row] of rows)if(!usedRows.has(id))findings.push({kind:'missing_in_rea',visualId:id,label:row.label});
 for(const [id,row] of candidates)if(!usedCandidates.has(id))findings.push({kind:'missing_in_visual',reaId:id,label:row.label});
 return {status:findings.length?'needs_backfill':'passed',findings,matches:accepted,secondary,expansionIds:[...expanded],visualHash:table.current.inventoryHash,screenshotId:table.current.screenshotId,structureHash:primaryStructureHash(structure)};
}

export function requiredExpansionIds(primary,expansions={}){
 return primary.expansionIds.filter(id=>expansions[id]?.status!=='verified'||expansions[id].screenshotId!==primary.screenshotId||expansions[id].structureHash!==primary.structureHash);
}

export function currentPrimaryContinuation(table,coverage,structure,page){
 const current=table?.current,review=coverage?.review;
 if(current?.surveyRevision!==2||!sameVisualPage(current.page,page)||review?.status!=='passed'||review.visualHash!==current.inventoryHash||review.screenshotId!==current.screenshotId||review.structureHash!==primaryStructureHash(structure))return null;
 const pending=requiredExpansionIds(review,coverage.expansions);
 return {status:'primary_already_verified',screenshotId:current.screenshotId,primaryComparison:'reuse_passed_primary_review',newVisualPrimaryReviewRequired:false,pending,nextTools:pending.length?['form_expand_sections']:['form_review_completeness']};
}
