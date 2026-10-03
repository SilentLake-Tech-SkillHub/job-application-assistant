---
name: job-application-assistant
description: Run a user-confirmed campus recruiting batch from official job discovery through application preparation, review, authorized submission, receipt verification, and tracker readback. Use when the user asks to prepare or execute multiple campus applications; do not invoke for information-only company research.
metadata:
  version: "1.1.1"
---

# 岗位代投助手 / Job Application Assistant

This Skill is independent of company-research Skills. Discover the workspace's private profile, current batch record and role tracker from its project router. Keep names, contact details, résumé paths, company lists, quotas, personal eligibility and referral information in private project records, never in this Skill or a public copy. A previous batch is evidence, not current authorization.

## Modes and authority

1. **Query**: confirm the batch's region, cohort, employment type, role families and exclusions, locations, company classification, mutually exclusive buckets, quota and counting rule, replacement rule, time window, current materials, and whether selecting roles and preparing forms is authorized. Record unresolved decisions. Do not start dependent browsing or forms while material scope is unresolved. Read [daily-batch.md](references/daily-batch.md).
2. **Prepare**: the confirmed batch may authorize the Agent to select roles within scope, handle login, fill fields, upload approved materials and save drafts without asking for each role first. Record the official company entry, every relevant plan, title and full visible JD, direct role URL, duplicate check and logged-in account limits. Preserve the role tracker as the fact source. Read [workbook-contract.md](references/workbook-contract.md) before tracker work and [browser-application.md](references/browser-application.md) before interacting with a site. Route login to [application-login](skills/application-login/SKILL.md) and form content to [application-content-fill](skills/application-content-fill/SKILL.md). Preparation does not authorize final submission.
3. **Review**: provide the exact role list and a versioned, readable package of each completed form, materials, consequential answers, current account limit, unresolved fields and screenshots. Keep the forms available. Request approval for the named roles and review versions only.
4. **Submit**: after that approval, recheck the role, plan, quota, materials and form version; submit one application at a time. Confirm a success page and, where available, the application history or receipt. An ambiguous result triggers status investigation before any retry. Update the tracker only after a verified receipt.
5. **Resume/status**: reload the latest private batch record, current tracker and website status. Reconcile uncertain or already submitted roles before acting. Continue independent companies when one role is blocked; never infer a successful submission from a button click, modal, redirect or draft.

If the user asks only to research companies or collect jobs, use the workspace's research workflow instead of this Skill. If they request a specific existing role, skip only Query questions already answered by current evidence; the review and submission boundaries still apply.

## Invariants

- Judge candidates from **title plus complete visible JD** and the confirmed role functions. A matching title alone is insufficient; an unfamiliar title can still qualify when the JD shows product ownership. Record inclusion or exclusion evidence for borderline roles. Do not convert a user's batch interpretation into a universal role definition.
- A company counts in one bucket only. Keep checked companies, eligible roles, prepared applications and verified submissions as separate numbers. A blocked or role-free company follows the confirmed replacement rule; it never counts as a prepared application. Use [daily-batch.md](references/daily-batch.md) for the batch ledger and optional deterministic validation.
- Respect official plan relationships, cohort rules, application windows, account quotas and existing submissions. Check the logged-in account immediately before preparing and again before submitting. Do not withdraw, delete or resubmit without a new specific instruction.
- Default application content comes from the user's designated application résumé. Follow explicit user instructions about content and material versions; otherwise, do not silently substitute an older résumé, historical application, auto-parsed text or project repository. Trace each field to its source and check auto-populated fields individually. Select all date/year/month fields through the actual picker controls; displayed input text alone is not a valid component selection. Use the content-filling subskill for longer accepted versions, missing facts, field limits and readback.
- Ordinary form and privacy-consent controls may be operated within the user's confirmed batch authority after reading them. The Agent handles the permitted login, OTP entry, CAPTCHA interaction and page controls through the login subskill; ask for the minimum user action only when a real missing input or the site's/tool's confirmation requirement makes it necessary. Check legal declarations, identity assertions and signatures against supported facts and current authority. Never retain credentials, codes, cookies or identity documents in the ledger or screenshots.
- Treat website drafts, final submission clicks, receipts and tracker updates as distinct stages. Persist the stage and evidence after each role so a new turn can resume without duplicate submission.

## Evidence and closeout

Load only the subskill needed for the current step. Login returns an account state and unresolved actions to Prepare; content filling returns a versioned field/source/readback package to Review. Use [preparation-scenarios.md](references/preparation-scenarios.md) for maintenance checks; a scenario review does not establish a live site's login or submission success.

Use the tracker and batch ledger specified by the workspace, without adding tracker columns or statuses on your own. Before each write, reread the live file and record a recoverable backup; change only the affected rows, then reopen the saved file and read back the company official entry, role URL, full JD and status. If another process changed the file, reconcile against the latest copy instead of overwriting it. Screenshots should show enough context to identify the site and step while masking personal details where possible.

Report coverage and outcome separately: companies checked by bucket, roles verified, forms prepared, submissions with receipts, uncertain results, blocked sites and remaining quota. State exactly which evidence supports a completion claim. Read the relevant reference at the point of use; this entrypoint does not import other project Skills or private configuration into a public copy.
