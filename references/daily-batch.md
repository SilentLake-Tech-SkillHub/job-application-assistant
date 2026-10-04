# Daily batch and recovery record

Use this reference for Query, daily counts and a resumed run. The workspace owns the private batch file; this document defines portable fields, not values. A batch should have a stable ID and a dated, user-confirmed Query snapshot. Record later changes with effective time and the earlier choice they replace.

## Query fields

- Scope: region, cohort, formal job or internship, target functions, exclusions and cities.
- Company pool: authoritative source, distinct company key, subsidiary/group relationship, bucket assignment rule and priority. Buckets must be mutually exclusive for counting, even if a firm has several attributes.
- Optional numeric targets by batch-specific counting bucket, or an explicit nonnumeric stop condition (confirmed-list coverage, a time window, or another user choice). Define whether counts concern checked companies or companies with eligible roles, and whether role-free/blocked companies are replaced. Do not inherit target values or bucket names from another user or batch; a single `all` bucket may represent a confirmed unsegmented scope.
- Time window, order, account-limit constraints, current résumé and portfolio evidence, and authority to choose roles and prepare forms. Final submission remains a separate approval of exact review versions.

Do not guess missing classification, quantity choices, materials or counting semantics. Ask only the decisions that affect the next action; continue work on independent confirmed buckets. A stated numeric target is a goal, not a universal cap or proof it was met. Respect a user-defined ceiling/stop condition and official account limits separately. With no fixed numeric target, record the user choice and a concrete stop condition instead of inventing a number.

## Execution choices

Before new form actions, ask `本轮申请准备和投递由一个 AI 执行，还是由多个 AI 平行执行？` unless this application's batch already has an explicit choice. Record `application_execution_mode` (`single` or `parallel`) and `mode_approval_ref`; a search mode is not application permission. Missing mode keeps dependent actions pending. Reuse valid same-batch choices and approval references rather than repeatedly requesting them.

For parallel work, record participant IDs/count, coordinator, resource limit, `execution_channel` (`platform` or `manual_handoff`), allocation version and a reference to the private coordination manifest. Load [the parallel subskill](../skills/application-parallel-execution/SKILL.md). Each delta identifies its batch/Query/allocation version and owner; one company/recruiting entity/shared-account scope has one owner. The coordinator writes the tracker serially from its latest version. A subskill allocation check supplements `validate_batch.py`; neither proves a real site saved or submitted anything.

Record the user's requirements/ideas and confirmed allocation proposal, including count/grouping rationale, workload estimates, coordinator duties and any capacity-based execution waves. The execution-mode answer alone does not confirm the proposal.

For JSON validation, `batch.quotas` is the legacy field name for a nonempty map of private counting buckets to nonnegative integer targets or `null`. An integer retains its existing counting semantics; `null` means no numeric target for that bucket. A `null` bucket requires nonempty `batch.target_choice_ref` and `batch.stop_condition`, referring to the user's confirmed choice and actual stopping rule. Unknown or unanswered quantities must not be encoded as `null`; they remain pending Query. `remaining_quota` reports `null` for such buckets, never zero or a fabricated remaining count. The validator cannot verify the stop condition, confirmation or official account limits against reality.

## Ledger fields

Keep a private, durable record with `batch_id`, Query version/time, company key, bucket, site/plan URLs, coverage state and evidence; each role has a stable role key, direct URL, title, JD evidence, application stage, draft URL, material identity, review version/hash, submission approval, receipt reference/time, tracker readback and next action. Never store the filled form's full personal answers, credentials, OTP, cookie or identity document. Link to a protected form or sanitized review package instead.

Suggested company states: `unvisited`, `checking`, `checked`, `blocked`; suggested role stages: `discovered`, `verified`, `preparing`, `prepared`, `reviewed`, `submit_clicked`, `submitted`, `uncertain`. These are ledger states, not new workbook statuses. A `submit_clicked` or `uncertain` role must be investigated through the application center before retrying.

Count distinct company keys per bucket for checked companies, distinct verified official role links for eligible roles, completed forms for prepared applications, and official receipts for submissions. Report the configured denominator and remaining target for numeric buckets; for nonnumeric buckets report scope/time progress and unresolved work against the confirmed stopping rule. A group/subsidiary counts separately only when the confirmed Query and actual employing/recruiting identity support it. Run `scripts/validate_batch.py <batch.json>` when using the JSON ledger format; set `scope_confirmed`, `bucket_rules_confirmed`, `materials_confirmed` and `preparation_authorized` only after the corresponding Query decisions. The validator checks duplicates, bucket membership, required approval references and receipt invariants.
