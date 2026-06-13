/**
 * bash 工具 —— 在沙箱内执行 shell 命令。
 *
 * cwd 锁定 workspace 根；read-only profile 禁用；超时SIGTERM。
 * 这是 flow 自管的轻量 StructuredTool（跨 provider 可移植，不依赖 Anthropic server-side bash）。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn } from "node:child_process";
import type { FlowSandboxPolicy } from "../../runtime/sandbox.js";

export function createBashTool(opts: { workspaceRoot: string; policy: FlowSandboxPolicy }) {
  return tool(
    async ({ command, timeoutMs }) => {
      if (opts.policy.profile === "read-only") {
        return "Error: sandbox profile is read-only; bash execution disabled.";
      }
      const timeout = timeoutMs ?? 30000;
      return new Promise<string>((done) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const child = spawn(command, {
          shell: true,
          cwd: opts.workspaceRoot,
          env: { ...process.env },
        });
        const timer = setTimeout(() => {
          timedOut = true;
          if (!child.killed) child.kill("SIGTERM");
        }, timeout);
        child.stdout.on("data", (d: Buffer) => {
          stdout += d.toString();
        });
        child.stderr.on("data", (d: Buffer) => {
          stderr += d.toString();
        });
        child.on("error", (e) => {
          clearTimeout(timer);
          done(`Error: ${e.message}`);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).slice(0, 20000);
          if (timedOut) done(`Error: timed out after ${timeout}ms\n${out}`);
          else done(code === 0 ? out || "(no output)" : `Exit ${code}\n${out}`);
        });
      });
    },
    {
      name: "bash",
      description:
        "在沙箱内执行 shell 命令（cwd=workspace 根）。用于构建/运行/git/系统操作。受 sandbox 约束。",
      schema: z.object({
        command: z.string().describe("要执行的 shell 命令"),
        timeoutMs: z.number().optional().describe("超时毫秒，默认 30000"),
      }),
    }
  );
}
