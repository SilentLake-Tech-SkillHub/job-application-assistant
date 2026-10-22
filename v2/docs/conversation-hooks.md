# 对话级 Hook 作用域

Hook 可以由宿主在用户或项目配置中发现，但工作流的启用范围必须是对话，不能是 cwd、工作区或公司。未注册的对话在读取流程、核对 Hash 或回执前立即返回，不注入申请规则、不拦截读取 Skill、状态登记或其他工具。

启用由当前 SKILL 的宿主执行器调用 `hooks/conversation_scope.py enable`。脚本仅读取宿主提供的 `CODEX_THREAD_ID` / `CODEX_SESSION_ID` / `DSH_SESSION_ID`，不接受模型指定另一个对话 ID；缺失或冲突时拒绝注册。`DSH_SESSION_ID` 与 DSH Hook payload 的 `session_id` 同源，因此加载回执可按同一对话匹配。参数为私有 scope 文件、用户已确认指令文件及授权依据。私有目录路径由安装端传入，产品代码不写死用户路径或对话 ID。

```sh
python3 hooks/conversation_scope.py enable --scope-file <private-scope.json> --policy-file <accepted-policy.md> --authorization-ref <user-request-reference>
python3 hooks/conversation_scope.py disable --scope-file <private-scope.json>
```

重复启用同一对话幂等；其他对话的记录保留。停用仅移除当前对话，不删除其他对话、表单或业务状态。新会话与 fork 默认未启用；确需继承时由用户明确启动，不能仅因目录相同自动继承。已获准的子 Agent 是否共享作用域，按宿主事件的真实父对话身份核验，不启动额外 Agent 作为默认要求。

加载回执至少绑定对话 ID、回合 ID、指令 Hash。对话间不得复用回执。Hook 负责注入和回执检查，填写前的建库／映射／冻结等事实由 MCP 内部阶段门禁验证；加载成功不代表业务准备完成。

验收覆盖：A 启用而 B 不受影响；A/B 可独立启停；fork 不默认继承；当前对话身份缺失或冲突不写状态。宿主实际触发及工具阻断另行验证，不能只凭脚本单元测试宣称全链路生效。速度目标不变，不引入逐动作串行模型审批。

## 修复后的职责

`hooks/route.md` 仅列具体 Skill/MCP 调用顺序及 IF 复用分支；详细规则按需读取。`hooks/workflow_hook.py` 是可部署的宿主入口，通过 `RECRUITING_WORKSPACE_ROOT`、`RECRUITING_WORKFLOW_POLICY`、`RECRUITING_WORKFLOW_LOCK`、`RECRUITING_WORKFLOW_SCOPE` 和 `RECRUITING_WORKFLOW_STATE` 接收私有路径，公开代码不写入用户或对话标识。锁同时绑定详细依据与短路由的 Hash。

前置 Hook 只检查申请写入，不阻断源码修复、读取和状态查询。当前已启用的 V2 对话不得误调旧 recruiting-form 写入；其他对话仍不受影响。真正的顺序依据由 MCP 的 `workflow_next`、资产覆盖声明、问题映射、冻结方案和读回证据决定，Hook 不把提示词加载当成业务完成，也不直接调度模型回合。

启动时读取两模块的 `runtime_info`，核对实际代码版本；IAB 仍通过活跃宿主执行上下文中的 `withHostBrowserBridge` 运行，缺少桥接时明确返回阻塞，禁止退回 Chrome。MCP 配置写入不代表当前进程已重载。
