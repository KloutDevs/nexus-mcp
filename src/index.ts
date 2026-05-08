#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { request as httpRequest } from "http";

const DEFAULT_PORT = parseInt(process.env.KLOUT_BRIDGE_PORT ?? "9421", 10);
const PORT_SCAN_RANGE = [DEFAULT_PORT, ...Array.from({ length: 10 }, (_, i) => DEFAULT_PORT + i + 1)];

// ─── bridge helper ────────────────────────────────────────────────────────────
function bridge(method: string, path: string, body?: unknown, timeoutMs = 310_000, port = DEFAULT_PORT): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload, "utf8") } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
          catch { resolve(Buffer.concat(chunks).toString("utf8")); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("bridge timeout")); });
    if (payload) req.write(payload, "utf8");
    req.end();
  });
}

// ─── context document ─────────────────────────────────────────────────────────
const CONTEXT = `
# Klout Workspace — Contexto Completo

## Quién es el usuario
Nahuel Schmidt (schmidtnahuel09@gmail.com) — desarrollador fullstack, trabaja en varios proyectos bajo \`C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\\`.

## Proyectos principales

### vscode-mcp
**Repo:** https://github.com/KloutDevs/vscode-mcp
**Ruta local:** \`C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\vscode-mcp\`
**Qué es:** MCP server en TypeScript/Node.js (ESM, stdio) + extensión de VS Code/Cursor (\`cursor-mcp-bridge\`) que conecta Claude Code CLI con el IDE.

**Arquitectura:**
\`\`\`
Claude Code CLI  →  nexus-mcp (este MCP)  →  HTTP :9421  →  cursor-mcp-bridge extension  →  Cursor IDE
\`\`\`

**Extension bridge** (\`extension/\`):
- Se instala en Cursor como extensión VSIX
- Corre un servidor HTTP en \`127.0.0.1:9421\`
- Expone endpoints: /status, /chat/open, /chat/send, /chat/send_and_wait, /chat/read, /chat/status, /commands, /command, /model/set, /model/picker, /editor/open, /editor/state, /diagnostics
- Detecta fin de respuesta de Cursor vía \`fs.watch\` sobre el JSONL de transcript (sin timeouts, notificación real)
- Versión actual: 1.1.2

**Deploy script:** \`scripts/deploy.sh\` — build + package VSIX + cursor --install-extension + reload window

**Convención:** siempre subir versión en extension/package.json antes de cada commit.

### HonorBridge
**Repo:** github.com/honortrading-oficial/HonorBridge
**Ruta local:** \`C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\HonorBridge\`
**Qué es:** Plataforma de agregación de datos de brokers MetaTrader (MT4/MT5).

**Arquitectura:**
- \`broker-bridge\` (Go + gRPC): corre en VPS Windows, envuelve DLLs de MT4/MT5 via CGO, expone cuenta/trades/equity por gRPC. Stateless (MemoryStore).
- \`broker-gateway\` (TypeScript + Fastify): corre en Railway. JWT + cookies httpOnly + bcrypt. Credenciales cifradas con AES-256-GCM. Proxy gRPC hacia bridge. MongoDB + Redis. SPA admin en Vite/React.
- Al arrancar, gateway rehidrata el bridge desde Mongo.

**Rama activa:** \`feat/broker-server-registry\`

### nexus-mcp (este MCP)
**Ruta local:** \`C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\nexus-mcp\`
**Qué es:** MCP global instalado en Claude Code para dar contexto y controlar Cursor en cualquier sesión.

## Cursor MCP Bridge — cómo funciona

Cuando \`cursor-mcp-bridge\` está activo en Cursor (ícono \`MCP :9421\` en barra de estado), Claude Code puede:

1. **cursor_status** — verificar que el bridge esté vivo
2. **cursor_open_chat** — abrir chat/composer/agente (devuelve \`since_ms\` para scoping)
3. **cursor_send_and_wait** — enviar mensaje y esperar respuesta completa (blocking via fs.watch)
4. **cursor_read_chat** — leer historial de la conversación actual
5. **cursor_set_model** — cambiar el modelo de IA
6. **cursor_open_file** — abrir archivo en el editor
7. **cursor_editor_state** — archivo activo, línea, selección
8. **cursor_diagnostics** — errores y warnings del LSP
9. **cursor_run_command** — ejecutar cualquier comando de VS Code/Cursor
10. **cursor_list_commands** — listar comandos disponibles

**Flujo de conversación con Cursor:**
\`\`\`
const { since_ms } = await cursor_open_chat({ mode: "agent" });
const r1 = await cursor_send_and_wait({ message: "...", since_ms });
const r2 = await cursor_send_and_wait({ message: "...", since_ms });
\`\`\`

**Detección de fin de respuesta:** \`fs.watch\` sobre el archivo JSONL del transcript. Se resuelve cuando el último mensaje assistant NO tiene bloques \`tool_use\` (= respuesta final, no paso intermedio). Sin polling, sin timers.

## Preferencias del usuario
- Siempre versionar antes de commit
- Siempre buildear VSIX antes de probar cambios en Cursor
- Usar \`scripts/deploy.sh\` para deploy automático
- No usar timeouts arbitrarios — preferir notificaciones reales
- Respuestas concisas, sin resúmenes innecesarios al final
`.trim();

