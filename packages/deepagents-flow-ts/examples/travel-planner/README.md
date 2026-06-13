# 示例：旅行规划（travel planner）

把一个目标拆成多个方面**并行**处理、聚合，再让用户确认/调整——`deepagents-flow-ts` 能做的
又一类需求（对比 RAG 的线性检索、默认图的迭代循环、human-in-loop 的纯审）。

对应 LangGraph 官方：**Map-reduce（`Send` 动态扇出）** + **Human-in-the-loop**（`interrupt` / `Command`）。

## 图

```
START → gather → ⟨Send 并行⟩ research × 4（交通/住宿/景点/美食）
      → aggregate → confirm(interrupt 确认/调整) → finalize → END
```

| 节点 | 职责 | 看点 |
|---|---|---|
| `gather` | 解析目的地 + 天数 | 纯逻辑 |
| `fanoutToResearch` | 对每个 aspect 派一个 research（条件边返回 `Send[]`） | **map 扇出** |
| `research` | 处理单个 aspect（并行实例），`runTool` 透出检索过程 | **并行 + onToolCall** |
| `aggregate` | 等所有并行完成后合成行程草案（barrier） | **reduce（reducer channel）** |
| `confirm` | `interrupt` 暂停，请用户确认/调整 | **HITL** |
| `finalize` | 按回复定稿 | — |

> `findings` channel 用 **reducer** 聚合：并行节点写同一 channel 必须用 reducer，否则互相覆盖。
> 这是和顺序流（默认图 `observe` 手动 append）的关键区别。

## 它如何用模板的 seam

`createTravelFlow()` 返回一个 **`StatefulFlow`**（因为有 confirm 的 interrupt）：`run({query})`→interrupted、
`run({resume})`→done。`onToolCall` 经 `config.configurable` 透传给并行的 research 实例（callbacks 随调用
流动，不污染固定的图 / checkpointer）。surface（acp/cli）plumbing 完全复用。

## 运行

```bash
pnpm --filter deepagents-app-ts build

pnpm --filter deepagents-flow-ts exec tsx examples/travel-planner/index.ts plan "东京 3 天 美食优先"
pnpm --filter deepagents-flow-ts exec tsx examples/travel-planner/index.ts plan -i
pnpm --filter deepagents-flow-ts exec tsx examples/travel-planner/index.ts          # ACP 服务
```

CLI 跑到行程草案会**暂停等你**输入确认/调整意见（同一终端继续输入）。无需模型凭证（节点用 demo 数据）。

## 测试

[tests/travel.test.ts](tests/travel.test.ts)：并行 4 aspect 聚合 + `onToolCall` 并发（各 4 次）+ interrupt→resume 两分支。
