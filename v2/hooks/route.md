仅对已启用对话执行，加载当前V2 Skill及阶段引用，复用已确认批次和原页面。
1. company_batch_create → company_batch_take：消费确认JSON，按冻结通道派发；formAssets缺模板先建库。
2. role_open → 按需login_compile/login_prepare → 用户验证 → role_resume → role_enter_application；不改岗位和实例。
3. workflow_next/form_route：完整证据链有效才复用。缺失或失效：有官网定义先capture_form_definition，再capture_rea_structure（原页REA、DOM/AX和脚本）→ form_mapping_candidates/profile_map_questions → 选项与条件采集 → form_build_template → template_register(draftId,draftHash) → probe_conditions → template_finalize。
4. prepare_plan校验冻结 → batch_prepare/roles_prepare_batch → verify_current/role_verify独立核验 → 用户审阅。
5. 具体提交授权 → role_submit → 官网回执 → application_closeout；主表经反向评审确认后更新。
执行宿主只用登录/申请MCP，维护宿主只修插件。禁止内联模板、脚本改资产和插件外逐元素操作；失败用workflow_handoff引用runId/failureEvidenceId交回修复，再由执行宿主实测。验证码交用户；未获提交授权停在审阅。有效资产复用不重复REA，证据缺失回建库。
