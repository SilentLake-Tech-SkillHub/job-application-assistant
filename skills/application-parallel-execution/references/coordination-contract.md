# Private application coordination record

Use the [parent batch record](../../../references/daily-batch.md) for scope, quota and role stages. This companion manifest accepts:

| Field | Meaning |
|---|---|
| workflow | `application` |
| batch_id / query_version | Confirmed private batch and scope version |
| mode / mode_approval_ref | `single` or `parallel`, with this application's user-choice evidence |
| execution_channel | `platform` or `manual_handoff` |
| participants / coordinator | Distinct participant ID strings, including the coordinator |
| output_roots | Non-overlapping relative output directories by participant |
| source_hash / assignment_version | Current SHA256 source snapshot and positive allocation version |
| assignments / roles | Exclusive account allocations and optional role-stage snapshot |

Each assignment has `assignment_id`, `company_key`, `recruiting_entity`, `operation_scope` (canonical ATS/account/quota alias, never credentials or raw personal identifiers), `owner` and `output_dir` inside that owner's root. Aliases sharing history or quota use one assignment. Optional `handoff` requires `from_owner`, `to_owner`, `stopped_ref`, `accepted_ref`; new owner matches `owner`, both identities are participants and acknowledgement evidence refers to the current allocation version. A manifest is not a lock; verify old-owner stopping before a new owner operates.

An optional role snapshot has `role_key`, `assignment_id`, `owner`, `direct_url`, `stage`, `material_id`, `review_hash`, `approved_review_hash`, `approval_ref` and `receipt_ref` as applicable. Use the parent stage vocabulary. Prepared or later forms require material identity; reviewed/clicked/submitted forms require the current review Hash. Clicked/submitted forms require approval evidence for that exact Hash. Submitted requires official receipt evidence; uncertain cannot be marked as submitted in the tracker. Before resuming an uncertain record, inspect actual application history regardless of a validator result. References must identify protected evidence; the validator cannot authenticate them.

Use sanitized reference IDs instead of contact details, form personal answers, credential/OTP/cookie or identity-document contents. The companion manifest does not replace the parent's quota ledger or browser checks. A received delta carries the same `batch_id`, `query_version`, `assignment_version`, owner and assignment ID; its role/review/material/approval lineage must match current records. Reject stale deltas pending reconciliation; never rewrite their version to bypass it. Tracker completion requires serial coordinator merge and saved readback, not merely receipt of a delta.

## Allocation decision evidence

Keep a private readable proposal alongside the manifest: the user's explicit requirements or ideas, Query/progress references, chosen grouping and count rationale, estimated workload and uncertainty, participant/worker/coordinator counts, actual concurrent capacity, wave/handoff arrangement where needed, configurable numeric or nonnumeric targets and stopping conditions, and user confirmation reference. These decision records precede dispatch. The snapshot validator does not judge allocation quality, confirm a proposal, optimize participant counts or enforce platform capacity. Reuse an unchanged confirmed proposal; version material changes and preserve their effective time and approval.

## 独立偏好与执行证据

manifest 顶层 preferences、prior_roles；assignment/role/delta 必填 preference_version，与当前确认版本相同。assignment 携带公司正式覆盖字段；roles 携带 [完整逐岗字段](../../../references/preference-contract.md)、前置报告和实际 execution。偏好更新拒收旧增量，复用 JD/指定复查范围；不合成偏好分或替换明确选岗，保留已投和回执；账号独占、协调者串行写、精确目标与表单版本审核照常。

每批先向用户要默认岗位次序，保存同批确认，不沿用上一批。每家公司开始申请操作前，先用同一逐岗包展示公司/岗位/BU或未披露/办公地，确认相对默认次序有无变化；company_order_confirmation_ref 和 pre_form_report_ref 对应同一包。交接复用这份记录，最终具体目标和当前表单版本继续审核，不另建三套脱节清单。
