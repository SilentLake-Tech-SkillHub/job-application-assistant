# Browser preparation and submission

## 浏览器分工：内置浏览器与 Chrome 默认并行

本节是浏览器选择的唯一规则，其他文件只引用这里。

**两条通道同时推进：**

1. **内置浏览器通道**：执行 Agent 自带的浏览器（例如 Claude 桌面端的浏览器窗格）。该工具内部名为 Playwright 的定位接口属于这一通道，不算 Playwright 通道。
2. **第二通道：Chrome 插件优先，Playwright 常备备用。** 有 Chrome 插件（例如 Claude in Chrome）时用它操作用户本人的 Chrome，复用其中的登录状态；没有插件、插件运行中断开且重连失败时，第二通道由 Playwright 承担（[`scripts/playwright_fill.py`](../scripts/playwright_fill.py) 用持久化浏览器配置，登录一次后保留）。Playwright 是 Skill 的常备备用通道，**不再每批询问是否同意**；它只改变操作手段，不扩大公司、数据、登录、验证码或提交授权。

**分工规则：**

- 以公司为单位分配通道（招聘主体及其共享账号、名额范围算一家）。同一家公司、同一个账号不在两个通道里同时操作，避免重复登录、互相覆盖草稿或重复提交。
- 用户指定的分配优先。未指定时：用户已在自己 Chrome 里登录过的站点、或必须用用户本人浏览器环境的站点，放 Chrome 通道；其余放内置浏览器通道，两边工作量大致均衡。分配结果在 Query 时与公司清单一起给用户看。
- 一家公司中途换通道视为交接：先保存草稿或记下当前页面、未保存内容和下一步，再在新通道读回账号与表单状态。
- 每个通道保留自己的公司页面；Chrome 通道按[窗口分组](chrome-window-grouping.md)每窗口最多 10 个网页。
- 每家公司的通道写在 `投递证据/<批次>/公司/<公司>/通道.md`（`通道: 内置浏览器 / Chrome / Playwright`）。Chrome 插件可用而改用 Playwright 时，`通道.md` 需写 `原因:`（例如插件断开、重连失败）。

**通道缺失时（Query 能力预检时确定，运行中出现同样处理）：**

| 情况 | 处理 |
|---|---|
| 内置浏览器 + Chrome 插件都可用 | 按上面的分工并行推进；Playwright 不启用 |
| 没有 Chrome 插件（未安装、未连接或本会话不可用） | 告诉用户缺少 Chrome 插件，第二通道直接改用 Playwright；Query `## 能力预检` 写 `Chrome: 不可用`、`Playwright: 可用` |
| 没有 Chrome 插件，Playwright 也跑不起来（缺 Python 包或浏览器） | 告诉用户缺什么、怎么装（`pip install playwright` 后 `python -m playwright install chromium`，或用 `--channel chrome` 调用本机 Chrome），**由用户自己调整环境**；Agent 不自行安装。调整好之前只用内置浏览器，原计划给第二通道的公司依次排在后面 |
| 内置浏览器不可用 | 告诉用户，所有公司改走第二通道（Chrome 插件，没有则 Playwright） |
| 运行中 Chrome 插件断开 | 保留页面与已记录状态，做一次有证据的重连；仍失败就把这些公司交接给 Playwright（`通道.md` 追加 `换通道: Chrome→Playwright` 与 `原因:`），新开的 Playwright 配置没有 Chrome 的登录态，相关公司在 Playwright 里登录一次 |

**Playwright 的登录：** 持久化配置默认在 `<投递根目录>/.浏览器配置/playwright`，属于用户私有工作区，含登录 Cookie，不放进 `投递证据/`、不提交、不分享。第一次在其中登录某家公司按[登录子 Skill](../skills/application-login/SKILL.md)的正常交接进行，之后复用；也可以 `--cdp` 连接用户已打开的浏览器。

**computer use 与系统脚本不属于浏览器通道：** 只用于浏览器工具够不到的系统层控件，例如原生的“确认重新提交表单”对话框。本批首次使用前说明用途并取得用户确认，记录后同批同类用途可复用；验证码完整接手按 [captcha-solve](../skills/captcha-solve/SKILL.md) 的三次确认执行。不能用它们绕过站点安全拒绝或本人操作要求，也不能代点微信 OAuth“允许”。

## 批量填写与填写缓存（三条通道通用）

本节是表单填写提速的唯一规则。目标是：先盘点、生成映射，再一次性批量执行，每个字段即时读回；中断后从缓存接着做。

