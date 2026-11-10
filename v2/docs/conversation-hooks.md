# 投递 Hook 与执行身份

任意对话可以直接调用登录、申请 MCP 或固定 CLI。第一个阶段调用校验指令和短路由的 Hash，按需注入流程，然后进入组件。对话 ID 和回合 ID 仅用于记录本轮提示和接续结果。宿主事件缺少这些字段时，仍可执行经组件校验的阶段调用。

Agent 编码与组标识来自宿主部署和已有注册簿。分支保存独立对话历史，同一 Agent 或 Agent 组沿用稳定执行身份。组成员各自保留编码。内置浏览器桥使用真实浏览器标识及稳定执行主体；实际目标页仍由岗位、原标签及文档代际验证。

`hooks/workflow_hook.py` 通过 `RECRUITING_WORKSPACE_ROOT`、`RECRUITING_WORKFLOW_POLICY`、`RECRUITING_WORKFLOW_LOCK`、`RECRUITING_WORKFLOW_SCOPE` 和 `RECRUITING_WORKFLOW_STATE` 接收部署路径。启用预加载的对话受组件固定入口约束。所有投递操作都使用组件入口。维护宿主由其部署角色限制为只读检查。CLI 和 MCP 的共同执行入口逐请求校验实际接口和核心版本，`runtime_info` 用于诊断与发布读回。

## 对话提示设置

可选启用预加载，使选定对话在回合开始时收到投递路由。登记有效期固定 12 小时，重复启用不续期。新对话可直接调用组件；需要预加载时，可单独设置。

```sh
python3 hooks/conversation_scope.py enable --scope-file <private-scope.json> --policy-file <accepted-policy.md> --authorization-ref <user-request-reference>
python3 hooks/conversation_scope.py disable --scope-file <private-scope.json>
```

提示设置只使用宿主提供的当前对话 ID。停用只移除本对话的预加载设置；下一次阶段调用仍按实际组件流程执行。组件软锁、执行宿主角色及岗位授权由各自来源决定。

## DSH 驻留宿主验收

配置文件里写有插件名不等于运行成功。先用宿主的 `pluginInventory.list` 核对目标 Hook 插件 `enabled=true` 且 `fiberPhase=active`；仅 enabled 而 phase 为空时检查正式插件管理接口的实际加载错误。插件包必须能从该 profile 解析；开发安装可用已存在、已核实本机入口的 file URL，不能用另一个宿主或新浏览器代替修复。通过宿主插件管理接口重载目标插件后，读回状态。

随后在原对话和新对话调用实际业务入口，验证 PreToolUse、PostToolUse 和 continuation 文件。错误响应可能由宿主包装为 `Error: {JSON}`，仍必须保留技术待办。每个阶段的 pending 在 SDK 校验之前登记；参数失败不能使 Stop 静默放行。只有组件已核实的用户等待、完整审阅或技术交接允许结束。代码维护/纯查询无需伪造投递回执。

真实日志没有 Hook 事件时，应先确认插件实际加载；不能仅根据会话恢复时间推断是 resumed-agent 接线故障。宿主重载和 MCP 子进程重载分别核实，保持原浏览器、原页面及未保存内容。

## 纯文字工具与文件参数

哪些宿主工具只传文字（待办、提问、发消息）、哪些参数名表示文件，只在 `hooks/tool-arguments.json` 定义一次。本包 `hooks/workflow_hook.py` 与工作区搜索组件的数据保护、组件软锁 Hook 都读这一份：纯文字工具只有在参数任意层级都没有文件参数时才按纯文字放行，带任何文件参数就按文件操作检查。文件缺失或无法解析时不放行任何纯文字工具。新增宿主工具名或文件参数名只改这个文件。
