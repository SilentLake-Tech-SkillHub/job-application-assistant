// Pages are compared by site and path only. Query strings carry per-load tokens;
// which role a page belongs to is read from the page itself (matchesRole).
export const samePage=(a,b)=>{try{const x=new URL(a),y=new URL(b);return x.origin===y.origin&&x.pathname===y.pathname;}catch{return false;}};
