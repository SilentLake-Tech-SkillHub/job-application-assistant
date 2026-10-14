# 真实模型全链路测试

本次配对实测：增强流程总 token 增加 27.1%，完整耗时 增加 42.4%。两轮各验证 5/5 份回执。

本轮模型请求从 29 次变为 36 次；增强轮三次 REA 工具共耗时 25.02 秒。程序减少了普通字段的人工映射决策，但本次没有减少模型往返总次数。REA 脚本证据、额外指南和持续重发的上下文均进入真实输入 usage。不能把先前 76%–90% 的交互文本减少当作全链路模型消耗节省。

## 现有流程

```json
{
  "model": "gpt-5.6-sol",
  "completed": true,
  "wall_seconds": 125.71356679999735,
  "to_batch_verified_seconds": 121.9134025,
  "usage": {
    "input_tokens": 1148359,
    "cached_input_tokens": 1091072,
    "output_tokens": 3525,
    "reasoning_output_tokens": 1185,
    "cache_write_input_tokens": 0,
    "total_tokens": 1151884,
    "uncached_input_tokens": 57287
  },
  "request_count": 29,
  "rea_cli_seconds": 0,
  "verified_batch": {
    "sites": {
      "native-bilingual": {
        "receipt": "mock-6b1db345a59b",
        "server_verified": true,
        "tracker_verified": true
      },
      "search-dropdown": {
        "receipt": "mock-f149944a22b5",
        "server_verified": true,
        "tracker_verified": true
      },
      "date-cascade": {
        "receipt": "mock-b812a08b4d10",
        "server_verified": true,
        "tracker_verified": true
      },
      "repeated-education": {
        "receipt": "mock-cd8a08b4080e",
        "server_verified": true,
        "tracker_verified": true
      },
      "upload-rerender": {
        "receipt": "mock-380c13e8db42",
        "server_verified": true,
        "tracker_verified": true
      }
    },
    "rea_calls": 0,
    "closeout_gate": true,
    "verified_at_ns": 1791997915420024500
  }
}
```

## REA 增强流程

```json
{
  "model": "gpt-5.6-sol",
  "completed": true,
  "wall_seconds": 179.01531080000132,
  "to_batch_verified_seconds": 174.7042704,
  "usage": {
    "input_tokens": 1460041,
    "cached_input_tokens": 1392256,
    "output_tokens": 4111,
    "reasoning_output_tokens": 1765,
    "cache_write_input_tokens": 0,
    "total_tokens": 1464152,
    "uncached_input_tokens": 67785
  },
  "request_count": 36,
  "rea_cli_seconds": 25.0211229,
  "verified_batch": {
    "sites": {
      "native-bilingual": {
        "receipt": "mock-fe9e44c73716",
        "server_verified": true,
        "tracker_verified": true
      },
      "search-dropdown": {
        "receipt": "mock-44286243e88d",
        "server_verified": true,
        "tracker_verified": true
      },
      "date-cascade": {
        "receipt": "mock-157cc5db3db7",
        "server_verified": true,
        "tracker_verified": true
      },
      "repeated-education": {
        "receipt": "mock-cb6f4df258c5",
        "server_verified": true,
        "tracker_verified": true
      },
      "upload-rerender": {
        "receipt": "mock-83bad1f74be9",
        "server_verified": true,
        "tracker_verified": true
      }
    },
    "rea_calls": 3,
    "closeout_gate": true,
    "verified_at_ns": 1791998094381803600
  }
}
```



- **时间边界：**从启动 Codex CLI 到完整模型回合和进程退出；另列“批次核验完成”时间。包含 Skill/档案读取、浏览器/工作区初始化、模型与网络等待、DOM 观察、REA、填写/重试、草稿保存与读回、模拟审核批准、实际 mock 提交、服务端回执核验和 Excel 台账读回。

- **真实 token：**来自 CLI turn.completed，并与该轮独立会话 rollout 的 token_count 交叉核对。input 包含 cached input；output 包含 reasoning。总量 = input + output，不能再次加缓存或推理。每次请求重新携带的上下文按实际 usage 累计。

- **REA 口径：**增强轮在搜索下拉、日期级联、上传重渲染三类复杂表单主动调用真实 REA CLI，并把捕获的前端脚本交给模型判断。生产流程仍按需诊断。REA 自身不调用 LLM；解读其证据及后续推理的消耗已计入该轮真实 usage。没有凭文本长度虚构“REA 独立模型 token”。

- **可比范围：**当前已登录 Codex CLI、相同模型/high、两个独立新上下文、每轮相同五类 mock、相同输入事实和完成条件、共用现有 Playwright 备用执行器。现有轮由模型选择全部字段来源和控件路径；增强轮用程序映射普通字段，模型处理异常并解读 REA。

- **预置与模拟：**输入已是确认岗位清单、JD/资格/名额和档案事实；真实求职调研、登录、验证码、人工批准等待不在本轮范围。mock 审核确认显式模拟，未伪造真人耗时。草稿通过服务端 GET 并逐字段对照当前 UI，未计入离开后重开/恢复草稿。默认内置浏览器/Chrome 扩展的完整链路仍需独立测试。

- **解释限制：**每种流程仅一轮，顺序为现有→增强。结果可说明这次执行，不能推断稳定平均速度、显著性或真实招聘网站效果。账户额度/金额不从 token 数擅自换算。

用法和 usage 字段：[Codex 官方文档](https://learn.chatgpt.com/docs/non-interactive-mode)。

前置失败尝试额外已报告 111,699 token，73.03 秒，独立保存在 unavailable-model-attempts.json 和 tool-policy-attempts.json。未知 usage 没有记为零。
