---
name: job-application-assistant-v2
description: Coordinate company-configured login and application MCP tools, stage checks and user review for confirmed recruiting roles. Use the single maintained V2 runtime for preparation and testing.
metadata:
  version: "2.0.0-alpha.64"
---

# 岗位代投助手 V2

本组件是工作区唯一的投递运行源码：登录 MCP、申请 MCP、固定 CLI 和 Hook 入口都指向这里；个人资料和运行状态放在组件外。投递只处理用户确认过的岗位范围，沿用当前材料、已有授权和同批次已做的决定，只问确实缺的事实。

每家公司一份正式填写模板，公司全部岗位共用其控件定义；公司文件按上游岗位编码登记岗位绑定。MCP 从确认的交接和绑定任务解析岗位目标，Agent 不选择、不替换岗位路径。辅助工具只用原始采集和实际核验结果，不另建或读取封存证明。

## 开始前：Hook

在对话中开始调用本组件时，先确认本宿主已为本项目装好组件 Hook 和工作区 Hook；没有就按自身宿主的方式装上，具体做法由 Agent 自己解决。

- 范围：Hook 对本项目生效，跨项目不生效。宿主能写项目级配置的写项目级；只能写用户级配置的，Hook 脚本按会话工作目录判断，不在本项目就直接放行。
- 组件 Hook：`hooks/workflow_hook.py`，事件 SessionStart、UserPromptSubmit、SubagentStart（注入调用顺序）和 PreToolUse、PostToolUse、Stop（阶段调用登记与接续检查）；所需环境变量见 [conversation hooks](docs/conversation-hooks.md)，可参照 Codex 的封装 `.codex/hooks/recruiting_workflow.py`。
- 工作区 Hook（数据保护、投递状态、需求入口、生产验收台账）：照本项目现有的 `.claude/settings.json`、`.codex/hooks.json`、`.agents/hooks.json` 装同一组。
- 修改 Hook 配置按工作区 `AGENTS.md`「组件软锁」执行。

对话 ID 和回合 ID 只用于本轮提示和接续记录，不决定 Agent 身份或调用资格；新对话、分支沿用已登记的 Agent 或 Agent 组身份，另注册实例走宿主安装器，组成员各自保留编码。可选的对话预加载见 [conversation hooks](docs/conversation-hooks.md)。

## 环节表

按顺序执行；一个环节的“完成标准”达到后进入下一个。Hook 注入的调用顺序由本表的“环节”“调用”两列生成。

