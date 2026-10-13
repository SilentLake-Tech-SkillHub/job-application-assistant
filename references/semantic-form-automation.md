# 程序化语义映射与 REA 诊断

在 Prepare 已获得本批表单授权后使用。默认通道仍是内置浏览器和 Chrome 扩展，
Playwright 仅作既有备用通道。此工具只减少结构识别和方案生成的 AI 文本；不授予新权限。

## 普通字段先由程序处理

通过当前通道的只读 DOM 接口运行 `inspect_form_controls.js`，保存本次私有盘点。
内置浏览器只读 evaluate 的环境必须传入只读函数本体，不用脚本标签注入或 DOM 写操作。
不能运行 DOM 读取脚本的工具，使用其原生盘点功能，补成同等结构；能力不足时按既有流程处理。
盘点元数据仍可能有个人信息，只放岗位私有证据目录。

```bash
node scripts/form_semantics.cjs <控件盘点.json> <当前表单URL> <语义映射.json> [<已验证缓存.json>]
python scripts/compile_form_mapping.py <控件盘点.json> <语义映射.json> --batch <批次> --company <公司> --url <岗位URL> --lane <内置浏览器|Chrome|Playwright> --out <填写方案.json> --workbook <追踪表.xlsx>
```

映射 scope 绑定当前表单 URL，编译 `--url` 必须与盘点表单的 origin/path 一致。
如果岗位链接与表单链接不同，先按当前表单 URL 编译，再将方案 `表单链接` 设为它、
`岗位链接` 设为正式岗位链接，并单独执行 `fill_plan.py check --workbook` 绑定岗位行。
编译时不传 `--workbook`，避免错误地把表单 URL 当岗位身份。

stdout 只给 automatic 数量、例外、覆盖限制和指纹；完整盘点/映射留在磁盘。
AI 优先处理 exceptions：缺少事实、含糊学历层级、重复经历、禁用依赖、动态枚举、
复杂控件、已有错误、条款/志愿和用户专属信息。alias 不匹配时保持待核，不能猜事实。
phone/email 只填档案引用，执行时仍受 `privacy-info-fill` 授权检查；不把值放入共享模板。

自动字段已有 `值来源`；确认私有档案实际含对应键。未知和复杂控件初始编译为 `需用户`，
表示暂停自动执行，不代表所有例外都必须问用户：能在当前授权和 UI 内核实的由 AI
补齐来源/控件/真实 `点击步骤`/`读回定位`，改为待填，再执行 `fill_plan.py check --ready`。
使用原来的 `fill_plan.py actions` 为内置浏览器/Chrome 生成动作清单；使用原来的
`playwright_fill.py` 执行备用通道。执行仍使用工具原生输入/点击，逐项读回，禁止 DOM 赋值。

不得靠缓存跳过当前盘点、字段校验、用户编辑保护、审核版本和最终提交门禁。
只在全部 automatic 字段本次读回成功后运行
`node scripts/form_semantics.cjs --commit <语义映射.json> <已读回填写方案.json> <已验证缓存.json>`。
脚本核对当前表单身份、各字段来源、已读回状态与 15 分钟内字段读回/页面校验，
生成结构缓存并私有保存。上传、添加/删除经历和联动后重扫、重编译受影响区域；
label 定位在 DOM ID 变化时重新解析，重复 label 只能使用本次 scoped CSS。
cache 命中不等于完成填表、草稿保存或投递成功。

## 复杂异常才使用 REA

只有当前公司所在通道已经提供可用、获准的 loopback CDP，才调用 `rea_bridge.py`；
内置浏览器/扩展没有 CDP 时留在本通道，不能另开浏览器复制登录或绕过平台限制。
桥接不安装依赖或启动调试端口，不执行 `capture_browser_scenario`，不调用私有投递 API。
需要构建 REA 的环境按开发者工作单独准备，普通投递 Agent 不自行安装。

```bash
python scripts/rea_bridge.py --command-json '["rea"]' --cdp http://127.0.0.1:9222 --target <指定target> --origin https://<当前招聘域名> --out <私有REA证据.json>
```

REA 原始 Evidence 在磁盘，stdout 是计数、来源和 completeness。
需要调查前端绑定代码时显式加 `--include-script-sources`，脚本源码只落私有证据文件，
再按问题读取片段；常规字段盘点不启用该选项。
缺 CLI/CDP、超时、返回不同 target/origin 或截断时报告诊断不可用；继续既有 UI 恢复。
从磁盘按需读有助于解释问题的证据片段，不把整个 bundle 或无关网络流量灌入模型。
被动观察不能证明后端保存；仍以字段真实选中、页面校验、草稿读回与官方回执验收。

实现依据和测试范围见 [设计文档](../docs/rea-automation-design.md)。
