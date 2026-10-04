// Isolated synthetic form: no accounts, personal data or real application submission.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:600}});
    await page.setContent(`<style>body{font:20px sans-serif;padding:40px}input{display:block;padding:10px;margin:10px}p{color:#a22}button{padding:10px}</style><h1>Isolated form binding test</h1><div><label for="first">Given name</label><input id="first"><label for="last">Family name</label><input id="last" aria-invalid="true"><p id="error">Family name required</p></div><button type="button" id="draft">Save draft</button><button type="button" id="reload">Reopen draft</button><p id="saved"></p><script>
    const model={first:'',last:''};let draft=null;
    for(const key of ['first','last']){const field=document.getElementById(key);field.addEventListener('input',()=>{model[key]=field.value});field.addEventListener('blur',()=>{if(key==='last'){field.setAttribute('aria-invalid',String(!model.last));document.querySelector('#error').hidden=!!model.last}})}
    document.querySelector('#draft').onclick=()=>{draft={...model};document.querySelector('#saved').textContent='Draft saved'};
    document.querySelector('#reload').onclick=()=>{if(draft)for(const key of ['first','last']){model[key]=draft[key];document.getElementById(key).value=model[key]}};
    </script>`);
    // Deliberately simulate the failure in the fixture, never as a production filling strategy.
    await page.locator('#last').evaluate(n=>{n.value='SampleB'});
    assert.equal(await page.locator('#last').inputValue(),'SampleB');
    await page.locator('#last').focus();await page.locator('#draft').focus();
    assert.equal(await page.locator('#last').getAttribute('aria-invalid'),'true');
    const output=process.argv[2];if(output)fs.mkdirSync(output,{recursive:true});
    if(output)await page.screenshot({path:path.join(output,'binding-before.png')});
    const first=page.getByLabel('Given name',{exact:true}),last=page.getByLabel('Family name',{exact:true});
    assert.equal(await first.count(),1);assert.equal(await last.count(),1);
    await first.fill('SampleA');await last.fill('SampleB');await page.locator('#draft').focus();
    assert.equal(await last.getAttribute('aria-invalid'),'false');assert.equal(await first.inputValue(),'SampleA');
    await page.locator('#draft').click();await page.locator('#reload').click();
    assert.equal(await first.inputValue(),'SampleA');assert.equal(await last.inputValue(),'SampleB');
    await last.fill('');await last.pressSequentially('SampleC');await page.locator('#draft').focus();
    assert.equal(await last.getAttribute('aria-invalid'),'false');assert.equal(await last.inputValue(),'SampleC');
    await page.locator('#draft').click();await page.locator('#reload').click();assert.equal(await last.inputValue(),'SampleC');
    if(output)await page.screenshot({path:path.join(output,'binding-after.png')});
    console.log(JSON.stringify({passed:true,directValueFailureReproduced:true,fillRecovered:true,sequentialInputRecovered:true,draftReadbackPassed:true,scope:'isolated synthetic fixture; no live ATS validation'}));
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
