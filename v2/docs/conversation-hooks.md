# 对话级 Hook 作用域

Hook 可以由宿主在用户或项目配置中发现，但工作流的启用范围必须是对话，不能是 cwd、工作区或公司。未注册的对话在读取流程、核对 Hash 或回执前立即返回，不注入申请规则、不拦截读取 Skill、状态登记或其他工具。

启用由当前 SKILL 的宿主执行器调用 `hooks/conversation_scope.py enable`。脚本仅读取宿主提供的 `CODEX_THREAD_ID` / `CODEX_SESSION_ID` / `DSH_SESSION_ID`，不接受模型指定另一个对话 ID；缺失或冲突时拒绝注册。`DSH_SESSION_ID` 与 DSH Hook payload 的 `session_id` 同源，因此加载回执可按同一对话匹配。参数为私有 scope 文件、用户已确认指令文件及授权依据。私有目录路径由安装端传入，产品代码不写死用户路径或对话 ID。

```sh
python3 hooks/conversation_scope.py enable --scope-file <private-scope.json> --policy-file <accepted-policy.md> --authorization-ref <user-request-reference>
python3 hooks/conversation_scope.py disable --scope-file <private-scope.json>
```

宿主接线以 `RECRUITING_HOST_ROLE` 声明角色：`executor`（默认）或 `maintainer`。维护宿主（例如只修代码的 Codex）调用 `enable` 一律拒绝（`HOST_ROLE_MAINTAINER_CANNOT_ENABLE_EXECUTION`），`disable` 仍可用于清理自己的旧登记；两个 MCP 在维护宿主下只回答只读检查，所有阶段工具在执行前返回 `HOST_ROLE_MAINTAINER_READ_ONLY` 并停止续跑，启动器不启动或附着浏览器。

重复启用同一对话幂等；其他对话的记录保留。停用仅移除当前对话，不删除其他对话、表单或业务状态。新会话与 fork 默认未启用；确需继承时由用户明确启动，不能仅因目录相同自动继承。已获准的子 Agent 是否共享作用域，按宿主事件的真实父对话身份核验，不启动额外 Agent 作为默认要求。

加载回执至少绑定对话 ID、回合 ID、指令 Hash。对话间不得复用回执。Hook 负责注入和回执检查，填写前的建库／映射／冻结等事实由 MCP 内部阶段门禁验证；加载成功不代表业务准备完成。

验收覆盖：A 启用而 B 不受影响；A/B 可独立启停；fork 不默认继承；当前对话身份缺失或冲突不写状态。宿主实际触发及工具阻断另行验证，不能只凭脚本单元测试宣称全链路生效。速度目标不变，不引入逐动作串行模型审批。

## 修复后的职责

`hooks/route.md` 仅列具体 Skill/MCP 调用顺序及 IF 复用分支；详细规则按需读取。`hooks/workflow_hook.py` 是可部署的宿主入口，通过 `RECRUITING_WORKSPACE_ROOT`、`RECRUITING_WORKFLOW_POLICY`、`RECRUITING_WORKFLOW_LOCK`、`RECRUITING_WORKFLOW_SCOPE` 和 `RECRUITING_WORKFLOW_STATE` 接收私有路径，公开代码不写入用户或对话标识。锁同时绑定详细依据与短路由的 Hash。

前置 Hook 只检查申请写入，不阻断源码修复、读取和状态查询。当前已启用的 V2 对话不得误调旧 recruiting-form 写入；其他对话仍不受影响。真正的顺序依据由 MCP 的 `workflow_next`、资产覆盖声明、问题映射、冻结方案和读回证据决定，Hook 不把提示词加载当成业务完成，也不直接调度模型回合。

启动时读取两模块的 `runtime_info`，核对实际代码版本；IAB 仍通过活跃宿主执行上下文中的 `withHostBrowserBridge` 运行，缺少桥接时明确返回阻塞，禁止退回 Chrome。MCP 配置写入不代表当前进程已重载。

## DSH 驻留宿主验收

配置文件里写有插件名不等于运行成功。先用宿主的 `pluginInventory.list` 核对目标 Hook 插件 `enabled=true` 且 `fiberPhase=active`；仅 enabled 而 phase 为空时检查正式插件管理接口的实际加载错误。插件包必须能从该 profile 解析；开发安装可用已存在、已核实本机入口的 file URL，不能用另一个宿主或新浏览器代替修复。通过宿主插件管理接口重载目标插件后，读回状态。

随后由执行 Agent 在自己的宿主上下文调用作用域 enable，并在同一真实会话验证 UserPromptSubmit、PreToolUse、PostToolUse 和 continuation 文件。错误响应可能由宿主包装为 `Error: {JSON}`，仍必须保留技术待办。每个阶段的 pending 在 SDK 校验之前登记；参数失败不能使 Stop 静默放行。只有组件已核实的用户等待、完整审阅或技术交接允许结束。代码维护/纯查询无需伪造投递回执。

真实日志没有 Hook 事件时，应先确认插件实际加载；不能仅根据会话恢复时间推断是 resumed-agent 接线故障。宿主重载和 MCP 子进程重载分别核实，保持原浏览器、原页面及未保存内容。