// ─── server ───────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "nexus-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_context",
      description: "Returns full context about Nahuel's workspace: projects (vscode-mcp, HonorBridge, nexus-mcp), architecture, how the Cursor bridge works, and user preferences. Call this at the start of any session to get up to speed.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cursor_list_workspaces",
      description: "Discover all active Cursor bridge instances. Returns each open Cursor window with its workspace name and port. Use when multiple Cursor projects are open simultaneously.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cursor_status",
      description: "Check if the Cursor MCP bridge is running. Pass port to target a specific Cursor window.",
      inputSchema: {
        type: "object",
        properties: {
          port: { type: "number", description: "Bridge port (default 9421). Use cursor_list_workspaces to find the right port." },
        },
      },
    },
    {
      name: "cursor_open_chat",
      description: "Open a new chat, composer, or agent panel in Cursor. Returns since_ms, workspace and port — store them to scope all subsequent calls to this session.",
      inputSchema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["chat", "composer", "agent"], description: "Panel to open (default: agent)" },
          port: { type: "number", description: "Bridge port. Use cursor_list_workspaces to find it." },
        },
      },
    },
    {
      name: "cursor_send_and_wait",
      description: "Send a message to the active Cursor agent and block until Cursor finishes responding. Uses fs.watch on the JSONL transcript — resolves the instant Cursor writes a final (non-tool-use) assistant message. No polling.",
      inputSchema: {
        type: "object",
        properties: {
          message:    { type: "string", description: "Message to send" },
          since_ms:   { type: "number", description: "Timestamp from cursor_open_chat to scope this session" },
          timeout_ms: { type: "number", description: "Safety-valve timeout in ms (default 300000)" },
        },
        required: ["message", "since_ms"],
      },
    },
    {
      name: "cursor_send",
      description: "Send a message to Cursor and return as soon as it's confirmed in the transcript (no waiting for Cursor's reply). On first call pass since_ms; after that pass composer_id for targeted, session-isolated delivery.",
      inputSchema: {
        type: "object",
        properties: {
          message:     { type: "string", description: "Message to send" },
          since_ms:    { type: "number", description: "Timestamp from cursor_open_chat — used only when composer_id is unknown" },
          composer_id: { type: "string", description: "Composer ID returned by a previous cursor_send call — use this for all messages after the first" },
          port:        { type: "number", description: "Bridge port (from cursor_list_workspaces or cursor_open_chat)" },
        },
        required: ["message"],
      },
    },
    {
      name: "cursor_read_chat",
      description: "Read the conversation history of a Cursor agent session. Pass composer_id for direct, unambiguous access to a specific session.",
      inputSchema: {
        type: "object",
        properties: {
          composer_id: { type: "string", description: "Composer ID from cursor_send response — preferred over since_ms" },
          since_ms:    { type: "number", description: "Fallback: filter transcripts by creation time" },
          port:        { type: "number", description: "Bridge port" },
        },
      },
    },
    {
      name: "cursor_set_model",
      description: "Change the active AI model in Cursor (e.g. claude-sonnet-4-5, claude-opus-4-7, gpt-4o).",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string", description: "Model slug to activate" },
        },
        required: ["model"],
      },
    },
    {
      name: "cursor_open_file",
      description: "Open a file in the Cursor editor, optionally jumping to a specific line.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute file path" },
          line: { type: "number", description: "Line number (1-indexed)" },
        },
        required: ["path"],
      },
    },
    {
      name: "cursor_editor_state",
      description: "Get the currently active editor: file path, cursor position, selected text, open editors.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cursor_diagnostics",
      description: "Get all errors and warnings from Cursor's language servers.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "cursor_run_command",
      description: "Execute any VS Code / Cursor command by ID. Use cursor_list_commands to discover IDs.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command ID" },
          args:    { type: "array",  description: "Optional arguments" },
        },
        required: ["command"],
      },
    },
    {
      name: "cursor_list_commands",
      description: "List available VS Code / Cursor commands, optionally filtered by keyword.",
      inputSchema: {
        type: "object",
        properties: {
          filter: { type: "string", description: "Keyword filter (e.g. 'chat', 'model', 'glass')" },
        },
      },
    },
    {
      name: "cursor_deploy_extension",
      description: "Build, package, install and reload the cursor-mcp-bridge extension in one shot. Run this after any change to the extension source.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    switch (name) {
      case "get_context":
        return { content: [{ type: "text", text: CONTEXT }] };

      case "cursor_list_workspaces": {
        const results: Array<{ port: number; workspace: string; version: string }> = [];
        await Promise.all(PORT_SCAN_RANGE.map(async (p) => {
          try {
            const r = await bridge("GET", "/status", undefined, 3_000, p) as Record<string, unknown>;
            if (r?.active) results.push({ port: p, workspace: String(r.workspace ?? ""), version: String(r.version ?? "") });
          } catch { /* not running */ }
        }));
        results.sort((a, b) => a.port - b.port);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "cursor_status": {
        const port = (a.port as number | undefined) ?? DEFAULT_PORT;
        const r = await bridge("GET", "/status", undefined, 10_000, port);
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_open_chat": {
        const port = (a.port as number | undefined) ?? DEFAULT_PORT;
        const openedAt = Date.now();
        const r = await bridge("POST", "/chat/open", { mode: (a.mode as string | undefined) ?? "agent" }, 10_000, port) as Record<string, unknown>;
        const status = await bridge("GET", "/status", undefined, 5_000, port) as Record<string, unknown>;
        return { content: [{ type: "text", text: JSON.stringify({ ...r, since_ms: openedAt, port, workspace: status.workspace ?? "" }, null, 2) }] };
      }

      case "cursor_send_and_wait": {
        const sinceMs   = a.since_ms as number;
        const maxWaitMs = (a.timeout_ms as number | undefined) ?? 300_000;
        const pollMs    = 4_000;   // interval between /chat/read polls
        const sendTimeoutMs = 60_000; // single send call timeout

        // Step 1: send with confirmation (short timeout per attempt)
        const sent = await bridge("POST", "/chat/send_and_wait", {
          message:    a.message,
          since_ms:   sinceMs,
          timeout_ms: sendTimeoutMs,
        }, sendTimeoutMs + 5_000) as { ok?: boolean; text?: string; error?: string; waited_ms?: number; attempt?: number };

        // If bridge already returned a full response within sendTimeoutMs, we're done
        if (sent.ok && sent.text) {
          return { content: [{ type: "text", text: `**Cursor** (${sent.waited_ms}ms):\n\n${sent.text}` }] };
        }

        // If send failed entirely (not a timeout), surface the error
        if (!sent.ok && sent.error && !sent.error.includes("timeout")) {
          return { content: [{ type: "text", text: `Error: ${sent.error}` }], isError: true };
        }

        // Step 2: Cursor is still working — poll /chat/read until response appears
        const deadline = Date.now() + maxWaitMs;
        let prevAssistantCount = -1;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, pollMs));

          const read = await bridge("GET", `/chat/read?since=${sinceMs}`, undefined, 10_000)
            .catch(() => null) as { messages?: Array<{ role: string; text: string }> } | null;

          if (!read?.messages) continue;

          const assistants = read.messages.filter(m => m.role === "assistant");

          // First poll — establish baseline count
          if (prevAssistantCount === -1) {
            prevAssistantCount = assistants.length;
            continue;
          }

          // New assistant message appeared → response is ready
          if (assistants.length > prevAssistantCount) {
            const reply = assistants[assistants.length - 1].text;
            return { content: [{ type: "text", text: `**Cursor**:\n\n${reply}` }] };
          }
        }

        return { content: [{ type: "text", text: "Timeout: Cursor no respondió dentro del tiempo límite." }], isError: true };
      }

      case "cursor_send": {
        const port = (a.port as number | undefined) ?? DEFAULT_PORT;
        const r = await bridge("POST", "/chat/send", {
          message:     a.message,
          since_ms:    a.since_ms,
          composer_id: a.composer_id,
        }, 65_000, port) as { ok?: boolean; confirmed?: boolean; composerId?: string; workspace?: string; attempt?: number; error?: string };
        if (!r.ok || !r.confirmed) {
          return { content: [{ type: "text", text: `Error: ${r.error ?? "send not confirmed"}` }], isError: true };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ confirmed: true, composer_id: r.composerId, workspace: r.workspace, port, attempt: r.attempt }),
          }],
        };
      }

      case "cursor_read_chat": {
        const port = (a.port as number | undefined) ?? DEFAULT_PORT;
        const composerId = a.composer_id as string | undefined;
        const qs = composerId
          ? `?composer_id=${encodeURIComponent(composerId)}`
          : `?since=${a.since_ms ?? 0}`;
        const r = await bridge("GET", `/chat/read${qs}`, undefined, 10_000, port);
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_set_model": {
        const r = await bridge("POST", "/model/set", { model: a.model });
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_open_file": {
        const r = await bridge("POST", "/editor/open", { path: a.path, line: a.line });
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_editor_state": {
        const r = await bridge("GET", "/editor/state");
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_diagnostics": {
        const r = await bridge("GET", "/diagnostics");
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_run_command": {
        const r = await bridge("POST", "/command", { command: a.command, args: a.args });
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_list_commands": {
        const qs = a.filter ? `?filter=${encodeURIComponent(a.filter as string)}` : "";
        const r = await bridge("GET", `/commands${qs}`);
        return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
      }

      case "cursor_deploy_extension": {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        const scriptPath = "C:/Users/bigma/Desktop/Nahuel/Trabajo/vscode-mcp/scripts/deploy.sh";
        const { stdout, stderr } = await execAsync(`bash "${scriptPath}"`, { timeout: 120_000 });
        return { content: [{ type: "text", text: stdout || stderr }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("nexus-mcp running\n");
}
main().catch(e => { process.stderr.write(`${e}\n`); process.exit(1); });
