# 在 Zed 中使用 RAG Agent

## 快速配置

编辑 `~/.config/zed/settings.json`：

```json
{
  "agent_servers": {
    "rag-agent": {
      "type": "custom",
      "command": "/Users/apple/.nvm/versions/node/v24.14.0/bin/tsx",
      "args": [
        "--tsconfig",
        "/Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/tsconfig.json",
        "/Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/src/index.ts"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "<your-anthropic-api-key>",
        "LOG_LEVEL": "debug",
        "LOG_DIR": "/Users/apple/workspace/deepagents-dev-templates-rag/logs"
      }
    }
  }
}
```

## 查看日志

```bash
# 实时查看日志
tail -f /Users/apple/workspace/deepagents-dev-templates-rag/logs/*.jsonl

# 查看 RAG 节点流程
grep -E "\[Rewrite\]|\[Retrieve\]|\[Prepare\]|\[Agent\]" /Users/apple/workspace/deepagents-dev-templates-rag/logs/*.jsonl
```

## 验证节点流程

RAG Agent 执行时会输出以下日志：

```
[Rewrite] 分析意图...
[Retrieve] Using tools: context7 for intent: factual
[Retrieve] Calling MCP tool: context7
[Prepare] 合并结果...
[Agent] 生成回答...
```

## 使用示例

### 查询文档（context7）
```
什么是 LangGraph？
```

### 查询食谱（howtocook-mcp）
```
红烧肉怎么做？
```

## 故障排除

### 查看最新日志
```bash
ls -lt /Users/apple/workspace/deepagents-dev-templates-rag/logs/ | head -5
```

### 清理旧日志
```bash
rm /Users/apple/workspace/deepagents-dev-templates-rag/logs/*.jsonl
```
