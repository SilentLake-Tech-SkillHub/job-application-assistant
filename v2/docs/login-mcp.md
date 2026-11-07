# V2 登录 MCP：运行、公司适配与验证

工作区只保留本包作为申请组件源码，部署入口指向同一目录。当前适配为影石手机号登录及三个已核实岗位；抖音登录交用户，图形验证码统一交给用户操作，REA 仅内部维护可选。不识别或代解验证码；登录工具不提交申请。

## 安装和启动

在本目录运行 `npm ci`，入口为 `node scripts/start.mjs login|application`。启动先只读检查真实宿主与 Chrome 配置，再核验已选 broker 的实际身份；缺浏览器仍提供只读运行能力，网站阶段明确报告缺口。浏览器分流政策仅见工作区 `产品管理/求职配置.md`，本文件不另定义默认浏览器。真实宿主内置浏览器及 Chrome 插件通过可信 SDK 桥注册；Playwright 专用 Chrome 是独立类型，不能命名为 IAB。没有明确初始化权限时不启动浏览器。保留既有页面，按原会话及真实页面ID恢复。

`RECRUITING_PROFILE_JSON` 指向私有主档，登录及申请私有运行目录分别为 `RECRUITING_LOGIN_PRIVATE_DIR`、`RECRUITING_PRIVATE_DIR`。公司资产只从 `RECRUITING_HANDOFF_DIR` 当前公司宽表读取；不恢复旧 `companies/` 目录。配置与完整验收说明见[宿主接线](host-integration.md)。

## 真实调用顺序

内部建库：真实 UI 观察全部方式、区号、声明弹窗 → 编写并校验公司配置 → `login_capture` 强制写入用户 JSON 的 `loginForms` → 实测。

运行：[岗位入口](role-entry.md) `role_queue_import` → `role_open` → 如需登录则使用返回的 `loginPlan` 调用 `login_prepare` / 声明接受 / `login_request_sms` → 用户验证及登录 → `role_resume` 返回原岗位 → `role_prepare` → `role_verify` → 用户校验。`login_open` 仅用于内部调试，不作为正式工作流入口。

登录同意框只看[持久业务授权](generic-form-pipeline.md#持久业务授权)的单一开关：为 1 时 `login_prepare` 直接勾选并读回，不打开声明全文，不按公司、声明文字或会话重新确认；为 0 或未设定时组件不勾，返回 `needs_user_login`，用户在同一标签完成登录后调用 `role_resume`。验证码使用 `login_verification_inspect` 只读识别，返回 `needs_user_verification` 后交用户操作。用户完成后调用 `login_resume_verification`；仍有验证码则保持等待，消失后必须读到短信倒计时才能进入短信码步骤。没有倒计时返回 `verification_completed_sms_unverified`，不自动重发、不假定发送成功。正式 MCP 和 broker 均不提供滑块拖动入口。短信有效期从实际观察到的短信发送倒计时计算，人工验证码等待时间不计入短信码有效期。

准备遇到有效登录态直接返回，不发码。登录结果由当前网站的正向登录证据和登录界面状态确定。全部操作通过现有 broker 的真实输入和点击，不调用网站私有登录 API。每次写操作都在引擎内调用 `hooks/login-gate.mjs`，且与申请 MCP 使用相同 origin 锁；不依赖模型记得执行检查。宿主 PreToolUse 的适配安装尚未完成，不能声称该宿主全局 Hook 已启用。

## 数据与产物

公司配置包含定位、类型、区号实际选项、阅读弹窗、验证码限制、登录态观察规则。自动手机号登录的输入来自用户 JSON，计划只保存输入指纹；本人登录不要求主档账号事实。新的登录字段写进同一 JSON；验证码只存在本次调用内，不写计划、挑战记录、日志或输出。

`plans/` 保存冻结计划；`disclosures/` 保存本次页面实际声明及 Hash；`acceptances/` 保存对应确认依据哈希；`challenges/` 保存发送时间、次数与结果；`runs/` 保存脱敏结果。验证码请求在点击前写尝试记录，未知结果不能自动重发。已知阅读弹窗关闭后必须确认消失；未知弹窗阻断。

## 验证与现有限制

运行 `npm test`。单元测试覆盖状态和失败门禁；SDK 集成测试证明真正 stdio 协议接线，不等于真实短信成功。真实影石证据保存在用户私有工作区，分别记录发码、用户交接、登录读回、连接次数和耗时。

本版支持已建库同账号多个岗位并发准备。文本简历的通用结构化导入、完整申请条款引擎、宿主 Hook 安装以及其他公司适配不在本阶段完成声明中。区号仅实现已捕获的中国大陆路径，其他区号需新增真实选项与账号规范，不猜测。账号掩码只能核实公开可见前后缀，不能唯一证明完整账号身份；不读取 Cookie 或隐藏用户数据。

当前V2运行时在macOS完成真实网站验收，Node运行测试为POSIX环境；Windows尚未适配。旧仓库的Windows CI和V2公开资产检查不代表V2登录/填写运行时已支持Windows。
