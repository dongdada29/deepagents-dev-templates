# DeepAgents Dev Templates

Monorepo for building, inspecting, and distributing DeepAgents AI applications.

## Packages

| Package | Description |
|---|---|
| [`packages/template`](./packages/template/) | DeepAgents application template — ACP server, tools, skills, config, distribution |
| [`packages/inspector`](./packages/inspector/) | Read-only orchestration visualizer — inspect agent structure, middleware chain, and LangGraph topology |
| [`packages/dev-agent`](./packages/dev-agent/) | Developer agent config and skills |

## Quick Start

```bash
npm install
npm run build -w packages/template
```

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Build template |
| `npm test` | Run template tests |
| `npm run graph` | Generate code relationship graph |
| `npm run inspect` | Inspect agent orchestration (dry-run by default) |
| `npm run inspect -- --full` | Full inspection with LangGraph runtime topology |
