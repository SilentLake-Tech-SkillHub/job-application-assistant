/* Deterministic, browser-neutral field mapping. No page writes, profile values, or submission.
 * Canonical fingerprint implementation adapted from REA; see THIRD_PARTY_NOTICES.md. */
'use strict';
const { digestCanonicalValue } = require('./vendor/rea_canonical_digest.cjs');
const fs = require('node:fs');
const VERSION = 1;
const normalize = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s*＊:：]/g, '');
const RULES = [
  ['name', '姓名', ['姓名','真实姓名','应聘者姓名','fullname','candidatename']],
  ['phone', '手机号', ['手机号码','手机号','联系电话','mobilephone','phonenumber']],
  ['email', '邮箱', ['邮箱','电子邮箱','email','emailaddress']],
  ['project', '项目经历', ['项目经历','项目说明','projectexperience','projectdescription']],
  ['degree', '学历', ['学历','学位','degree']],
  ['graduation', '毕业时间', ['毕业时间','毕业年月','graduationdate']],
  ['bachelor.school', '学校-本科', ['本科院校','本科毕业院校','本科学校','bacheloruniversity']],
  ['master.school', '学校-硕士', ['硕士院校','硕士学校','研究生院校','masteruniversity']],
];
const AUTH = /密码|验证码|身份证|证件号|护照|银行卡|password|otp|captcha|token|cookie/i;
const CHOICE = /最高学历|highest|是否|调剂|志愿|意向|条款|同意|声明|terms|consent|preference/i;
function scope(url) {
  const u = new URL(url);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw Error('Expected credential-free HTTP(S) form URL');
  return { origin: u.origin, path: u.pathname };
}
function descriptor(f) {
  return { label:f.label || '', group:f.group || '', kind:f.kind, required:!!f.required,
    disabled:!!f.disabled, readonly:!!f.readonly, multiple:!!f.multiple,
    maxLength:f.maxLength ?? null, accept:f.accept ?? null, optionCount:f.optionCount ?? null,
    optionLabels:f.optionLabels || [], optionsNeedOpening:!!f.optionsNeedOpening,
    identityReview:!!f.fieldIdentityNeedsReview, labelSource:f.labelSource || '',
    validationError:!!f.validationErrorVisible, sharedContainer:!!f.sharedContainer };
}
function usableFields(inventory) {
  if (inventory?.readOnly !== true || inventory?.valuesIncluded !== false || !Array.isArray(inventory.fields)) throw Error('Expected value-free read-only inventory');
  if (inventory.count !== inventory.fields.length || inventory.fields.length > 2000) throw Error('Incomplete or oversized inventory');
  return inventory.fields.filter(f=>f.kind !== 'button').filter(f=>!
    (f.kind==='readonly_input' && inventory.fields.some(g=>g!==f && g.kind==='select' && g.label===f.label && g.group===f.group)));
}
function fingerprint(inventory, url) {
  return digestCanonicalValue({ version:VERSION, scope:scope(url), coverage:inventory.coverageLimit || '', fields:usableFields(inventory).map(descriptor) });
}
function semantic(f) {
  const label=normalize(f.label), group=normalize(f.group);
  if (AUTH.test(f.label || '')) return {reason:'user-only authentication or identifier'};
  if (CHOICE.test(f.label || '')) return {reason:'requires current user decision or field interpretation'};
  if (f.kind==='file' && /^(简历附件|简历|resume|resumefile)$/.test(label)) return {key:'resume',source:'材料:简历',confidence:1};
  const matches=RULES.filter(r=>r[2].includes(label));
  if (/^(学校|毕业院校|就读院校|school|university)$/.test(label)) {
    if (/本科|bachelor/.test(group) && !/硕士|master/.test(group)) matches.push(RULES.find(r=>r[0]==='bachelor.school'));
    if (/硕士|研究生|master/.test(group) && !/本科|bachelor/.test(group)) matches.push(RULES.find(r=>r[0]==='master.school'));
  }
  return matches.length === 1 ? {key:matches[0][0], source:'档案:'+matches[0][1], confidence:1} : {reason:'unresolved or ambiguous field meaning'};
}
function locator(f, fields) {
  // Only unambiguous associated labels are portable across rerenders; repeated labels use refreshed CSS.
  if (f.label && fields.filter(g=>g.label===f.label).length===1 && ['label','aria-label','aria-labelledby'].includes(f.labelSource)) return {label:f.label};
  if (f.controlLocator || f.locator) return {css:f.controlLocator || f.locator};
  return null;
}
function mapInventory(inventory, url, cache=null) {
  const fields=usableFields(inventory), hash=fingerprint(inventory,url);
  // Cache commits semantic assignments as well as structure; it never implies success or approval.
  const cacheHit=!!(cache && cache.version===VERSION && cache.fingerprint===hash && cache.verified===true &&
    cache.mappingDigest===digestCanonicalValue(cache.assignments) && cache.assignments.length===fields.length);
  const mapped=fields.map((f,i)=>{
    const s=semantic(f), loc=locator(f,fields);
    let reason=s.reason;
    if (f.disabled) reason='disabled dependency';
    if (f.fieldIdentityNeedsReview || !loc) reason='field identity needs review';
    const native=['text','select','file','radio','checkbox'].includes(f.kind) &&
      !(f.kind==='select' && !(f.evidence || []).some(e=>e==='select'));
    if (!native && !reason) reason='complex widget needs verified click recipe';
    if (f.validationErrorVisible && !reason) reason='existing validation error needs diagnosis';
    const old=cacheHit?cache.assignments[i]:null;
    if (old && (old.semantic!==s.key || old.source!==s.source)) throw Error('Cache assignment differs from current mapping rules');
    return {index:f.index, label:f.label || '', group:f.group || '', kind:f.kind, locator:loc,
      semantic:s.key || null, source:s.source || null, confidence:s.confidence || 0,
      disposition:reason?'exception':'automatic', reason:reason || null,
      privacy:['phone','email'].includes(s.key), required:!!f.required};
  });
  for(const f of mapped) {
    if(f.semantic && mapped.filter(g=>g.semantic===f.semantic).length>1) {
      f.disposition='exception';f.reason='multiple fields share one profile source; identify distinct records';
    }
  }
  return {version:VERSION, scope:scope(url), fingerprint:hash, cacheHit, fields:mapped,
    exceptions:mapped.filter(f=>f.disposition==='exception').map(f=>({index:f.index,label:f.label,group:f.group,reason:f.reason})),
    coverageLimit:inventory.coverageLimit || 'unknown coverage; inspect other frames and steps separately'};
}
function verifiedCache(mapping, verifiedIndexes) {
  const allowed=mapping.fields.filter(f=>f.disposition==='automatic');
  if (!allowed.every(f=>verifiedIndexes.includes(f.index))) throw Error('Every automatic mapping needs a successful current readback before caching');
  const assignments=mapping.fields.map(f=>({semantic:f.semantic,source:f.source}));
  return {version:VERSION, fingerprint:mapping.fingerprint, scope:mapping.scope, verified:true, assignments,
    mappingDigest:digestCanonicalValue(assignments)};
}
function summary(mapping) {
  return {fingerprint:mapping.fingerprint,cacheHit:mapping.cacheHit,automatic:mapping.fields.filter(f=>f.disposition==='automatic').length,
    exceptions:mapping.exceptions,coverageLimit:mapping.coverageLimit};
}
function cacheFromReadback(mapping, plan, now=Date.now()) {
  const fresh=t=>Number.isFinite(Date.parse(t)) && now-Date.parse(t)>=-60000 && now-Date.parse(t)<=15*60000;
  if(mapping.version!==VERSION || !plan || !Array.isArray(plan['字段']))throw Error('Expected mapping and existing fill-plan');
  const check=plan['页面校验'];
  if(!check || check['结果']!=='通过' || !fresh(check['时间']))throw Error('A fresh successful page check is required');
  if(digestCanonicalValue(scope(plan['表单链接']||plan['岗位链接']))!==digestCanonicalValue(mapping.scope))throw Error('Readback belongs to another form');
  const verified=[];
  for(const f of mapping.fields.filter(f=>f.disposition==='automatic')) {
    const matches=plan['字段'].filter(p=>digestCanonicalValue(p['定位'])===digestCanonicalValue(f.locator));
    if(matches.length!==1)throw Error('Missing unique readback field');
    const p=matches[0];
    if(p['状态']!=='已读回' || p['值来源']!==f.source || !fresh(p['更新时间']))throw Error('Automatic field has no fresh matching readback');
    verified.push(f.index);
  }
  return verifiedCache(mapping,verified);
}
module.exports={mapInventory,fingerprint,verifiedCache,cacheFromReadback,summary,semantic,scope};
if (require.main===module) {
  try {
    if(process.argv[2]==='--commit') {
      const [,mappingPath,planPath,out]=process.argv.slice(2);
      if(!mappingPath || !planPath || !out)throw Error('Usage: form_semantics.cjs --commit mapping.json readback-plan.json cache.json');
      const cache=cacheFromReadback(JSON.parse(fs.readFileSync(mappingPath,'utf8')),JSON.parse(fs.readFileSync(planPath,'utf8')));
      fs.writeFileSync(out,JSON.stringify(cache,null,2)+'\n');
      process.stdout.write(JSON.stringify({verified:true,assignments:cache.assignments.length})+'\n');
      return;
    }
    const [inventoryPath,url,out,cachePath]=process.argv.slice(2);
    if (!inventoryPath || !url || !out) throw Error('Usage: node form_semantics.cjs inventory.json URL mapping.json [verified-cache.json]');
    const mapping=mapInventory(JSON.parse(fs.readFileSync(inventoryPath,'utf8')),url,cachePath?JSON.parse(fs.readFileSync(cachePath,'utf8')):null);
    fs.writeFileSync(out,JSON.stringify(mapping,null,2)+'\n');
    process.stdout.write(JSON.stringify(summary(mapping))+'\n');
  } catch(e) { console.error(e.message); process.exitCode=2; }
}