<!-- 环节表:开始 -->
| 环节 | 进入条件 | 调用 | 组件返回 | 交给用户 | 完成标准 | 异常去向 |
|---|---|---|---|---|---|---|
| 建批次 | 用户确认了岗位范围，`岗位交接/公司/<公司编码>.json` 已确认 | `company_batch_create` → `company_batch_take` | 各公司的通道分配（Chrome 分身／内置浏览器）、冻结的岗位顺序、`form_assets_status`（各站点缺登录配置、正式模板、投递链接的情况） | 本批公司数、各通道分到的公司、缺资产的站点 | 每家公司拿到通道分配 | 没有可用通道 `NO_USABLE_BROWSER_CHANNEL`；分身没运行或没连上，Agent 直接调 `browser_initialize_chrome`／`browser_restore_chrome` |
| 进岗位与登录 | 拿到分配；按公司冻结顺序逐个岗位，岗位编码与分配一致 | `role_advance` | `ready_to_fill`；或 `needs_user_login`；写了首版登录配置时带 `loginConfigsCreated`，写了首版入口配置时带 `entryConfigsCreated` | `needs_user_login`：请用户在原分身登录；`loginConfigsCreated`／`entryConfigsCreated`：写了哪几家公司 | `ready_to_fill`（点入口后落在申请表） | 用户登录后再调 `role_advance`；错误带 `details.nextTool` 就调它；首版入口同一失败第二次返回 `agent_fallback` 时调 `role_entry_fallback`；页面卡住 `role_reload_page`；多余标签 `role_close_extra_pages`；链接打不开 `role_report_link_failure` |
| 选路线 | `ready_to_fill` | `workflow_next`／`form_route` | 下一步：复用公司模板去填写，或去建库；有已核实官方表单定义的公司先 `capture_form_definition` | 无 | 拿到下一步 | 按返回的 `continuation` 处理 |
| 建库 | 公司没有正式模板，或填写时观察到真实结构缺口 | `form_construct_acquire` → `form_construct_build` | 第一段先返回脱敏截图，带 `observation` 再调返回 REA 一级候选；第二段在组件内完成展开、复核、已知事实映射、正式模板与版本更新、交互测试和确认，只返回一次：`agentItems`（新问题映射、页面定义）、`userItems`（缺的答案）、`fallbackItems`，附记录引用；完成时带 `controlSources`（各控件由哪一层做出） | `userItems` 里缺的答案，一次集中问；完成时告诉用户哪些控件靠兜底 | 返回 `company_template_ready` | `agentItems` 由 Agent 处理后再调 `form_construct_build`；`fallbackItems` 走 `form_gui_fallback`；看细节用 `form_construction_records`（不重采） |
| 填写与核验 | 公司模板可用 | `role_prepare` | 填写结果和独立核验结果（同一次调用；组件能自修的定位变化已在内部修复、回放测试并重填一次） | 无（进入审阅） | 独立核验通过 | 不再调 `role_verify`；修不了的按 `continuation` 处理；用户明确授权的同公司并行岗位用 `roles_prepare_batch`，已就绪的不同公司用 `workflow_advance` |
| 用户审阅 | 填写与核验完成 | 无工具（Agent 汇报） | 无 | 原分身标签里已填好的表单及实际保存状态、独立核验结果、附件验收结果、需要用户补充或决定的项；只报计数、异常和证据引用，不罗列全部成功项 | 用户对这个岗位、这张表给出具体提交授权，或提出修改 | 用户要改：改资料后回到填写与核验 |
| 提交与收尾 | 用户对这个岗位和当前表单的明确提交授权 | `role_submit` | 官网回执；同一次调用写回固定收尾（`application_closeout`）的结果 | 是否拿到官网回执、收尾是否写回 | 拿到官网回执，收尾已写回 | 只有收尾写回失败：再调一次 `application_closeout`，不重新提交；没有官网回执不算提交 |
<!-- 环节表:结束 -->

## 接续与异常（所有环节）

- 按 `continuation.owner/state` 接续：建库、映射、可恢复的技术缺口归 Agent，不交用户。Hook 不安排模型回合，由 Agent 读结果调下一个允许的工具；有允许的下一步就继续，不在每次部分填写后结束回合；不盲目重试没变化的失败。
- 一家公司等用户时，其他公司照常推进；按公司记录用户等待和阻塞。派发本身不是执行证据。恢复已授权的原任务后直接接续，不再询问是否继续；结束前调用 company_batch_status 核对 actionable、waitingCompanies 和 agentWorkRemaining；还有 actionable 就按返回的原任务继续，不能用最后一家等待覆盖其它公司的可执行工作。
- 登录 MCP 每次变更都执行确定性守卫，守卫失败即停止依赖它的动作。
- 同一真实失败在同一任务或公司出现两次：本宿主在组件外登记表 `产品管理/Agent浏览器兜底登记.json` 里、且页面所在浏览器也登记时，返回 `continuation.state: agent_fallback`，按下文“Agent 浏览器兜底”调 `form_gui_fallback`；表外宿主、表外浏览器，或兜底后同一失败再出现，返回 `ask_user` 和 `repeatedFailure`：把字段和证据交给用户，其他公司继续。不锁任何东西；刷新、恢复或丢页不计次。
- 分身没运行或没连上：Agent 直接调 `browser_initialize_chrome`（`authorization.evidence` 填当前任务授权原话）；断开、原端口不在：`browser_restore_chrome`。
- 接口或核心版本对不上被拒：重连该 MCP，或用 `component_runtime` 完成更新，不经已知过期的连接继续；用 `runtime_info` 读回（见 [runtime architecture](docs/runtime-architecture.md)）。
- 代码更新后只需 `component_runtime reload`（C43）：业务核心换到当前代码，浏览器主控空闲且代码不同就随之换新，Chrome 分身和标签不关；返回 `browserHost.updated` 为 true 时先调 `browser_initialize_chrome` 连上分身。工具报 `BROWSER_HOST_VERSION_MISMATCH` 或 `BROWSER_HOST_RESTART_REQUIRED` 时同样直接 reload，不要手动结束主控进程。
- `HOST_ROLE_MAINTAINER_READ_ONLY`：本宿主配置为维护角色，不执行投递（见 [host integration](docs/host-integration.md)）。
- 确属通用代码缺陷：`workflow_handoff` 带实际准备或核验运行编号交维护。

