import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The inspector loads template *source* when INSPECTOR_TEMPLATE_SOURCE=1 (its
// default test mode). template-runtime.ts resolves the template package source
// dynamically (preferring packages/template, falling back to deepagents-app-ts).
// Template source uses the `@runtime/*` tsconfig path alias, but vitest does not
// read the template's tsconfig `paths` — mirror that single mapping here so the
// source-import channel resolves. (`.js` specifiers resolve to the corresponding
// `.ts` files via vite's built-in extension trying.)
const templatePkg = fileURLToPath(new URL("../deepagents-app-ts", import.meta.url));
const templateRuntime = `${templatePkg}/src/runtime`;

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    testTimeout: 30000,
  },
  resolve: {
    alias: [
      // Template source uses `@runtime/*` tsconfig path alias
      { find: /^@runtime\//, replacement: `${templateRuntime}/` },
    ],
  },
});
