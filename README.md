# pi-kot

<img src="screenshot_placeholder_01.png" alt="pi-kot screenshot" width="800"/>

> A browser-based UI for the [pi coding agent](https://pi.dev) — built out of love, curiosity, and a desire to explore what a web-native terminal + AI agent experience could feel like.

pi-kot wraps the `@earendil-works/pi-coding-agent` SDK in an HTTP bridge with a React-based web UI. It exposes the agent's capabilities through REST, SSE, and WebSocket, giving you a fully interactive chat-and-terminal environment in your browser — no desktop app required.

---

## Features

| Feature | Description |
|---|---|
| **💬 Chat** | Full agent conversation with streaming, markdown rendering, code blocks with syntax highlighting, and diff views |
| **🖥️ Terminal** | Multi-tab xterm.js terminal with persistent PTY sessions, **touch gestures** (long-press+drag arrows, double-tap Tab, 3-finger paste), and a mobile quick-keys bar |
| **📁 File Explorer** | Browse, read, edit, and manage files in your project workspace |
| **🔧 MCP Support** | Add, configure, and toggle MCP servers with a full settings UI |
| **🧩 Orchestration** | Multi-agent workflows — supervise sub-agents, delegate tasks, inspect results |
| **🔐 Auth** | Password-based login, API key support, JWT sessions |
| **📱 Mobile-friendly** | PWA-ready, adaptive layout, touch gestures, virtual keyboard support |
| **🔄 Session persistence** | Sessions survive restarts via JSONL on disk; reattach on reconnect |
| **📦 Extensions** | Discover and install pi extensions from the UI — some features only appear after installing the right extension |

---

## Quick Start

```bash
# Clone and install
git clone <your-repo>/pi-kot.git
cd pi-kot
npm install

# Dev mode (server + Vite hot-reload)
npm run dev

# Open http://localhost:5173
```

Or build for production:

```bash
npm run build
npm run start
# Open http://localhost:3333
```

<img src="screenshot_placeholder_02.png" alt="pi-kot terminal" width="800"/>

---

## Terminal Touch Gestures

pi-kot's terminal supports mobile touch gestures inspired by Termius:

| Gesture | Action | Details |
|---|---|---|
| **Long-press 150ms + drag** | Arrow keys (↑↓←→) | Continuous with 3 speed gears — drag further for faster |
| **Double-tap** | Tab key | Two quick taps within 300ms |
| **3-finger tap** | Paste | Reads from system clipboard |
| **2-finger scroll** | Scroll buffer | Up/down through terminal history |

<img src="screenshot_placeholder_03.png" alt="touch gestures" width="400"/>

---

## 📦 Recommended Extensions

Some features only appear **after** installing the corresponding extension. Head to the **Extensions tab** (⚙ → Extensions) and install the 💎 **Recommended for pi-kot** extensions:

| Extension | Package | Unlocks |
|---|---|---|
| **pi-web-access** 🌐 | `npm:pi-web-access` | Web search, content extraction, API interaction tools for the agent |
| **pi-playwright** 🎭 | `npm:pi-playwright` | Browser automation — the agent can interact with real web UI |
| **pi-vision-tool** 👁️ | `npm:pi-vision-tool` | **Vision agent selection** — non-vision models can delegate `describe_image` to a vision-capable model |
| **pi-rewind** ⏪ | `npm:@ayulab/pi-rewind` | **Session revert** — checkpoint, rewind, and branch from any prior state |
| **pi-processes** ⚙️ | `npm:@aliou/pi-processes` | Background process management (dev servers, watchers, builds) |

> 💡 **Tip:** Some UI elements only appear **after** the extension is installed. For example:
> - **Vision model selector** in Extensions tab → appears only after `pi-vision-tool` is installed
> - **Rewind button** on chat messages → appears only after `pi-rewind` is installed
> If something mentioned in this README doesn't show up, check the Extensions tab first.

---

## Configuration

See [START.md](./START.md) for the full configuration reference — ports, auth, storage paths, and more.

```bash
# With password auth
UI_PASSWORD=mypassword npm run dev

# Custom port
PORT=4000 npm run start

# Minimal UI (hide optional panels)
MINIMAL_UI=true npm run start

# See all options
npx pi-kot --help
```

---

## Project Structure

```
pi-kot/
├── packages/
│   ├── client/          # React SPA (Vite, xterm.js, Zustand)
│   │   └── src/
│   │       ├── components/   # UI components (ChatView, TerminalPanel, ...)
│   │       ├── stores/       # Zustand stores (session, terminal, MCP, ...)
│   │       ├── hooks/        # Custom hooks (touch swipe, extensions, ...)
│   │       └── lib/          # Utilities (API client, SSE, theme, ...)
│   └── server/          # Express server (REST, SSE, WebSocket, PTY)
│       └── src/
│           ├── routes/       # API routes (sessions, terminal, git, MCP, ...)
│           ├── mcp/          # MCP server registry & manager
│           ├── orchestration/ # Multi-agent orchestration
│           └── ...           # Config, auth, PTY manager, etc.
├── pi-forge/            # Reference template (design inspiration)
├── START.md             # Configuration & running guide
└── ROADMAP.md           # Build plan & progress
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

## Motivation

pi-kot began as an exploration — what if the pi coding agent had a web UI that felt native on both desktop and mobile? What if you could use it from your phone, with touch gestures that actually make sense for a terminal? What if the agent's entire session history was navigable, searchable, and survived restarts?

This project was built out of **love and curiosity** — for the pi ecosystem, for thoughtful UI, and for the craft of building tools that feel good to use.

---

## License

MIT
