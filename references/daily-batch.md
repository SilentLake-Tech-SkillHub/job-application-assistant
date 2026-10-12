# Daily batch and recovery record

Use this reference for Query, daily counts and a resumed run. The workspace owns the private batch file; this document defines portable fields, not values. A batch should have a stable ID and a dated, user-confirmed Query snapshot. Record later changes with effective time and the earlier choice they replace.

## Query fields

- Scope: region, cohort, formal job or internship, target functions, exclusions and cities.
- Company pool: authoritative source, distinct company key, subsidiary/group relationship, bucket assignment rule and priority. Buckets must be mutually exclusive for counting, even if a firm has several attributes.
- Optional numeric targets by batch-specific counting bucket, or an explicit nonnumeric stop condition (confirmed-list coverage, a time window, or another user choice). Define whether counts concern checked companies or companies with eligible roles, and whether role-free/blocked companies are replaced (`replace`) or left as kept gaps (`keep_gap`), as defined in [stage contract §9](stage-contract.md#9-计数补位规则). Do not inherit target values or bucket names from another user or batch; a single `all` bucket may represent a confirmed unsegmented scope.
- Time window, order, account-limit constraints, current résumé and portfolio evidence, and authority to choose roles and prepare forms. Final submission remains a separate approval of exact review versions.

Do not guess missing classification, quantity choices, materials or counting semantics. Ask all “开始前必问” items in one Query and leave the “到步骤前再问” items to their step, exactly as listed in [stage contract §3](stage-contract.md#3-query开始前必问-vs-到步骤前再问); continue work on independent confirmed buckets. A stated numeric target is a goal, not a universal cap or proof it was met. Respect a user-defined ceiling/stop condition and official account limits separately. With no fixed numeric target, record the user choice and a concrete stop condition instead of inventing a number.

## Execution choices

Before new form actions, ask `本轮申请准备和投递由一个 AI 执行，还是由多个 AI 平行执行？` unless this application's batch already has an explicit choice. Record `application_execution_mode` (`single` or `parallel`) and `mode_approval_ref`; a search mode is not application permission. Missing mode keeps dependent actions pending. Reuse valid same-batch choices and approval references rather than repeatedly requesting them.

For parallel work, record participant IDs/count, coordinator, resource limit, `execution_channel` (`platform` or `manual_handoff`), allocation version and a reference to the private coordination manifest. Load [the parallel subskill](../skills/application-parallel-execution/SKILL.md). Each delta identifies its batch/Query/allocation version and owner; one company/recruiting entity/shared-account scope has one owner. The coordinator writes the tracker serially from its latest version. A subskill allocation check supplements `validate_batch.py`; neither proves a real site saved or submitted anything.

Record the user's requirements/ideas and confirmed allocation proposal, including count/grouping rationale, workload estimates, coordinator duties and any capacity-based execution waves. The execution-mode answer alone does not confirm the proposal.

For JSON validation, `batch.quotas` is the legacy field name for a nonempty map of private counting buckets to nonnegative integer targets or `null`. An integer retains its existing counting semantics; `null` means no numeric target for that bucket. A `null` bucket requires nonempty `batch.target_choice_ref` and `batch.stop_condition`, referring to the user's confirmed choice and actual stopping rule. Unknown or unanswered quantities must not be encoded as `null`; they remain pending Query. `remaining_quota` reports `null` for such buckets, never zero or a fabricated remaining count. The validator cannot verify the stop condition, confirmation or official account limits against reality.

## Ledger fields

Keep a private, durable record with `batch_id`, Query version/time, company key, bucket, site/plan URLs, coverage state and evidence; each role has a stable role key, direct URL, title, JD evidence, application stage, draft URL, material identity, review version/hash, submission approval, receipt reference/time, tracker readback and next action. Never store the filled form's full personal answers, credentials, OTP, cookie or identity document. Link to a protected form or sanitized review package instead.

**Prepared and blocked gates (Issue #23).** A role counts as prepared only when `execution.fill` is `complete` with `evidence_ref` and a field-by-field `readback_ref`, and `execution.save` is either `complete` with `evidence_ref` plus a reopened-draft `readback_ref`, or `not_supported` with evidence that the site offers no draft. A `not_supported` form is reviewable but unsaved: keep its page open and report it separately. A submitted role counts through its receipt. A company in `blocked` state carries a `blocked` object with `reason`, `scope` (`role`/`company`/`shared_account`/`batch`), `unblock_owner` (`user`/`site`/`platform`/`official_rule`), `next_action` and `evidence_ref`; a blocked `fill/save/submit` action carries `reason`, `unblock_owner` and `next_action`. The Agent is never an unblock owner: authorized work the Agent can still do is pending, not blocked, and does not end the batch. These checks are structural; they do not prove a referenced screenshot or draft exists.

**Query, gate and evidence fields (v1.13).** Timing and meaning come from the [stage contract](stage-contract.md); the validator checks structure only.

| Where | Field | Rule |
|---|---|---|
| batch | `entry` `{intent, basis, ref}` | `intent` must be `application` ([§1](stage-contract.md#1-入口判定谁来处理这个请求)) |
| batch | `sources[]` `{name, ref, sha256, read_at}` or `{name, status: "missing", handling}` | router/profile/tracker/batch record/résumé as read ([§2](stage-contract.md#2-启动读取与缺失处理)) |
| batch | `materials[]` `{material_id, ref, sha256}` | every role `material_id` must be listed |
| batch | `role_selection_authorized`, `authorization_ref` | scope of the preparation authority ([§4](stage-contract.md#4-授权覆盖范围与必停情形)) |
| batch | `application_execution_mode`, `mode_approval_ref` | `single`/`parallel` |
| batch | `automation` | the [authorization record](automation-authorization.md#记录) |
| batch | `channels`, `browser` | capability preflight; `browser.playwright_substitute` `{approved, ref}`; `browser.computer_use_ref` after the first approval |
| batch | `stop_reached_ref`, `resume_readback`, `gate_runs[]` | closeout and resume ([§7](stage-contract.md#7-状态冲突时以谁为准), [§11](stage-contract.md#11-批次能否结束收尾检查)) |
| company | `browser_lane` | `in_app`/`chrome`/`playwright`; required once any of its roles starts a form; `playwright` needs an approved substitute; `lane_history[]` `{from, to, handoff_ref}` for a lane change |
| company | `count_rule` | `{status: verified|未核实, max_applications (int or null), concurrent, order_rule, change_rule, source, checked_at}`; required before any of its roles starts a form; with `未核实` only one role may reach `submit_clicked` until `first_submit_readback_ref` is recorded |
| role | `eligibility` | `{conclusion: meets|pending|not_meets, ref}`; `pending`/`not_meets` need `user_attempt_ref` before a form starts |
| role | `review_package` | `{materials, consequential_answers, account_limit, unresolved_fields, screenshots}`; required from `reviewed`; `review_hash` = `sha256:` + hash of its canonical JSON |
| role | `presubmit_check_ref`, `target_confirmation` | required from `submit_clicked`; target `{company, bu, location, title, intent_slots[], count_rule_line, review_hash, confirmation_ref}` matching the role and current `review_hash` |
| role | `tracker_readback_ref` | required when `tracker_status` is `submitted` |

`keep_gap` and `replace` change the remaining target as defined in [§9](stage-contract.md#9-计数补位规则). Every reference is a file path relative to the application root (`file:<path>`), with evidence under `投递证据/`; the validator and gates enforce this by default ([strict evidence](stage-contract.md#10a-严格证据模式与-投递证据)), and `--lenient` exists only for migrating old ledgers.

Suggested company states: `unvisited`, `checking`, `checked`, `blocked`; suggested role stages: `discovered`, `verified`, `preparing`, `prepared`, `reviewed`, `submit_clicked`, `submitted`, `uncertain`. These are ledger states, not new workbook statuses. A `submit_clicked` or `uncertain` role must be investigated through the application center before retrying.

Count distinct company keys per bucket for checked companies, distinct verified official role links for eligible roles, completed forms for prepared applications, and official receipts for submissions. Report the configured denominator and remaining target for numeric buckets; for nonnumeric buckets report scope/time progress and unresolved work against the confirmed stopping rule. A group/subsidiary counts separately only when the confirmed Query and actual employing/recruiting identity support it. Run `scripts/validate_batch.py <batch.json>` when using the JSON ledger format; set `scope_confirmed`, `bucket_rules_confirmed`, `materials_confirmed` and `preparation_authorized` only after the corresponding Query decisions. The validator checks duplicates, bucket membership, required approval references and receipt invariants.

## 独立偏好与执行证据

Query 将 hard_scope 和三条独立轴写入 batch.preferences（见 [契约](preference-contract.md) 与 [空模板](preference-template.md)），roles/增量携带 preference_version。公司覆盖字段放 companies，prior_roles 保留已投/回执与明确选择。每岗包含前置报告、BU 未披露标记、完整 JD 判断和独立 fill/save/submit 证据。更新偏好只复用原 JD 和用户指定复查范围，不重开首轮；弱优先/平级不强排、跨轴不加权。缺字段的旧快照需适配人工复核后才能新交付。

默认岗位次序与公司动作前确认的唯一规则见[偏好契约](preference-contract.md#默认次序与公司动作前确认)。
