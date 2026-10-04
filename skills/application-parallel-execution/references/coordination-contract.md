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
