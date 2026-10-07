# 独立偏好与执行证据维护验证

基线 main：`7a53ecd5a775b525b0a47e9e33f2bf3a7afe614b`。仅新分支/Draft PR；不合并、不修改招聘网站或公共模板中的个人取值。保留上游布局、Excel 列/枚举、首轮/二轮范围、批量分阶段、自动化授权与提交审核。

## 可复现检查

```sh
python3 -m unittest discover -s scripts -p 'test_*.py'
NODE_PATH=<temporary-playwright-node_modules> node scripts/test_inspect_form_controls.cjs
NODE_PATH=<temporary-playwright-node_modules> node scripts/test_field_binding_recovery.cjs
python3 docs/validation/check_package.py .
```

Playwright 仅安装到临时目录，不进入技能包。既有两项浏览器测试运行于无账号的隔离合成页面：控件盘点 12 个控件/26 项检查通过；直接赋值失败复现、fill/顺序输入恢复、草稿保存重开读回通过。测试启动临时 headless Chrome，需要运行环境允许该进程；不访问真实 ATS。

Python 合成测试：47 项通过，无跳过。包括不限城市不排除、硬城市范围、弱优先/并列/未知原样保留、跨轴不代选/不加权、AI 数据产品与纯数仓的人工 JD 依据、正式与转正实习同一报告排序、有正式岗和覆盖不足仍展示转正实习、每批默认次序及公司动作前确认、旧已投/回执与明确选择保护、旧偏好版本拒收、BU 未披露、缺前置逐岗报告拒收、实际执行/回执证据、待核/排除不计为候选、同名不同 ID 与多城市同 ID、URL 业务参数保留。测试只验证声明与字段契约，不判断 JD 真伪或自然语言分类正确性。

## 完整包与流程图

完整仓库复制到临时安装目录后，从另一 cwd 运行上述测试/校验器。核对所有 SKILL frontmatter 的 name/description、Markdown 本地引用、Python 语法和各校验器 CLI 加载。该检查不等于在 Codex/Claude/Dots 等平台实际注册、远程安装或招聘站端到端验证；嵌套子技能必须随父包复制，偏好空模板必须留在私有工作区填充。旧快照缺新字段须保留原始证据、人工适配后再交付，不能把版本号改成新版本绕过校验。

本轮按仓库所有者 PR 评论改用 [excalidraw-flowchart](https://github.com/SilentLake-Tech-SkillHub/excalidraw-flowchart/blob/main/SKILL.md)：总览仅模块/功能并手工构图，内部图仅流程步骤并用规格自动排版。自写 docs/flow/render_flow.py 已撤除。技能环境检查报告 Node/Chrome 就绪，依赖和离线页面缺失；按技能要求等待临时目录依赖安装授权，尚未进行本轮图形编辑/视觉验收。此前 PNG 元数据验证只证明此前源/图对应，不能声称完成本轮手绘修复。本轮按用户最新指示只推送 README 排除及其余不依赖绘图的候选修订，不提交整包完成验收。

真实表单操作/保存/提交、来源真实性、公司覆盖、前置报告时间、用户确认及历史快照完整性仍须现场核验；结构校验不是平台强制 hook 或真实 ATS 验证。

## 精确文件范围

- `SKILL.md`
- `docs/flow/module-1.excalidraw`
- `docs/flow/module-1.png`
- `docs/flow/module-3.excalidraw`
- `docs/flow/module-3.png`
- `docs/flow/module-4a.excalidraw`
- `docs/flow/module-4a.png`
- `docs/flow/module-4b.excalidraw`
- `docs/flow/module-4b.png`
- `docs/flow/module-5.excalidraw`
- `docs/flow/module-5.png`
- `docs/flow/overview.excalidraw`
- `docs/flow/overview.png`
- `docs/validation/check_package.py`
- `docs/validation/preference-contract.md`
- `references/automation-continuity.md`
- `references/browser-application.md`
- `references/daily-batch.md`
- `references/preference-contract.md`
- `references/preference-template.md`
- `references/workbook-contract.md`
- `scripts/preference_contract.py`
- `scripts/test_preference_contract.py`
- `scripts/test_validate_batch.py`
- `scripts/validate_batch.py`
- `skills/application-parallel-execution/SKILL.md`
- `skills/application-parallel-execution/references/coordination-contract.md`
- `skills/application-parallel-execution/scripts/validate_assignments.py`

## 独立复审反例回归

跨轴冲突执行必须同时有 selected:true 与 selection_ref；仅有引用而 selected:false 会拒收。uncertain 无任何动作证据会拒收；准备数量只计算候选中具备完成填写证据与材料身份的记录，部分填写不计已准备。搜索 manifest 及其 delta 岗位仅允许只读阶段，fill/save/submit 全部 not_started；通用申请入口仍可在授权内填写。合成回归覆盖原样反例与有效正例。

## 本轮候选规则修订

本批先初始化默认岗位次序，每家公司申请动作前用同一逐岗包确认相对默认次序有无变化，衔接最终目标与当前表单版本审核。私有 conversion_last 政策将明确转正的实习放同一报告末尾，不以无正式岗或覆盖充分为展示条件；旧 conditional/fallback 记录保留原件后按新确认版本适配。历史、明确选择、完整 JD 判断、身份与既有反例回归仍保留。用户最新范围明确排除 README；README 已恢复当前 main 原始内容，不在候选 PR 差异中。图形依赖授权仍未明确获得，本轮只提交不依赖绘图的候选修订，保持 Draft，图形部分仍阻塞。

## README 排除与候选状态

按 2026-10-07 17:18 UTC 最新明确指示，只修 README 以外内容。先 fetch 核对两仓 main 与 PR 分支，没有他人并发提交；README 完整恢复当前 main，字节一致，PR 不再包含本次 README 差异。此前评论的 README 改写建议已被新指令覆盖，不在 README 添加说明。绘图工具依赖约 370MB 的请求尚未获同意，不安装、不重提；12 组已改图仍待指定技能重画及视觉验收。除 README 外的规则/验证候选可先评审，禁止正式安装、合并和自动合并。
