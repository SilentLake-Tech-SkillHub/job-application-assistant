# 提交门禁钩子

`application_guard.py` 是一个 PreToolUse 钩子：每次 Agent 要执行浏览器点击前先运行它。点击看起来是**最终提交**（按钮或描述含“提交”“投递”“我已知晓”“Submit”等，不含“保存草稿”“投递记录”之类），而当前没有有效的提交通行证时，它直接拦截，并把原因反馈给模型。

通行证由 `scripts/stage_gate.py <batch.json> --stage submit --role <role_key>` 通过后发放，存在 `投递证据/门禁通行证.json`：

- 只对这一个岗位有效；
- 10 分钟内有效，最多 3 次点击（提交按钮加站点确认弹窗）；
- 该岗位在台账里记为 `submitted` 或 `uncertain` 后立即作废，不能顺带给下一个岗位用。

钩子只在含 `投递证据/` 文件夹的目录（投递根目录）及其子目录里生效，其他项目不受影响。

## 安装

在投递根目录运行（用安装到本机的 Skill 副本里的脚本；先不加 `--write` 看会改什么）：

```bash
python <Skill目录>/hooks/install_hooks.py --platform claude-code --project <投递根目录> --write
python <Skill目录>/hooks/install_hooks.py --platform codex       --project <投递根目录> --write
python <Skill目录>/hooks/install_hooks.py --platform kimi        --project <投递根目录> --write
```

| 平台 | 写入位置 | 说明 |
|---|---|---|
| Claude Code | `<投递根目录>/.claude/settings.json` | `PreToolUse`，`matcher: "mcp__.*"`（浏览器都是 MCP 工具）。保留已有设置 |
| Z.ai GLM | 同 Claude Code | GLM 通过 Claude Code 使用（如 glm-launch）时，钩子机制与 Claude Code 完全相同 |
| Codex | `<投递根目录>/.codex/config.toml` | `[[hooks.PreToolUse]]`。项目级钩子首次需在 Codex 里用 `/hooks` 审核并信任；项目层未受信任时不加载；钩子内容改动后需重新信任 |
| Kimi Code | `~/.kimi-code/config.toml` | `[[hooks]] event = "PreToolUse"`，用户级配置；不设 matcher，由脚本自己判断 |
| ZCode（Z.ai 桌面端） | 未验证 | 支持 Claude Code 插件市场，但钩子配置格式没有公开文档；能用 Claude Code 格式钩子时按 Claude Code 一行配置 |

命令使用安装时的 Python 绝对路径和脚本绝对路径，Windows、macOS、Linux 通用。重复运行不会重复添加。

## 行为约定

| 情况 | 结果 |
|---|---|
| 不是浏览器点击，或不像最终提交 | 放行 |
| 像最终提交，有有效通行证 | 放行，扣一次点击 |
| 像最终提交，没有通行证 / 已过期 / 已用完 / 岗位已提交 | 拦截（退出码 2） |
| 判断过程出错 | 像提交时拦截（失败即关闭）；Codex 和 Kimi 对钩子自身报错默认放行，所以脚本自己处理异常 |
| 不在投递根目录 | 放行 |

## 局限

- 只能识别带文字的点击（按钮名、元素描述、`action_summary`）。只给屏幕坐标、没有任何描述的点击无法识别，仍须按 SKILL.md 先跑提交门禁。
- 只拦最终提交这一个不可逆动作。开表单、审核、收尾三个门禁仍由 Agent 按[阶段契约](../references/stage-contract.md#10-校验脚本的运行时点必须运行错误阻断)运行。
