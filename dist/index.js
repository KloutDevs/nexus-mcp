#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { request as httpRequest } from "http";
const BRIDGE_PORT = parseInt(process.env.KLOUT_BRIDGE_PORT ?? "9421", 10);
// ─── bridge helper ────────────────────────────────────────────────────────────
function bridge(method, path, body, timeoutMs = 310_000) {
    return new Promise((resolve, reject) => {
        const payload = body !== undefined ? JSON.stringify(body) : undefined;
        const req = httpRequest({
            hostname: "127.0.0.1",
            port: BRIDGE_PORT,
            path,
            method,
            timeout: timeoutMs,
            headers: {
                "Content-Type": "application/json; charset=utf-8",
                ...(payload ? { "Content-Length": Buffer.byteLength(payload, "utf8") } : {}),
            },
        }, (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
                }
                catch {
                    resolve(Buffer.concat(chunks).toString("utf8"));
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("bridge timeout")); });
        if (payload)
            req.write(payload, "utf8");
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
Claude Code CLI  →  klout-mcp (este MCP)  →  HTTP :9421  →  cursor-mcp-bridge extension  →  Cursor IDE
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

### klout-mcp (este MCP)
**Ruta local:** \`C:\\Users\\bigma\\Desktop\\Nahuel\\Trabajo\\klout-mcp\`
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
const server = new Server({ name: "klout-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "get_context",
            description: "Returns full context about Nahuel's workspace: projects (vscode-mcp, HonorBridge, klout-mcp), architecture, how the Cursor bridge works, and user preferences. Call this at the start of any session to get up to speed.",
            inputSchema: { type: "object", properties: {} },
        },
        {
            name: "cursor_status",
            description: "Check if the Cursor MCP bridge is running on port 9421.",
            inputSchema: { type: "object", properties: {} },
        },
        {
            name: "cursor_open_chat",
            description: "Open a new chat, composer, or agent panel in Cursor. Returns since_ms — pass it to cursor_send_and_wait to scope the session.",
            inputSchema: {
                type: "object",
                properties: {
                    mode: { type: "string", enum: ["chat", "composer", "agent"], description: "Panel to open (default: agent)" },
                },
            },
        },
        {
            name: "cursor_send_and_wait",
            description: "Send a message to the active Cursor agent and block until Cursor finishes responding. Uses fs.watch on the JSONL transcript — resolves the instant Cursor writes a final (non-tool-use) assistant message. No polling.",
            inputSchema: {
                type: "object",
                properties: {
                    message: { type: "string", description: "Message to send" },
                    since_ms: { type: "number", description: "Timestamp from cursor_open_chat to scope this session" },
                    timeout_ms: { type: "number", description: "Safety-valve timeout in ms (default 300000)" },
                },
                required: ["message", "since_ms"],
            },
        },
        {
            name: "cursor_read_chat",
            description: "Read the full conversation history of the current Cursor agent session.",
            inputSchema: {
                type: "object",
                properties: {
                    since_ms: { type: "number", description: "Filter to transcripts created after this timestamp" },
                },
                required: ["since_ms"],
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
                    args: { type: "array", description: "Optional arguments" },
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
    const a = (args ?? {});
    try {
        switch (name) {
            case "get_context":
                return { content: [{ type: "text", text: CONTEXT }] };
            case "cursor_status": {
                const r = await bridge("GET", "/status");
                return { content: [{ type: "text", text: JSON.stringify(r, null, 2) }] };
            }
            case "cursor_open_chat": {
                const openedAt = Date.now();
                const r = await bridge("POST", "/chat/open", { mode: a.mode ?? "agent" });
                return { content: [{ type: "text", text: JSON.stringify({ ...r, since_ms: openedAt }, null, 2) }] };
            }
            case "cursor_send_and_wait": {
                const r = await bridge("POST", "/chat/send_and_wait", {
                    message: a.message,
                    since_ms: a.since_ms,
                    timeout_ms: a.timeout_ms ?? 300_000,
                }, 310_000);
                if (!r.ok)
                    return { content: [{ type: "text", text: `Error: ${r.error}` }], isError: true };
                return { content: [{ type: "text", text: `**Cursor** (${r.waited_ms}ms, attempt ${r.attempt}):\n\n${r.text}` }] };
            }
            case "cursor_read_chat": {
                const r = await bridge("GET", `/chat/read?since=${a.since_ms ?? 0}`);
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
                const qs = a.filter ? `?filter=${encodeURIComponent(a.filter)}` : "";
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
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write("klout-mcp running\n");
}
main().catch(e => { process.stderr.write(`${e}\n`); process.exit(1); });
