// Suggestions from existing semantic facts only. Neither record order nor a
// framework's repeatIndex establishes which person's record a field represents.
const normalize=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/请输入|请填写/gu,'').replace(/[\s＊*：:()（）/／_-]/gu,''):'';
const familyOf=key=>{const m=key.match(/^(education|internship|employment|projects|workProjects|awards|languages)\.([^.]+)\.(.+)$/);return m?{family:m[1],recordId:m[2],suffix:m[3]}:null;};
const familyGroup=family=>family==='workProjects'?'projects':family;
const matches=(value,terms)=>terms.some(term=>normalize(term)===normalize(value));
function contextFor(control){
 const sections=[control.section,control.group].filter(v=>typeof v==='string'&&v.trim()),text=sections.map(normalize).join(' '),found=[];
 if(/教育|学历|学业|education|academic/.test(text))found.push('education');
 if(/实习|internship/.test(text))found.push('internship');
 if(/正式工作|工作经历|任职经历|工作背景|employment|workexperience/.test(text))found.push('employment');
 if(/项目|project/.test(text))found.push('projects');
 if(/奖项|获奖|荣誉|award|honor/.test(text))found.push('awards');
 if(/语言|外语|language/.test(text))found.push('languages');
 if(!found.length){
  const label=normalize(control.label);
  if(/^实习|^internship/.test(label))found.push('internship');
  else if(/^工作职责|^工作内容|^工作单位|^work/.test(label))found.push('employment');
  else if(/^项目|^project/.test(label))found.push('projects');
  else if(/^入学|^毕业|^学校|^专业|^学位|^学历/.test(label))found.push('education');
 }
 return {families:[...new Set(found)],evidence:sections,repeatIndex:control.repeatIndex??null,recordSelection:'requires_semantic_review',automaticMapping:false};
}
function intents(label){
 const result=[];
 const add=(intent,terms)=>{if(matches(label,terms))result.push(intent);};
 add('school',['学校','学校名称','毕业学校','毕业院校','院校名称','就读院校','school','school name','university','institution']);
 add('school_en',['学校英文名称','学校英文名','院校英文名','school name in English']);
 add('educationLevel',['学历','最高学历','学位','学历学位','教育程度','degree','education level','qualification']);
 add('major',['专业','专业名称','所学专业','主修专业','major','major name','field of study']);
 add('major_en',['专业英文名称','major in English']);
 add('start',['开始时间','开始日期','起始时间','起始日期','起始年月','入学时间','入职时间','实习开始时间','项目开始时间','start','start date','from date']);
 add('end',['结束时间','结束日期','结束年月','毕业时间','毕业日期','离职时间','实习结束时间','项目结束时间','end','end date','to date']);
 add('company',['单位名称','公司名称','工作单位','实习单位','任职公司','雇主','company','company name','employer','organization']);
 add('projectName',['项目名称','项目名','project','project name','project title']);
 add('role',['职务','职位名称','职位','岗位名称','担任职务','项目角色','项目职务','role','position','job title']);
 add('description',['项目描述','项目介绍','项目内容','项目简介','description','project description','project summary']);
 add('responsibilities',['工作职责','工作内容','实习内容','实习职责','任职职责','项目中职责','项目职责','职责描述','responsibilities','duties']);
 add('awardName',['获奖项','获奖名称','奖项名称','奖项','荣誉名称','award','award name','honor']);
 add('awardDate',['获奖时间','获奖日期','获奖年份','授奖时间','award date','award year','date awarded']);
 add('languageName',['语言类型','语种','语言名称','外语语种','language','language type','language name']);
 add('languageAbility',['掌握程度','熟练程度','语言水平','语言能力','proficiency','language proficiency']);
 add('listeningSpeaking',['听说','听说能力','口语水平','listening and speaking','speaking']);
 add('readingWriting',['读写','读写能力','reading and writing','writing']);
 return result;
}
function semanticMatch(fact,intent){
 const {family,suffix}=fact,group=familyGroup(family);
 if(intent==='school'||intent==='school_en')return group==='education'&&(intent==='school_en'?suffix==='school.name.en':/^(?:school(?:\.name(?:\.(?:zh|en))?)?|school\.abbreviation)$/.test(suffix));
 if(intent==='educationLevel')return group==='education'&&/^(?:level|degree|qualification)$/.test(suffix);
 if(intent==='major'||intent==='major_en')return group==='education'&&(intent==='major_en'?suffix==='major.en':/^major(?:\.(?:zh|en))?$/.test(suffix));
 if(intent==='start'||intent==='end')return ['education','internship','employment','projects'].includes(group)&&suffix===intent;
 if(intent==='company')return ['internship','employment'].includes(group)&&/^(?:company(?:\.(?:name(?:\.(?:zh|en))?|zh|en))?|employer(?:\.name)?|organization(?:\.name)?)$/.test(suffix);
 if(intent==='projectName')return group==='projects'&&suffix==='name';
 if(intent==='role')return ['internship','employment','projects'].includes(group)&&/^(?:title|role|position)$/.test(suffix);
 if(intent==='description')return group==='projects'&&/^(?:description|summary)$/.test(suffix);
 if(intent==='responsibilities')return ['internship','employment','projects'].includes(group)&&suffix==='responsibilities';
 if(intent==='awardName')return group==='awards'&&suffix==='name';
 if(intent==='awardDate')return group==='awards'&&/^(?:date|year)$/.test(suffix);
 if(intent==='languageName')return group==='languages'&&suffix==='name';
 if(intent==='languageAbility')return group==='languages'&&suffix==='proficiency';
 if(intent==='listeningSpeaking')return group==='languages'&&/^(?:proficiency|listeningSpeaking|listening|speaking)$/.test(suffix);
 if(intent==='readingWriting')return group==='languages'&&/^(?:proficiency|readingWriting|reading|writing)$/.test(suffix);
 return false;
}
function precisionHint(control,fact,key,registry){
 const sourcePrecision=fact.precision||registry?.precision||(/\.year$/.test(key)?'year':null),controlPrecision=control.precision||({date:'day',month:'month',year:'year'})[control.type]||null;
 if(!sourcePrecision&&!controlPrecision)return {};
 const order={year:1,month:2,day:3};
 const precisionCompatibility=!sourcePrecision||!controlPrecision?'not_verified':sourcePrecision===controlPrecision?'exact':order[sourcePrecision]>=order[controlPrecision]?'projection_requires_review':'insufficient_source_precision';
 return {sourcePrecision,controlPrecision,precisionCompatibility};
}
export function suggestSemanticMappings(control,profile){
 const context=contextFor(control),wanted=intents(control.label),candidates=[];
 for(const [factKey,fact]of Object.entries(profile.facts||{})){
  if(factKey.startsWith('unmapped.')||profile.fieldRegistry?.[factKey]?.neverStoreValue)continue;
  const parsed=familyOf(factKey);if(!parsed)continue;
  if(context.families.length&&!context.families.includes(familyGroup(parsed.family)))continue;
  const matched=wanted.filter(intent=>semanticMatch(parsed,intent));if(!matched.length)continue;
  candidates.push({factKey,status:fact.status||'missing',family:parsed.family,recordId:parsed.recordId,matchKind:'semantic_key',semanticIntents:matched,contextMatch:context.families.length?'matched':'unspecified',...precisionHint(control,fact,factKey,profile.fieldRegistry?.[factKey])});
 }
 return {context,candidates};
}
export function enrichRegistryCandidate(control,profile,factKey){
 const parsed=familyOf(factKey),fact=profile.facts[factKey],context=contextFor(control);
 return {factKey,status:fact.status||'missing',matchKind:'registry_label_exact',...(parsed?{family:parsed.family,recordId:parsed.recordId}:{}),contextMatch:parsed&&context.families.length?context.families.includes(familyGroup(parsed.family))?'matched':'conflict':'unspecified',...precisionHint(control,fact,factKey,profile.fieldRegistry?.[factKey])};
}
export function rankMappingSuggestions(candidates){
 const known=candidate=>candidate.status==='known'?1:0,context=candidate=>candidate.contextMatch==='matched'?2:candidate.contextMatch==='conflict'?-1:0;
 return [...candidates].sort((a,b)=>Number(a.contextMatch==='conflict')-Number(b.contextMatch==='conflict')||known(b)-known(a)||context(b)-context(a)||Number(b.matchKind==='registry_label_exact')-Number(a.matchKind==='registry_label_exact'));
}
