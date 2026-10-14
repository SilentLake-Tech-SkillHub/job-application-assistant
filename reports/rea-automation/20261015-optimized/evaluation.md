# 真实模型全链路测试

本次配对实测：优化后流程总 token 减少 70.2%，完整耗时 减少 51.0%。两轮各验证 5/5 份回执。

两轮都是本次重新执行，使用相同 gpt-5.6-sol/high、合成资料、五类表单、备份浏览器执行器与验收条件。优化前代码和 Skill 固定在 00aaeb8fb775，保留原先主动调用 REA 的流程；优化后合并普通准备、上传重扫和例外批处理，文档只加载一次，REA 按失败/未知绑定触发。模型请求 40 → 13 次；真实 REA 调用 3 → 0 次，耗时 41.35 → 0.00 秒。保留五份当前字段读回、草稿验证、审核版本哈希、逐角色提交门禁、服务端回执与 Excel 读回。 实报未缓存输入 66,543 → 45,146，输出 4,829 → 3,075；其中 97.9% 来自减少缓存输入的重复携带。因此总 token 改善不能直接换算为费用改善。工具时间合并区间 126.48 → 67.27 秒，模型/网络/编排剩余时间 166.18 → 76.17 秒。优化后逐角色审核、提交和回执台账核验仍耗时 52.09 秒；没有省略这些检查。以上只描述这次时间分解，不能把差值全部归因于某个模块。

## 优化前增强流程

```json
{
  "model": "gpt-5.6-sol",
  "completed": true,
  "wall_seconds": 292.6617714999993,
  "to_batch_verified_seconds": 288.1327739,
  "usage": {
    "input_tokens": 1529583,
    "cached_input_tokens": 1463040,
    "output_tokens": 4829,
    "reasoning_output_tokens": 1850,
    "cache_write_input_tokens": 0,
    "total_tokens": 1534412,
    "uncached_input_tokens": 66543
  },
  "request_count": 40,
  "rea_cli_seconds": 41.3467112,
  "verified_batch": {
    "sites": {
      "native-bilingual": {
        "receipt": "mock-4e86635e451d",
        "server_verified": true,
        "tracker_verified": true
      },
      "search-dropdown": {
        "receipt": "mock-18c15d2889d0",
        "server_verified": true,
        "tracker_verified": true
      },
      "date-cascade": {
        "receipt": "mock-54611ea5f9a1",
        "server_verified": true,
        "tracker_verified": true
      },
      "repeated-education": {
        "receipt": "mock-8720633c9cb0",
        "server_verified": true,
        "tracker_verified": true
      },
      "upload-rerender": {
        "receipt": "mock-3102263771eb",
        "server_verified": true,
        "tracker_verified": true
      }
    },
    "rea_calls": 3,
    "closeout_gate": true,
    "verified_at_ns": 1792004481360337400
  }
}
```

## 优化后流程