**1. 每个岗位一份 `填写方案.json`（填写缓存）。** 放在岗位目录，记录每个字段的定位、控件、填法、值或值来源、逐字段状态与读回。它只是缓存：
- 不记盘点状态、投递状态、批准、回执——这些只在 Excel 和 Markdown 证据里（[追踪表契约](workbook-contract.md#填写缓存与-excel-的分工)）。键名有白名单，写进状态类字段会被门禁拒绝。
- 值从哪里来：先用 `profile_vault.py init` 把简历转成文本基础档案（[个人信息档案](../skills/personal-info-vault/SKILL.md)），之后查值只读这份文本档案，不再反复读 PDF。手机号、邮箱、住址、紧急联系人等敏感字段只写 `值来源: 档案:<字段>`，执行时从档案取值，读回只记 `一致/不一致`，且本批开启了 `privacy-info-fill` 才由 Agent 填；方案里出现手机号、证件号、邮箱形态的明文会被拒绝，带令牌或账号密码的链接也会被拒绝。密码、验证码、证件号、银行卡号不进方案，`填法: 用户`。
- 档案里没有的值：字段标为「需用户」，按公司汇总一次问用户，答复用 `profile_vault.py add` 写进档案，再 `fill_plan.py vault-sync` 改回待填——档案里没有这一项时脚本不允许改。
- 绑定 Excel：`skeleton` / `from-template` / `check` / 执行器都可带 `--workbook`，岗位行必须唯一、公司一致、仍为 `待投递`（只读 Excel，不写）。
- 生成：`fill_plan.py skeleton <控件盘点.json>` 由[控件盘点](control-preflight.md)输出生成骨架；同一站点再次申请时 `fill_plan.py from-template <站点模板>`。补全值和自定义组件的点击路径后，`fill_plan.py check --ready` 必须通过。
- 站点模板：`fill_plan.py template` 把一份跑通的方案提炼成 `<投递根目录>/站点模板/<站点>.json`（只有定位、控件、填法、点击路径和值来源，不含个人取值和进度），供同站点其他岗位复用。

**2. 填法只有四种。**

| 填法 | 适用控件 | 内置浏览器 / Chrome 插件 | Playwright |
|---|---|---|---|
| 批量 | 原生文本框、多行文本、原生下拉、原生单选/复选 | `fill_plan.py actions` 输出分组；一组用一次批量调用（如 `browser_batch`）执行多个工具自带的表单接口（`form_input` / 输入），先用 `find` 等只读接口拿到元素引用 | `playwright_fill.py` 用 `fill()` / `select_option()` / `check()` |
| 点击 | 自定义下拉、搜索下拉、级联、日期、自定义单选 | 按 `点击步骤` 逐步真实点击实际选项 / 日期单元 | 执行器按 `点击步骤` 真实点击 |
| 上传 | 文件 | 工具的上传接口 | `set_input_files()` |
| 用户 | 证件号、验证码、未授权的子 Skill 步骤、只有用户知道的事实 | 集中交接 | 标为 `需用户`，跳过 |

**3. 读回与回退。** 每批执行后立刻逐字段读回（批量组整组读回，再看页面校验提示），用 `fill_plan.py mark` 写回状态；Playwright 执行器每个字段读回后立即写回 JSON。读回不一致的字段退回逐字输入或真实点击，仍不行按[字段绑定恢复](field-binding-recovery.md)处理。全部 `已读回`（或选填 `跳过`）后，看一眼页面整体有没有报错，用 `fill_plan.py page-check --ok yes --observation <截图>` 记下页面校验（Playwright 执行器自动截图并检查可见的报错提示）；然后 `fill_plan.py export` 导出 `填写读回.md`（带方案哈希）。导出要求页面校验通过、所有读回都在 15 分钟内——太久就先在页面复核；任何字段再改动都会作废页面校验。导出的 Markdown 是独立填写证据；门禁不读取 JSON，也不比较缓存哈希。Playwright 执行器在批量填写读回不一致时，会先改用逐字输入再读回，报错信息里不回显个人值。

**4. 仍然禁止：** 自写页面脚本给输入框赋值、派发合成事件、改组件内部状态、移除 readonly——这些在 React/Vue 表单上常见“显示已填、提交判空”。工具自带的表单接口和 Playwright 的输入 API 不属于此类。批量执行永远不包含提交按钮：方案里出现像提交的点击会被校验拒绝，执行器也会按元素文字拒绝点击；提交仍由 Agent 在提交门禁和钩子之下单独点击。

**5. 中断与续跑。** 续跑时先看 `batch_check.py` 报告的 `填写进度`，再按缓存接着做：
- 缓存里 `已读回` 的字段先在页面上复核一遍——页面可能已重载而没保存，复核不一致的退回 `待填` 重填（执行器自动做，另外两条通道按 `fill_plan.py pending` 和读回结果手动标记）；
- 上传简历会触发重新解析，可能改掉已填字段，所以上传在前，整轮填完后再整体复核一次；
- 保存草稿后重开表单逐字段读回，写 `草稿读回`。

**执行结束保留页面。** Playwright 备用执行器用专用持久化配置启动独立浏览器，通过 CDP 连接；成功、失败、等登录或分段执行后仅断开客户端，浏览器与未保存页面继续保留。再次执行复用该配置及当前表单页，不导航或重载未保存页面。输出 `浏览器会话.CDP` 可用于 `--cdp` 重连。既有 CDP 会话也不会被执行器关闭；关闭仍按下节的点名指令处理。`--headless` 供测试使用，也保留浏览器进程，拥有该临时浏览器的测试须显式清理。未安装浏览器时只提示用户配置，不自动安装。

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

- **Wait for usable controls before writing.** Inspect the current DOM/accessibility state and use the execution platform’s documented locators, form interfaces or native inputs (batch filling: [批量填写与填写缓存](#批量填写与填写缓存三条通道通用)). Neither inspection nor filling permits page-script value assignment, synthetic event injection, hidden framework-state reads or private API requests. When controls stop responding, inspect the actual blocker and protect unsaved work before considering a reload; record the observed failure, not a guessed environment diagnosis.
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
3. Use [application-content-fill](../skills/application-content-fill/SKILL.md) for all form content. Default to the user's designated application résumé and follow their additional instructions. Run the read-only [control preflight](control-preflight.md) before writing and turn it into the role's `填写方案.json` ([batch filling and fill cache](#批量填写与填写缓存三条通道通用)). Inspect every required field and any auto-filled field; distinguish text entry from selects, searchable selects, cascaders, radio/checkbox choices, dates and uploads. Open dynamic choices and click their actual options; input text is not proof of selection. Rescan affected controls after upload/parsing, type changes or added/deleted rows. Date inputs must be selected through their actual picker controls, with the component selection and validation read back; assigning input text is insufficient. Report website drafts or shells that appear automatically. Upload or replace a résumé before manual corrections when upload triggers auto-parsing; afterwards recheck every field that parsing can overwrite.
4. For upload, locate the visible and specific control. If multiple elements share a label, narrow to the visible exact button and handle the file chooser once. After any failure, inspect for an open OS dialog and existing uploaded filename before retrying. Count upload complete only when the site displays the correct file/success state.
5. Route login through the login subskill, and agreement checkboxes and personal/contact fields through `terms-consent` and `privacy-info-fill` — each only if the user enabled it for this batch (see [automation-authorization.md](automation-authorization.md)); otherwise hand that step to the user. CAPTCHA challenges run through `captcha-solve` when enabled: ordinary clicks may proceed, graphical challenges default to the user, and Agent takeover needs three explicit confirmations plus platform permission; government ID numbers are always completed by the user. Request user participation for an actual missing input or site-required confirmation, personal attestation, signature or identity action. Never assert a work authorization status that the user has not supplied.

## Review package

For each role show company, plan, title, direct URL, quota/cross-plan impact, résumé/material filenames, consequential field answers, consent/declaration status, missing items and sanitized screenshots of the completed form and final button. Give the package a version or hash. Keep the page open; a changed material answer or upload creates a new version requiring review.

## Submit and verify

Approval covers only the exact named roles and reviewed form versions. Immediately before each click, recheck the title, account remaining quota, form version and unresolved warnings. Apply the parent's **application-count rule gate** (Issue #12) before presenting roles, then the **pre-submission target confirmation gate** (Issue #8): restate 公司、BU/业务集团/招聘主体、办公地、岗位 and every 意向部门/志愿槽位 in submission order, and wait for the user's explicit confirmation of that exact target before the final click. General instructions such as 「帮我填写打勾提交」 authorize mechanics only and never satisfy this gate; no automation mode (including fully automatic) waives it. Intention/preference slots are **user-choice fields**: propose options with reasoning, never select them unilaterally. Submit one role and wait. A quota modal, CAPTCHA, redirect or loading state is not a receipt. Verify the site's success page and application history or confirmation ID where available. If uncertain, stop that role's retry and inspect the application center. Record the receipt and only then update the tracker. Continue an unrelated role only when it cannot duplicate or interfere with the uncertain one.

显示已填但仍报错、共享容器字段错位或联动丢值时，必须按[字段绑定恢复策略](field-binding-recovery.md)逐项恢复并记录分层证据。

## 独立偏好与执行证据

准备前读取 [偏好证据契约](preference-contract.md)：先有岗位目录的 `岗位包.md` 后操作表单，逐岗字段、转正实习排序和跨轴规则以该契约为准。Review 和 closeout 按每岗更新实际执行证据；登录成功不能称表单准备完成。默认岗位次序与公司动作前确认的唯一规则见[偏好契约](preference-contract.md#默认次序与公司动作前确认)。
