// Public, data-only capability registry. Company assets contain mappings, not drivers.
const freeze = value => { if(value && typeof value === 'object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };
export const CONTROL_TYPES = freeze({
 text:{kind:'text',valueType:'string',readbackType:'string',methods:['fill'],reads:['value','text']},
 searchable_text:{kind:'text',valueType:'string',readbackType:'string',methods:['fill'],reads:['value']},
 readonly_text:{kind:'text',valueType:'string',readbackType:'string',methods:[],reads:['value','text']},
 dropdown:{kind:'choice',valueType:'string',readbackType:'string',methods:['dropdown','select','ud_dropdown','ant_dropdown'],reads:['value','text']},
 radio:{kind:'choice',valueType:'string',readbackType:'string',methods:['radio'],reads:['radio']},
 year_picker:{kind:'date',valueType:'string',readbackType:'string',methods:['feishu_year','ud_date'],reads:['value','text']},
 month_picker:{kind:'date',valueType:'string',readbackType:'string',methods:['feishu_month','ud_date'],reads:['month','value']},
 day_picker:{kind:'date',valueType:'string',readbackType:'string',methods:['ant_day'],reads:['value']},
 checkbox:{kind:'boolean',valueType:'boolean',readbackType:'boolean',methods:['check'],reads:['checked']},
 file_upload:{kind:'file',valueType:'string',readbackType:'string[]',methods:['upload'],reads:['files']}
});
export const CONTROL_METHODS = freeze(Object.fromEntries([
 ...new Set(Object.values(CONTROL_TYPES).flatMap(c=>c.methods)), 'click','wait','ant_dropdown_inspect','ud_dropdown_inspect','capture_wecruit_schema'
].map(method=>[method,{method,inspection:method.endsWith('_inspect')||method==='wait'||method==='capture_wecruit_schema',templateAllowed:!method.endsWith('_inspect')&&method!=='capture_wecruit_schema'}])));
export const templateMethods = () => new Set(Object.keys(CONTROL_METHODS).filter(k=>CONTROL_METHODS[k].templateAllowed));
export const controlCapabilities = () => ({schemaVersion:1,revision:'shared-controls-1',types:CONTROL_TYPES,methods:CONTROL_METHODS,locatorPolicy:'question_scoped_unique',readbackPolicy:'live_dom_independent'});
