# pi-kot

<img width="2560" height="1440" alt="New Project" src="https://github.com/user-attachments/assets/fa6a4dd8-c61e-43e4-ba36-4b5bf2640745" />

> A browser-based UI wrapper for the [pi coding agent](https://pi.dev)

pi-kot wraps the `@earendil-works/pi-coding-agent` SDK in an HTTP bridge with a React-based web UI. It exposes the agent's capabilities through REST, SSE, and WebSocket, giving you a fully interactive chat-and-terminal environment in your browser — no desktop app required.

Changes and SDK upgrades are tracked in [CHANGELOG.md](./CHANGELOG.md).

---

## Motivation

pi-kot was created because I was looking for an agentic harness with minimal token usage and high customization — one that behaves the way I want and looks the way I want. I've used many, and I really like Hermes, but I'm in love with Pi.

Then I decided to push Qwen3.6-35B-A3B to its absolute limit to build pi-kot. The setup I use is an RTX 3060 12GB VRAM running Qwen3 through llama.cpp with turboquant by [TheTom](https://github.com/TheTom/llama-cpp-turboquant), keeping context around 120k. That gets me to about 19-25 tps — painfully slow — but it stays stable: no failures, no tool-calling loops. pi-kot is built 90% with Qwen3.6-35B-A3B.

This project was built out of **love and curiosity**.

---

## Features

| Feature | Description |
| --- | --- |
| **💬 Chat** | Full agent conversation with streaming, markdown rendering, code blocks with syntax highlighting, diff views, and KaTeX math — no intermediate adapter, SDK types consumed directly |
| **🗂️ Trail / Tool Grouping** | Consecutive tool calls collapse into a single **Trail** card. In-between agent reasoning appears as collapsible **Justification** steps with a chain-of-thought view that follows the agent live |
| **🌐 Internationalization** | Full multi-language support (**English** & **简体中文 / Simplified Chinese**), auto-detected from browser locale or configurable in Settings |
| **🖥️ Terminal** | Multi-tab xterm.js terminal with persistent PTY sessions, **touch gestures** (long-press+drag arrows, double-tap Tab, 3-finger paste), and a mobile quick-keys bar |
| **📁 File Explorer** | Browse, read, edit, and manage files in your project workspace with auto-refresh on agent edits, folder drag-and-drop uploads, drag-to-move, and ZIP downloads |
| **🔧 MCP Support** | Add, configure, and toggle MCP servers with a full settings UI |
| **💾 Persistent UI Prefs** | Theme, language, sticky header, token usage toggle, image compression, trail view — saved **server-side** in `~/.pi/agent/ui-settings.json`. Survives browser cache clears and device switches |
| **🧩 Orchestration** | Multi-agent workflows — supervise sub-agents, delegate tasks, inspect results |
| **🔐 Auth** | Password-based login, API key support, JWT sessions |
| **📱 Mobile-friendly** | PWA-ready, adaptive layout, touch gestures, virtual keyboard support |
| **🔄 Session persistence** | Sessions survive restarts via JSONL on disk; reattach on reconnect |
| **🎨 Unified Theme System** | Consistent light/dark theme tokens across panels, modals, inputs, and terminal chrome |
| **🔌 Tunnel** | Built-in tunnel helper UI for exposing local pi-kot traffic via supported providers, with install checks, diagnostics, and one-click start/stop |
| **📦 Extensions** | Discover and install pi extensions from the UI — some features only appear after installing the right extension |
| **🎨 Artifacts** | Agent-created HTML, SVG, Mermaid diagrams, and other files render inline in chat via sandboxed previews |
| **📎 Turn File Chips** | Files modified/created during each turn are summarized in clickable chips below the assistant message with diff previews |
| **✈️ Fly-to-Top Anchor** | Smooth prompt anchoring that flies your message to the top upon submit, keeping streaming responses comfortably in focus |

---

## Quick Start

### One-shot setup via npx

```bash
npx pi-kot --password pikot
```

help

```bash
npx pi-kot --help
```

Available options:

| Flag | Description | Default |
| --- | --- | --- |
| `--port <n>` | Port to listen on | `3333` |
| `--host <h>` | Host/interface to bind to | `0.0.0.0` |
| `--password <pw>` | Enable UI password auth | — |
| `--api-key <key>` | Static API key for scripts/CI | — |
| `--workspace <path>` | Workspace root directory | `~/.pi-kot/workspace/default` |
| `--log-level <level>` | Logging level | `info` |
| `--help, -h` | Show help | — |
| `--version, -v` | Show version | — |

All flags can also be set with environment variables: `PORT`, `HOST`, `UI_PASSWORD`, `API_KEY`, `WORKSPACE_PATH`, `LOG_LEVEL`, `MINIMAL_UI`.

### Example: install, run, and expose it

```bash
# Install dependencies
npm install

# Run directly with all settings inline
npx pi-kot --port 3333 --host 127.0.0.1 --password secret --workspace ~/Code
```

### Dev mode (server + Vite hot-reload)

```bash
npm run dev

# Backend on :3332, UI at http://localhost:5173 (Vite proxies /api → :3332)
```

### Production

```bash
npm run build
npm run start

# Open http://localhost:3333
```

All flags also work as environment variables (`PORT`, `HOST`, `UI_PASSWORD`, `API_KEY`, `WORKSPACE_PATH`, `LOG_LEVEL`, `MINIMAL_UI`, ...) — full reference in [Configuration](#configuration).

---

## Trail — Grouped Tool Display & Chain-of-Thought

When the agent executes consecutive tool calls or intersperses text between actions, pi-kot structures them into a clean **Trail**:

- **Auto (Justify)**: Collapses reasoning steps into preview rows. The newest step automatically stays expanded while the agent is live so you can follow its train of thought in real-time.
- **Expand All**: Expands all tools, justifications, and thinking blocks.
- **Consecutive Tool Grouping**: Identical consecutive actions (like reading multiple files) are automatically bundled (e.g. `8 × Read`) to avoid visual noise while remaining interactive.

---

## Slash Commands

Type `/` in the chat input to access built-in and extension commands. Slash commands support arguments:

```
/vision config provider openai
/vision show
/vision on
/compact
/compact with summary
/reload
/abort
```

The dropdown stays visible while typing arguments, and arguments are forwarded directly to the target extension or command handler.

---

## 🌐 Internationalization (i18n)

pi-kot supports multiple languages out of the box:

- **English** (`en`)
- **简体中文** (`zh-CN` / Simplified Chinese)

Language is automatically detected from your browser settings and can be changed in **Settings → Appearance → Language**.

---

## Terminal Touch Gestures

pi-kot's terminal supports mobile touch gestures inspired by Termius:

| Gesture | Action | Details |
| --- | --- | --- |
| **Long-press 150ms + drag** | Arrow keys (↑↓←→) | Continuous with 3 speed gears — drag further for faster |
| **Double-tap** | Tab key | Two quick taps within 300ms |
| **3-finger tap** | Paste | Reads from system clipboard |
| **2-finger scroll** | Scroll buffer | Up/down through terminal history |

---

## 📦 Recommended Extensions

Some features only appear **after** installing the corresponding extension. Head to the **Extensions tab** (⚙ → Extensions) and install the 💎 **Recommended for pi-kot** extensions:

| Extension | Package | Unlocks |
| --- | --- | --- |
| **pi-web-access** 🌐 | `npm:pi-web-access` | Web search, content extraction, API interaction tools for the agent |
| **pi-playwright** 🎭 | `npm:pi-playwright` | Browser automation — the agent can interact with real web UI |
| **pi-vision-tool** 👁️ | `npm:pi-vision-tool` | **Vision agent selection** — non-vision models can delegate `describe_image` to a vision-capable model; full vision settings exposed in Extensions tab and slash commands (`/vision config`, `/vision show`, etc.) |
| **pi-rewind** ⏪ | `npm:@ayulab/pi-rewind` | **Session revert** — checkpoint, rewind, and branch from any prior state |
| **pi-plan-mode** 📋 | `npm:@narumitw/pi-plan-mode` | **Plan mode** — codex-like structured planning. Blocks mutating tools, adds `plan_mode_question` for structured user questions |
| **context-mode** 🧠 | `npm:context-mode` | **Context window savings** — sandboxed code execution, FTS5 knowledge base, BM25 search, and session continuity across compaction |

> 💡 **Tip**: Some UI elements only appear **after** the extension is installed. For example:
>
> - **Vision model selector & slash commands** → appears only after `pi-vision-tool` is installed
> - **Rewind button** on chat messages → appears only after `pi-rewind` is installed
> - **Plan mode tool safety** → appears only after `pi-plan-mode` is installed
> - **Context stats/doctor commands** → appears only after `context-mode` is installed
> If something mentioned in this README doesn't show up, check the Extensions tab first.

---

## Tunnel

pi-kot includes a built-in tunnel helper for exposing your local instance to the internet.

- **Provider**: currently supports **ngrok**
- **Modes**: **quick** tunnel mode
- **Intents**: ephemeral-public, persistent-public, private-network

### Using the Tunnel tab

1. Open **Settings** → **Tunnel**
2. The tab shows an installation check for the tunnel provider
3. If missing, it shows the install command and download link
4. Run **diagnostics** to verify binary, auth token, and network readiness
5. Click **Start Tunnel** to launch; the public URL is shown and can be copied
6. Click **Stop Tunnel** to tear it down when finished

### API routes

The server exposes tunnel controls under `/api/v1/tunnel`:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/tunnel/check` | Check whether ngrok is installed and return version/platform info |
| `GET` | `/api/v1/tunnel/doctor` | Run diagnostics for binary, auth token, and network checks |
| `GET` | `/api/v1/tunnel/status` | Return whether a tunnel is active, its public URL, mode, provider, and local port |
| `POST` | `/api/v1/tunnel/start` | Start an ngrok tunnel |
| `POST` | `/api/v1/tunnel/stop` | Stop an active tunnel |

---

## Configuration

All options can be set as environment variables **or** CLI flags (with `npx pi-kot` / `pi-kot`). Flags not listed below are in `npx pi-kot --help`.

### Network

| Variable | Flag | Default | Description |
| --- | --- | --- | --- |
| `PORT` | `--port` | `3333` | HTTP listen port |
| `HOST` | `--host` | `0.0.0.0` | Bind address (`127.0.0.1` for loopback-only) |
| `TRUST_PROXY` | — | `false` | Trust `X-Forwarded-*` headers when behind a reverse proxy |
| `CORS_ORIGIN` | — | `true` | CORS origin. `true` = reflect request origin; set a specific origin in production |

### Authentication

| Variable | Flag | Default | Description |
| --- | --- | --- | --- |
| `UI_PASSWORD` | `--password` | — | Enable password auth; browser shows a login form |
| `API_KEY` | `--api-key` | — | Static API key for scripts/CI; also accepted as password in the login form |

If both are unset, auth is **disabled** and the UI opens freely.

### Storage paths

| Variable | Flag | Default | Description |
| --- | --- | --- | --- |
| `WORKSPACE_PATH` | `--workspace` | `~/.pi-kot/workspace/default` | Default project workspace directory |
| `SESSION_DIR` | — | `~/.pi-kot/sessions` | Session data directory |
| `FORGE_DATA_DIR` | — | `~/.pi-kot` | Base config/data directory (MCP config, tool/skill overrides) |
| `PI_CONFIG_DIR` | — | `~/.pi/agent` | pi agent configuration directory (used by the SDK; `~/.pi/agent-dev` in dev mode) |

### Data files (under `FORGE_DATA_DIR` by default)

| Variable | Default | Description |
| --- | --- | --- |
| `MCP_CONFIG_FILE` | `$FORGE_DATA_DIR/mcp.json` | MCP server configurations |
| `MCP_STDIO_TRUST_FILE` | `$FORGE_DATA_DIR/mcp-stdio-trust.json` | Trusted stdio MCP servers |
| `TOOL_OVERRIDES_FILE` | `$FORGE_DATA_DIR/tool-overrides.json` | Per-project tool enable/disable overrides |
| `SKILL_OVERRIDES_FILE` | `$FORGE_DATA_DIR/skill-overrides.json` | Per-project skill enable/disable overrides |

### Logging & Environment

| Variable | Flag | Default | Description |
| --- | --- | --- | --- |
| `LOG_LEVEL` | `--log-level` | `info` | Server log level: `info`, `debug`, `warn`, `error` |
| `PIKOT_MODE` | — | — | Set to `dev` to use `-dev`-suffixed data dirs (`~/.pi-kot-dev/`) so dev data doesn't mix with production |
| `NODE_ENV` | — | `production` | Set automatically by the server; `test` disables request logging |
| `MOUNT_CWD_PROJECT` | — | auto-set by CLI | When set, auto-creates a project for the given directory; the CLI shim sets it to the current working directory |

### Static client serving

| Variable | Default | Description |
| --- | --- | --- |
| `SERVE_CLIENT` | `true` | Serve the built Vite client from `CLIENT_DIST_PATH`; set `false` to run API-only (e.g. behind a separate reverse proxy serving the client) |
| `CLIENT_DIST_PATH` | `packages/client/dist` (in-repo) or `dist/client` (npm install) | Path to the built client dist directory; auto-detected |

### Orchestration & UI

| Variable | Default | Description |
| --- | --- | --- |
| `ORCHESTRATION_ENABLED` | `true` | Enable supervisor/worker orchestration |
| `MINIMAL_UI` | `false` | Hide optional UI panels (terminal, git, changes). Useful for locked-down deployments |

### Dev-mode only (Vite)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_PORT` | `3332` | Backend port that the Vite dev proxy forwards `/api` requests to (the `dev` script sets this to `3332`) |

---

## File Explorer

Browse and manage files in your project workspace.

- **Open**: Click a file to read it; auto-refreshes when modified by the agent
- **Edit**: Modify content directly in the editor (CodeMirror)
- **New file/folder**: Right-click in the tree
- **Delete**: Right-click a file
- **Drag to move**: Drag files or folders onto another folder to move them in-app
- **Upload files/folders**: Drag from your OS, use the folder picker, or click the upload buttons
- **Download folder as ZIP**: Right-click a folder in the explorer and choose the download action
- **Clone project**: Use the clone dialog to pull a repo into the workspace, with optional custom destination path

---

## Git Panel

The Git panel shows the current repository's status — modified files, staged changes, commit history, and branch information.

- **View changes**: See diffs of modified files
- **Stage/unstage**: Stage files for commit
- **Commit**: Write and execute commits
- **Branch**: Switch branches
- **Commit history**: Browse commits and expand each one to see changed files
- **Inline commit diffs**: Click a file inside a commit to view its unified diff directly in the panel

---

## MCP Servers

pi-kot supports Model Context Protocol (MCP) servers — tools, resources, and prompts exposed by external services.

### Adding a server

1. Open **Settings** → **MCP** tab
2. Click **Add Server**
3. Choose **Stdio** (local command) or **HTTP** (remote URL)
4. Configure and save

### Managing tools

Each MCP server exposes tools that the agent can use. You can enable/disable individual tools per project from the MCP settings panel.

---

## Orchestration

pi-kot supports multi-agent workflows — a supervisor session can spawn worker sub-agents to handle tasks in parallel.

- Click the **⚡ (Orchestration)** toggle in the toolbar to enable it
- Workers appear nested under their supervisor in the sidebar and show their own message stream
- Workers can be interrupted, killed, or detached individually

---

## Artifacts

pi-kot can render agent-created content inline in chat — HTML pages, SVG images, Mermaid diagrams, and more.

### How it works

1. The agent writes files to `.pi/artifacts/` in your project directory
2. Files are served via `/api/v1/artifacts/<filename>`
3. The chat renderer detects HTML/SVG/JSON/Markdown content and shows a live preview

### Supported formats

| Format | Detection | Preview |
| --- | --- | --- |
| **HTML** | `<!DOCTYPE html>`, `<html>`, or ` ```html` | Sandboxed iframe |
| **SVG** | `<svg>` or ` ```svg` | Sandboxed iframe |
| **Mermaid** | ` ```mermaid` | Rendered diagram |
| **Markdown** | ` ```markdown` | Rendered markdown |
| **JSON** | ` ```json` or valid JSON tool output | Syntax highlighted |
| **Image** | `data:image/...` or ` ```image` | `<img>` tag |

---

## Settings

Access settings via the **⚙** icon in the header.

| Tab | What you can configure |
| --- | --- |
| **Appearance** | Theme picker, language (English / 简体中文), sticky user header, show token usage, image compression, trail default view — all **persisted server-side** |
| **Providers** | View configured providers, add/remove API keys, add custom providers, raw models.json editor |
| **Agent** | Default provider, default model, thinking level, model scope (hide unused models with **bulk select toggles**), orchestrator model |
| **General** | Server & SDK versions, update check, reload page |
| **Extensions ⚗️** | Install/manage pi extensions — **install the recommended ones to unlock features** |
| **Skills** | Enable/disable agent skills |
| **Tunnel 🚇** | Tunnel provider install check, diagnostics, start/stop tunnel, copy public URL |

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **UI** | React, TypeScript, Vite, xterm.js, CodeMirror, Zustand |
| **Server** | Fastify, ws (WebSocket), node-pty |
| **SDK** | `@earendil-works/pi-coding-agent` (currently 0.84.2) |
| **Auth** | JWT, scrypt password hashing |
| **State** | Zustand (client), JSONL session files (server) |
| **i18n** | Lightweight custom registry supporting English & 简体中文 |

---

## License

MIT
