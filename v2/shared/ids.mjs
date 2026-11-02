// 私有存储键与目录项编号：原有小写规则，另允许键里出现固定编码 C00001 / S0001 / J000001（大写、定长）。
const CODE_TOKEN=/(?<![A-Za-z0-9])(?:C\d{5}|S\d{4}|J\d{6})(?![A-Za-z0-9])/g;
export const keyOK=(value,max=79)=>typeof value==='string'&&new RegExp('^[a-z0-9][a-z0-9_-]{0,'+max+'}$').test(value.replace(CODE_TOKEN,m=>m.toLowerCase()));
