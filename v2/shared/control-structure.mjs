// Structural candidates only. A match never grants permission to fill or proves
// that a custom date/select/upload driver works on the target company.
export function controlStructure(controls){
 const distinct=new Map();
 for(const c of controls){
  const label=(c.label||'').replace(/[＊*\s]+$/gu,'').trim();
  const shape={label,type:c.type||'unknown',tag:c.tag||null,readonly:!!c.readonly,required:!!c.required,renderer:c.contextProvider||null,options:c.options||null,userOnly:!!c.userOnly};
  const key=JSON.stringify(shape);const old=distinct.get(key);
  if(old){old.instances++;old.selectors.push(c.selector);}else distinct.set(key,{...shape,instances:1,selectors:[c.selector]});
 }
 return [...distinct.values()];
}
export function compareControlStructures(current,baseline=[]){
 const target=controlStructure(current),prior=controlStructure(baseline);
 const key=x=>JSON.stringify({label:x.label,type:x.type,tag:x.tag,readonly:x.readonly,required:x.required,renderer:x.renderer,options:x.options,userOnly:x.userOnly});
 const old=new Set(prior.map(key)),now=new Set(target.map(key));
 const matched=target.filter(x=>old.has(key(x))),added=target.filter(x=>!old.has(key(x))),removed=prior.filter(x=>!now.has(key(x)));
 return {rawControlCount:current.length,distinctStructureCount:target.length,matchedStructureCount:matched.length,structuralMatchRatio:target.length?matched.length/target.length:null,added,removed,executionVerified:false};
}
