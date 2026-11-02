# 宿主接线与真实能力

浏览器政策只读取工作区 `产品管理/求职配置.md`。本文件描述实现，不定义第二套默认通道或授权。

## 宿主职责：由部署配置决定

每个用户或项目可以只使用一个执行宿主，也可以把执行、维护分配给不同宿主。Agent 品牌不决定权限：任一已适配宿主均可配置为 `executor` 或 `maintainer`；适配器只描述接入方式与能力，不分配业务职责。角色配置不能替代真实浏览器能力、当前会话身份、任务绑定或用户提交授权。

每个宿主的部署配置是其 `RECRUITING_HOST_ROLE` 的唯一配置来源；MCP、Hook 和 shell 必须获得相同值。新安装未指定角色时为 `executor`，已有部署重新安装时保留已配置角色；有冲突就报告并要求明确选择，不能静默覆盖。项目说明只引用这份配置，不另写按品牌分工的规则。Agent 不得为绕过拒绝自行改变角色。

启动子宿主时，由安装或启动接线清除从父宿主继承的角色与会话标识，再显式注入目标宿主的配置和真实会话身份；不能通过假造 ID 或移除限制来临场提权。单宿主维护时，先暂停执行并用 `conversation_scope.py disable` 退出当前执行作用域，按用户的组件维护授权修复；恢复时重新启用作用域并核验运行版本。若用户确需改变部署角色，更新接线、重载受影响进程后读回；不要求另装第二个 Agent。

## Chrome 通道：专用 Chrome 分身

Chrome 通道固定是组件自己的 Chrome 分身（`shared/chrome-clone.mjs`）：本机已安装的 Google Chrome，以固定私有资料目录 `RECRUITING_BROWSER_PROFILE_DIR`（工作区 `.runtime/chrome-profile`）和本机调试端口 `RECRUITING_BROWSER_CDP_PORT`（默认 9333，只监听 127.0.0.1）启动；可见窗口、允许扩展，不带 `--disable-extensions`、`--enable-automation` 或无头参数。所有执行端连同一个分身：登录状态保存在资料目录，换执行端或重启 MCP 不丢；用户或 computer use 可以直接操作这个窗口处理边缘场景。日常 Chrome 不受影响：资料目录不能是日常 Chrome 目录（Chrome 136 起默认目录本来也不能开调试端口），组件不连接、不读取日常 Chrome 及其插件。

- 唯一启动入口：`node scripts/chrome-clone.mjs start`（已在运行直接返回，不开第二个）；或经 `browser_initialize_chrome` / `browser_restore_chrome` 由 broker 调用同一启动函数。分身以独立进程启动，不随 broker 或宿主退出。
- 状态：`node scripts/chrome-clone.mjs status` 返回 `running` / `stopped` / `running_without_cdp`（资料目录被一个没开调试端口的 Chrome 占用，先退出它）/ `port_taken`（端口被别的进程占用）。
- broker 以 `cdp` 模式经 Playwright `connectOverCDP` 连接；每次连接核对资料目录：分身不带 `--enable-automation`，`Browser.getBrowserCommandLine` 不可用，改用 `SystemInfo.getProcessInfo` 取浏览器自己的进程号，再在本机进程列表里核对该进程的 `--user-data-dir` 等于记录的资料目录（进程列表读不到时，退到资料目录里的 `DevToolsActivePort` 必须写着本端口和当前浏览器编号）；不符即 `BROWSER_PROFILE_IDENTITY_MISMATCH`。Playwright 只做连接，从不启动这个 Chrome。
- 执行端的资料目录或端口与能力文件记录不一致时，启动返回 `CHROME_CLONE_CONFIG_MISMATCH` 且不建 Chrome broker，不会出现第二个 Chrome。

## 执行端适配器

`host/adapters/<执行端>.mjs` 每个执行端一份（codex、claude-code、antigravity、kimi-code、zcode、dsh），只回答“这个执行端能把什么交给组件”：MCP 注册配置的位置和格式、有没有内置浏览器、内置浏览器是否对组件代码开放（`code`）、只给模型用（`agent_only`）还是尚未核实（`unverified`）、是否支持 MCP sampling。适配器只描述内置浏览器；Chrome 通道在所有执行端都是同一个分身，日常 Chrome 里的插件不属于投递流程，适配器不描述。适配器不做分流决定；分流规则只读能力文件。`agent_only` 和 `unverified` 不做探测，直接记为不可加载（`node scripts/browser-capability.mjs detect` 即可写入）；只有 `code` 才在执行端内用 `detectHostBrowsers` 跑三步检测。新增执行端只加一个适配器文件，并把公开或实测证据写在 `evidence` 里。

MCP 注册由 `node scripts/install-host.mjs --host <id> --workspace <工作区绝对路径> [--role executor|maintainer]` 生成：所有执行端写入同一个能力文件路径、同一个分身资料目录和端口，只有 `RECRUITING_HOST_ID`、`RECRUITING_HOST_ROLE` 不同，并删除不再使用的 `RECRUITING_BROWSER_MODE`、`RECRUITING_BROWSER_INITIALIZE` 等键。工作区内的配置加 `--write` 直接写；用户目录下的配置先看预览和当前 sha256，`--write --expect-sha <sha>` 才写；YAML（DSH）只出预览，按实际结构人工粘贴；已有 recruiting 条目的 YAML 必须显式传 `--role`，不猜测已有插件树的角色。

