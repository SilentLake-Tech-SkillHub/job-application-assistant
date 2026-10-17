# MCP 固定事件收尾

`application_closeout` 校验官网证据并原子更新当前已确认公司方案 JSON。它不提交网站，不转换或同步 Excel，不调用外部同步脚本。

| event | applicationStatus | receiptStatus |
|---|---|---|
| submission_confirmed | 已提交 | receipt_verified |
| submission_uncertain | 待投递 | not_verified |
| application_blocked | 待投递 | not_verified |
| user_skipped | 待投递 | not_verified |

输入只有 `rolesFile`、`expectedHash` 和严格校验的 `outcome`。事件绑定批次、公司、岗位 ID、标题、链接和证据 Hash。证据包含同一身份、官网同源 sourceUrl、观察时间、result、reviewer 及实际 artifacts。确认提交必须有 `official_receipt_confirmed` 证据；Hash 不能代替官网事实核对。

`recordApplicationOutcome` 在独占文件锁内核实输入 Hash、已选身份和所有证据，保存写前恢复文件后原子替换方案。未知标签、输入或证据变化、已提交降级及复用事件 ID 篡改均拒绝。同一事件重放读回当前状态，不重复入账、不操作网页。成功返回 `closed` 仅代表原生 JSON 已入账。结果不确定的岗位继续阻止直接重跑。
