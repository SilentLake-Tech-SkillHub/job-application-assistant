# MCP 固定事件收尾（反向回传）

`application_closeout({outcome})` 校验官网证据后，把**本岗位的最新结果**覆盖写入工作区 `岗位交接/投递回传.json`（每个岗位一条，键为 `companyId|岗位ID`）。不保留事件历史，不另存备份；回滚靠 git。它不改主表状态、不提交网站、不同步 Excel。

记录 `submission_confirmed` 前，MCP 还核对：本岗位在本批队列里由 MCP 按该公司**已封存**的表单模板填写，并有通过的独立核验记录（`role_prepare` / `role_verify` 的 `verify_current` 结果，模板 Hash 与核验时一致）。手工在浏览器里填写提交的岗位没有这条记录，拒绝记录，返回 `SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL`；模板未封存或核验后被改动分别返回 `SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED`、`SUBMISSION_TEMPLATE_CHANGED_AFTER_VERIFY`。先按建库路线补齐表单，再用 `role_verify` 核验后收尾。

| event | 证据 result 要求 | 反向评审时建议的主表状态 |
|---|---|---|
| submission_confirmed | official_receipt_confirmed | 岗位待投递 → 岗位已投递 |
| role_closed | official_role_closed | 岗位待投递 → 岗位失效/关闭 |
| submission_uncertain | 任意 | 不改状态；用户处理前禁止重跑该岗位 |
| application_blocked | 任意 | 不改状态；用户处理前禁止重跑该岗位 |
| user_skipped | 任意 | 不改状态 |

前提：`投递批次.json` 状态为已交接/进行中/等待反向评审（仅同一已确认批次继续回传，不允许新组批），且用户确认摘要与内容一致；事件绑定的批次、岗位 ID、标题、链接必须与批次中的唯一岗位一致。证据须同一身份、官网同源 https sourceUrl、观察时间不晚于当前、所有 artifacts Hash 一致。已确认投递的岗位不能被降级；同一 eventId 内容不同即拒绝；同一事件重放返回 already_recorded。

主表状态只由搜索端写：`company_store.py reverse` 读取回传、生成反向评审页并逐行给出“当前状态是X，更新状态是Y”；用户确认后 `reverse-confirm` 才写主表，已处理的回传随即清除。重新导入批次时，已回传但未处理的岗位受保护（已投递/已关闭跳过，不确定/受阻在用户处理前不重跑）。
