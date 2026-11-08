# 独立运行、MCP 接口与数据边界

投递业务核心是 `shared/application-service.mjs`、`login/service.mjs`。输入校验、阶段规则、任务读写、浏览器调用和结果回传都在核心内。`shared/confirmed-runner.mjs` 编排已确认岗位至用户审阅。MCP 适配器只转换工具协议；CLI 连接同一核心。

## 固定入口

- 独立调用：`node scripts/cli.mjs --workspace /absolute/workspace application|login <operation> [input.json]`。`list` 列出操作；JSON 参数文件由调用者提供，业务规则在核心校验。
- 连续准备：`node scripts/run-confirmed-roles.mjs`，读取 `RECRUITING_RUN_AUTHORIZATION_FILE`；输出等待登录或待审阅。`resume` 接续原岗位，`close` 关闭命令行客户端，保留浏览器和核心。
- MCP 接口：`node scripts/start.mjs application|login`。stdio 只承载协议；客户端退出时业务核心继续运行。
- 核心管理：MCP `component_runtime`，或 CLI `runtime`，输入 `{"action":"status|pause|reload|resume|stop"}`。启动在首次连接时完成。`stop` 只停止空闲核心。

## 更新与恢复

公司模板、岗位绑定、主档和交接 JSON 使用现有固定写入入口覆盖后，在下次业务调用直接重读。核心代码更新：暂停新调用，等待正在执行的调用完成，部署代码，执行 `reload`，读回核心 PID、版本和 `runtime_info` 指纹，然后接续原任务。MCP 适配器 PID 保持不变，浏览器独立运行。新核心启动失败时保留旧核心并返回错误，可用 `resume` 恢复旧核心。调用中核心意外退出会返回失败，写操作不自动重放；下一次明确调用重新启动核心。

管理入口返回 adapterPid、hostPid、workerPid、version、active、paused、reloading、lastError。维护状态与业务阶段分别读取。修改 MCP 适配器协议本身是接口部署；普通公司适配及业务核心维修使用上述固定更新入口。

宿主视觉 sampling 通过本次调用的私有 socket 传给核心，CLI 可使用配置的视觉服务。该连接不写进公司模板或任务。没有视觉服务时沿用已确认的附件验收规则。

## 唯一位置与写入责任

| 内容 | 位置 | 固定入口 |
|---|---|---|
| 通用代码、Skill、Hook、测试 | 组件源码仓库 | 授权维护、Git |
| 公司/站点/岗位主数据及登录配置 | 工作区 `岗位交接/工作簿全量.json` | 搜索固定脚本 |
| 已确认投递输入 | `岗位交接/公司/<公司编码>.json` | company_store.py |
| 个人事实 | `产品管理/网申个人信息主档.json` | profile 模块 |
| 公司公共控件与岗位绑定 | `.runtime/application/templates/<公司编码>.json` | 建库固定操作 |
| 草稿、计划、核验、当前执行状态 | `.runtime/application`、`.runtime/login`、`.runtime/role-queue` | Store、TaskRecords、RoleQueue |
| 浏览器能力 | `.runtime/browser-capability.json` | 能力配置入口 |
| 投递结果 | `岗位交接/投递回传.json` | application_closeout |
| 依赖缓存及安装/分发 | 部署选定位置 | 安装脚本生成并读回 |

`shared/runtime-paths.mjs` 是 CLI、MCP、核心启动的路径入口；私有数据禁止落入组件源码目录。工作区、宿主身份、宿主职责共同定位运行核心。独立入口继承部署角色，维护角色仍只调只读业务检查。批次确认、个人资料来源与提交授权由核心检查。

任务记录按公司/岗位/操作覆盖。开发 MCP 客户端只输出结果，不额外存逐次文件；连续执行入口只保留当前编排状态。清理旧资料先按当前文件引用闭包核对，再删除已替代且无引用的文件，Git 保留回滚。
