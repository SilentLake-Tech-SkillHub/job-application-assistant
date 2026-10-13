# Browser preparation and submission

## 浏览器分工：内置浏览器与 Chrome 默认并行

本节是浏览器选择的唯一规则，其他文件只引用这里。

**两个默认通道，同时使用：**

1. **内置浏览器通道**：执行 Agent 自带的浏览器（例如 Claude 桌面端的浏览器窗格）。该工具内部名为 Playwright 的定位接口属于这一通道，不算使用 Playwright 框架。
2. **Chrome 通道**：通过 Chrome 插件（例如 Claude in Chrome）操作用户本人的 Chrome，复用其中已有的登录状态。

**分工规则：**

- 以公司为单位分配通道（招聘主体及其共享账号、名额范围算一家）。同一家公司、同一个账号不在两个通道里同时操作，避免重复登录、互相覆盖草稿或重复提交。
- 用户指定的分配优先。未指定时：用户已在自己 Chrome 里登录过的站点、或必须用用户本人浏览器环境的站点，放 Chrome 通道；其余放内置浏览器通道，两边工作量大致均衡。分配结果在 Query 时与公司清单一起给用户看。
- 一家公司中途换通道视为交接：先保存草稿或记下当前页面、未保存内容和下一步，再在新通道读回账号与表单状态。
- 每个通道保留自己的公司页面；Chrome 通道按[窗口分组](chrome-window-grouping.md)每窗口最多 10 个网页。
- 每家公司的通道写在 `投递证据/<批次>/公司/<公司>/通道.md`（`通道: 内置浏览器 / Chrome / Playwright`）。

**通道缺失时（Query 能力预检时确定，运行中出现同样处理）：**

| 情况 | 处理 |
|---|---|
| 两个通道都可用 | 按上面的分工并行推进 |
| 没有 Chrome 插件（未安装、未连接或本会话不可用） | 告诉用户缺少 Chrome 通道，并询问：“没有检测到 Chrome 插件，可以用 Playwright 代替 Chrome 通道吗？”用户明确同意才启用 Playwright，并记录确认依据；不同意或未回答时只用内置浏览器继续，原计划给 Chrome 通道的公司依次排在后面 |
| 内置浏览器不可用 | 告诉用户，所有公司改走 Chrome 通道；不自动启用 Playwright |
| 两个通道都不可用 | 询问是否可以用 Playwright；不同意则停在断点，说明缺什么 |
| 运行中 Chrome 插件断开 | 保留页面与已记录状态，做一次有证据的重连；仍失败就按“没有 Chrome 插件”处理，询问是否用 Playwright 接管 Chrome 通道里的公司 |

**Playwright 代替的边界：** 询问时说明它会连接哪个浏览器或会话；新开的独立浏览器没有用户的登录状态，相关公司需要重新登录。同意只对当前批次有效，写在 Query.md `## 能力预检` 节（`Playwright代替: 同意` 与确认记录）。代替不扩大公司、数据、登录、验证码或提交授权。

**computer use 与系统脚本不属于浏览器通道：** 只用于浏览器工具够不到的系统层控件，例如原生的“确认重新提交表单”对话框。本批首次使用前说明用途并取得用户确认，记录后同批同类用途可复用；验证码完整接手按 [captcha-solve](../skills/captcha-solve/SKILL.md) 的三次确认执行。不能用它们绕过站点安全拒绝或本人操作要求，也不能代点微信 OAuth“允许”。

## Page retention

本节是页面保留与关闭的**唯一规则**，[窗口分组](chrome-window-grouping.md)和其他文件只引用这里。

Read when opening company sites, filling, reviewing or submitting. Reuse each company's current login state and assigned browser lane; do not bypass a site safety refusal by switching lanes.

