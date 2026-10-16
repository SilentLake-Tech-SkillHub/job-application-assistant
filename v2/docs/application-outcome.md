# MCP 固定事件收尾

application_closeout 是唯一收尾接口：接收事件，持久化结果，内部同步 Excel、刷新完整及已登记批次 JSON，读回后返回 closed。Skill 只声明状态规则，不承担收尾编排。网站提交不是本接口的功能。

| event | applicationStatus | 独立 receiptStatus |
|---|---|---|
| submission_confirmed | 已提交 | receipt_verified |
| submission_uncertain | 待投递 | not_verified |
| application_blocked | 待投递 | not_verified |
| user_skipped | 待投递 | not_verified |

输入仅允许 rolesFile、expectedHash 和 outcome。outcome 严格包含 schemaVersion=1、UUID eventId、event、batchId、companyId、roleId、roleUrl、roleTitle、evidence={file,sha256}。模型不能传目标标签或任意JSON patch。证据文件严格包含 schemaVersion=1、同一事件及岗位身份、observedAt、sourceUrl、result、reviewer、artifacts=[{file,sha256}]。submission_confirmed 要求 result=official_receipt_confirmed，sourceUrl 为岗位官网同源。执行者必须先确认真实官网回执或应聘记录；文件Hash不证明事实。

原生公司方案 schemaVersion=1 保存业务状态、独立结果信息及 applicationOutcomeEvents。固定规则阻止已提交降级；结果不确定、受阻、跳过仍为待投递，但独立结果阻止下一轮直接准备。旧 not_submitted/submitted 按固定映射规范化；误写 receipt_verified 仅在附带回执证据的确认事件下修复。

RECRUITING_TRACKER_CONFIG 指定私有同步配置（未显式配置时读取个人JSON同目录的 tracker-config.private.json）：workbook、upstreamScripts、roles 映射。每个 companyId:roleId 映射配置精确的 roleUrl/title、sheet/company/workbookUrl；不得凭标题模糊匹配。原官网详情和申请链接不同，由已核实的私有映射衔接。缺行默认拒绝；仅显式配置 createFields 时允许按公司归组补录，含公式时禁止中间插行。复用现有 workbook_store.refresh 刷新全量和已登记批次视图。RECRUITING_PYTHON 指定含 openpyxl 的Python运行时，依赖及上游固定脚本由部署配置提供。

JSON 结果先入账，Excel 同步后导出派生 JSON。同步失败返回 sync_failed，结果事件不会丢失；同一 eventId 重试仅恢复文件同步，无网站操作。事件ID冲突、输入Hash变化、证据Hash变化、岗位身份不匹配、未知字段、非法标签拒绝。备份、原子文件替换、应用锁及写前Hash保护协作进程。Excel与多个JSON不是跨文件原子事务；中断恢复靠持久事件重放，未同步不得报告closed。外部非协作写者不遵守锁时仍存在竞态，必须停止并核对冲突。

Excel业务主账与全量JSON保持原契约；本次传入的原生公司方案作为MCP执行视图同步其状态，并保留证据。旧交接schema由上游固定导出器维护，不将本接口冒称为任意JSON结构转换器。已关闭事件再次调用会重新核对/同步当前账本，业务记录不重复。
