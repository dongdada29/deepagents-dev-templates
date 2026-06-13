/**
 * Flow 工具沙箱策略 —— 从 AppConfig 解析出工具执行前的路径/能力校验规则。
 *
 * flow-ts 走显式图、不用 deepagents FilesystemMiddleware，故工具（bash/fs/search）
 * 在执行前自己用这套策略校验。语义对齐 app-ts 的 sandbox profile
 * （workspace-write / read-only / open / custom），但实现是 flow-ts 自管的轻量匹配。
 */

import { resolve, relative, isAbsolute } from "node:path";
import type { AppConfig } from "deepagents-app-ts/runtime";

export interface FlowSandboxPolicy {
  profile: "custom" | "workspace-write" | "read-only" | "open";
  writablePaths: string[];
  deniedWritePaths: string[];
}

/** 从 AppConfig 解析出工具沙箱策略（对齐 app-ts resolveSandboxPolicy 语义）。 */
export function getFlowSandboxPolicy(config: AppConfig): FlowSandboxPolicy {
  const sandbox = config.sandbox;
  if (sandbox.profile === "open") {
    return { profile: "open", writablePaths: ["/**"], deniedWritePaths: [] };
  }
  if (sandbox.profile === "read-only") {
    return { profile: "read-only", writablePaths: [], deniedWritePaths: ["/"] };
  }
  if (sandbox.profile === "workspace-write") {
    return {
      profile: "workspace-write",
      writablePaths: sandbox.writablePaths,
      deniedWritePaths: sandbox.deniedWritePaths,
    };
  }
  return {
    profile: "custom",
    writablePaths: config.permissions.allowedPaths,
    deniedWritePaths: config.permissions.deniedPaths,
  };
}

/** 把 workspace 相对/绝对/~/ 路径解析成绝对路径。 */
export function toAbsolutePath(p: string, workspaceRoot: string): string {
  if (isAbsolute(p)) return p;
  if (p.startsWith("~/")) return resolve(process.env.HOME || "", p.slice(2));
  return resolve(workspaceRoot, p);
}

/** 简易 glob 匹配：支持尾部 /** 与单段 *。 */
function matchGlob(path: string, glob: string): boolean {
  const g = glob.replace(/\/+$/, "");
  if (g.endsWith("/**")) return path.startsWith(g.slice(0, -3));
  if (g.endsWith("*")) return path.startsWith(g.slice(0, -1));
  return path === g || path.startsWith(g + "/");
}

/**
 * 判定一次路径访问是否放行。
 * - read：非 read-only 即放行，但限在 workspace 内（open 除外）
 * - write：read-only 全拒；命中 deniedWritePaths 拒；其余放行（writablePaths 作允许提示）
 */
export function isPathAllowed(
  absPath: string,
  workspaceRoot: string,
  policy: FlowSandboxPolicy,
  write: boolean
): { ok: boolean; reason?: string } {
  if (policy.profile !== "open") {
    const rel = relative(workspaceRoot, absPath);
    if (rel.startsWith("..")) {
      return { ok: false, reason: `path outside workspace: ${absPath}` };
    }
  }
  if (!write) return { ok: true };
  if (policy.profile === "read-only") {
    return { ok: false, reason: "sandbox is read-only" };
  }
  for (const denied of policy.deniedWritePaths) {
    const deniedAbs = toAbsolutePath(denied, workspaceRoot);
    if (matchGlob(absPath, deniedAbs)) {
      return { ok: false, reason: `path denied by sandbox: ${denied}` };
    }
  }
  return { ok: true };
}
