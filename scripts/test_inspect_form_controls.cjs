const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--no-sandbox']});
try{const page=await browser.newPage();await page.setContent(`<form>
<label for="plain">说明*</label><input id="plain" required value="PRIVATE_MARKER_765" maxlength="40">
<div class="info_box"><div class="subtitle">奖项名称*</div><div class="el-select"><input readonly placeholder="请选择" value="FAKE_PRIVATE_VALUE"></div></div>
<div class="el-date-editor"><input readonly></div><div class="el-cascader"><input readonly></div>
<div class="ant-select"><input role="combobox"></div>
<select id="multi" multiple><option selected>甲</option><option>乙</option></select>
<label><input type="checkbox">至今</label><input type="radio" name="nature">
<input id="end" disabled type="month"><input type="file" accept=".pdf" style="display:none">
<input type="hidden" value="HIDDEN_SECRET"><input type="password" value="PASSWORD_SECRET"><input id="otp" value="OTP_SECRET">
<div style="display:none"><input id="hidden-section"></div><textarea maxlength="500"></textarea><button>保存草稿</button>
</form>`);
await page.addScriptTag({content:fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'inspect_form_controls.js'),'utf8')});
const before=await page.locator('#plain').inputValue(); const r=await page.evaluate(()=>inspectApplicationForm(document));
assert.equal(r.count,12);assert.equal(r.fields.find(x=>x.label==='奖项名称*').kind,'select');assert.equal(r.fields.find(x=>x.label==='奖项名称*').action,'open_and_click_actual_option');assert.equal(r.fields.filter(x=>x.kind==='select').length,2);
assert.equal(r.fields.find(x=>x.label==='说明*').required,true);assert.equal(r.fields.find(x=>x.label==='说明*').maxLength,'40');assert.equal(r.fields.find(x=>x.kind==='multi_select').optionCount,2);
assert.equal(r.fields.find(x=>x.kind==='file').accept,'.pdf');assert.equal(r.fields.find(x=>x.disabled).action,'skip_until_dependency_resolved');assert(r.fields.some(x=>x.kind==='cascader'));assert(r.fields.some(x=>x.kind==='checkbox'));assert(r.fields.some(x=>x.kind==='radio'));
assert(!JSON.stringify(r).includes('SECRET'));assert(!JSON.stringify(r).includes('PRIVATE_MARKER'));assert(!JSON.stringify(r).includes('FAKE_PRIVATE_VALUE'));assert.equal(await page.locator('#plain').inputValue(),before);
assert.equal(await page.locator('.el-select input').inputValue(),'FAKE_PRIVATE_VALUE');assert(!r.fields.some(x=>x.locator==='#hidden-section'));
await page.setContent(`<div class="info_box"><div class="subtitle">姓名*</div><input id="given" aria-label="名" data-automation-id="name" aria-invalid="false"><label for="family">姓</label><input id="family" data-automation-id="name" aria-invalid="true" aria-errormessage="family-error"><div id="family-error" role="alert">必填</div></div><div class="info_box"><div class="subtitle">两字段</div><input id="unknown-a"><input id="unknown-b"></div>`);
const shared=await page.evaluate(()=>inspectApplicationForm(document));
const given=shared.fields.find(x=>x.controlLocator==='#given'),family=shared.fields.find(x=>x.controlLocator==='#family');
assert.equal(given.label,'名');assert.equal(family.label,'姓');assert.equal(given.validationErrorVisible,false);assert.equal(family.validationErrorVisible,true);assert.equal(given.sharedContainer,true);assert.equal(given.automationMatchCount,2);assert.equal(given.required,false);assert.equal(shared.fields.find(x=>x.controlLocator==='#unknown-a').fieldIdentityNeedsReview,true);
console.log(JSON.stringify({passed:true,controls:r.count,checks:26,readOnlyVerified:true,valuesExcluded:true,sharedContainerIdentityAndErrors:true}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