- **默认全部保留**：准备/投递期间，本批已确认公司的整组页面保持可见，包括未完成公司、账号页、表单、审核页和回执。完成一个岗位、一次验证码交接、提交成功或回合结束，都不授权关闭。
- **受保护页面**（任何情况下都不由 Agent 关闭、移动或重载腾位）：登录态页面、有未保存内容的表单、草稿、待审核页面、提交回执/成功页、`save: not_supported` 的已填表单、用户本人打开或归属不清的页面、用户指定保留的页面。
- **非保护页面**：Agent 自己打开的岗位列表、详情、研究页，且所属公司的业务读回门禁已通过。
- **何时可以关闭**：只有用户另行发出**点名公司或页面**的关闭指令时，才关闭其中的非保护页面；指令覆盖到受保护页面时，先列出这些页面并再确认一次。没有这样的指令，不清理任何批次标签——包括公司处理结束时。
- 窗口满了只新建窗口，不关闭页面腾位。

Before ending the turn, use the browser tool's documented visible-retention mechanism and read back company, URL and stage from the tab list. Where a visible deliverable and an internal handoff are distinct, retained company pages must be visible deliverables; a handoff flag alone is not proof of visible retention. On the next turn, re-list tabs before acting. If protected pages are missing, report the actual loss, recover their original URLs and check server-saved content; reopening does not restore unsaved edits.

Browser tab/window indexes drift whenever the user (or a parallel session) opens, closes or reorders tabs mid-run. Re-locate the target tab by URL match before every operation batch; never address a tab by an index remembered from an earlier step.

## Page-init, reload and injection discipline

These rules come from a live SuccessFactors/Workday application session; follow them on any heavy-SPA recruiting page.

