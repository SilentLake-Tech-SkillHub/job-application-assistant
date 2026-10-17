# V2 登录 MCP：运行、公司适配与验证

工作区只保留本包作为申请组件源码，部署入口指向同一目录。当前适配为影石手机号登录及三个已核实岗位；抖音登录交用户，图形验证码统一交给用户操作，REA 仅内部维护可选。无 OCR，无申请提交。

## 安装和启动

在本目录运行 `npm ci`。登录服务为 `node scripts/start.mjs login`，申请服务为 `node scripts/start.mjs application`。两个启动器共用 V2 broker。普通调用要求已有明确选定的broker；缺少时返回BROWSER_SESSION_SELECTION_REQUIRED。只有明确初始化新会话时设置RECRUITING_BROWSER_INITIALIZE=1，禁止为排查窗口而自动创建实例；`login_open` 启动 MCP 自己管理的独立 Chrome，使用用户私有目录中的独立浏览器资料。不接入日常 Chrome，不读取其 DevToolsActivePort，不要求开启远程调试或接受连接弹窗。两个 MCP 复用同一浏览器进程；断开后不自动重启。已有浏览器进程及未保存页面须保留；源码清理不代表可以关闭它们。仅内部维护显式设置 `RECRUITING_BROWSER_MODE=cdp` 时才接入已有 Chrome；这种模式可能出现浏览器调试连接授权。

可选 `RECRUITING_BROWSER_PROFILE_DIR` 指定独立浏览器资料目录，默认用户 JSON 同目录下 `.browser-profile/`，严禁指向日常 Chrome 资料目录。共同设置 `RECRUITING_PROFILE_JSON` 指向用户私有 JSON；登录服务另设 `RECRUITING_LOGIN_PRIVATE_DIR`，申请服务另设 `RECRUITING_PRIVATE_DIR`。私有目录不位于此代码包内。`RECRUITING_LOGIN_COMPANY_DIR` 可选，默认 `companies/`，每公司一份 `<companyId>.login.json`。依赖缺失或 broker 不可用时明确报错，不自动改旧版配置。

## 真实调用顺序

内部建库：真实 UI 观察全部方式、区号、声明弹窗 → 编写并校验公司配置 → `login_capture` 强制写入用户 JSON 的 `loginForms` → 实测。

运行：[岗位入口](role-entry.md) `role_queue_import` → `role_open` → 如需登录则使用返回的 `loginPlan` 调用 `login_prepare` / 声明接受 / `login_request_sms` → 用户验证及登录 → `role_resume` 返回原岗位 → `role_prepare` → `role_verify` → 用户校验。`login_open` 仅用于内部调试，不作为正式工作流入口。

相同公司、相同声明内容哈希和用途已有明确接受时，`login_prepare` 默认勾选、读回并复用接受记录，不重复询问。声明变化或撤销时重新处理。验证码使用 `login_verification_inspect` 只读识别，返回 `needs_user_verification` 后交用户操作。用户完成后调用 `login_resume_verification`；仍有验证码则保持等待，消失后必须读到短信倒计时才能进入短信码步骤。没有倒计时返回 `verification_completed_sms_unverified`，不自动重发、不假定发送成功。正式 MCP 和 broker 均不提供滑块拖动入口。短信有效期从实际观察到的短信发送倒计时计算，人工验证码等待时间不计入短信码有效期。

准备遇到已认证同账号直接返回，不发码。登录结果必须同时满足账号匹配与登录表单消失。全部操作通过现有 broker 的真实输入和点击，不调用网站私有登录 API。每次写操作都在引擎内调用 `hooks/login-gate.mjs`，且与申请 MCP 使用相同 origin 锁；不依赖模型记得执行检查。宿主 PreToolUse 的适配安装尚未完成，不能声称该宿主全局 Hook 已启用。

## 数据与产物

公司配置包含定位、类型、区号实际选项、阅读弹窗、验证码限制、账号匹配与状态规则。账号事实从用户 JSON 获取，计划只保存指纹。新的登录字段写进同一 JSON；验证码只存在本次调用内，不写计划、挑战记录、日志或输出。

`plans/` 保存冻结计划；`disclosures/` 保存本次页面实际声明及 Hash；`acceptances/` 保存对应确认依据哈希；`challenges/` 保存发送时间、次数与结果；`runs/` 保存脱敏结果。验证码请求在点击前写尝试记录，未知结果不能自动重发。已知阅读弹窗关闭后必须确认消失；未知弹窗阻断。

## 验证与现有限制

运行 `npm test`。单元测试覆盖状态和失败门禁；SDK 集成测试证明真正 stdio 协议接线，不等于真实短信成功。真实影石证据保存在用户私有工作区，分别记录发码、用户交接、登录读回、连接次数和耗时。

本版支持已建库同账号多个岗位并发准备。文本简历的通用结构化导入、完整申请条款引擎、宿主 Hook 安装以及其他公司适配不在本阶段完成声明中。区号仅实现已捕获的中国大陆路径，其他区号需新增真实选项与账号规范，不猜测。账号掩码只能核实公开可见前后缀，不能唯一证明完整账号身份；不读取 Cookie 或隐藏用户数据。

当前V2运行时在macOS完成真实网站验收，Node运行测试为POSIX环境；Windows尚未适配。旧仓库的Windows CI和V2公开资产检查不代表V2登录/填写运行时已支持Windows。
