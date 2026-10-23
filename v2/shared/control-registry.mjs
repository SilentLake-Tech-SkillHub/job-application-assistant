// Public, data-only capability registry. Company assets contain mappings, not drivers.
const freeze = value => { if(value && typeof value === 'object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };
export const CONTROL_TYPES = freeze({
 text:{kind:'text',valueType:'string',readbackType:'string',methods:['fill'],inputModes:['fill','keyboard'],reads:['value','text']},
 searchable_text:{kind:'text',valueType:'string',readbackType:'string',methods:['fill','phoenix_autocomplete'],inputModes:['fill','keyboard'],reads:['value']},
 readonly_text:{kind:'text',valueType:'string',readbackType:'string',methods:[],reads:['value','text']},
 dropdown:{kind:'choice',valueType:'string',readbackType:'string',methods:['dropdown','select','ud_dropdown','ant_dropdown','phoenix_dropdown'],reads:['value','text']},
 multiselect:{kind:'choice',valueType:'string[]',readbackType:'string[]',methods:['ant_multiselect','select_multiple'],reads:['selected_values']},
 radio:{kind:'choice',valueType:'string',readbackType:'string',methods:['radio','phoenix_radio'],reads:['radio']},
 year_picker:{kind:'date',valueType:'string',readbackType:'string',methods:['feishu_year','ud_date','phoenix_date'],reads:['value','text']},
 month_picker:{kind:'date',valueType:'string',readbackType:'string',methods:['feishu_month','ud_date','native_date','phoenix_date'],reads:['month','value','text']},
 day_picker:{kind:'date',valueType:'string',readbackType:'string',methods:['ant_day','native_date','phoenix_date'],reads:['value','text']},
 checkbox:{kind:'boolean',valueType:'boolean',readbackType:'boolean',methods:['check'],reads:['checked']},
 file_upload:{kind:'file',valueType:'string',readbackType:'string[]',methods:['upload'],reads:['files']}
});
export const CONTROL_METHODS = freeze(Object.fromEntries([
 ...new Set(Object.values(CONTROL_TYPES).flatMap(c=>c.methods)), 'authorized_submit','remove_uploaded_file','click','wait','dropdown_inspect','ant_dropdown_inspect','ud_dropdown_inspect','phoenix_dropdown_inspect','phoenix_dropdown_verify','phoenix_autocomplete_inspect','phoenix_autocomplete_verify','capture_wecruit_schema','ant_dropdown_verify','ud_dropdown_verify','dropdown_verify'
].map(method=>[method,{method,inspection:method.endsWith('_inspect')||method.endsWith('_verify')||method==='wait'||method==='capture_wecruit_schema',templateAllowed:!method.endsWith('_inspect')&&!method.endsWith('_verify')&&!['capture_wecruit_schema','remove_uploaded_file','authorized_submit'].includes(method)}])));
export const templateMethods = () => new Set(Object.keys(CONTROL_METHODS).filter(k=>CONTROL_METHODS[k].templateAllowed));
export const controlCapabilities = () => ({schemaVersion:1,revision:'shared-controls-2',types:CONTROL_TYPES,methods:CONTROL_METHODS,locatorPolicy:'question_scoped_unique',readbackPolicy:'live_dom_independent'});

// Persist one spelling for semantic references, independent of URL transport.
export function canonicalControlSpec(value){
 if(typeof value==='string'&&value.startsWith('antq:')){
  try{const raw=value.slice(5);return 'antq:'+JSON.stringify(JSON.parse(raw.startsWith('{')?raw:decodeURIComponent(raw)));}catch{throw Error('INVALID_SEMANTIC_CONTROL_REFERENCE');}
 }
 if(Array.isArray(value))return value.map(canonicalControlSpec);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,canonicalControlSpec(v)]));
 return value;
}
