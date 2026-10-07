---
name: application-parallel-execution
description: Coordinate user-approved parallel application preparation and role-version-approved submissions across independent recruiting account scopes. Use after an application batch chooses multiple AI; preserve exclusive ownership, approval evidence, receipts and serial tracker merging.
metadata:
  version: "1.1.0"
---

# 多 Agent 平行准备与投递

Load the [application parent](../../SKILL.md) and its login, content, browser and tracker references for the action being performed. This subskill defines coordination; it does not replace those controls or grant submission authority. Private account aliases, materials and assignments stay in workspace records.

## Query and dispatch

Before a new preparation/application batch enters forms, ask: `本轮申请准备和投递由一个 AI 执行，还是由多个 AI 平行执行？` Combine this with other missing Query choices. The search batch's multi-AI choice does not answer this question. Reuse the explicit application choice in the same batch; an already stated multi-AI request needs only missing coordination decisions. Until answered, do not dispatch or start mode-dependent form actions; continue independent offline preparation.

Single AI returns to the parent. Multiple AI requires participants or count, coordinator, actual platform/resource limits, and platform subagents or user-managed handoff packages. Do not fix the participant count or silently create chats. The confirmed choice authorizes agreed delegation for application preparation; final submission remains tied to the exact role and reviewed version. Task files do not prove agents started or work completed.

Read [the private coordination contract](references/coordination-contract.md), reconcile official history, current batch and materials, then assign exclusive company/recruiting-entity/account scopes. Run `python3 scripts/validate_assignments.py <private-manifest.json>` relative to this subskill before dispatch and after ownership or review changes. This validates a snapshot; it neither locks live agents nor confirms official receipts.

## User requirements and allocation proposal

Before proposing a split, proactively ask `对 AI 人数、分工方式、优先级、时间或任务数量，你有明确要求吗？` Reuse explicit answers already recorded for this batch. When there is no definite requirement, invite the user's own ideas: `你希望怎样推进？可以说说最看重的方向、覆盖面、速度，或你愿意投入的时间；暂时没有具体想法也可以告诉我，我会给你建议。` Do not make the user supply a finished allocation or a numeric answer. A user explicitly asking for recommendations may receive a reasoned proposal without another redundant question; silence does not confirm it. Continue independent evidence reconciliation while awaiting missing answers.

Derive the proposal from the latest confirmed Query, the user's ideas, existing progress, uncovered independent scopes, priority/deadline, estimated effort and uncertainty, browser/account dependencies, available participants and actual tool capacity. Choose grouping dimensions that fit this batch; employer size, industry and historical task packages are possible evidence, never universal buckets. Search groups canonical source/plan coverage; application groups recruiting entities and shared account/history/official-quota dependencies. Keep dependent work together, balance estimated effort rather than company counts alone, and disclose estimates that have not been measured.

If the user supplies a participant count or grouping requirement, honor it within actual execution constraints and explain any conflict. Otherwise recommend a justified count and allocation; do not demand that the user choose a number first or reuse a previous batch's count. Distinguish total participants, active workers, coordinator work and simultaneous platform capacity. More participants than current capacity can work in successive waves or through user-managed handoff, if supported and confirmed. A tool's measured capacity is an execution constraint, not a universal Skill limit; never claim unavailable agents exist or bypass tool controls.

Present a readable proposal with the Query/evidence references, proposed participants and coordinator, each owner's scope and outputs, grouping/count rationale, estimated workload, time/resource constraints, quantity/stop conditions and known gaps. Ask the user to confirm or adjust it before dispatch. An execution-mode choice alone does not approve an inferred allocation. Record the confirmed proposal and evidence in private batch records, then produce the versioned manifest. Reuse the unchanged confirmed allocation on continuation; material scope, ownership or count changes require a revised proposal and the handoff controls below.

Business targets are batch choices. Ask whether the user wants a numerical target, coverage of a confirmed list, a time window, or another explicit stopping rule. Do not impose a fixed number of companies, roles or applications, force equal-size groups, or silently fill missing numbers from earlier batches. A numeric target is a goal unless the user explicitly makes it a ceiling or stopping condition. Changing a confirmed goal needs an effective-time record and user agreement; absence of a numeric target does not expand the confirmed scope. Official application/account limits and exact-role submission approval remain binding.

## Preference-version and per-role handoff

Load [the preference contract](../../references/preference-contract.md) before allocation and merge. Assignments, roles and deltas carry the current preference_version; reject stale versions without rewriting them. Reuse recorded JDs and only user-selected recheck gaps. Every role returns company/title/direct URL/BU or 未披露/cities/employment/direction/JD decision evidence and separate actual fill/save/submit states plus its pre-form report reference. No worker resolves cross-axis conflicts, replaces an explicit selection or loses a submitted receipt. Conditional internships need sufficient formal coverage and no suitable formal role. Existing account exclusivity, serial tracker writing and final target/form-version review remain mandatory.

## Owner and approval boundaries

- One company, employing/recruiting entity and shared ATS/account/quota scope has one active owner. Different roles or preferences sharing that history or limit stay with that owner. When independence cannot be established, stop the conflicting scope and let the coordinator merge its allocation. Different confirmed independent companies may proceed in parallel.
- Each owner works within its versioned assignment and output directory, using company-specific windows. Only the coordinator updates the master workbook and shared ledgers, serially from the latest copy with backup, identity deduplication and saved readback. A prepared-form count is distinct from a verified-submission count.
- Produce a readable, versioned form review with material identity, control selections, consequential answers, quota impact and sanitized screenshot. The user can approve a batch of **named roles and review versions**. Preserve exact approval references; a user or coordinator forwarding a task cannot enlarge that scope. An unchanged valid approval survives handoff and does not require asking again. Every final submission click additionally requires the parent's pre-submission target confirmation gate (Issue #8): 公司、BU/业务集团、办公地、岗位 and 意向部门/志愿槽位 restated and explicitly confirmed by the user — general instructions never satisfy it, no automation mode waives it, and intention slots are user-choice fields the Agent proposes but never selects.
- Immediately before submission, reread role, current form/material version, account quota and shared-plan/preference rules. A material answer/upload/role change needs a new review. Apply the actual tool's action-time requirements where present. A selected multi-AI mode is never final-submit approval.
- After the authorized click, verify an official success receipt and history where available. `submit_clicked` and `uncertain` remain unresolved; investigate status before retry. Do not interpret a loading page, modal or tracker cell as success.

## Recovery and merge

For handoff, the old owner saves the latest user edits, pending page, draft/save uncertainty, selected roles, materials/review Hashes, approval evidence, account-limit facts, attempted actions and precise next step. Keep unsaved pages available rather than refreshing to test preservation.

The coordinator confirms old-owner stop, records the new owner and a new assignment version; the new owner acknowledges it before acting. If stop cannot be verified, do not operate that account or spend its quota. Reconcile saved form/history before resuming, particularly after an uncertain submission. Retain genuinely independent work when one site or tool is blocked; never bypass security controls.

An owner sends receipt-backed deltas, never an old full-workbook replacement. The coordinator checks the latest source Hash and ID, accepts only current assignment/review lineage, writes serially and reads back company, role, JD and status. Hash changes force rebase on the current workbook. Keep unmerged receipts durable and prevent retries while merge is pending.

Report assigned/checked/eligible companies, prepared forms, reviewed and approved versions, verified receipts, uncertain attempts, tracker-readback successes, blocked scopes and remaining quota separately. Do not claim a role submitted or a quota completed based on files, clicks or agent agreement.
