# MCP 固定事件收尾（反向回传）

用户对具体岗位及当前表单明确授权后，`role_submit` 绑定原队列、账号、页面、模板、核验报告和附件版本，一次执行提交并采集官网回执。响应给出带证据 Hash 的 `outcome`，交 `application_closeout` 校验写回。响应式页面出现同名同类型提交按钮时，按本次捕获的精确节点选择末个，动作前再次比对节点属性；不同提交动作并存则拒绝。点击不是成功；提交尝试先持久化，不确定也不自动再次点击。

`application_closeout({outcome})` 校验官网证据后，把**本岗位的最新结果**覆盖写入工作区 `岗位交接/投递回传.json`（每个岗位一条，键为岗位编码 `J000001`，记下公司编码与站点编码）。不保留事件历史，不另存备份；回滚靠 git。它不改主表状态、不提交网站、不同步 Excel。

记录 `submission_confirmed` 前，MCP 还核对：本岗位在本批队列里由 MCP 按该公司**已封存**的表单模板填写，并有通过的独立核验记录（`role_prepare` / `role_verify` 的 `verify_current` 结果，模板 Hash 与核验时一致）。手工在浏览器里填写提交的岗位没有这条记录，拒绝记录，返回 `SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL`；模板未封存或核验后被改动分别返回 `SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED`、`SUBMISSION_TEMPLATE_CHANGED_AFTER_VERIFY`。先按建库路线补齐表单，再用 `role_verify` 核验后收尾。

| event | 证据 result 要求 | 反向评审时建议的主表状态 |
|---|---|---|
| submission_confirmed | official_receipt_confirmed | 岗位待投递 → 岗位已投递 |
| role_closed | official_role_closed | 岗位待投递 → 岗位失效/关闭 |
| submission_uncertain | 任意 | 不改状态；用户处理前禁止重跑该岗位 |
| application_blocked | 任意 | 不改状态；用户处理前禁止重跑该岗位 |
| user_skipped | 任意 | 不改状态 |

前提：该岗位所在公司文件的「批次」状态为已交接/进行中/等待反向评审（仅同一已确认批次继续回传，不允许新组批），且确认指纹与内容一致；事件里 `companyId` 是站点编码、`roleId` 是岗位编码，批次编号、标题、岗位链接必须与该公司文件中本批选中的唯一岗位一致。证据须同一身份、官网同源 https sourceUrl、观察时间不晚于当前、所有 artifacts Hash 一致。已确认投递的岗位不能被降级；同一 eventId 内容不同即拒绝；同一事件重放返回 already_recorded。

主表状态只由搜索端写：`company_store.py reverse` 读取回传、生成反向评审页并逐行给出“当前状态是X，更新状态是Y”；用户确认后 `reverse-confirm` 才写主表，已处理的回传随即清除。重新导入批次时，已回传但未处理的岗位受保护（已投递/已关闭跳过，不确定/受阻在用户处理前不重跑）。

## 摘要阶段

部分网站在填写页与最终提交之间有“预览并提交”摘要页，部分没有。`role_submit` 在离开填写页前独立重核一次整表（字段、主档来源、附件），网站有摘要页时直接点进去，摘要页不再做任何内容比对，也不打开条款全文；随后点击最终提交。摘要页上尚未勾选的条款框按[持久业务授权](generic-form-pipeline.md#持久业务授权)的单一开关处理：开关为 1 直接勾选并读回；为 0 返回 `needs_user_consent`，用户勾选后再次调用 `role_submit`（已进入摘要的任务不重复整表复核）。点进摘要后若在等待时间内没有看到最终提交按钮，在任何提交尝试前停止并报告。

具体岗位、当前模板的最终提交授权独立核对；提交尝试先落盘再点击真实按钮，只有官网回执才算成功，结果不明不自动重试。

## 链接观察

同一文件的 `observations` 是投递端发现的链接变化，由 `recordObservation` 写入（投递回传仍只有投递组件一个写入方）：`{kind:'role'|'site', code, field, value, evidence, observedAt}`，每个（编码, 字段）只留最新一条。岗位可报 `岗位链接`（只能报打不开，值为空）和 `投递链接`；站点可报 `登录链接`、`账号核对页`（后者不能为空）。新值必须是 https。搜索端 `apply-observations` 预览、用户确认后写主表并清除已处理的观察。
