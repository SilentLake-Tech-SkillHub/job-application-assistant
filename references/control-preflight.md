# 填写前控件盘点

在用户指定的真实浏览器页面，通过已授权浏览器DOM执行接口载入`scripts/inspect_form_controls.js`，再执行`JSON.stringify(inspectApplicationForm(document))`。脚本不点击、不填值、不调用网络，不直接读取control.value、Cookie或认证状态，并过滤所识别的认证输入。未读取control.value不代表输出没有个人数据：label、placeholder、定位元数据或附近DOM文本可能含个人内容，也可能含URL等文本。`valuesIncluded:false`仅表示未读取control.value，不是无个人数据保证。结果仅用于本次已授权的求职流程，保持私有，不擅自分享或公开。

## 输出与人工核对

每个控件包含label、locator、controlLocator、kind、action、confidence、evidence、required、disabled、readonly、multiple、maxLength、accept、placeholder、optionCount、optionsNeedOpening、validationErrorVisible与dependencyReview。覆盖当前已渲染DOM，包括屏幕外字段；隐藏或未渲染步骤、折叠区、iframe与shadow DOM需分别打开/定位后再扫描。分类不能替代真实组件验证；脚本不保证推断出全部联动关系或任意网站内部校验。

`kind`区分text、readonly_input、select、multi_select、cascader、date_picker、radio、checkbox、file、button、unknown。被下拉/日期组件包裹的input按外层组件识别。未识别的只读输入和低置信度控件须在UI核对后决定操作；禁用字段先核查依赖，不强行启用。

## 私有操作方案 = 填写方案.json

盘点结果用 `python scripts/fill_plan.py skeleton <控件盘点.json> --batch <批次> --company <公司> --url <岗位链接> --lane <通道> --out <岗位目录>/填写方案.json` 生成骨架：按控件分好「批量 / 点击 / 上传 / 用户」，上传排在最前，证件号、验证码类字段直接标为用户填写；自定义组件里重复出现的显示框会合并。然后按条目与 label 对应来源事实，补全值（或 `值来源: 档案:<字段>`）、自定义组件的真实点击路径（`点击步骤`）和读回位置（`读回定位`），以及依赖顺序。先处理类型/上级选项，再处理下级选择；上传触发解析时先上传，再重新盘点并校正。`fill_plan.py check --ready` 通过后才执行。格式与执行方式见[批量填写与填写缓存](browser-application.md#批量填写与填写缓存三条通道通用)。

| 控件 | 填法 | 操作与核验 |
| --- | --- | --- |
| 原生文本 / 多行文本 | 批量 | 工具表单接口或 Playwright `fill()` 成组填写，随后逐字段读回文本与长度提示；不一致的退回逐字输入、失焦 |
| 原生下拉 / 原生单选 / 原生复选 | 批量 | 工具表单接口或 `select_option()` / `check()`；读回选中项与勾选状态 |
| 自定义下拉/搜索下拉 | 点击 | 打开，必要时搜索，再点击实际选项；核对选中项与校验 |
| 级联 | 点击 | 逐层点击，核对完整选中路径及下级重置 |
| 日期/年/月/范围 | 点击 | 点击真实日期单元，核对粒度、起止与“至今” |
| 上传 | 上传 | 选择正确文件，等解析结束，核对附件及被覆盖字段 |
| 禁用/未知/按钮 | 用户或核查 | 核查依赖与作用，最终提交按钮不作为校验工具，也不进方案 |

不用页面脚本给 input 赋值或派发事件；批量只走工具自带的表单接口或 Playwright 输入 API。

没有匹配枚举时核查真实“其他/自定义”入口；没有入口则按用户指示处理，不能伪造选择。删除已授权的无效条目后重新盘点及核对剩余条目。字段显示、组件有效选择、服务器保存和申请提交是四个不同状态。

## 定向维护检查

执行`NODE_PATH=<含playwright的依赖目录> node scripts/test_inspect_form_controls.cjs`。测试使用隔离浏览器的合成表单，不访问真实申请账号；验证控件分类、隐藏文件上传、禁用依赖、必填与限制、未读取control.value及DOM只读；这些检查不保证元数据不含个人内容。浏览器可执行路径由`CHROME_EXECUTABLE`指定；默认使用本机Chrome。随后在授权的实际表单运行脚本并验证一个受影响的真实控件，不能用合成测试冒充官网填写成功。

显示已填但仍报错、共享容器字段错位或联动丢值时，必须按[字段绑定恢复策略](field-binding-recovery.md)逐项恢复并记录分层证据。
