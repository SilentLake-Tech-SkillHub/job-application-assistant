// 站点入口配置只能经 scripts/site-entry.mjs：校验（不能写死岗位编号）→ 预览 → 用户原话 + 预览指纹 → 写入。
import test from 'node:test';import assert from 'node:assert/strict';import {readFile,rm} from 'node:fs/promises';import path from 'node:path';
import {siteEntry,checkLoginPath} from '../scripts/site-entry.mjs';
import {companyDoc,site,role,saveLogin,handoffWorkspace} from './fixtures/handoff.mjs';
const origin='https://jobs.example.test',uuid='739bc546-7ae3-4f6a-9d4f-681f02bf3a91';
const loc=(id)=>({kind:'declarative_transition',target:'same',detail:{location:{pathnamePattern:'^/job/detail$',query:{jobAdId:id}},roleSelector:'.title'},entryLocator:{text:'立即投递',label:'立即投递'},form:{location:{pathnamePattern:'^/form$',query:{fromPage:'job',jobAdId:id}},readySelector:'.t',roleSelector:'.t',rolePrefix:'你正在投递职位:'},evidence:{detailUrl:origin+'/job/detail?jobAdId='+uuid,formUrl:origin+'/form?fromPage=job&jobAdId='+uuid,capturedAt:'2026-10-24',method:'observed'}});
const login={schemaVersion:1,companyId:'keep',version:1,origin,loginPath:'/job/detail?jobAdId='+uuid,allowedPaths:['/'],loginMethod:'user_operated',evidence:{capturedAt:'2026-10-22',sourceUrl:origin+'/',method:'live'},account:{selector:'div.acct',source:'companyAccounts.keep.display',mask:'exact',pageUrl:origin+'/'},success:{requiresAccountMatch:true,noApplicationSubmission:true},entry:loc(uuid)};
async function ws(){const dir=await handoffWorkspace([companyDoc({code:'C00039',name:'Keep',sites:[site('S0015',origin)],roles:[role('J000144','S0015','AI 业务产品经理',origin+'/zpdetail/511153522')]})]);await saveLogin(dir,'Keep','登录.json',login);return {dir,workspace:path.dirname(dir),file:path.join(dir,'公司','中国大陆','Keep','登录.json')};}
test('fix a hard-coded role ID: preview → user words + preview fingerprint → written with confirmation and version bump',async()=>{
 const {dir,file}=await ws(),workspace=path.dirname(dir);
 // 交接目录名固定为 岗位交接：fixture 目录本身充当，用 workspace 指向其父目录时需同名
 const real=path.join(workspace,'岗位交接');const {rename}=await import('node:fs/promises');await rename(dir,real);const f=path.join(real,'公司','中国大陆','Keep','登录.json');
 try{
  const patch={entry:loc('$roleId'),loginPath:'/'};
  const p=await siteEntry({workspace,site:'S0015',patch});assert.match(p.show_user_exactly[0],/S0015/);assert.deepEqual(p.show_user_exactly.slice(1),['entry.detail.location.query.jobAdId：当前 "'+uuid+'" → 更新 "$roleId"','entry.form.location.query.jobAdId：当前 "'+uuid+'" → 更新 "$roleId"','loginPath：当前 "/job/detail?jobAdId='+uuid+'" → 更新 "/"']);assert.equal(p.expectedSha.length,64);
  await assert.rejects(siteEntry({workspace,site:'S0015',patch,quote:'确认',expectedSha:'0'.repeat(64)}),/SITE_ENTRY_CHANGED_SINCE_PREVIEW/);
  await assert.rejects(siteEntry({workspace,site:'S0015',patch,quote:' ',expectedSha:p.expectedSha}),/USER_QUOTE_REQUIRED/);
  const w=await siteEntry({workspace,site:'S0015',patch,quote:'确认改成通用写法',expectedSha:p.expectedSha,now:()=>'t'});assert.equal(w.version,2);
  const saved=JSON.parse(await readFile(f,'utf8'));assert.equal(saved.entry.detail.location.query.jobAdId,'$roleId');assert.equal(saved.loginPath,'/');assert.deepEqual(saved.confirmation,{userQuote:'确认改成通用写法',confirmedAt:'t',fields:['entry','loginPath']});
 }finally{await rm(real,{recursive:true,force:true});}
});
test('literal role IDs, role-specific login paths and out-of-scope keys are refused before any write',async()=>{
 const {dir}=await ws(),workspace=path.dirname(dir),real=path.join(workspace,'岗位交接');const {rename}=await import('node:fs/promises');await rename(dir,real);
 try{
  await assert.rejects(siteEntry({workspace,site:'S0015',patch:{entry:loc(uuid)}}),/ENTRY_ROLE_ID_LITERAL/);
  await assert.rejects(siteEntry({workspace,site:'S0015',patch:{loginPath:'/job/detail?jobAdId='+uuid}}),/LOGIN_PATH_ROLE_ID_LITERAL/);
  await assert.rejects(siteEntry({workspace,site:'S0015',patch:{account:{}}}),/SITE_ENTRY_PATCH_KEYS/);
  await assert.rejects(siteEntry({workspace,site:'S9999',patch:{loginPath:'/'}}),/UNKNOWN_SITE/);
  assert.equal(checkLoginPath('/051736/position/list'),'/051736/position/list');
 }finally{await rm(real,{recursive:true,force:true});}
});
