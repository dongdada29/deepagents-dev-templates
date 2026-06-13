# 示例：项目管理（project manager）

把目标拆成任务、估时排期、**评估计划是否完备（不完备就重规划）**，最后**人工审批**——
体现"分解-执行-评估循环 + HITL"这类需求（对比 RAG 的线性检索、travel 的并行、human-in-loop 的纯审）。

对应 LangGraph 官方：**Reflection / evaluator-optimizer** + **Branching（条件边）** + **Human-in-the-loop**。

## 图

```
START → plan → estimate → evaluate ─(条件边)─ 不完备 & 未达上限 → plan(重规划)
                                   └ 否则 → approve(interrupt 审批) → finalize → END
```

| 节点 | 职责 | 看点 |
|---|---|---|
| `plan` | 把目标拆成任务（demo 首轮拆少、重规划补全） | — |
| `estimate` | 给每个任务估时（"执行"步骤） | — |
| `evaluate` | 评估完备性（任务数 ≥ 阈值），写 `decision` | **reflection** |
| `routeAfterEvaluate` | 不完备 & 未达上限 → 回 `plan`；否则 → `approve` | **条件边循环 + 上限** |
| `approve` | `interrupt` 暂停，请人审批 | **HITL** |
| `finalize` | 按审批定稿，输出任务表 + 甘特排期 | — |

> 评估循环用条件边**回边**实现，`MAX_REPLAN` 封顶防死循环——和默认图的 reflect 循环同构，
> 但这里 evaluate 评的是"产物是否达标"（evaluator-optimizer），而非"要不要再调工具"。

## 它如何用模板的 seam

`createPMFlow()` 返回 **`StatefulFlow`**（因 approve 的 interrupt）：`run({query})`→评估循环跑到审批
interrupt、`run({resume})`→finalize。surface（acp/cli）plumbing 完全复用。

## 运行

```bash
pnpm --filter deepagents-app-ts build

pnpm --filter deepagents-flow-ts exec tsx examples/project-manager/index.ts plan "做一个落地页"
pnpm --filter deepagents-flow-ts exec tsx examples/project-manager/index.ts plan -i
pnpm --filter deepagents-flow-ts exec tsx examples/project-manager/index.ts          # ACP 服务
```

CLI 跑到计划会**暂停等你**批准/提意见（同一终端继续输入）。无需模型凭证（节点纯逻辑）。

## 测试

[tests/pm.test.ts](tests/pm.test.ts)：条件边决策表 + 评估循环（首轮不足→重规划补全）+ interrupt→resume 两分支。