## Agent 浏览器兜底

进入申请页：首版入口同一失败第二次、结果点名 `role_entry_fallback` 时使用。`start` 模式核对登记表，在任务绑定的岗位页（不在就回岗位链接）只读盘点岗位标题和候选按钮；Agent 只在这张标签上先核对岗位名，再用鼠标点进本岗位申请表，不填写、不提交、不自己开新标签（站点自己开就停在那里），落到登录页就停。然后用 `report` 模式回报按钮完整文字 `label` 和同文字按钮从上往下第几个 `position`；组件核对落地页是本岗位申请表后写入首版入口配置（`entryConfigsCreated`），再调 `role_advance` 接续。登记表外、点了没反应、落地不是本岗位申请表时交用户。

表单控件：只在结果点名 `form_gui_fallback` 时使用。`start` 模式检查组件外登记表（宿主 + 页面所在浏览器：装了 Agent 插件的 Chrome 分身，或内置浏览器），返回要做的字段、值和规则。只在任务绑定的那张申请页上用鼠标点击和键盘输入，不提交，不碰其他控件，不开新标签。然后用 `report` 模式回报每个字段的步骤（`click_field`、`click_text` 加准确文字、`type_value`、`type_text`、`press`）；组件把步骤写进正式公司模板的操作定义，回放、重测并接续原任务。“投递流程不用 Chrome AI 插件”只对这一处例外。

组件代点（第三种方式，登记表里登记了 `component_playwright` 时可用）：Agent 自己的浏览器操作不了这张页面时（例如分身里的插件没连上、宿主不给点击），只看页面（`role_screenshot`）决定怎么点，不自己操作，把操作交组件用自己连着分身的浏览器通道执行——入口用 `role_entry_fallback`（`mode=component`，回报同样的 `label`、`position`，组件核对同文字按钮个数不变后点一次，再同样核对落地页）；表单控件用 `form_gui_fallback`（`mode=component`，回报同样的步骤，组件写进操作定义后回放测试、独立读回）。只能点盘点出的入口候选按钮或模板里登记的控件，不提交。页面没有本岗位内容时不选按钮，改用 `role_report_link_failure`。这不是“Agent 用组件外的 Playwright”：Agent 不另起浏览器工具。

