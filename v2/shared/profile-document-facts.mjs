import {readFile,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {recordProfileAnswers,validateProfile} from './profile.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
// Restore reviewed source facts through the same atomic profile writer. A file
// checksum proves which document was reviewed, not that a model's transcription
// is automatically correct; keep its exact excerpt and real source kind.
export async function recordProfileDocumentFacts(profile,{filePath,sha256,excerpt,facts,evidence},io={readFile,stat,realpath}){
 if(!path.isAbsolute(filePath||'')||!['.pdf','.png','.jpg','.jpeg','.doc','.docx','.md','.txt'].includes(path.extname(filePath).toLowerCase())||!/^[a-f0-9]{64}$/.test(sha256||'')||!excerpt?.trim()||!evidence?.trim()||!Array.isArray(facts)||!facts.length)throw Error('PRIMARY_DOCUMENT_EVIDENCE_REQUIRED');
 const canonical=await io.realpath(filePath),metadata=await io.stat(canonical);
 if(!metadata.isFile()||metadata.size<1||metadata.size>30*1024*1024)throw Error('PRIMARY_DOCUMENT_SIZE_INVALID');
 const content=await io.readFile(canonical);
 if(digest(content)!==sha256)throw Error('PRIMARY_DOCUMENT_HASH_MISMATCH');
 if(facts.some(fact=>fact.status!=='known'||fact.omissionKind!==undefined))throw Error('DOCUMENT_CANNOT_AUTHORIZE_OMISSION');
 const candidate=structuredClone(profile),result=recordProfileAnswers(candidate,{answers:facts,evidence});
 const sourceId='document-'+digest(canonical).slice(0,24),recordedAt=candidate.sources[result.sourceId].recordedAt;
 candidate.sources[sourceId]={kind:'primary_document',filePath:canonical,sha256,excerpt,evidence,recordedAt};
 delete candidate.sources[result.sourceId];
 for(const key of result.updatedFacts){candidate.facts[key].sourceIds=[sourceId];delete candidate.facts[key].reason;}
 validateProfile(candidate);Object.assign(profile,candidate);
 return {...result,sourceId,sourceKind:'primary_document',documentSha256:sha256,profileHash:digest(JSON.stringify(profile))};
}