Codex 适配器会将所选角色同时写入两个 MCP 与 `shell_environment_policy.set.RECRUITING_HOST_ROLE`，保留其他 shell 设置。其他适配器会返回 `shellEnvironment`，由对应宿主的安装/启动接线传给 Hook 和 shell；仅改 MCP 环境不算安装完成。输出的 `roleSource` 区分本次显式选择、保留已有配置与新安装默认值。

迁移到新机器时，按目标工作区、Node 路径和用户选择重新生成配置，再重新核验浏览器能力。复制旧配置会保留旧分工及绝对路径，不能当作通用产品默认安装。安装预览和文件写入都不证明驻留 MCP/Hook 已重载；两个 MCP 的 `runtime_info.runtime.hostId/hostRole` 返回进程启动时实际加载的身份与角色，用于重载后的核对。

## 浏览器能力：一次检测，写入文件

结果写入 `RECRUITING_BROWSER_CAPABILITY_FILE`（私有，schemaVersion 2）。`chrome` 是全机一条分身记录（路径、版本、资料目录、端口、连接地址、启动入口）；`hosts.<RECRUITING_HOST_ID>.iab` 是各执行端的内置浏览器检测结果。之后启动、建批次和注册浏览器桥一律读这个文件，不再临场探测或猜测；插件时代的 schema 1 文件视为未检测，必须重测。

内置浏览器三步检测并记录证据（检测在执行宿主内运行：`scripts/host-browser-bridge.mjs` 的 `detectHostBrowsers({agent,fileUpload,screenshot})`）：

1. 声称有：宿主列出 `type=iab`，或适配器声明存在。
2. 能加载：打开组件本地探测页，逐项完成读取、输入、点击、截图、上传文件；任何一项不行即 `not_loadable`（简历必须能上传）。
3. 是本尊：打开探测页后不得出现新的 Chrome/Chromium 主进程、探测标签不得出现在 Chrome 分身里、请求不得来自无头或自动化浏览器，否则记为 `declared_but_fake`，永不使用。

内置浏览器三步全过且分身可用时 `channels=['chrome','iab']`（双开）；否则只用分身。文件不记录账号名、Cookie 或浏览记录。Chrome 自动升级只由启动时读取 `Info.plist` 更新版本号；换执行宿主或用户要求时才重测（`node scripts/browser-capability.mjs reset --quote "<用户原话>"` 后重新检测）。每次会话内置浏览器可用时，宿主调用 `registerFromCapability({agent,allowedOrigins,fileUpload})` 注册内置浏览器桥；分身不需要注册。文件缺失返回 `BROWSER_CAPABILITY_DETECTION_REQUIRED`；检测完成但分身未安装且无内置浏览器时，建批次返回 `NO_USABLE_BROWSER_CHANNEL`。两个 MCP 的 `runtime_info` 返回记录的能力与当前连接是否在线，配置路径本身不表示连接成功。

`RECRUITING_IAB_SOCKET` 只有对端由当前宿主真实内置浏览器 SDK 注册时可用，另一份 Chromium 不属于 IAB。桌面 AX 点击/截图工具不具备 tab/DOM SDK，不能冒充该桥。

执行宿主启动只创建休眠 broker 服务，不连接、不启动 Chrome；维护宿主连休眠 broker 也不创建。首次使用通过显式 `browser_initialize_chrome({authorization:{initialize:true,evidence}})`（分身未运行时先启动分身再连接），恢复通过 `browser_restore_chrome`（原端口不在时以 `--restore-last-session` 启动分身再连接）；两者均由宿主真实会话 Hook 及维护宿主门禁约束。缺连接时启动仍能读运行能力；创建批次和网站阶段拒绝不可用通道，不暗中切换。源码不自动关闭旧 broker、用户窗口或页面。恢复绑定原生 target ID、真实浏览器会话及文档代际；相同 URL 的新标签不能替代原标签。所有读写优先用任务已绑定的实际 pageId；origin 路由只负责初次分配，不能覆盖旧任务身份。

## 视觉模型桥

附件验收规则全文见[通用流程](generic-form-pipeline.md#附件截图与模型验收)。有真实 MCP sampling 的宿主可直接使用该能力；未声明 sampling 时不能调用或伪造支持。

DSH 可把本包 `host/dsh-vision-bridge.mjs` 作为 Cordis 插件注册，注入已有 `llm` 和 `attachments` 服务。配置需要绝对私有 `socketPath`、已注册 `provider` 和确实支持 `image` 输入的 `model`；申请 MCP 的 `RECRUITING_VISION_SOCKET` 指向同一 socket。插件不复制密钥、不新增远端端点，不重放对话；仅把本次范围内实际图片通过宿主 attachment 服务传给选定模型。

私有 Unix socket 只接受当前用户并设置0600。`GET /status` 实时核实模型图片能力并报告插件启动指纹；`POST /review` 使用宿主 LLM 完成一次受限图文调用。响应记录实际模型、调用标识及宿主可提供的 provider response ID；未提供远端ID时留空。中断、长度截断、无文本、非JSON或缺页均不能当作通过。当前进程的配置或源码改变后，必须重载对应宿主并读回实际版本；磁盘文件更新不代表驻留进程已更新。

## 验收范围

`npm test` 包含真实stdio MCP、私有Unix socket、合成页面的浏览器驱动、权限继承和视觉结果契约测试。部署还须读取执行宿主实际能力，做无个人信息的真实图片调用；涉及网站的最终验收要在该宿主实际支持且已选定的浏览器中完成。宿主没有IAB、网站预览不支持或仅有模拟测试时，如实报告范围，不能宣称真实网站已投递或已通过。
