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
- `detail`、`form` 均须声明真实 `roleSelector` 或 `roleIdentity`。标题必须精确匹配已确认岗位；URL 身份必须读回已确认岗位 ID，不能用预期值代替实际读回。
- `roleIdentity.source` 支持 `query`、`hashQuery`、`pathname`；路径身份另需首尾锚定的 `pattern`，其命名捕获组须与 `parameter` 同名。
- 入口定位可用 `{selector,label}` 、`{text,label}` 或 `{role,name,label}`；`text` 或 `name` 必须与 `label` 相同。实际元素必须唯一、可见且文字精确一致。
- 账号从原页面或配置声明的同源身份页核对，进入前后都必须精确匹配；身份页缺失或重复即阻断。
- 已在表单页时不点击任何入口。先前中断已打开唯一表单时，重新核实后复用该表单，不重复触发入口。
- `evidence` 保存在公司私有资产，至少记录实际观察到的详情页与表单页，以及日期、方法。没有真实跳转证据，不猜表单地址，不以主页或列表页替代。
- 本入口只打开申请页；不填写、不接受协议、不处理验证码、不点击最终提交。进入后仍按完整定义/控件采集、映射、分支探测、模板封存、冻结计划、填写与独立读回继续。

当前不支持自动执行任意多步骤弹窗脚本；遇到中间选择、协议或验证，应保留页面并明确交接，不能把这些动作夹进入口定位器。

页面标题带固定栏目提示时，可为该阶段配置 `rolePrefix`，仅从实际读回文本开头移除该原样前缀再精确比对；前缀不匹配即失败，不能用预期标题替代实际文本。

## 链接唯一与链接变更

- 每个岗位只有一个岗位链接，存在主表；公司.json、批次都从主表派生，不另存第二个链接或第二套岗位ID。入口配置的查询参数用 `$roleId` 按岗位取值，公司级配置不写死某个岗位的编号。
- 进入申请页成功时，如果实际到达并核对过的详情页与已确认的岗位链接不同（网站跳转或改了链接），登录 MCP 把它写入 `投递回传.json` 的 `linkChanges`（每岗位一条、覆盖写，去掉 userId 等个人参数），不改主表、不改公司.json。
- 搜索端 `company_store.py relink-observed` 预览“岗位链接 X → Y”（岗位在当前批次时同时列出批次的同步修改），用户确认后用 `relink` 覆盖主表链接，旧链接只留在 git 历史；`refresh` 按新链接重算岗位ID；批次登记“链接”作用域的确认。批次内容变化后，执行端须重新导入队列。
- 搜索端组批时核对：岗位链接或投递链接之一必须能被该公司的声明式入口识别，否则不进批次并列出原因。
- 入口失败时，错误记录写明哪一项不符（选择器个数 / 前缀 / 标题 / 站内身份）、匹配到几个元素，以及期望值与读到值的 Hash；不写岗位原文。
