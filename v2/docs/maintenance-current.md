# 当前维护依据

运行行为以本包当前 `SKILL.md`、[通用表单流程](generic-form-pipeline.md)、[宿主接线](host-integration.md)和工作区的唯一私有配置为准。本文件只索引维护依据，不保存个人任务结果或重复业务规则。

Chrome 分身的启动与身份核验实现位于 `shared/chrome-clone.mjs`、`shared/browser.mjs`、`shared/browser-environment.mjs`。核验覆盖真实资料目录、浏览器实例和本机进程；macOS路径别名先规范化，进程列表固定UTF-8编码。服务重载保留独立分身和现有页面。

宿主适配与安装位于 `host/adapters/`、`scripts/install-host.mjs`；安装按TOML键语义合并，无法安全改写的定义明确拒绝。视觉服务位于 `host/dsh-vision-bridge.mjs`，启动只回收同用户、同inode且已无监听者的残留socket；活跃服务和普通文件保留。模型报告只保留实际可观察的结论。

完整维护步骤、门禁影响评估、失败复现和部署验收要求见[维护端规则](maintenance.md)。具体工作区本轮进度只写其现有任务单；以真实驻留版本、组件回执及当前页面核验为完成依据。
