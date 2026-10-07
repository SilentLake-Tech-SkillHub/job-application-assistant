# Role tracker contract

Read for workbook discovery, writes and status reconciliation. Locate the current workbook and regional sheet through the workspace router and private profile. Do not embed a user's path, filename, columns or personal data in this public Skill. Inspect the actual header and validation before editing.

- The company official recruiting entry and its current plan are separate from a role's **direct official detail URL**. Verify and read back both levels; a list URL or guessed job URL is not a verified role link.
- Record one row per verified in-scope role, title, explicit location, full visible JD, employing unit if shown, plan and direct URL. Keep source wording faithful and document inaccessible portions instead of filling them from a snippet. A company with no verified role retains its existing placeholder semantics.
- Deduplicate by direct URL or job ID, then compare employer, title, unit and location when URLs change. Search current site history as well as workbook status before opening a new application.
- A recorded, unsubmitted role stays in the tracker's existing pending value. Fine-grained stages such as `prepared` and `uncertain` belong in the private run ledger. Set the tracker's submitted value only after an official success receipt; a button click, draft, modal or user statement alone cannot establish it.
- Reread the live workbook immediately before writing; record its SHA-256 and make a recoverable backup for a structural edit. Apply the smallest update, preserve other sheets, formulas, validation and user edits, save, reopen and verify the company entry, role URL, JD, status and formula errors. If the file changed during editing, reconcile or stop before overwriting it. Never treat remembered row numbers as stable.

When site evidence conflicts with the tracker, leave the application stage unresolved until the site account/history is checked. Report the discrepancy and its exact affected roles; do not mass-change statuses or resubmit.

## 独立偏好与执行证据

执行 [偏好证据契约](preference-contract.md)：硬范围之外的城市排序只分组；不更改现有 Excel 列/验证/枚举。用招聘主体内官方 ID 或规范直链识别岗位，同名不同 BU/城市/ID 不合并，多城市同一岗位不重复计数。BU 未披露写 未披露。就业/方向/筛选理由/偏好版本/逐岗证据保存在已有备注或私有流水；保留已投回执和明确选择，更新偏好不撤回申请。能力分不包含城市偏好，Top5 只展示。

每批先向用户要默认岗位次序，保存同批确认，不沿用上一批。每家公司开始申请操作前，先用同一逐岗包展示公司/岗位/BU或未披露/办公地，确认相对默认次序有无变化；company_order_confirmation_ref 和 pre_form_report_ref 对应同一包。交接复用这份记录，最终具体目标和当前表单版本继续审核，不另建三套脱节清单。
