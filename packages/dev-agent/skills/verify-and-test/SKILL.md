---
name: verify-and-test
description: "完整验证流程：build → typecheck → test → ACP smoke test → graph（支持 TS / Python 模板）"
tags: [testing, verification, build, quality]
version: "2.0.0"
---

# 验证与测试

## When to Use
每次开发任务完成后，必须执行完整验证流程。

> **注意**：以下按模板类型分开描述。先用 `template-init` 技能确认当前项目类型。

## TypeScript 模板验证流程

### Step 1: 编译检查
```bash
pnpm run build
```
- 预期：无错误，`dist/` 目录生成
- 失败处理：修复 TypeScript 错误后重试

常见编译错误：
| 错误码 | 原因 | 修复 |
|--------|------|------|
| TS2307 | 找不到模块 | 检查安装和 `.js` 后缀 |
| TS2345 | 类型不匹配 | 检查 Zod schema 和函数签名 |
| TS2554 | 参数数量错误 | 检查函数签名 |
| TS1343 | `import.meta.url` 问题 | 确认 ESM 配置 |

### Step 2: 类型检查
```bash
pnpm run typecheck
```

### Step 3: Lint 检查
```bash
pnpm run lint
```

### Step 4: 单元测试
```bash
pnpm test
```
测试文件命名：`tests/unit/{module-name}.test.ts`

测试结构（Arrange/Act/Assert）：
```typescript
import { describe, it, expect } from "vitest";

describe("myTool", () => {
  it("should handle valid input", async () => {
    // Arrange
    const input = { param1: "test" };
    // Act
    const result = await myTool.invoke(input);
    // Assert
    expect(result).toContain("success");
  });
});
```

### Step 5: ACP Smoke Test
```bash
pnpm run test:acp-smoke
```

### Step 6: 代码图生成
```bash
pnpm run graph
```

---

## Python 模板验证流程

> **TODO (Python)**：以下为 Python 验证流程占位，需根据 `deepagents-app-py` 实际命令补充。

### Step 1: Lint 检查
```bash
uv run ruff check .
```

### Step 2: 类型检查
```bash
uv run pyright
```

### Step 3: 单元测试
```bash
uv run pytest
```

### Step 4: 构建检查
```bash
uv build
```

---

## 综合检查（通用）

手动检查清单：
- [ ] 没有 `any` 类型（TS）/ 没有 `Any` 注解（Python）
- [ ] 没有硬编码密钥
- [ ] TS: 所有导入路径带 `.js` 后缀
- [ ] 新工具有 schema + 字段描述
- [ ] 新技能有正确的 YAML frontmatter
- [ ] 提示词已通过 `save_prompt` 保存
- [ ] 变量已通过 `agent_variable` 创建

## 验证结果报告
```
✅ 验证结果：
| 检查项 | 结果 |
|--------|------|
| build | ✅ 通过 |
| typecheck | ✅ 通过 |
| lint | ✅ 通过 |
| test | ✅ N/N 通过 |
| acp-smoke | ✅ 通过 |
| graph | ✅ 生成成功 |
| 代码规范 | ✅ 无违规 |

需要用户操作：
- 填写 WEATHER_API_KEY 变量值
- 确认 MCP weather-server 配置
```

## 失败处理
1. **编译失败** → 读错误信息 → 修复代码 → 重新 build
2. **测试失败** → 读测试输出 → 定位失败用例 → 修复逻辑或测试
3. **类型错误** → 检查 schema 是否与类型一致
4. **依赖缺失** → TS: `pnpm install <package>` / Python: `uv add <package>` → 重新 build

## Anti-patterns
- ❌ 跳过验证直接报告完成
- ❌ 只跑 build 不跑 test
- ❌ 测试失败后声明"基本完成"
- ❌ 不检查代码规范（any 类型、硬编码密钥）
- ✅ 按顺序执行所有验证步骤
- ✅ 所有步骤通过后才报告完成
- ✅ 失败时给出具体错误和修复方案
