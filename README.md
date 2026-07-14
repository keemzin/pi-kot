# pi-kot

<img width="2560" height="1440" alt="New Project" src="https://github.com/user-attachments/assets/fa6a4dd8-c61e-43e4-ba36-4b5bf2640745" />


> A browser-based UI wrapper for the [pi coding agent](https://pi.dev)

pi-kot wraps the `@earendil-works/pi-coding-agent` SDK in an HTTP bridge with a React-based web UI. It exposes the agent's capabilities through REST, SSE, and WebSocket, giving you a fully interactive chat-and-terminal environment in your browser — no desktop app required.

---

## Motivation

pi-kot was created because I was looking for an agentic harness with minimal token usage and high customization — one that behaves the way I want and looks the way I want. I've used many, and I really like Hermes, but I'm in love with Pi.

Then I decided to push Qwen3.6-35B-A3B to its absolute limit to build pi-kot. The setup I use is an RTX 3060 12GB VRAM running Qwen3 through llama.cpp with turboquant by [TheTom](https://github.com/TheTom/llama-cpp-turboquant), keeping context around 120k. That gets me to about 19-25 tps — painfully slow — but it stays stable: no failures, no tool-calling loops. pi-kot is built 90% with Qwen3.6-35B-A3B.

This project was built out of **love and curiosity**.

---

## Features

| Feature | Description |
|---|---|
| **💬 Chat** | Full agent conversation with streaming, markdown rendering, code blocks with syntax highlighting, and diff views — no intermediate adapter, SDK types consumed directly |
| **🖥️ Terminal** | Multi-tab xterm.js terminal with persistent PTY sessions, **touch gestures** (long-press+drag arrows, double-tap Tab, 3-finger paste), and a mobile quick-keys bar |
| **📁 File Explorer** | Browse, read, edit, and manage files in your project workspace with folder drag-and-drop uploads, drag-to-move, and ZIP downloads |
| **🔧 MCP Support** | Add, configure, and toggle MCP servers with a full settings UI |
| **💾 Persistent UI Prefs** | Theme, sticky header, token usage toggle, and image compression — saved **server-side** in `~/.pi/agent/ui-settings.json`. Survives browser cache clears and device switches |
| **🧩 Orchestration** | Multi-agent workflows — supervise sub-agents, delegate tasks, inspect results |
| **🔐 Auth** | Password-based login, API key support, JWT sessions |
| **📱 Mobile-friendly** | PWA-ready, adaptive layout, touch gestures, virtual keyboard support |
| **🔄 Session persistence** | Sessions survive restarts via JSONL on disk; reattach on reconnect |
| **🎨 Unified Theme System** | Consistent light/dark theme tokens across panels, modals, inputs, and terminal chrome |
| **🔌 Tunnel** | Built-in tunnel helper UI for exposing local pi-kot traffic via supported providers, with install checks, diagnostics, and one-click start/stop |
| **📦 Extensions** | Discover and install pi extensions from the UI — some features only appear after installing the right extension |

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
|---|---|---|
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

# Open http://localhost:5173
```

### Production

```bash
npm run build
npm run start

# Open http://localhost:3333
```

Or build for production:

```bash
npm run build
npm run start
# Open http://localhost:3333
```

---

## Terminal Touch Gestures

pi-kot's terminal supports mobile touch gestures inspired by Termius:

| Gesture | Action | Details |
|---|---|---|
| **Long-press 150ms + drag** | Arrow keys (↑↓←→) | Continuous with 3 speed gears — drag further for faster |
| **Double-tap** | Tab key | Two quick taps within 300ms |
| **3-finger tap** | Paste | Reads from system clipboard |
| **2-finger scroll** | Scroll buffer | Up/down through terminal history |

---

## 📦 Recommended Extensions

Some features only appear **after** installing the corresponding extension. Head to the **Extensions tab** (⚙ → Extensions) and install the 💎 **Recommended for pi-kot** extensions:

| Extension | Package | Unlocks |
|---|---|---|
| **pi-web-access** 🌐 | `npm:pi-web-access` | Web search, content extraction, API interaction tools for the agent |
| **pi-playwright** 🎭 | `npm:pi-playwright` | Browser automation — the agent can interact with real web UI |
| **pi-vision-tool** 👁️ | `npm:pi-vision-tool` | **Vision agent selection** — non-vision models can delegate `describe_image` to a vision-capable model; full vision settings exposed in Extensions tab |
| **pi-rewind** ⏪ | `npm:@ayulab/pi-rewind` | **Session revert** — checkpoint, rewind, and branch from any prior state |
| **pi-plan-mode** 📋 | `npm:@narumitw/pi-plan-mode` | **Plan mode** — codex-like structured planning. Blocks mutating tools, adds `plan_mode_question` for structured user questions |
| **context-mode** 🧠 | `npm:context-mode` | **Context window savings** — sandboxed code execution, FTS5 knowledge base, BM25 search, and session continuity across compaction |

> 💡 **Tip**: Some UI elements only appear **after** the extension is installed. For example:
> - **Vision model selector** in Extensions tab → appears only after `pi-vision-tool` is installed
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
|---|---|---|
| `GET` | `/api/v1/tunnel/check` | Check whether ngrok is installed and return version/platform info |
| `GET` | `/api/v1/tunnel/doctor` | Run diagnostics for binary, auth token, and network checks |
| `GET` | `/api/v1/tunnel/status` | Return whether a tunnel is active, its public URL, mode, provider, and local port |
| `POST` | `/api/v1/tunnel/start` | Start an ngrok tunnel |
| `POST` | `/api/v1/tunnel/stop` | Stop an active tunnel |

---

## Configuration

See [START.md](./START.md) for the full configuration reference — ports, auth, storage paths, and more.

---

## File Explorer

Browse and manage files in your project workspace.

- **Open**: Click a file to read it
- **Edit**: Modify content directly in the editor (CodeMirror)
- **New file/folder**: Right-click in the tree
- **Delete**: Right-click a file
- **Drag to move**: Drag files or folders onto another folder to move them in-app
- **Upload files/folders**: Drag from your OS, use the folder picker, or click the upload buttons
- **Download folder as ZIP**: Right-click a folder in the explorer and choose the download action
- **Clone project**: Use the clone dialog to pull a repo into the workspace, with optional custom destination path

The file explorer also shows files the agent has created or modified during the session.

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

## Settings

Access settings via the **⚙** icon in the header.

| Tab | What you can configure |
|---|---|
| **Appearance** | Theme picker, sticky user header, show token usage, image compression — all **persisted server-side** |
| **Providers** | View configured providers, add/remove API keys, add custom providers, raw models.json editor |
| **Agent** | Default provider, default model, thinking level, model scope (hide unused models), orchestrator model |
| **General** | Server & SDK versions, update check, reload page |
| **Extensions ⚗️** | Install/manage pi extensions — **install the recommended ones to unlock features** |
| **Skills** | Enable/disable agent skills |
| **Tunnel 🚇** | Tunnel provider install check, diagnostics, start/stop tunnel, copy public URL |

### Image compression

You can toggle automatic client-side image compression before sending images to the model. When enabled, images are downscaled to a max dimension and compressed to JPEG to reduce token usage.

---

## Project Structure

```
pi-kot/
├── packages/
│   ├── client/          # React SPA (Vite, xterm.js, Zustand)
│   │   └── src/
│   │       ├── components/   # UI components (ChatView, TerminalPanel, SlidePanel, ...)
│   │       ├── stores/       # Zustand stores (session, layout, terminal, MCP, preferences)
│   │       ├── hooks/        # Custom hooks (touch swipe, extensions, ...)
│   │       └── lib/          # Utilities (API client, SSE, theme, tool-registry, ...)
│   │                          # Note: no normalize.ts — SDK types consumed directly
│   └── server/          # Express server (REST, SSE, WebSocket, PTY)
│       └── src/
│           ├── routes/       # API routes (sessions, terminal, git, files, projects, extensions, tunnel, ...)
│           ├── mcp/          # MCP server registry & manager
│           ├── orchestration/ # Multi-agent orchestration
│           ├── ask-user-question/ # Web-compatible tool wrappers (e.g. plan_mode_question)
│           ├── tunnel/       # Tunnel providers, registry, service, install/doctor helpers
│           └── ...           # Config, auth, PTY manager, extension manager, etc.
├── START.md             # Configuration & running guide
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **UI** | React, TypeScript, Vite, xterm.js, CodeMirror, Zustand |
| **Server** | Express, ws (WebSocket), node-pty |
| **SDK** | `@earendil-works/pi-coding-agent` |
| **Auth** | JWT, scrypt password hashing |
| **State** | Zustand (client), JSONL session files (server) |

---

## License

MIT
