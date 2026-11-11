# 岗位代投助手 V2

当前唯一维护实现位于 [v2/](v2/)，组件入口为 [SKILL.md](v2/SKILL.md)。版本及本次修复见 [版本记录](v2/docs/版本记录.md)。

组件包含独立业务核心、登录和申请 MCP、CLI、浏览器驱动、Hooks及测试。个人资料、公司模板、确认交接和运行状态保存在部署工作区，固定位置与写入责任见 [运行架构](v2/docs/runtime-architecture.md)。

## 安装与使用

在v2目录执行 `npm ci`。按 [宿主接线](v2/docs/host-integration.md) 配置工作区和执行端，并从 [Skill](v2/SKILL.md) 启动已确认岗位的准备流程。登录、填写、独立核验和具体提交授权由组件分别检查。

发布后的后台更新、当前对话版本核验及原任务接续见 [维护规则](v2/docs/maintenance.md)。公司模板及资料通过固定入口覆盖更新，下一次调用直接读取。

## 验证

GitHub Actions运行唯一的 [V2 component](.github/workflows/v2.yml) 工作流：POSIX运行时测试、Python Hook检查、跨平台公共资产检查。实际网站操作按部署工作区授权执行。

本仓库发布通用代码，不包含个人资料、Cookie或投递记录。第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
