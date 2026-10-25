// Host role is declared by the host wiring (MCP env), never chosen by the model.
// executor: may operate recruiting websites through MCP stages (default, so a
// single-host installation keeps working). maintainer: repairs shared code and
// may only call read-only inspections; every website-facing stage is refused.
export const HOST_ROLES=new Set(['executor','maintainer']);
export function hostRole(env=process.env){
 const role=(env.RECRUITING_HOST_ROLE||'executor').trim();
 if(!HOST_ROLES.has(role))throw Error('INVALID_RECRUITING_HOST_ROLE');
 return role;
}
export function maintainerRefusal(tool){
 return {error:'HOST_ROLE_MAINTAINER_READ_ONLY',tool,hostRole:'maintainer',
  message:'维护宿主只能修复共享代码和调用只读检查；网站采集、填写、核验和提交只由执行宿主调用。',
  completion:{complete:false,status:'host_role_forbidden'},
  continuation:{state:'closed',owner:'user',requiresUser:false,shouldContinue:false,nextTools:[],reason:'HOST_ROLE_MAINTAINER_READ_ONLY'}};
}
