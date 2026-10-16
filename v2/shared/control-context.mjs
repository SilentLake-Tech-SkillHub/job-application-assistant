// Read rendered question wrappers through the existing browser broker; no hidden state.
export async function enrichControlContext(page,controls){
 if(!controls.length)return [];
 const roots=['.ud-formily-item','.ant-form-item'];const fields=[];
 for(const [i,c] of controls.entries())for(const [j,root]of roots.entries()){
  const wrapper=`${root}:has(:is(${c.selector})):not(:has(${root} :is(${c.selector})))`;
  fields.push({id:`${i}-${j}`,read:{selector:wrapper,kind:'text'}});
  fields.push({id:`${i}-${j}-label`,read:{selector:`${wrapper} > ${root}-label`,kind:'text'}});
 }
 const observed=await page.observe({fields});
 return controls.map((c,i)=>{const j=roots.findIndex((_,j)=>typeof observed.fields[`${i}-${j}`]?.value==='string'&&observed.fields[`${i}-${j}`].value.trim());const context=observed.fields[`${i}-${j}`]?.value;const first=(observed.fields[`${i}-${j}-label`]?.value||context)?.split('\n').map(s=>s.trim()).find(Boolean);const label=(first||c.label||c.placeholder||'').replace(/^[＊*\s]+|[＊*？?\s]+$/gu,'').trim();return {...c,label,required:c.required||!!first&&/[＊*]/u.test(first),userOnly:c.userOnly||/证件号码|身份证|护照号|验证码|密码/.test(label+' '+(c.placeholder||'')),contextProvider:j<0?(c.contextProvider||null):roots[j]};});
}
