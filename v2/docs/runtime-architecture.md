# 独立运行、MCP 接口与数据边界

投递业务核心是 `shared/application-service.mjs`、`login/service.mjs`。输入校验、阶段规则、任务读写、浏览器调用和结果回传都在核心内。`shared/confirmed-runner.mjs` 编排已确认岗位至用户审阅。MCP 适配器只转换工具协议；CLI 连接同一核心。

## 固定入口

- 独立调用：`node scripts/cli.mjs --workspace /absolute/workspace application|login <operation> [input.json]`。`list` 列出操作；JSON 参数文件由调用者提供，业务规则在核心校验。
- 连续准备：`node scripts/run-confirmed-roles.mjs`，读取 `RECRUITING_RUN_AUTHORIZATION_FILE`；输出等待登录或待审阅。`resume` 接续原岗位，`close` 关闭命令行客户端，保留浏览器和核心。
- MCP 接口：`node scripts/start.mjs application|login`。stdio 只承载协议；客户端退出时业务核心继续运行。
- 核心管理：MCP `component_runtime`，或 CLI `runtime`，输入 `{"action":"status|pause|reload|update|resume|stop"}`。启动在首次连接时完成。`stop` 只停止空闲核心。

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

## CLI/MCP 版本一致

用户允许保留两种调用方式，要求两端保持当前部署版本一致。业务调用前比较已安装版本、通用代码指纹、核心实际加载指纹，以及接口进程加载的适配器代码。业务核心落后且空闲时自动更新并再次比对；正在执行、已暂停、更新失败或仍不一致时返回明确错误，当前业务请求不执行。

接口代码本身改变时返回 INTERFACE_CODE_STALE，需重连受影响的 MCP 接口；核心管理诊断仍可用。旧接口的诊断结果由 Hook 记录，已启用执行会话中的旧版本业务调用被 MCP_RUNTIME_VERSION_MISMATCH 拦截。首次连接或连接变化时用 runtime_info 读取真实身份，后续按同一连接记录检查。版本检查使用本地当前安装版本，不自动升级到远端未部署代码；公司模板和个人数据不参与代码指纹。

## 同一对话更新闭环

固定MCP通信层经interface-call将每次请求交给新加载的interface-worker，连续运行CLI编排也使用同一入口。更新管理处于业务程序之外。component_runtime update等待操作结束、切换当前已安装程序并校验版本/指纹后返回verified；随后调用原任务继续。管理程序本身变化也按指纹检查并在空闲时替换。独立CLI与MCP共用同一个核心。

验收覆盖：同一MCP客户端连接保持不变，连续更新业务、接口调度和管理程序，CLI读回一致；持久化taskId/pageId不变、步骤继续递增；新程序启动失败不推进任务，修复后更新并接续。

## 宿主现有连接的后台更新

`node scripts/update-runtime.mjs --preview` 从当前调用进程的祖先链定位实际执行宿主，只列出该宿主直接管理、本组件目录内的登录/申请进程。正式执行去掉 `--preview`：旧版接口利用Node本机调试接口发现旧SDK服务，检查请求空闲后，在原stdin/stdout管道内交接新版；进程和宿主连接保留。已接入新版的接口直接完成核心update和版本核验。Agent随后用当前聊天里的runtime_info与CLI读回同一版本，再接续原任务。

调试接口只在本机短时开启，先核对PID及组件启动命令；端口被占用时拒绝，不连接其他服务。完成或失败后关闭本次开启的调试接口。旧SDK请求仍在执行时拒绝交接；新适配器加载失败时恢复旧监听。该兼容桥限定当前已测试的Node与SDK接口，入口不执行网页业务、不改变部署权限。未来更新继续使用同一组件命令和component_runtime，不需要用户另行提出宿主重连事项。
