---
name: job-application-assistant-v2
description: Coordinate company-configured login and application MCP tools, stage checks and user review for confirmed recruiting roles. Use for V2 preparation and testing; preserve the installed previous version.
metadata:
  version: "2.0.0-alpha.4"
---

# 岗位代投助手 V2

Start from the workspace router, confirmed role scope, current materials and existing authorization. Reuse same-batch decisions; ask only genuinely missing facts. This version is separate from the installed previous Skill. It does not switch global MCP configuration or migrate original private data automatically.

## Start and route

1. Before opening a website, consume the upstream-confirmed company plan JSON through `role_queue_import` (file or object); read [role entry](docs/role-entry.md). The upstream workflow owns selection, approval and Excel-to-JSON preparation. The entry consumes the confirmed JSON without converting Excel; outcome persistence and tracker synchronization belong to MCP internals. Validate the JSON's approval/version, selected roles, order and URLs; do not invent selections, reorder roles, select from a homepage or silently bypass missing input.
2. Check both MCP browser statuses; use one managed broker and private profile. Follow the returned frozen queue order with `role_open`. Its first navigation is the confirmed role URL, and any login plan stays bound to the role and original tab. Do not call company `login_open` as the normal entry. Never attach to the daily Chrome or invoke REA during normal use. Keep the broker alive; a disconnected page requires recovery, not automatic reconnection.
3. An authenticated result requires matching account and absent login form. Otherwise read the declaration returned by preparation; obtain the user's acceptance of that exact declaration before `login_accept_privacy`, then `login_request_sms`. Third-party login remains user-operated. Graphical verification is always user-operated. Return the handoff once; do not drag, solve, refresh or resend automatically. After the user completes it, call `login_resume_verification` to verify that the challenge disappeared and an SMS countdown is visible. A missing challenge alone does not prove that an SMS was sent. Use only the user's current code with `login_verify_otp`; do not retain it.
4. Login MCP invokes deterministic guards within every mutation. A failed guard stops dependent actions. A Hook does not schedule a model turn: this Skill reads the result and invokes the next permitted tool. Preserve independent work when one company waits for the user.
5. After user login, call `role_resume`: it must return `ready_to_fill`, matching account, original role URL and title on the original tab. A homepage or login success alone cannot release filling. Recheck existing application history/quota before preparation. Call `role_prepare` for the same queue task; it compiles, fills and independently verifies. Use `role_verify` for additional read-only verification, then provide the private report/screenshot for user review. Sequential mode releases the next role only after the earlier role is prepared for review. When the confirmed JSON explicitly enables `parallel_roles`, verify the shared login once, refresh/recheck each role account and use `roles_prepare_batch`; one account lease covers that batch while its distinct role pages run concurrently. Never launch a browser to resolve ambiguous window ownership.
6. Application MCP keeps control capture, conditional discovery, private profile registration, offline plan compilation, batch preparation and independent current-page verification. All newly discovered questions, optional fields and explicit omissions remain registered. This release still has the previous application engine; generic résumé import and full application agreement handling are pending. Only native text parsing is in scope; no OCR.
7. Before compiling, review employer-facing text against the designated source: source/audit notes, model caveats and missing-data explanations belong only in metadata. Structural validity and JSON/page equality do not prove content quality. The compiler rejects recognized editorial leakage; source-based semantic review remains required. Record user-perspective timing from the first timestamp to the final timestamp, including model work, repair and waiting without deductions.
8. Review the exact completed form and actual save state. No application submission is performed by the login MCP or this release's batch preparation. Keep target, review and final-submit authority separate.

Use the installed tool descriptions; return compact counts, exceptions and evidence references instead of full successful inventories. Company assets contain selectors/rules, never personal values. Ordinary private facts live in the user's JSON, authentication secrets remain ephemeral. Browser pages and unsaved work stay open. See [installation and test instructions](docs/login-mcp.md).

For the requested comparison of responsibilities still outside MCP, read [legacy rule audit](docs/legacy-rule-audit.md). This is an audit list, not authority to delete prior rules or claim unfinished submission/receipt functionality.

## Business status rules

Business application status remains `待投递` / `已提交`. Only an official receipt or application-history confirmation permits `已提交`; preparation, review and a submit click do not. Receipt verification is separate metadata. Uncertain results block retries. MCP owns fixed event validation, persistent outcome records, Excel/JSON synchronization and recovery; the model does not assign labels or orchestrate separate synchronization calls.
