# 填写前控件盘点

在用户指定的真实浏览器页面，通过已授权浏览器DOM执行接口载入`scripts/inspect_form_controls.js`，再执行`JSON.stringify(inspectApplicationForm(document))`。脚本不点击、不填值、不调用网络，也不读取input.value、密码、验证码、Cookie或认证状态。输出不包含URL、个人取值和选项文本；结果默认保存在私有项目，不上传公开仓库。

## 输出与人工核对

每个控件包含label、locator、controlLocator、kind、action、confidence、evidence、required、disabled、readonly、multiple、maxLength、accept、placeholder、optionCount、optionsNeedOpening、validationErrorVisible与dependencyReview。覆盖当前已渲染DOM，包括屏幕外字段；隐藏或未渲染步骤、折叠区、iframe与shadow DOM需分别打开/定位后再扫描。分类不能替代真实组件验证；脚本不保证推断出全部联动关系或任意网站内部校验。

`kind`区分text、readonly_input、select、multi_select、cascader、date_picker、radio、checkbox、file、button、unknown。被下拉/日期组件包裹的input按外层组件识别。未识别的只读输入和低置信度控件须在UI核对后决定操作；禁用字段先核查依赖，不强行启用。

## 私有操作方案

按条目与label对应来源事实，记录定位、控件性质、实际可选项与限制、拟填内容、交互方法、依赖顺序、校验和持久化结果。先处理类型/上级选项，再处理下级选择；上传触发解析时先上传，再重新盘点并校正。不要先把所有input一律赋值。

| 控件 | 操作与核验 |
| --- | --- |
| 文本 | 输入、失焦，读回文本与长度提示 |
| 下拉/搜索下拉 | 打开，必要时搜索，再点击实际选项；核对选中项与校验 |
| 级联 | 逐层点击，核对完整选中路径及下级重置 |
| 日期/年/月/范围 | 点击真实日期单元，核对粒度、起止与“至今” |
| 单选/多选 | 点击实际选项，核对选中状态和数量 |
| 上传 | 选择正确文件，等解析结束，核对附件及被覆盖字段 |
| 禁用/未知/按钮 | 核查依赖与作用，最终提交按钮不作为校验工具 |

没有匹配枚举时核查真实“其他/自定义”入口；没有入口则按用户指示处理，不能伪造选择。删除已授权的无效条目后重新盘点及核对剩余条目。字段显示、组件有效选择、服务器保存和申请提交是四个不同状态。

## 定向维护检查

执行`NODE_PATH=<含playwright的依赖目录> node scripts/test_inspect_form_controls.cjs`。测试使用隔离浏览器的合成表单，不访问真实申请账号；验证控件分类、隐藏文件上传、禁用依赖、必填与限制、个人取值排除及DOM只读。浏览器可执行路径由`CHROME_EXECUTABLE`指定；默认使用本机Chrome。随后在授权的实际表单运行脚本并验证一个受影响的真实控件，不能用合成测试冒充官网填写成功。

显示已填但仍报错、共享容器字段错位或联动丢值时，必须按[字段绑定恢复策略](field-binding-recovery.md)逐项恢复并记录分层证据。
