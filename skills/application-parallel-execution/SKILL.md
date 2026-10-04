---
name: application-parallel-execution
description: Coordinate user-approved parallel application preparation and role-version-approved submissions across independent recruiting account scopes. Use after an application batch chooses multiple AI; preserve exclusive ownership, approval evidence, receipts and serial tracker merging.
metadata:
  version: "1.0.0"
---

# 多 Agent 平行准备与投递

Load the [application parent](../../SKILL.md) and its login, content, browser and tracker references for the action being performed. This subskill defines coordination; it does not replace those controls or grant submission authority. Private account aliases, materials and assignments stay in workspace records.

## Query and dispatch

Before a new preparation/application batch enters forms, ask: `本轮申请准备和投递由一个 AI 执行，还是由多个 AI 平行执行？` Combine this with other missing Query choices. The search batch's multi-AI choice does not answer this question. Reuse the explicit application choice in the same batch; an already stated multi-AI request needs only missing coordination decisions. Until answered, do not dispatch or start mode-dependent form actions; continue independent offline preparation.

Single AI returns to the parent. Multiple AI requires participants or count, coordinator, actual platform/resource limits, and platform subagents or user-managed handoff packages. Do not fix the participant count or silently create chats. The confirmed choice authorizes agreed delegation for application preparation; final submission remains tied to the exact role and reviewed version. Task files do not prove agents started or work completed.

Read [the private coordination contract](references/coordination-contract.md), reconcile official history, current batch and materials, then assign exclusive company/recruiting-entity/account scopes. Run `python3 scripts/validate_assignments.py <private-manifest.json>` relative to this subskill before dispatch and after ownership or review changes. This validates a snapshot; it neither locks live agents nor confirms official receipts.

## Owner and approval boundaries

- One company, employing/recruiting entity and shared ATS/account/quota scope has one active owner. Different roles or preferences sharing that history or limit stay with that owner. When independence cannot be established, stop the conflicting scope and let the coordinator merge its allocation. Different confirmed independent companies may proceed in parallel.
- Each owner works within its versioned assignment and output directory, using company-specific windows. Only the coordinator updates the master workbook and shared ledgers, serially from the latest copy with backup, identity deduplication and saved readback. A prepared-form count is distinct from a verified-submission count.
- Produce a readable, versioned form review with material identity, control selections, consequential answers, quota impact and sanitized screenshot. The user can approve a batch of **named roles and review versions**. Preserve exact approval references; a user or coordinator forwarding a task cannot enlarge that scope. An unchanged valid approval survives handoff and does not require asking again.
- Immediately before submission, reread role, current form/material version, account quota and shared-plan/preference rules. A material answer/upload/role change needs a new review. Apply the actual tool's action-time requirements where present. A selected multi-AI mode is never final-submit approval.
- After the authorized click, verify an official success receipt and history where available. `submit_clicked` and `uncertain` remain unresolved; investigate status before retry. Do not interpret a loading page, modal or tracker cell as success.

## Recovery and merge

For handoff, the old owner saves the latest user edits, pending page, draft/save uncertainty, selected roles, materials/review Hashes, approval evidence, account-limit facts, attempted actions and precise next step. Keep unsaved pages available rather than refreshing to test preservation.

The coordinator confirms old-owner stop, records the new owner and a new assignment version; the new owner acknowledges it before acting. If stop cannot be verified, do not operate that account or spend its quota. Reconcile saved form/history before resuming, particularly after an uncertain submission. Retain genuinely independent work when one site or tool is blocked; never bypass security controls.

An owner sends receipt-backed deltas, never an old full-workbook replacement. The coordinator checks the latest source Hash and ID, accepts only current assignment/review lineage, writes serially and reads back company, role, JD and status. Hash changes force rebase on the current workbook. Keep unmerged receipts durable and prevent retries while merge is pending.

Report assigned/checked/eligible companies, prepared forms, reviewed and approved versions, verified receipts, uncertain attempts, tracker-readback successes, blocked scopes and remaining quota separately. Do not claim a role submitted or a quota completed based on files, clicks or agent agreement.
