# 公司方案 JSON 消费接口

## 职责边界

上游提供已确认的公司方案 JSON。入口直接消费它，不负责选岗阶段的 Excel→JSON 转换；投递结果收尾由 MCP 内部按固定事件同步 Excel 和 JSON，详见 application-outcome.md。没有特殊的测试专用输入分支。`readCompanyPlan` 是独立输入适配接口，现支持本机 JSON 文件和直接 JSON 对象，后续可替换为上游服务适配器。

`role_queue_import` 参数二选一：`{rolesFile}` 或 `{companyPlan}`。可用 `companyOrder` 传入本批已经确认的公司顺序。只验证上游JSON自身的确认标记/引用、版本、最终选岗、次序、URL范围和已投状态，然后保存冻结执行快照。它不会自行确认方案，不把 Agent 推荐当用户选择。

## JSON 契约

原生格式：`schemaVersion=1`、`batchId`、`version`、`confirmation={status:'confirmed',reference:'上游确认记录引用'}`、`companies`。公司包含 `companyId,order,roles`；角色包含 `id,title,url,selected,order,applicationStatus`，`applyUrl`可选且必须是上游已核实链接。同公司按岗位 `order`；多公司按明确的公司 `order` 或 `companyOrder`，不得按数组位置猜次序。`roleId`可代替`id`；本地键必须注明，不能冒充官网岗位ID。

兼容旧公司方案 JSON：`schema_version=1,batch_id,companies`，消费每公司的 `version/confirmed_at/confirmation_ref/confirmed_digest` 作为上游确认声明；不重新检查或转换工作簿。公司身份可由已建库的唯一官网origin映射；读取 `selected/order/url` 和已提供的 `applicationStatus` 或 `existing_data` 中的投递状态。上游对其确认和同步真实性负责。

只准备 `待投递/not_submitted`；`已提交/submitted/receipt_verified` 保护并跳过；不确定状态、重复次序、重复岗位或不匹配公司URL阻断。输入文件变化后冻结快照失效；对象输入保留收到的版本和内容Hash，不能凭本地快照推断远端方案一直未变，新版方案应重新传入。

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

在本包目录运行 `node scripts/run-confirmed-roles.mjs <公司方案JSON路径>`。设置 `RECRUITING_PROFILE_JSON`、`RECRUITING_LOGIN_PRIVATE_DIR`、`RECRUITING_PRIVATE_DIR`（已有申请模板）、`RECRUITING_RUN_EVIDENCE_DIR` 和 `RECRUITING_RUN_AUTHORIZATION_FILE`（已有本轮用户授权文件）；可选 `RECRUITING_ROLE_QUEUE_DIR`、`RECRUITING_BROWSER_SOCKET`、`RECRUITING_BROWSER_PROFILE_DIR`。

脚本通过正式 stdio MCP 协议接收JSON、打开岗位、准备登录并按授权请求一次短信；到人工步骤暂停。用户在原页面完成后向该进程输入 `resume`，脚本只读确认并恢复原岗位，继续填写及独立核验，保存计时和截图，停在用户校验。`close`只关闭MCP客户端，浏览器/broker保留。人工未完成时不重复发码；错误明确返回，不自动重启浏览器。它不实现Excel处理或最终提交。

## 同账号多岗位并发

上游确认 JSON 可用 `execution={mode:'parallel_roles',authorizationRef:'明确并发授权引用'}` 启用同公司岗位并发；角色次序仅作枚举，跨公司边界仍按确认次序。登录保持账号级独占，一岗登录后其他岗位刷新并核对账号复用；填写用 `roles_prepare_batch`，一次账号租约内按独立 pageId/URL 并发执行。所有计划先编译；任何任务失败后等待其他工作者结束再释放锁。不得用多个 companyId 伪造同公司的并发。

`role_enter_application` 只允许从核实的详情页进入申请表，核对岗位标题、同账号和真实返回 URL；在表单页不会点击提交按钮。表单字段仍须各岗位完整建库。运行前已有 broker 时固定本轮实例，连接断开或窗口不明确时返回恢复问题，不能通过另开浏览器试错。

用户视角计时使用 `RECRUITING_RUN_STARTED_AT` 传入本轮开始时间戳，直到最终结束时间戳，不扣模型思考、修复、人工等待。没有传入时只能声明进程耗时。表单与JSON一致仅证明执行一致性，正式文本仍先对照来源审核；来源备注与待核说明放元数据。

首次显式创建MCP浏览器时设置 `RECRUITING_BROWSER_INITIALIZE=1`；普通执行不设置，已有broker缺失即返回会话选择问题，不自动开第二实例。已连接broker可被两MCP客户端复用，客户端重启不重启浏览器。