登记表是组件外数据：每行 `hostId` 必须等于该执行端安装时的 `RECRUITING_HOST_ID`（`scripts/install-host.mjs --host <id>`），且只对有适配器 `host/adapters/<id>.mjs` 的执行端有效。新接入一个 Agent：按该 id 安装并在登记表加一行；和已有适配器不是同一个产品的，先补适配器。改登记表不改组件。见 [host integration](docs/host-integration.md#agent-浏览器兜底登记与执行端标识)。

## 规则

### 批次与输入

- `company_batch_create` 带当前准备授权，只读用户确认过的公司宽表 `岗位交接/公司/<公司编码>.json`（编码固定：公司 C00001、站点 S0001、岗位 J000001；链接在执行时现读，见 [role entry](docs/role-entry.md)），再 `company_batch_take`。MCP 按正向评审确认的公司顺序拆出公司并分配 Chrome／内置浏览器，每个通道取前 `companiesPerChannel` 家（默认 10 家、共 20 家），不另传公司次序或公司子集；同公司多个岗位算一家，已核实共享登录范围的放同一通道。见 [dual-browser batches](docs/company-batches.md)。
- 选岗、审批和 Excel 转 JSON 属于上游流程；本组件只消费确认后的 JSON，不转换 Excel，不做外部表同步。不自造选择、不改公司和岗位的优先顺序、不跳过缺失的输入。旧的显式顺序／同公司运行器仍可用，不是新批次的默认方式。

### 浏览器与标签

- 通道只在能力文件记录的执行端上运行：Chrome 是组件的 Chrome 分身（固定私有资料目录和本机调试端口，所有宿主共用，只由 `scripts/chrome-clone.mjs` 或 `browser_initialize_chrome` 启动）；内置浏览器只在三步检测全过时使用。批次取 browserChannels 偏好与已记录可用能力的交集；为空时用可用通道并报告原因。
- 不用 Playwright、browser-use 或组件外的浏览器工具，不自己启动 Chrome，不连接、不使用日常 Chrome 及其插件；正常使用不调 REA。保持浏览器和页面开着，未保存的内容不动。
- 每家公司按冻结的岗位顺序执行，第一次导航打开确认的岗位链接；登录绑定原岗位和原标签。
- 一个岗位任务 = 一张绑定标签（任务记录里的 `pageId`），每一步只在这张标签上做，URL 只说明走到哪一步。任务中不自己用浏览器工具开页、选页或切页：`role_advance` 复用本岗位已有标签，没有才新开；有入口配方的站点总是岗位链接 → 同一任务内登录 → 入口驱动到表单，不直接打开存储的申请链接。像表单的多余标签要先经用户查看并给出原话才关。
- 站点还没有入口配置时，`role_advance` 进入申请页那一步由组件在原岗位页读出与岗位名一致的标题（读不到就不点）、点一次唯一的投递按钮，落地页是本岗位申请表（有输入框，且地址里有岗位编号或页面上有岗位名）就写入首版入口配置并读回，同一任务接着进入；结果的 `entryConfigsCreated` 列出写了哪几家，要告诉用户。落到登录页照常交用户登录。其余失败（读不到标题、按钮没有或不止一个、点了没换页、落地不是本岗位申请表）第一次按原错误处理，同一失败第二次交 Agent 浏览器兜底（见下文）。
- 已有入口配置的修改只通过 `scripts/site-entry.mjs`（预览 → 用户原话 → 写入），见 [role entry](docs/role-entry.md) 和 [declarative entry](docs/declarative-entry.md)。

### 登录

- 登录态不从页面痕迹推断：点一次真实入口，落在申请表即已登录，落在登录页即未登录；只读“是不是登录页”的识别，不读账号文字。
- 没登录时不跳登录页的站点（C42）：页头可点的“登录／请登录／登录注册”文字、带登录字样且有手机号／验证码／密码输入的对话框，也算登录入口。岗位页上认出登录入口时 `role_advance` 直接返回需要登录，不点入口、不进兜底；入口按钮被挡住或不可用时不点，错误详情写明挡住它的元素类型、是否对话框。
- 没有登录配置的公司或站点，由组件按固定规则写入首版本人登录配置并读回，同一任务接着走；结果的 `loginConfigsCreated` 列出写了哪几家，要告诉用户。
- 验证码和第三方登录由用户本人操作。已有短信接口可用于已确认的手机号输入和用户当前提供的验证码，验证码不保存。是否同意按普通业务授权开关。

### 建库

- 第一段 `form_construct_acquire`：不带 `observation` 时返回脱敏截图，Agent 自己看图列一级控件（标签、栏目、第几次出现，每个展开入口一行；不写 DOM、值或子控件），再带 `observation` 调用，组件在同一页做 REA 和实时采集，返回 REA 一级候选。
- 第二段 `form_construct_build`：带视觉与 REA 的一级对照 `primary` 和 `evidence`（新公司另带 `page`）调用，组件内部完成其余步骤，见环节表。详情用 `form_construction_records` 按需读取摘要或完整记录，不重新采集。流程细节见 [generic form pipeline](docs/generic-form-pipeline.md)。
- 记录规则：每家公司建库时，每个控件按统一格式记进这家公司的正式模板——类型、展开类型（不展开／弹出列表／输入后出候选／多级逐级展开）、操作方式；选择类控件记四块：字段外框、选择框（或点开它的按钮）、弹出的候选菜单、选中后显示的结果；多级控件按答案逐级展开，并记下到末级的路径。
- 分类顺序：先按网页通用标注（ARIA）；标注不够时按识别出的招聘系统控件库（飞书、atsx／Ant、北森 phoenix）；两层都认不出，或交互测试同一原因失败两次，走下文“Agent 浏览器兜底”，手点的步骤写进这家公司的模板。只按控件种类和控件库写组件代码，不按公司写代码。
- 实测通过才算记完。建库结果的 `controlSources` 列出由通用标注、控件库、兜底各做出几个控件，以及靠兜底的控件名。

建库每次返回向用户说明当前阶段、该阶段本轮调用次数和实际缺口；阶段变化时简要汇报。新公司页面定义第一次提交后由组件保存接续，不反复重写。记录查询先用摘要，细节按 fieldId／section 和 offset／limit 读取；原始脚本用 form_script_search，不读整份结构。用户要求岗位数量时，company_batch_create 显式传 roleLimit，并读回 queue.tasks.length；companiesPerChannel 是通道公司容量，不是岗位数量。

### 公司模板与资料

- 公司资产只存选择器和规则，不存个人值；普通个人事实在用户 JSON，认证秘密不落盘。
- 公司更新先写唯一正式模板、内容映射和版本，再做后续检查和操作，所有读取都用正式资产；draft 是临时文件，用完删除，不作为执行来源。已建好的公司直接复用存储资产，不因旧证据缺失或内部格式变化重新认证、重新采集；只有观察到真实填写失败才走增量回补。独立读回和提交核验分开。
- 新发现的问题、可选字段和明确省略都要登记。有已核实官方表单定义的公司，先 `capture_form_definition` 再采 DOM（见 [official form definitions](docs/official-form-definitions.md)），它是建库证据，不证明映射或填写已完成。简历导入先放用户批准的本地材料，再重新采集门户解析出的字段。
- 填写前按确认范围核对实际投递记录和投递数量限制。

### 内容与附件

- 发给雇主的文字对照指定来源复核；来源／审计说明、模型提示、缺数据说明只放 metadata。结构合法、JSON 与页面一致都不证明内容质量；编译器拒绝已识别的编辑痕迹，按来源的语义复核仍要做。
- 用户视角耗时从第一个时间戳算到最后一个，包含模型思考、修复和等待，不扣除。
- 附件验收按 [persistent business authorization](docs/generic-form-pipeline.md#持久业务授权) 和 [attachment acceptance](docs/generic-form-pipeline.md#附件截图与模型验收)：一个岗位的全部附件一次视觉模型调用判定；没有可用视觉模型时接受站点已上传状态；只有模型判定不符才阻断。不下载附件、不比文件哈希、不让用户确认照片。

### 提交与授权

- 登录 MCP 和所有准备工具都不提交。最终提交只用 `role_submit`，且必须有用户对这个岗位和当前表单的明确授权；它绑定模板哈希和已核验的审阅运行，提交前再核验一次编辑表单，站点的摘要步骤直接进入、不做比较，只认官网回执，同一次调用写回固定收尾（见 [application outcome](docs/application-outcome.md)）。目标、审阅和最终提交三种授权分开。

### 业务状态

- 本组件从不修改主表状态。`application_closeout` 按官方证据校验固定事件，覆盖写入 `岗位交接/投递回传.json` 中每个岗位的最新结果。只有官网回执或投递记录确认才算 `submission_confirmed`；准备、审阅和点击提交都不算。该岗位不是本组件按本批队列里公司正式模板填写并通过独立核验（`role_prepare`／`role_verify`）的，`submission_confirmed` 也被拒绝，手工填写的表单不能登记为已提交；先为该公司建库。
- 本组件不改交接区的链接。岗位的投递链接为空时，`role_enter_application` 把核实过的申请页作为观察记录写进 `岗位交接/投递回传.json`；岗位链接或投递链接打不开时，`role_report_link_failure` 带证据记录失败观察（仍能打开的跳转不算变化）。搜索端用 `apply-observations` 预览观察记录，用户确认后才写主表，下次导入读刷新后的公司文件。`form_assets_status`（`company_batch_create` 也会返回）按站点编码列出缺的登录配置、正式模板和投递链接。
- 不确定或受阻的结果在用户处理前不重试。搜索端通过反向评审把结果整理成“当前状态是X，更新状态是Y”，用户确认后才写主表。本组件不读写 Excel，模型不能自定业务标签。

### 运行方式

- 按已安装工具的说明传参。固定 CLI 和 MCP 使用同一业务核心，规则相同；公司数据每次操作重读。安装和测试见 [login MCP](docs/login-mcp.md)，运行与版本更新见 [runtime architecture](docs/runtime-architecture.md)。尚需建设的能力见 [capability boundaries](docs/capability-boundaries.md)。
- 故障恢复见 [failure recovery](docs/failure-recovery.md)。

## 维护、部署与运行更新

这些内容不属于投递执行，按文档进行：

- 宿主职责（执行端 `executor`／维护端 `maintainer`）、安装、迁移、浏览器能力检测：[host integration](docs/host-integration.md)。
- 维护流程（失败聚合、一次修一类、先用已存证据复现、门禁变更影响评估、新框架适配器准入、`scripts/readiness.mjs`）：[maintenance](docs/maintenance.md)。
- 运行核心更新（`component_runtime`、`scripts/update-runtime.mjs`、CLI／MCP 版本一致）：[runtime architecture](docs/runtime-architecture.md)。
- Hook 与执行身份：[conversation hooks](docs/conversation-hooks.md)。
