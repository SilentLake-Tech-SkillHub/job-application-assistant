import {readHandoffBatch} from './company-directory.mjs';
import {validateMaterials} from './business-materials.mjs';

// Every execution entry resolves through the same confirmed role scope.
export async function confirmedMaterialContext({handoffDir,companyId,roleId,pageUrl,catalog}){
 const {input,source}=await readHandoffBatch({handoffDir});
 if(input.materialContractVersion!==1)throw Error('HANDOFF_MATERIAL_CONTRACT_UPGRADE_REQUIRED');
 const company=catalog.find(c=>c.id===companyId),parent=company?.companyId||companyId;
 const hits=input.companies.filter(c=>c.companyId===parent).flatMap(c=>c.roles).filter(r=>
  (roleId==null||String(r.roleId)===String(roleId))&&new URL(r.url).origin===new URL(pageUrl).origin);
 if(hits.length!==1)throw Error('CONFIRMED_MATERIAL_ROLE_NOT_UNIQUE');
 const role=hits[0];validateMaterials(role.materials);
 if(role.materials.items.some(item=>item.evidence.roleUrl!==role.url))throw Error('ROLE_MATERIAL_SCOPE_MISMATCH');
 return {batchId:input.batchId,contentSha256:source.contentSha256,companyId,roleId:role.roleId,roleUrl:role.url,materials:role.materials};
}
