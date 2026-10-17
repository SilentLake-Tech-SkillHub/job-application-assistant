// Repeat item keys are stable React keys, not dense indexes. Resolve logical row
// ordinals to currently mounted DOM keys without editing IDs or component state.
export function remapFeishuSpecDOM(spec) {
  const keys={};
  for(const group of ['education','career','internship','project','works','award','language','sns']){
    [...document.querySelectorAll('.resumeEditForm-item.resumeEditForm-'+group)].forEach((row,index)=>{
      const key=row.querySelector('.atsx-form-item[data-cy]')?.getAttribute('data-cy')?.match(/^[^.]+/)?.[0];
      if(key)keys[`${group}[${index}]`]=key;
    });
  }
  const replace=value=>{
    if(typeof value==='string')return value.replace(/\b(?:education|career|internship|project|works|award|language|sns)\[\d+\]/g,key=>keys[key]||key);
    if(Array.isArray(value))return value.map(replace);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)]));
    return value;
  };
  return replace(spec);
}

export function remapSpec(spec,keys) {
  const replace=value=>typeof value==='string'?value.replace(/\b(?:education|career|internship|project|works|award|language|sns)\[\d+\]/g,key=>keys[key]||key):Array.isArray(value)?value.map(replace):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)])):value;
  return replace(spec);
}

export function canonicalizeInventory(fields) {
  const groups={},logicalToRuntime={},runtimeToLogical={};
  for(const field of fields){
    const key=field.selector.match(/\b(education|career|internship|project|works|award|language|sns)\[\d+\]/)?.[0];
    if(!key||runtimeToLogical[key])continue;
    const group=key.split('[')[0],index=groups[group]||0;groups[group]=index+1;
    const logical=`${group}[${index}]`;logicalToRuntime[logical]=key;runtimeToLogical[key]=logical;
  }
  return {fields:fields.map(field=>({...field,selector:remapSpec(field.selector,runtimeToLogical),runtimeSelector:field.selector})),logicalToRuntime};
}
