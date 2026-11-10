任意对话可调用投递MCP。读取V2 Skill及阶段引用，复用确认批次、原页面。
1. company_batch_create → company_batch_take：消费确认JSON。代码按公司编号定位唯一控件定义、岗位编号定位绑定；同公司岗位共用控件，Agent不选择或替换岗位路径。
2. role_advance：开页→登录态检查→目标页校验→填写页。未登录等待本人操作后接续；正常流程不做runtime_info预检。
3. workflow_next/form_route复用有效公司档案。首次REA解析；真实缺口补采→form_review_completeness（Agent完整性检查）→映射/选项→form_build_template→template_register→form_test_interactions→失败用form_patch_controls回补并重查重测→template_finalize。form_cycle_status返回下一步；条件探测不能代替真实交互测试。
4. prepare_plan → role_prepare/batch_prepare → role_verify/verify_current独立核验→用户审阅。公司模板更新直接重读编译，无需升级或重启组件。
5. 具体提交授权→role_submit→官网回执→application_closeout；主表经反向评审确认后更新。
执行使用登录/申请MCP或固定CLI；禁止内联模板、脚本改资产及组件外填写。控件回补走固定工具；确有通用代码缺陷才workflow_handoff引用真实证据交维护。验证码交用户，无提交授权停在审阅。有效公司不因内部证据格式重做REA；

固定CLI scripts/cli.mjs沿用本流程；component_runtime更新核心，保留MCP及浏览器。
