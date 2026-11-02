import {readHandoffBatch} from './company-directory.mjs';
import {validateMaterials} from './business-materials.mjs';

// Every execution entry resolves through the same confirmed role scope:
// 目录项（companyId = 站点资产键）→ 站点编码、公司编码 → 本批确认的岗位编码（roleId）。
export async function confirmedMaterialContext({handoffDir,companyId,roleId,pageUrl,catalog}){
 const {input,source}=await readHandoffBatch({handoffDir});
 if(input.materialContractVersion!==2)throw Error('HANDOFF_MATERIAL_CONTRACT_UPGRADE_REQUIRED');
 const site=catalog.find(c=>c.id===companyId),parent=site?.companyId,siteId=site?.siteId;
 if(!site)throw Error('CONFIRMED_MATERIAL_ROLE_NOT_UNIQUE');
 const roles=input.companies.filter(c=>c.companyId===parent).flatMap(c=>c.roles);
 const hits=roles.filter(r=>(roleId==null||r.roleId===String(roleId))&&r.siteId===siteId&&new URL(r.url).origin===new URL(pageUrl).origin);
 if(hits.length!==1)throw Error('CONFIRMED_MATERIAL_ROLE_NOT_UNIQUE');
 const role=hits[0];validateMaterials(role.materials,role.roleId);
 return {batchId:input.batchId,contentSha256:source.files[parent].contentSha256,companyId,roleId:role.roleId,officialId:role.officialId,roleUrl:role.url,materials:role.materials};
}
