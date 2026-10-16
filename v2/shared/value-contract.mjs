// Canonical profile values are checked at ingestion, never repaired after writing.
export function validDate(value,precision) {
  if(typeof value!=='string')return false;
  const patterns={year:/^\d{4}$/,month:/^\d{4}-\d{2}$/,day:/^\d{4}-\d{2}-\d{2}$/};
  if(!patterns[precision]?.test(value))return false;
  const [y,m,d]=value.split('-').map(Number);
  return y>0&&(m===undefined||m>=1&&m<=12)&&(d===undefined||d>=1&&d<=new Date(Date.UTC(y,m,0)).getUTCDate());
}

// Only this explicit ingestion boundary accepts a numeric year. It does not
// infer missing precision or fabricate month/day components.
export function ingestFactValue(value,precision) {
  if(precision==='year'&&Number.isInteger(value))value=String(value);
  if(precision&&!validDate(value,precision))throw Error('INVALID_CANONICAL_DATE');
  return value;
}

export function validateControlContract(f) {
  const c=f.control;
  const types={text:['text','string','string',['fill']],searchable_text:['text','string','string',['fill']],readonly_text:['text','string','string',[]],dropdown:['choice','string','string',['dropdown','select']],radio:['choice','string','string',['radio']],year_picker:['date','string','string',['feishu_year']],month_picker:['date','string','string',['feishu_month']],checkbox:['boolean','boolean','boolean',['check']],file_upload:['file','string','string[]',['upload']]};
  const t=types[c?.type];
  if(!t||f.kind!==t[0]||c.valueType!==t[1]||c.readbackType!==t[2])throw Error('CONTROL_TYPE_CONTRACT_REQUIRED');
  if(f.readonly!==true&&!f.userOnly&&!(f.actions||[]).length)throw Error('CONTROL_ACTION_REQUIRED');
  if((f.actions||[]).some(a=>!t[3].includes(a.method)))throw Error('CONTROL_ACTION_TYPE_MISMATCH');
  const readKinds={text:['value','text'],searchable_text:['value'],readonly_text:['value','text'],dropdown:['value','text'],radio:['radio'],year_picker:['value','text'],month_picker:['month'],checkbox:['checked'],file_upload:['files']};
  if(!readKinds[c.type].includes(f.read.kind))throw Error('CONTROL_READBACK_TYPE_MISMATCH');
  if(f.kind==='date'&&f.precision!==(c.type==='year_picker'?'year':'month'))throw Error('DATE_CONTROL_PRECISION_MISMATCH');
  if(f.kind==='choice'){
    if(!Array.isArray(c.options)||!c.options.length||c.options.some(v=>typeof v!=='string')||new Set(c.options).size!==c.options.length)throw Error('CONTROL_OPTIONS_REQUIRED');
    for(const a of f.actions||[])if(JSON.stringify(a.options)!==JSON.stringify(c.options))throw Error('CONTROL_OPTIONS_ACTION_MISMATCH');
    if(f.enumMap&&Object.values(f.enumMap).some(v=>!c.options.includes(v)))throw Error('ENUM_MAPPING_OUTSIDE_CAPTURED_OPTIONS');
  }
  return c;
}
