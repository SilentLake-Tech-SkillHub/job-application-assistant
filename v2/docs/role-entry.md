# 投递批次消费接口

## 职责边界

唯一输入是工作区 `岗位交接/投递批次.json`：由搜索端 `company_store.py forward` 生成、用户在正向评审页确认（`forward-confirm` 登记原话与内容摘要）后才可读取。目录 `RECRUITING_HANDOFF_DIR` 指定，默认 `<工作区>/岗位交接`。旧的公司方案 JSON 文件或对象输入一律拒绝（`HANDOFF_BATCH_REQUIRED`）。本组件不做选岗、不转换 Excel；投递结果回传见 application-outcome.md。

公司目录同样来自工作区：`岗位交接/公司/<地区>/<公司>/公司.json`（companyId、官网域名）及同目录 `登录[@域名].json`、`表单定义[@域名].json`。一家公司有多个站点时，每个站点是一个目录项：主站点用公司.json 的 companyId，其它站点用该站点登录配置里的 companyId，没有登录配置的站点用 `<companyId>--<域名>`。组件包内不携带公司目录或公司资产，也不写死任何域名。

`role_queue_import` 不需要参数（`companyOrder` 可选）。它核对批次状态为已交接/进行中、确认摘要与内容一致，按批次里的公司次序与岗位顺序冻结执行快照（志愿顺序只在志愿分组内排：分组内多个岗位须有用户给定的不重复正整数顺序，否则 `INVALID_CONFIRMED_ROLE_ORDER`；执行按分组、志愿依次排开，每个岗位带 `preference:{group,rank,bu}`）；任务归属到岗位链接所在站点的目录项。冻结的是用户确认的内容摘要：批次文件因阶段推进被覆盖写（状态、时间）不影响快照，内容被改动则快照失效（`ROLE_INPUT_CHANGED`）。

## 状态

只准备主表状态为 `岗位待投递` 的岗位（批次只收这一种）；`岗位已投递/岗位推进中/岗位offer/岗位终止` 保护并跳过。不确定状态、重复次序、重复岗位或岗位链接不属于该公司已知站点时阻断。

## 执行顺序

1. 以相同私有档案、队列目录、浏览器socket、申请资产目录启动两个MCP；`role_queue_import`先离线接收方案。
2. `role_open({queueId,queueHash,taskId})`按冻结顺序直接打开岗位URL，保留原标签身份、原岗位和目标表单。首次导航不是公司登录首页。
3. 需要登录则返回绑定原岗位的 `loginPlan`；调用 `login_prepare`、按已授权声明处理、请求一次当前短信；图形验证及本人操作交用户。
4. 用户完成后 `role_resume` 在原标签返回原岗位，核对账号、完整URL及标题，返回 `ready_to_fill` 才能继续。
5. `role_prepare` 核对同一任务→全部字段离线编译→填写→独立只读核验；新增问题强制登记私有JSON。`role_verify`可额外核验；`role_screenshot`保存原标签截图并遮盖密码/短信码。
6. 返回 `ready_for_user_review` 后交用户校验；该岗位准备完成才可开始顺序中的下一岗位。当前不提供最终提交操作。

岗位详情与表单不同可使用上游已核实的 `applyUrl/apply_url`；对应公司进入方式必须已建库，缺少则报 `ROLE_ENTRY_RECIPE_REQUIRED`，不拼接链接。登录后首页不等于返回原岗位。公司 `login_open` 只供内部调试。

正常运行用MCP管理的独立Chrome，两个MCP重启仍复用broker。不读取日常Chrome调试端口，不运行REA，不自动重启或重连。重新计时用新的私有浏览器资料目录，从进程启动记总时间，单列人工等待；上轮页面保留。

## 一条脚本运行

