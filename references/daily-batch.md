# Daily batch and recovery record

Use this reference for Query, daily counts and a resumed run. The workspace owns the private batch file; this document defines portable fields, not values. A batch should have a stable ID and a dated, user-confirmed Query snapshot. Record later changes with effective time and the earlier choice they replace.

## Query fields

- Scope: region, cohort, formal job or internship, target functions, exclusions and cities.
- Company pool: authoritative source, distinct company key, subsidiary/group relationship, bucket assignment rule and priority. Buckets must be mutually exclusive for counting, even if a firm has several attributes.
- Numeric quotas by bucket, whether the goal counts companies checked or companies with eligible roles, and whether role-free or blocked companies are replaced.
- Time window, order, account-limit constraints, current résumé and portfolio evidence, and authority to choose roles and prepare forms. Final submission remains a separate approval of exact review versions.

Do not guess missing classification, quota, materials or counting semantics. Ask only the decisions that affect the next action; continue work on independent confirmed buckets. A stated quota is a target, not proof it was met.

## Ledger fields

Keep a private, durable record with `batch_id`, Query version/time, company key, bucket, site/plan URLs, coverage state and evidence; each role has a stable role key, direct URL, title, JD evidence, application stage, draft URL, material identity, review version/hash, submission approval, receipt reference/time, tracker readback and next action. Never store the filled form's full personal answers, credentials, OTP, cookie or identity document. Link to a protected form or sanitized review package instead.

Suggested company states: `unvisited`, `checking`, `checked`, `blocked`; suggested role stages: `discovered`, `verified`, `preparing`, `prepared`, `reviewed`, `submit_clicked`, `submitted`, `uncertain`. These are ledger states, not new workbook statuses. A `submit_clicked` or `uncertain` role must be investigated through the application center before retrying.

Count distinct company keys per bucket for checked companies, distinct verified official role links for eligible roles, completed forms for prepared applications, and official receipts for submissions. Report the denominator and remaining target for every bucket. A group/subsidiary counts separately only when the confirmed Query and actual employing/recruiting identity support it. Run `scripts/validate_batch.py <batch.json>` when using the JSON ledger format; set `scope_confirmed`, `bucket_rules_confirmed`, `materials_confirmed` and `preparation_authorized` only after the corresponding Query decisions. The validator checks duplicates, bucket membership, required approval references and receipt invariants.
