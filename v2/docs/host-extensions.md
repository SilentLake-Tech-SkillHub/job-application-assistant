# 每个宿主使用自己的主用Chrome扩展

浏览器选择仍只存组件外浏览器设置。具体插件归属只存组件外Agent浏览器登记的`agents[].mainChromeExtension`；公司模板不存插件或宿主信息。

| 宿主 | 插件 | 连接方式 |
|---|---|---|
| codex | ChatGPT | 当前Codex宿主的正式扩展工具上下文 |
| claude-code | Claude | 当前Claude宿主的正式扩展工具上下文 |
| kimi-work | Kimi | 已登记的Kimi WebBridge |

## 注册

已提供适配器声明插件能力的宿主，在Agent注册或`install-host --write`时登记对应插件。已有部署只补插件登记，不改角色或MCP配置：

```sh
node scripts/register-host-extension.mjs --workspace <workspace> --host codex
```

新增Agent有这项能力时，在安装/注册时提供`extension`，或使用安装器的`--extension-id <id> --extension-name <name> --extension-transport host_sdk|webbridge`。已有插件登记覆盖原行，其它浏览器登记保持。没有能力声明的Agent不使用其他产品插件；能力由实际宿主提供，登记不等于连接验收。

## 原生宿主扩展桥（host_sdk）

在**当前宿主自己的扩展工具运行环境**中，使用该环境实际暴露的browser SDK。Codex使用自己的ChatGPT扩展运行环境，Claude使用自己的Claude扩展运行环境；不能从另一宿主的服务构造身份。如果宿主只提供模型工具，没有可供代码调用的SDK，先在该宿主接通正式工具桥，不能把Kimi服务当作它的实现。

1. 从真实浏览器清单选`type=extension`的主用Chrome；读取宿主提供的浏览器API文档。沿用现有扩展，不启动Chrome、不读取或复制Cookie/profile。
Codex的宿主SDK需先读取其要求的说明：`await agent.documentation.get("confirmations")`、`await agent.documentation.get("capabilities/tab/cdp")`；文档加载是实际宿主前置步骤，未加载时按宿主提示完成，不能改用另一通道绕过。原生只读环境没有performance时，页面和截图身份读取扩展实际Page.getFrameTree的loaderId。

2. 导入本组件`scripts/host-browser-bridge.mjs`，调用：

```js
const bridge = await registerMainChromeExtension({
  agent,                  // 当前宿主实际初始化的运行时
  browserId,              // 上一步真实扩展清单中的id
  allowedOrigins,         // 当前确认岗位/站点的官方域名
  env,                    // 本宿主安装配置，保留实际hostId/Agent编码/角色
  fileUpload, reaPackageRoot, // 可选：REA 6.7.0 已安装包路径；上传默认使用官方 filechooser
  deferBrowserCalls: true
});
```

这一步创建当前宿主独立的本机私有socket，不改变MCP角色或Agent身份，也不操作网页。组件共用主控逐请求按安装宿主id转发，先读回`executor.hostId/extensionId/browserType`，匹配当前登记后才执行动作。

3. 调用正式MCP的`browser_initialize_chrome`及原任务。在另一条异步调用中，通过当前宿主工具持续调用`pumpHostBrowser(bridge,{maxJobs:100,waitMs:1000})`执行排队的浏览器请求，直至该MCP调用返回。SDK要求动作出现在当前工具调用中时，不能只留一个上轮回调而不泵送。
工具严格串行的宿主中，不要同时等待MCP长调用与泵送。可用本组件固定CLI异步发起相同操作（沿用安装配置和同一CoreClient核心），返回运行会话后在宿主工具中泵送，最后读回CLI结果，再从当前MCP核对版本、核心PID和连接状态；不启动另一套业务核心或浏览器。

4. 源码更新后重新加载桥接模块。确认无请求执行时关闭旧桥的server，仅释放本地socket，保留浏览器与标签；用当前模块重新登记。用户页先经正式SDK借用，组件不关闭借用页；本任务新标签只在确认的官方域名上使用，并按宿主规则标记接续。

`browser_preferences`返回对应插件登记。`HOST_EXTENSION_BRIDGE_REQUIRED`表示加载**这个宿主的**桥接；`HOST_EXTENSION_NOT_REGISTERED`表示用注册入口补登记。身份不一致时重连原宿主对应插件，不能用另一插件回报成功。

原生扩展返回 `Debugger unattached` 时，桥使用实际扩展实例重新取得原标签，读取完整 URL、文档代际和当前可见表单控件。原标签恢复后自动接续只读步骤。动作已发起才断开时，先读回现状并从任务恢复，避免重复点击或填写。需要指定任务复核时，使用 `browser_restore_chrome` 的 `role` 参数传原队列引用。桥在线但原表单未读回时返回 `original_tab_not_verified`，保留 Agent 接续待办。

## 采集、填写和验收

浏览器桥继续执行同一页面适配器、正式公司模板、操作定义与独立读回。原生扩展可传入已安装的 `reaPackageRoot`（或宿主环境 `RECRUITING_REA_PACKAGE_ROOT`）接入 REA 6.7.0。扩展读取绑定页的原始结构，由组件进程归一化。该通道报告 DOM、可访问性和资源清单覆盖，脚本正文及活动事件未采集。其他宿主也可提供正式 `reaInspect` 回调。文件上传走宿主实际文件选择器；各宿主的真实能力分别验收。

读回应包含实际宿主、插件、扩展浏览器身份及任务页面；不能仅凭`agent_plugin_main_chrome`字符串或离线夹具算实际连接。修复回归覆盖宿主分别路由、跨插件拒绝、未来Agent注册、完整启动链及已存在浏览器保留。真实网页及其它宿主未运行的验收单独保留待办。
