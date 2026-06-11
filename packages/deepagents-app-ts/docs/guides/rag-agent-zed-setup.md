# 在 Zed 中使用 RAG Agent

## 快速配置

编辑 `~/.config/zed/settings.json`：

```json
{
  "agent_servers": {
    "rag-agent": {
      "type": "custom",
      "command": "node",
      "args": [
        "--import",
        "tsx",
        "/Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/src/index.ts",
        "--config",
        "/Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/config/rag-agent.config.json"
      ],
      "env": {
        "ANTHROPIC_API_KEY": "<your-anthropic-api-key>",
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

## 使用步骤

1. **修改配置**：将 `<your-anthropic-api-key>` 替换为你的 API Key

2. **重启 Zed**：修改 settings.json 后需要重启或 reload Zed

3. **打开 Agent 面板**：在 Zed 中按 `Cmd+?` 或点击底部 Agent 面板

4. **选择 RAG Agent**：在 Agent 面板顶部选择 `rag-agent`

5. **开始对话**：直接输入问题即可

## 使用示例

### 查询文档（context7）
```
什么是 LangGraph？
```

### 查询食谱（howtocook-mcp）
```
红烧肉怎么做？
```

### 混合查询
```
如何用 LangGraph 构建 RAG 应用？
```

## 工作流程

```
你的问题 → Rewrite(意图识别) → Retrieve(MCP检索) → Prepare(结果处理) → Agent(生成回答)
```

- **context7**：查询技术文档
- **howtocook-mcp**：查询烹饪食谱

## 验证 MCP 工具

测试 MCP 工具是否正常工作：

```bash
# 测试 context7
npx -y @upstash/context7-mcp

# 测试 howtocook-mcp
npx -y howtocook-mcp
```

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API Key | 是 |
| `LOG_LEVEL` | 日志级别 (debug/info/warn/error) | 否 |

## 故障排除

### MCP 工具不工作
```bash
# 检查 npx 是否可用
which npx

# 手动测试 MCP 工具
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | npx -y @upstash/context7-mcp
```

### Agent 无响应
1. 检查 API Key 是否正确
2. 查看日志：`tail -f /Users/apple/workspace/deepagents-dev-templates-rag/logs/*.log`
3. 确认 Zed 已重启

### 重置配置
```bash
# 恢复默认配置
cp /Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/config/app-agent.config.json \
   /Users/apple/workspace/deepagents-dev-templates-rag/packages/deepagents-app-ts/config/rag-agent.config.json
```
