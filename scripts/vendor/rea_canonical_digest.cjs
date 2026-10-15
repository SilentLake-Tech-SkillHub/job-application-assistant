// Adapted from morluto/rea src/domain/canonicalDigest.ts at ed24604ee10362b063feb8610cee1f2049df65c8.
// Copyright (c) 2026 morluto. MIT; full license in licenses/REA-MIT.txt.
// Changes: TypeScript types removed; CommonJS export added. Hashing semantics retained.
'use strict';
const {createHash}=require('node:crypto');
function digestCanonicalValue(value, context='Comparison') {
  const hash=createHash('sha256');let buffered='';
  const emit=part=>{buffered+=part;if(buffered.length>=8192){hash.update(buffered);buffered='';}};
  if(!emitCanonical(value,emit,new Set()))throw new TypeError(`${context} could not canonicalize data`);
  if(buffered)hash.update(buffered);return hash.digest('hex');
}
function emitCanonical(value,emit,ancestors) {
  if(typeof value==='number'&&!Number.isFinite(value))throw Error(Number.isNaN(value)?'NaN is not allowed':'Infinity is not allowed');
  if(value===null||typeof value!=='object'){
    const encoded=JSON.stringify(value);if(encoded===undefined)return false;emit(encoded);return true;
  }
  if(ancestors.has(value))throw Error('Circular reference detected');ancestors.add(value);
  try {
    if('toJSON' in value&&typeof value.toJSON==='function')return emitCanonical(value.toJSON(),emit,ancestors);
    if(Array.isArray(value)){
      emit('[');const length=value.length;
      for(let i=0;i<length;i++){if(i>0)emit(',');if(!(i in value))continue;const item=value[i];emitCanonical(item===undefined||typeof item==='symbol'?null:item,emit,ancestors);}emit(']');
    }else{
      emit('{');let first=true;
      for(const key of Object.keys(value).sort()){
        if(Reflect.get(value,key)===undefined||typeof Reflect.get(value,key)==='symbol')continue;
        const item=Reflect.get(value,key);if(!first)emit(',');first=false;emit(JSON.stringify(key));emit(':');
        if(!emitCanonical(item,emit,ancestors))emit('undefined');
      }emit('}');
    }return true;
  }finally{ancestors.delete(value);}
}
module.exports={digestCanonicalValue};
