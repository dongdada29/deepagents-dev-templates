import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, normalize, resolve, sep } from "node:path";
import { inspectAgent } from "./inspector.js";
import type { TemplateRuntime } from "./template-runtime.js";
import type { AgentOrchestrationSpec } from "./types.js";
import { applyEdits, previewEdits, type EditPayload } from "./editing/writer.js";

export interface InspectServerOptions {
  spec: AgentOrchestrationSpec;
  port?: number;
  portRangeEnd?: number;
  staticDir: string;
  editing?: { runtime: TemplateRuntime; workspaceRoot: string; configPath: string };
}

export interface InspectServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startInspectServer(options: InspectServerOptions): Promise<InspectServerHandle> {
  const startPort = options.port ?? 7322;
  const portRangeEnd = options.portRangeEnd ?? 7332;
  let lastError: unknown;

  for (let port = startPort; port <= portRangeEnd; port += 1) {
    try {
      const server = createInspectHttpServer(options.spec, options.staticDir, options.editing);
      await listen(server, port);
      return {
        url: `http://localhost:${port}`,
        port,
        close: () => close(server),
      };
    } catch (error) {
      lastError = error;
      if (!isAddressInUse(error)) {
        throw error;
      }
    }
  }

  throw new Error(`No available port in range ${startPort}-${portRangeEnd}: ${errorMessage(lastError)}`);
}

function createInspectHttpServer(
  spec: AgentOrchestrationSpec,
  staticDir: string,
  editing?: { runtime: TemplateRuntime; workspaceRoot: string; configPath: string }
): Server {
  const root = resolve(staticDir);
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/api/spec") {
      sendJson(res, 200, spec);
      return;
    }

    if (
      req.method === "POST" &&
      (url.pathname === "/api/preview" || url.pathname === "/api/apply")
    ) {
      if (!editing) {
        res.writeHead(404);
        res.end("Editing not enabled");
        return;
      }
      readJsonBody(req)
        .then((payload: EditPayload) => {
          if (url.pathname === "/api/preview") {
            const preview = previewEdits(
              editing.runtime,
              editing.workspaceRoot,
              editing.configPath,
              payload
            );
            sendJson(res, preview.validation.ok ? 200 : 422, preview);
            return;
          }
          const result = applyEdits(
            editing.runtime,
            editing.workspaceRoot,
            editing.configPath,
            payload
          );
          if (!result.ok) {
            sendJson(res, 422, result);
            return;
          }
          inspectAgent({ workspaceRoot: editing.workspaceRoot, configPath: editing.configPath })
            .then((newSpec) => sendJson(res, 200, { ...result, spec: newSpec }))
            .catch((err) =>
              sendJson(res, 500, { ok: false, errors: [{ message: String(err) }] })
            );
        })
        .catch((err) =>
          sendJson(res, 400, { ok: false, errors: [{ message: String(err) }] })
        );
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = resolve(root, normalize(decodeURIComponent(requested)).replace(/^[/\\]+/, ""));
    if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": contentType(filePath) });
    createReadStream(filePath).pipe(res);
  });
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolveClose();
      }
    });
  });
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function isAddressInUse(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "EADDRINUSE";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readJsonBody(req: IncomingMessage): Promise<EditPayload> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}") as EditPayload);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}