在本包目录运行 `node scripts/run-confirmed-roles.mjs`。设置 `RECRUITING_HANDOFF_DIR`、`RECRUITING_PROFILE_JSON`、`RECRUITING_LOGIN_PRIVATE_DIR`、`RECRUITING_PRIVATE_DIR`（已有申请模板）、`RECRUITING_RUN_EVIDENCE_DIR` 和 `RECRUITING_RUN_AUTHORIZATION_FILE`（已有本轮用户授权文件）；可选 `RECRUITING_ROLE_QUEUE_DIR`、`RECRUITING_BROWSER_SOCKET`、`RECRUITING_BROWSER_PROFILE_DIR`。

脚本通过正式 stdio MCP 协议读取已确认的投递批次、打开岗位、准备登录并按授权请求一次短信；到人工步骤暂停。用户在原页面完成后向该进程输入 `resume`，脚本只读确认并恢复原岗位，继续填写及独立核验，保存计时和截图，停在用户校验。`close`只关闭MCP客户端，浏览器/broker保留。人工未完成时不重复发码；错误明确返回，不自动重启浏览器。它不实现Excel处理或最终提交。

## 同账号多岗位并发

上游确认 JSON 可用 `execution={mode:'parallel_roles',authorizationRef:'明确并发授权引用'}` 启用同公司岗位并发；角色次序仅作枚举，跨公司边界仍按确认次序。登录保持账号级独占，一岗登录后其他岗位刷新并核对账号复用；填写用 `roles_prepare_batch`，一次账号租约内按独立 pageId/URL 并发执行。所有计划先编译；任何任务失败后等待其他工作者结束再释放锁。不得用多个 companyId 伪造同公司的并发。

`role_enter_application` 进入申请页并核对后，把真实申请页链接按官方岗位ID写回 `岗位交接/公司/<地区>/<公司>/公司.json` 的 `投递链接`（只写同站点、与岗位页不同的链接，覆盖写）；搜索端 refresh 保留它，下批正向批次带上作为 `applyUrl`。该公司已有覆盖申请页的表单模板时直接打开申请页；还没有时仍从岗位页进入，进入后先建库。`form_assets_status` 按批次列出登录配置、已封存模板和申请页链接的缺口。

`role_enter_application` 只允许从核实的详情页进入申请表，核对岗位标题、同账号和真实返回 URL；在表单页不会点击提交按钮。表单字段仍须各岗位完整建库。运行前已有 broker 时固定本轮实例，连接断开或窗口不明确时返回恢复问题，不能通过另开浏览器试错。

本人操作登录配置可以用 `account.pageUrl` 声明同源的独立身份页。通用详情→申请表入口在进入前后都重新定位唯一的身份页，并精确核对已声明的账号字段；身份页缺失、重复、跨源或账号变化都会阻断。岗位标题与返回路径仍在原岗位标签校验。身份页里的姓名不能代替用户指定登录账号的核实；用户指出账号不对时，原账号核验及应聘记录结论失效，待本人重新登录后再核对。

用户视角计时使用 `RECRUITING_RUN_STARTED_AT` 传入本轮开始时间戳，直到最终结束时间戳，不扣模型思考、修复、人工等待。没有传入时只能声明进程耗时。表单与JSON一致仅证明执行一致性，正式文本仍先对照来源审核；来源备注与待核说明放元数据。

首次显式创建MCP浏览器时设置 `RECRUITING_BROWSER_INITIALIZE=1`；普通执行不设置，已有broker缺失即返回会话选择问题，不自动开第二实例。已连接broker可被两MCP客户端复用，客户端重启不重启浏览器。

原标签身份失效时，role_resume 只可恢复到同一浏览器通道中、URL 与原任务完全一致且唯一的现有页面；恢复后重新核对账号和岗位。不存在或重复时拒绝，不另开页面。

## 声明式通用入口

已有飞书与简历弹窗配方保持兼容。其他已核实的详情页到申请页跳转可用 `entry.kind=declarative_transition`，合同与实际证据要求见 [声明式入口](declarative-entry.md)。Chrome 和内置浏览器共同执行一个共享驱动；仅观察真实返回页，不构造申请 URL。未采到真实按钮或结果页证据时仍阻断，不以手工填表替代建库。
