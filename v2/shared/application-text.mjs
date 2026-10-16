// Employer-facing values must not contain source-audit notes or model caveats.
// This catches known editorial leakage; factual/semantic review still requires the source document.
const editorial=/(?:简历|档案|材料)(?:注明|记载|显示|提到|未提供|未注明)|(?:据|根据)(?:简历|用户提供|现有资料)|待用户确认|待核实|未经核实|未获确认|不作推断|不能推断|避免编造|此处仅作|暂无证据|需进一步确认/;
export function applicationTextIssues(values){return Object.entries(values||{}).filter(([,v])=>typeof v==='string'&&editorial.test(v)).map(([source])=>({source,reason:'INTERNAL_REVIEW_NOTE_IN_APPLICATION_TEXT'}));}
export function assertApplicationText(values){if(applicationTextIssues(values).length)throw Error('INTERNAL_REVIEW_NOTE_IN_APPLICATION_TEXT');}
