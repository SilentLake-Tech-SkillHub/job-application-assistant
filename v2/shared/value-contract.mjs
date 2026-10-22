import {CONTROL_TYPES} from './control-registry.mjs';
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
  const t=CONTROL_TYPES[c?.type];
  if(!t||f.kind!==t.kind||c.valueType!==t.valueType||c.readbackType!==t.readbackType)throw Error('CONTROL_TYPE_CONTRACT_REQUIRED');
  if(f.readonly!==true&&!f.userOnly&&!(f.actions||[]).length)throw Error('CONTROL_ACTION_REQUIRED');
  if((f.actions||[]).some(a=>!t.methods.includes(a.method)))throw Error('CONTROL_ACTION_TYPE_MISMATCH');
  if(!t.reads.includes(f.read.kind))throw Error('CONTROL_READBACK_TYPE_MISMATCH');
  for(const a of f.actions||[])if(a.inputMode!==undefined&&(a.method!=='fill'||!t.inputModes?.includes(a.inputMode)))throw Error('INVALID_TEXT_INPUT_MODE');
  if(f.kind==='date'&&f.precision!==(c.type==='year_picker'?'year':c.type==='month_picker'?'month':'day'))throw Error('DATE_CONTROL_PRECISION_MISMATCH');
  if(f.kind==='choice'){
    if(!Array.isArray(c.options)||!c.options.length||c.options.some(v=>typeof v!=='string')||new Set(c.options).size!==c.options.length)throw Error('CONTROL_OPTIONS_REQUIRED');
    for(const a of f.actions||[])if(JSON.stringify(a.options)!==JSON.stringify(c.options))throw Error('CONTROL_OPTIONS_ACTION_MISMATCH');
    for(const a of f.actions||[])if(a.optionTextMap){
      if(a.method!=='ant_dropdown'||!Array.isArray(a.observedOptionTexts)||Object.entries(a.optionTextMap).some(([value,text])=>!c.options.includes(value)||typeof text!=='string'||!a.observedOptionTexts.includes(text)))throw Error('CHOICE_ALIAS_REQUIRES_CAPTURED_OPTION_TEXT');
    }
    if(f.enumMap&&Object.values(f.enumMap).some(v=>!c.options.includes(v)))throw Error('ENUM_MAPPING_OUTSIDE_CAPTURED_OPTIONS');
  }
  return c;
}