```json
{
  "model": "gpt-5.6-sol",
  "completed": true,
  "wall_seconds": 143.43396179999763,
  "to_batch_verified_seconds": 138.5519718,
  "usage": {
    "input_tokens": 454362,
    "cached_input_tokens": 409216,
    "output_tokens": 3075,
    "reasoning_output_tokens": 1012,
    "cache_write_input_tokens": 0,
    "total_tokens": 457437,
    "uncached_input_tokens": 45146
  },
  "request_count": 13,
  "rea_cli_seconds": 0,
  "verified_batch": {
    "sites": {
      "native-bilingual": {
        "receipt": "mock-ac656d9e23dd",
        "server_verified": true,
        "tracker_verified": true
      },
      "search-dropdown": {
        "receipt": "mock-045f203c2b0f",
        "server_verified": true,
        "tracker_verified": true
      },
      "date-cascade": {
        "receipt": "mock-2bf51171a6c6",
        "server_verified": true,
        "tracker_verified": true
      },
      "repeated-education": {
        "receipt": "mock-260dc5ff681d",
        "server_verified": true,
        "tracker_verified": true
      },
      "upload-rerender": {
        "receipt": "mock-e33865c13325",
        "server_verified": true,
        "tracker_verified": true
      }
    },
    "rea_calls": 0,
    "closeout_gate": true,
    "verified_at_ns": 1792004624870835100,
    "preparation_passes": {
      "native-bilingual": 1,
      "search-dropdown": 1,
      "date-cascade": 1,
      "repeated-education": 1,
      "upload-rerender": 2
    },
    "loaded_documents": {
      "SKILL.md": "827368ccae3eb6b7db408b06f81eb02e2cf63b265625d8cfd718b4b37820cbc5",
      "batch-contract": "4b2bd75b305d2c123494e6276bce6ee7886a3f13855e022ed1dccf16c34d3f2a",
      "synthetic-profile": "e1a707e31b6ef2e595c95d25d8956d6e780af6df3abf3d9de41a6c4596e28c87",
      "references/stage-contract.md": "404ce5c50c26618968aaa2a3d9803d82fe64b5defd25101f5f9c98854b249fae",
      "references/browser-application.md": "58e0bcc3c47cbea7cb7ab7338e9a24e5fcdbd5e7e7a49310345445306a7c61cc",
      "skills/application-content-fill/SKILL.md": "df35a09123cffe65f83cfced73fa9e8096822d684af18c642a5c160eca4053cf",
      "skills/privacy-info-fill/SKILL.md": "396d94c821613671e149514fef868a2691f1c3364a1f75a7dd39b74bb1a887d2",
      "references/semantic-form-automation.md": "06e5256526614d3fec00510061ee53d35af245f7a9de71c952e6ed272643d658"
    }
  }
}
```



- **时间边界：**从启动 Codex CLI 到完整模型回合和进程退出；另列“批次核验完成”时间。包含 Skill/档案读取、浏览器/工作区初始化、模型与网络等待、DOM 观察、REA、填写/重试、草稿保存与读回、模拟审核批准、实际 mock 提交、服务端回执核验和 Excel 台账读回。

- **完整文档传输：**两轮使用同样的 50,000-token 工具输出预算，核验 CLI 真实模型可见输出没有截断标记。完整传输是验收条件；文档截断的初次尝试及消耗单独保留。

- **真实 token：**来自 CLI turn.completed，并与该轮独立会话 rollout 的 token_count 交叉核对。input 包含 cached input；output 包含 reasoning。总量 = input + output，不能再次加缓存或推理。每次请求重新携带的上下文按实际 usage 累计。

- **REA 口径：**优化前沿用三类复杂表单主动调用真实 REA 的测试模式；优化后仅在正常 UI 探查仍无法确定绑定或实际失败时调用。同样成功的控件无需 REA，实际调用次数从日志核验。REA 自身不调用 LLM；解读其证据及后续推理的消耗已计入该轮真实 usage。没有凭文本长度虚构“REA 独立模型 token”。

- **可比范围：**当前已登录 Codex CLI、相同模型/high、两个独立新上下文、每轮相同五类 mock、相同输入事实和完成条件、共用现有 Playwright 备用执行器。两轮均程序映射普通字段、模型决定复杂点击；优化后合并往返、去重文档和已读回字段，并用条件诊断。差异包含整个优化组合，不能单独推断某项优化的贡献。

- **预置与模拟：**输入已是确认岗位清单、JD/资格/名额和档案事实；真实求职调研、登录、验证码、人工批准等待不在本轮范围。mock 审核确认显式模拟，未伪造真人耗时。草稿通过服务端 GET 并逐字段对照当前 UI，未计入离开后重开/恢复草稿。默认内置浏览器/Chrome 扩展的完整链路仍需独立测试。

- **解释限制：**每种流程仅一轮，顺序为优化前→优化后。结果可说明这次执行，不能推断稳定平均速度、显著性或真实招聘网站效果。账户额度/金额不从 token 数擅自换算。

用法和 usage 字段：[Codex 官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)。

前置无效尝试额外已报告 1,534,285 token，279.96 秒，保存在本目录 *-attempts.json。未知 usage 没有记为零；被截断指令的尝试即使有五份回执也不用于完整传输比较。
