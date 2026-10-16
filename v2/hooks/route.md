仅对当前已启用对话执行。加载 job-application-assistant-v2，按现有批次状态续跑以下调用链：
1. company_batch_create → company_batch_take：从已确认岗位 JSON 取公司并切分 Chrome / 内置浏览器。
2. role_open；需要登录才调用 login_compile → login_prepare，用户完成验证后 role_resume → role_enter_application，保留原岗位和实例。
3. workflow_next / form_route：可用公司表单 → 本地映射与 prepare_plan；缺失或失效 → capture_controls → 选项/分支增量建库 → template_register，再 prepare_plan。
4. 冻结计划通过 → batch_prepare / roles_prepare_batch → verify_current / role_verify → 用户校验。
5. 仅获具体提交授权后按志愿顺序提交；application_closeout 在 MCP 内核验结果、固定状态并同步 JSON/Excel。
执行门禁在 MCP 内检查真实证据；缺失不跳步，代码维护与只读操作不拦截。验证码交用户，正常运行不用 REA，无具体提交授权则停在用户核对。详细规则按需读取已登记模块引用。
