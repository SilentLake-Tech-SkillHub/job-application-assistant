import {recordApplicationOutcome,outcomeSchema} from './application-outcome.mjs';

// 只写工作区 岗位交接/投递回传.json；不改主表、不同步外部账本、不操作网站。
// assertPrepared：MCP 传入的门禁，“已投递”前核对本岗位按已封存表单模板填写并核验通过（见 form-assets.mjs）。
export async function closeApplication({assertPrepared,...args}) {
 const prepared = assertPrepared ? await assertPrepared(outcomeSchema.parse(args.outcome)) : null;
 const recorded = await recordApplicationOutcome(args);
 if (prepared) recorded.preparedBy = prepared;
 return {...recorded, status: 'closed', websiteAction: 'none'};
}
