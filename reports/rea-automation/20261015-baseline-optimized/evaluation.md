# 真实模型全链路测试

本次配对实测：优化后流程总 token 减少 62.4%，完整耗时 减少 21.1%。两轮各验证 5/5 份回执。

两轮都是本次重新执行，使用相同 gpt-5.6-sol/high、合成资料、五类表单、备份浏览器执行器与验收条件。原无 REA 轮使用 00aaeb8fb775 的原输入执行器，Skill 固定在 REA 增强前 ef9b403003ec，模型判断全部字段来源与控件路径；该轮不暴露 REA 或自动映射工具；优化后合并普通准备、上传重扫和例外批处理，文档只加载一次，REA 按失败/未知绑定触发。模型请求 30 → 13 次；真实 REA 调用 0 → 0 次，耗时 0.00 → 0.00 秒。保留五份当前字段读回、草稿验证、审核版本哈希、逐角色提交门禁、服务端回执与 Excel 读回。 优化后若同样零次 REA，本次改善来自程序化准备和减少往返，不能证明 REA 诊断的独立收益。历史无 REA 轮有指令截断，不混入此重新配对比较。 实报未缓存输入 66,151 → 53,072，输出 5,315 → 3,643；其中 97.9% 来自减少缓存输入的重复携带。因此总 token 改善不能直接换算为费用改善。工具时间合并区间 20.81 → 33.26 秒，模型/网络/编排剩余时间 108.23 → 68.53 秒。优化后逐角色审核、提交和回执台账核验仍耗时 10.50 秒；没有省略这些检查。以上只描述这次时间分解，不能把差值全部归因于某个模块。

## 原无 REA 流程

```json
{
  "model": "gpt-5.6-sol",
  "completed": true,
  "wall_seconds": 129.04298049999852,
  "to_batch_verified_seconds": 125.6924808,
  "usage": {
    "input_tokens": 1106791,
    "cached_input_tokens": 1040640,
    "output_tokens": 5315,
    "reasoning_output_tokens": 1601,
    "cache_write_input_tokens": 0,
    "total_tokens": 1112106,
    "uncached_input_tokens": 66151
  },
  "request_count": 30,
  "rea_cli_seconds": 0,
  "verified_batch": {
    "sites": {
      "native-bilingual": {
        "receipt": "mock-0501b6501d94",
        "server_verified": true,
        "tracker_verified": true
      },
      "search-dropdown": {
        "receipt": "mock-51a668462de8",
        "server_verified": true,
        "tracker_verified": true
      },
      "date-cascade": {
        "receipt": "mock-f4122213bd56",
        "server_verified": true,
        "tracker_verified": true
      },
      "repeated-education": {
        "receipt": "mock-aa870bbd5d9f",
        "server_verified": true,
        "tracker_verified": true
      },
      "upload-rerender": {
        "receipt": "mock-a92bd0f37112",
        "server_verified": true,
        "tracker_verified": true
      }
    },
    "rea_calls": 0,
    "closeout_gate": true,
    "verified_at_ns": 1792006297336039800
  }
}
```

## 优化后流程

```json
{
  "model": "gpt-5.6-sol",
  "completed": true,
  "wall_seconds": 101.78613839999889,
  "to_batch_verified_seconds": 97.6663826,
  "usage": {
    "input_tokens": 414032,
    "cached_input_tokens": 360960,
    "output_tokens": 3643,
    "reasoning_output_tokens": 1216,
    "cache_write_input_tokens": 0,
    "total_tokens": 417675,
    "uncached_input_tokens": 53072
  },
  "request_count": 13,
  "rea_cli_seconds": 0,
  "verified_batch": {
    "sites": {
      "native-bilingual": {
        "receipt": "mock-e84b0ba5d90a",
        "server_verified": true,
        "tracker_verified": true
      },
      "search-dropdown": {
        "receipt": "mock-43991f69a04b",
        "server_verified": true,
        "tracker_verified": true
      },
      "date-cascade": {
        "receipt": "mock-93aeb8fb1253",
        "server_verified": true,
        "tracker_verified": true
      },
      "repeated-education": {
        "receipt": "mock-d165c4331c50",
        "server_verified": true,
        "tracker_verified": true
      },
      "upload-rerender": {
        "receipt": "mock-6ebef09aaf34",
        "server_verified": true,
        "tracker_verified": true
      }
    },
    "rea_calls": 0,
    "closeout_gate": true,
    "verified_at_ns": 1792006398933635400,
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

- **REA 口径：**原无 REA 轮不提供 REA，全部字段来源和复杂点击由模型判断；优化后仅在正常 UI 探查仍无法确定绑定或实际失败时调用。同样成功的控件无需 REA，实际调用次数从日志核验。REA 自身不调用 LLM；解读其证据及后续推理的消耗已计入该轮真实 usage。没有凭文本长度虚构“REA 独立模型 token”。

- **可比范围：**当前已登录 Codex CLI、相同模型/high、两个独立新上下文、每轮相同五类 mock、相同输入事实和完成条件、共用现有 Playwright 备用执行器。原无 REA 轮由模型选择全部字段来源和点击路径；优化后程序映射普通字段、合并往返、去重文档和已读回字段，并用条件诊断。差异包含整个优化组合，不能单独推断某项优化的贡献。

- **预置与模拟：**输入已是确认岗位清单、JD/资格/名额和档案事实；真实求职调研、登录、验证码、人工批准等待不在本轮范围。mock 审核确认显式模拟，未伪造真人耗时。草稿通过服务端 GET 并逐字段对照当前 UI，未计入离开后重开/恢复草稿。默认内置浏览器/Chrome 扩展的完整链路仍需独立测试。

- **解释限制：**每种流程仅一轮，顺序为原无 REA→优化后。结果可说明这次执行，不能推断稳定平均速度、显著性或真实招聘网站效果。账户额度/金额不从 token 数擅自换算。

## 五网站与未测项

整批图每根柱子汇总五个网站；下方五网站图表示从同一批次启动到各站回执核验完成的累计时间，包含前置准备和其他网站等待，不是单站独立耗时。累计 token 是回执时 CLI 已报告的全批共享 usage，不是分配给该站的消耗，也不能把五行相加。模型可能在工具调用后才报告后续 usage，因此各站累计值不会等于最终总量。批量准备可能延迟首份回执，同时缩短整批完成时间。

本页整批数据没有隔离单站 cold/warm；最初 cold/warm 只指语义结构缓存。详见 site-progress.csv，不能把累计值当作独立单站成本。后续另行执行的 [20 格独立模型测试](../20261015-isolated/evaluation.md) 单独报告。


用法和 usage 字段：[Codex 官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)。
