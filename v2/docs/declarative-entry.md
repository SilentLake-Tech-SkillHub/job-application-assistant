# 声明式岗位到申请页跳转

`entry.kind = declarative_transition` 是与既有飞书配方、简历弹窗配方并列的通用入口。Chrome 和宿主内置浏览器均调用 `shared/entry-transition.mjs`，不保存公司名分支，不构造申请地址。

公司私有 `登录.json` 的 `entry` 结构如下。所有选择器、按钮文字和路径约束必须来自该公司的实际页面证据；示例不能直接当作公司配置。

```json
{
  "kind": "declarative_transition",
  "target": "same_or_new",
  "detail": {
    "location": {"pathnamePattern": "^/detail$", "query": {"job": "$roleId"}},
    "roleSelector": ".actual-job-title"
  },
  "entryLocator": {"selector": ".actual-open-application", "label": "申请职位"},
  "form": {
    "location": {"pathnamePattern": "^/application$", "query": {"job": "$roleId"}},
    "readySelector": ".actual-form",
    "roleIdentity": {"source": "query", "parameter": "job"}
  },
  "evidence": {
    "detailUrl": "https://example.test/detail?job=123",
    "formUrl": "https://example.test/application?job=123",
    "capturedAt": "2026-10-22",
    "method": "observed_rendered_navigation"
  }
}
```

- `target` 必须为 `same`、`new` 或 `same_or_new`。结果仅从浏览器实际页面清单中查找；结果有多个即阻断。
- `location.pathnamePattern` 必须为首尾锚定的正则；可同时声明 `hashPathPattern`、`query`、`hashQuery`。`$roleId` 只在查询参数值中作为运行时身份比较值，不用于拼地址。重复的同名参数一律拒绝。
- 入口配置对本站所有岗位通用：查询参数里像岗位编号的字面值（UUID、5 位以上数字、16 位以上带数字的串）、路径规则里的 UUID 或 9 位以上数字一律拒绝（`ENTRY_ROLE_ID_LITERAL`），岗位编号只能写 `$roleId`。路径里的站点租户号等短数字（如 `/051736/`）允许。
- 入口配置只能用 `node scripts/site-entry.mjs --workspace <工作区> --site <站点编码> --input <改动.json>` 写：先预览（`show_user_exactly` + 指纹），把预览原样给用户，用户确认后带 `--quote "<用户原话>" --expected-sha <指纹>` 写入；只改 `entry`、`loginPath`，`loginPath` 同样不能带岗位编号；写入时版本加一并记下用户原话。不得用编辑工具直接改登录配置文件（门禁拦截）。
- `detail`、`form` 均须声明真实 `roleSelector` 或 `roleIdentity`。标题必须精确匹配已确认岗位；URL 身份必须读回已确认岗位 ID，不能用预期值代替实际读回。
- `roleIdentity.source` 支持 `query`、`hashQuery`、`pathname`；路径身份另需首尾锚定的 `pattern`，其命名捕获组须与 `parameter` 同名。
- 入口定位可用 `{selector,label}` 、`{text,label}` 或 `{role,name,label}`；`text` 或 `name` 必须与 `label` 相同。实际元素必须唯一、可见且文字精确一致。
- 账号从原页面或配置声明的同源身份页核对，进入前后都必须精确匹配；身份页缺失或重复即阻断。
- 已在表单页时不点击任何入口。点击会开新标签的站点（`new` / `same_or_new`），由任务在第一次点击前登记已有的同站标签（`excludePageIds`），之后只认点击新开出来的申请页；中断重试时沿用同一份登记，不重复触发入口，也不会把旧的申请页认作本次进入。
- `evidence` 保存在公司私有资产，至少记录实际观察到的详情页与表单页，以及日期、方法。没有真实跳转证据，不猜表单地址，不以主页或列表页替代。
- 本入口只打开申请页；不填写、不接受协议、不处理验证码、不点击最终提交。进入后仍按完整定义/控件采集、映射、分支探测、模板封存、冻结计划、填写与独立读回继续。

当前不支持自动执行任意多步骤弹窗脚本；遇到中间选择、协议或验证，应保留页面并明确交接，不能把这些动作夹进入口定位器。

页面标题带固定栏目提示时，可为该阶段配置 `rolePrefix`，仅从实际读回文本开头移除该原样前缀再精确比对；前缀不匹配即失败，不能用预期标题替代实际文本。

## 链接唯一与链接刷新

- 每个岗位只有一个岗位链接和一个投递链接，存在主表岗位编码（J）那一行；公司宽表从主表投影，不另存第二份。岗位身份是岗位编码，官方岗位ID只是从链接读出的值。入口配置的查询参数用 `$roleId` 按岗位的官方岗位ID取值核对，公司级配置不写死某个岗位的编号。
- 链接只在“打不开”“第一次拿到空着的投递链接”或“岗位链接跳转后岗位编号变了、岗位名一致”时回报，记到 `投递回传.json` 的 `observations`（见 role-entry.md）；编号不变的跳转不算变化，不回报，也不从申请页反推详情页链接。
- 搜索端 `company_store.py apply-observations` 预览，用户确认后在原编码下覆盖主表、只重生成这一家的宽表并按“链接变更”重新确认；投递端只刷新这一家。
- 组批与就绪检查不再要求链接能被入口配置识别。
- 入口失败时，错误记录写明哪一项不符（选择器个数 / 前缀 / 标题 / 站内身份）、匹配到几个元素，以及期望值与读到值的 Hash；不写岗位原文。