- **Wait for usable controls before writing.** Inspect the current DOM/accessibility state and use the execution platform’s documented locators or native inputs. Read-only inspection does not permit page mutation, synthetic event injection, hidden framework-state reads or private API requests. When controls stop responding, inspect the actual blocker and protect unsaved work before considering a reload; record the observed failure, not a guessed environment diagnosis.
- **Predict the native resubmit dialog.** Pages entered via form POST (common after verification-code logins) raise the browser-native "confirm form resubmission" dialog on reload. That dialog is not in the page DOM; handle it at the OS accessibility layer, and prefer not to reload such pages at all unless the form is server-drafted.
- **Upload through supported file controls.** Use the tool’s documented file chooser/upload API or the authorized native chooser. Do not synthesize files or mutate page inputs with scripts. Read back the uploaded filename and site result; inspect any open chooser before retrying.
- **Use the verified tab’s documented controls.** Prefer URL-verified DOM locators/accessibility actions. Native clicks require a fresh observation of the actual company window; avoid stealing the user’s frontmost work. An unavailable tool does not authorize a different UI technology forbidden by the executing platform.
- **Expect id renumbering after re-renders.** Resume upload (and its auto-parse), saves and section changes can rebuild the whole form with new element ids. After any such event, re-enumerate before filling; prefer upload-first then fill-fields. **Draft-saving timing (single rule):** on a site with a draft/save control, save after each completed section; once all required fields are filled, save again, confirm the success message, reopen safely and read back field by field (`save.readback_ref`). On a site without drafts, collect all decisions first and fill in one pass (`save: not_supported`).
- **Cross-check "data lost" reports through a second locator.** A readback script can have its own bug (e.g. concatenating a label name into an id) and produce a false "all fields GONE" panic. Before reporting data loss, re-read the same fields via an independent locator (by id vs. by label text) and compare.
- **Email applications are out of scope.** This Skill never sends application emails ([stage contract §12](stage-contract.md#12-邮件投递)). For an email-only role, record it as blocked for the user; where reading the mailbox is authorized, check the sent items read-only so the user does not send a duplicate.

## 表单准备前的资格复核

读取[任职资格核对](eligibility-check.md)，先把搜索记录中的硬性条件、个人依据和缺口落实为独立结论。JD或历史库已列出的必需条件不得忽略；待核和明确不符合不默认进入表单。只为读取JD/查历史的登录与投递准备分开，不把已登录当作已选岗通过。有效选择、用户剔除与已投保护继续保留。

## Discover and prepare

1. Verify that the page belongs to the employer or its named recruiting platform. Recheck cohort, employment type, location, title, plan and application window. Enumerate all in-scope pages or record a precise coverage limit. Open each candidate's real detail page and judge its title **and complete visible JD**.
2. Use [application-login](../skills/application-login/SKILL.md) for login-state checks, phone/email verification and WeChat login. Read back the authenticated account, then check application history, plan relationship and current remaining attempts before a form is opened. Disclose the company's cooldown, résumé-refresh effects and preference-order rules before preparation; record an officially undisclosed rule as such. When a tracker says unsubmitted but the user or site indicates an earlier application, pause that role for reconciliation; do not create another application shell.
3. Use [application-content-fill](../skills/application-content-fill/SKILL.md) for all form content. Default to the user's designated application résumé and follow their additional instructions. Run the read-only [control preflight](control-preflight.md) before writing and produce a private per-field action map. Inspect every required field and any auto-filled field; distinguish text entry from selects, searchable selects, cascaders, radio/checkbox choices, dates and uploads. Open dynamic choices and click their actual options; input text is not proof of selection. Rescan affected controls after upload/parsing, type changes or added/deleted rows. Date inputs must be selected through their actual picker controls, with the component selection and validation read back; assigning input text is insufficient. Report website drafts or shells that appear automatically. Upload or replace a résumé before manual corrections when upload triggers auto-parsing; afterwards recheck every field that parsing can overwrite.
4. For upload, locate the visible and specific control. If multiple elements share a label, narrow to the visible exact button and handle the file chooser once. After any failure, inspect for an open OS dialog and existing uploaded filename before retrying. Count upload complete only when the site displays the correct file/success state.
5. Route login through the login subskill, and agreement checkboxes and personal/contact fields through `terms-consent` and `privacy-info-fill` — each only if the user enabled it for this batch (see [automation-authorization.md](automation-authorization.md)); otherwise hand that step to the user. CAPTCHA challenges run through `captcha-solve` when enabled: ordinary clicks may proceed, graphical challenges default to the user, and Agent takeover needs three explicit confirmations plus platform permission; government ID numbers are always completed by the user. Request user participation for an actual missing input or site-required confirmation, personal attestation, signature or identity action. Never assert a work authorization status that the user has not supplied.

## Review package

For each role show company, plan, title, direct URL, quota/cross-plan impact, résumé/material filenames, consequential field answers, consent/declaration status, missing items and sanitized screenshots of the completed form and final button. Give the package a version or hash. Keep the page open; a changed material answer or upload creates a new version requiring review.

## Submit and verify

Approval covers only the exact named roles and reviewed form versions. Immediately before each click, recheck the title, account remaining quota, form version and unresolved warnings. Apply the parent's **application-count rule gate** (Issue #12) before presenting roles, then the **pre-submission target confirmation gate** (Issue #8): restate 公司、BU/业务集团/招聘主体、办公地、岗位 and every 意向部门/志愿槽位 in submission order, and wait for the user's explicit confirmation of that exact target before the final click. General instructions such as 「帮我填写打勾提交」 authorize mechanics only and never satisfy this gate; no automation mode (including fully automatic) waives it. Intention/preference slots are **user-choice fields**: propose options with reasoning, never select them unilaterally. Submit one role and wait. A quota modal, CAPTCHA, redirect or loading state is not a receipt. Verify the site's success page and application history or confirmation ID where available. If uncertain, stop that role's retry and inspect the application center. Record the receipt and only then update the tracker. Continue an unrelated role only when it cannot duplicate or interfere with the uncertain one.

显示已填但仍报错、共享容器字段错位或联动丢值时，必须按[字段绑定恢复策略](field-binding-recovery.md)逐项恢复并记录分层证据。

## 独立偏好与执行证据

准备前读取 [偏好证据契约](preference-contract.md)：先有岗位目录的 `岗位包.md` 后操作表单，逐岗字段、转正实习排序和跨轴规则以该契约为准。Review 和 closeout 按每岗更新实际执行证据；登录成功不能称表单准备完成。默认岗位次序与公司动作前确认的唯一规则见[偏好契约](preference-contract.md#默认次序与公司动作前确认)。
