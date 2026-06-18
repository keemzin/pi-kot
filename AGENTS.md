# AGENTS.md

This file is the always-loaded context entrypoint for coding agents working on **pi-kot**.
Keep it concise and accurate. Detailed guidance is split into `docs/agent/*` as the project grows.

---

## 🚫 Working Directory Constraint

**This project lives at `/home/hakeem/pi-kot/`. You MUST stay in this directory.**

- Do **not** `cd` outside `/home/hakeem/pi-kot/` for any reason.
- Do **not** read, write, or execute commands outside this directory (e.g., `../`, `/home/other/`).
- Access subdirectories inside `/home/hakeem/pi-kot/` normally — `./pi-forge/`, `./openkot-ref/`, `./WORKING/`, `./packages/` are all fine.
- For files in `node_modules/`, use the full path under `/home/hakeem/pi-kot/node_modules/...` (never via `../`).
- Use absolute paths when calling tools like `read`, `write`, `edit`, or `bash` to avoid ambiguity.
- **Stick to this directory. If you're not sure a path is inside `/home/hakeem/pi-kot/`, check first.**

---

## What This Project Is

**pi-kot** is a browser UI (web wrapper / web frontend) for the [pi coding agent](https://pi.dev).
It embeds the [`@earendil-works/pi-coding-agent`](https://pi.dev/docs/latest/sdk) SDK and
exposes pi's agent capabilities over REST + Server-Sent Events (SSE) + WebSocket to a web client.

It is **NOT** a reimplementation of the agent loop, tools, session logic, or LLM communication.
All of that comes from the pi SDK. pi-kot is the **HTTP bridge and web UI**.

### Inspiration

The project is directly inspired by **[pi-forge](./pi-forge/)** (located in the same directory).
pi-forge is the primary reference: its API surface, architecture patterns, SSE event model, and
UI component layout serve as the template. Where pi-forge does something well, pi-kot should
learn from it. Where pi-forge is over-engineered for pi-kot's scope, pi-kot should simplify.

### Official SDK Reference

The canonical SDK documentation lives at **https://pi.dev/docs/latest/sdk**.
Always refer there when implementing SDK integration. Key SDK concepts:

| Concept | Description |
|---|---|
| `createAgentSession()` | Factory for a single `AgentSession`. Async. Must be awaited. |
| `AgentSession` | Manages agent lifecycle, message history, event streaming, compaction. |
| `AgentSessionRuntime` | Handles session replacement (new, resume, fork, clone). |
| `session.prompt()` | Sends a prompt. Resolves ONLY after the full agent run finishes. |
| `session.subscribe()` | Subscribe to streaming events. Returns an unsubscribe function. |
| `session.steer()` / `session.followUp()` | Queue messages during active streaming. |
| `AuthStorage` | API key / OAuth token management. |
| `ModelRegistry` | Model discovery (built-in + custom). |
| `SessionManager` | Session persistence (in-memory, file-based, tree navigation). |
| `SettingsManager` | Global + project settings with merge semantics. |
| `DefaultResourceLoader` | Discovers extensions, skills, prompts, themes, context files. |
| `defineTool()` | Define custom tools with TypeBox parameter schemas. |

---

## API Surface (Inspired by pi-forge)

All API endpoints live under `/api/v1/`. The following routes are adapted from
[pi-forge](./pi-forge/)'s design. Implement them progressively.

### Health & Auth

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health probe (no auth) |
| `GET` | `/api/v1/auth/status` | Whether auth is enabled |
| `POST` | `/api/v1/auth/login` | Login with password → JWT |
| `GET` | `/api/v1/ui-config` | Public UI config (no auth) |

### Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/projects` | List projects |
| `POST` | `/api/v1/projects` | Create a project |
| `GET` | `/api/v1/projects/browse` | Browse filesystem for folder picker |
| `PATCH` | `/api/v1/projects/:id` | Rename a project |
| `DELETE` | `/api/v1/projects/:id` | Delete a project (optional cascade) |

### Sessions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/sessions` | List sessions (filter by `projectId`) |
| `POST` | `/api/v1/sessions` | Create a new session |
| `GET` | `/api/v1/sessions/:id/messages` | Full message history |
| `GET` | `/api/v1/sessions/:id/context` | Token + cost telemetry |
| `GET` | `/api/v1/sessions/:id/tree` | Session branching tree |
| `POST` | `/api/v1/sessions/:id/navigate` | Navigate to a different tree leaf |
| `POST` | `/api/v1/sessions/:id/fork` | Fork from an entry into a new session |
| `POST` | `/api/v1/sessions/:id/model` | Set model for this session only |
| `POST` | `/api/v1/sessions/:id/steer` | Steer or follow-up during streaming |
| `POST` | `/api/v1/sessions/:id/abort` | Abort current agent run |
| `DELETE` | `/api/v1/sessions/:id` | Dispose (optional hard delete) |

### Prompt & Streaming

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/sessions/:id/prompt` | Send a prompt (fire-and-forget → 202) |
| `GET` | `/api/v1/sessions/:id/stream` | SSE stream of agent events |
| `GET` | `/api/v1/sessions/:id/turn-diff` | Diff from the last completed agent turn |

### Files

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/files/tree` | List project file tree |
| `GET` | `/api/v1/files/read` | Read a file's contents |
| `PUT` | `/api/v1/files/write` | Write / create a file (atomic) |
| `GET` | `/api/v1/files/search` | Search files (ripgrep / Node) |
| `POST` | `/api/v1/files/upload` | Multipart file upload |
| `GET` | `/api/v1/files/download` | Download file or folder-as-tar.gz |

### Git

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/git/status` | Git status |
| `GET` | `/api/v1/git/diff` | Unstaged diff |
| `GET` | `/api/v1/git/log` | Commit log |
| `POST` | `/api/v1/git/stage` | Stage files |
| `POST` | `/api/v1/git/unstage` | Unstage files |
| `POST` | `/api/v1/git/commit` | Commit staged changes |
| `POST` | `/api/v1/git/push` | Push to remote |
| `POST` | `/api/v1/git/pull` | Pull from remote |
| `GET` | `/api/v1/git/branches` | List branches |
| `POST` | `/api/v1/git/branch/create` | Create & optionally checkout a branch |

### Configuration

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/config/providers` | List LLM providers (presence only) |
| `GET` | `/api/v1/config/auth` | Auth provider presence |
| `PUT` | `/api/v1/config/auth/:provider` | Set API key |
| `DELETE` | `/api/v1/config/auth/:provider` | Remove API key |
| `GET` | `/api/v1/config/settings` | Read agent settings |
| `PUT` | `/api/v1/config/settings` | Update agent settings (shallow merge) |
| `GET` | `/api/v1/config/models` | Read custom models config (keys redacted) |
| `PUT` | `/api/v1/config/models` | Write custom models config |
| `GET` | `/api/v1/config/skills` | List skills with enabled state |
| `PUT` | `/api/v1/config/skills/:name/enabled` | Toggle a skill |

### Terminal

| Method | Path | Description |
|---|---|---|
| `WebSocket` | `/api/v1/terminal` | Integrated PTY via WebSocket |

---

## SSE Event Stream

The SSE stream (`GET /api/v1/sessions/:id/stream`) is the central mechanism
for real-time agent output. Every client (the UI, scripts, dashboards)
consumes the same stream.

### Always-first event: `snapshot`

```json
{
  "type": "snapshot",
  "sessionId": "01J7...",
  "projectId": "proj_abc...",
  "messages": [...],
  "isStreaming": false
}
```

### Agent lifecycle events

| Event | Fires when... |
|---|---|
| `agent_start` | Agent begins processing a turn |
| `agent_end` | Agent finishes processing (refresh derived state) |
| `message_start` | A new assistant message begins |
| `message_update` | Streaming delta (`text_delta`, `thinking_delta`, `tool_use_start`, etc.) |
| `message_end` | Assistant message complete |
| `tool_call` | Agent decides to invoke a tool |
| `tool_execution_start` | Tool runner begins |
| `tool_execution_update` | Streaming tool output |
| `tool_execution_end` | Tool runner finishes |
| `tool_result` | Tool result added to session |

### Queue & system events

| Event | Fires when... |
|---|---|
| `queue_update` | Pending steer/followUp queue changed |
| `compaction_start` / `compaction_end` | Context compaction begins/ends |
| `auto_retry_start` / `auto_retry_end` | Provider rate-limit backoff |

### Ordering guarantees

1. `snapshot` is always first on connect.
2. For a single turn: `agent_start` → `message_start` → 1+ `message_update` → `message_end` (per message, interleaved with tool events) → `agent_end`.
3. Unknown event types must be silently ignored (forwards-compatibility).

---

## Architecture Overview

```
┌──────────────────────────────────────┐
│             Browser                   │
│                                      │
│  Web UI (React / Vue / Svelte / ...) │
│    ├─ ChatView / ChatInput           │
│    ├─ Project/Session navigation     │
│    ├─ File browser + editor          │
│    ├─ Git panel                      │
│    ├─ Terminal (xterm.js + WS)       │
│    ├─ Config/settings panels         │
│    └─ Install prompt (PWA)           │
│                                      │
│  API client layer (typed wrappers)   │
│  SSE client (streaming consumer)     │
└──────────┬───────────────────────────┘
           │ HTTP (REST + SSE) + WebSocket
           │ All under /api/v1/
           ▼
┌──────────────────────────────────────┐
│            HTTP Server                │
│  (Node.js — Fastify / Express / Hono) │
│                                      │
│  Routes:                             │
│    auth, config, projects, sessions, │
│    stream, files, git, terminal      │
│                                      │
│  SDK integration:                    │
│    createAgentSession()              │
│    AgentSession lifecycle            │
│    SSE bridge (events → SSE)         │
│    Session registry (in-memory Map)  │
│    File manager (path-validated fs)  │
│    Git runner (subprocess)           │
│    PTY manager (node-pty)            │
└──────────────────────────────────────┘
```

### Key Design Principles (from pi-forge)

1. **All session interactions through a session registry.** Routes must not import `AgentSession` or call `createAgentSession()` directly. The registry is the single source of truth.
2. **All filesystem ops through a file manager.** No raw `fs.*` calls in routes. Path validation is centralized.
3. **Prompt routes are fire-and-forget.** `POST /prompt` returns 202 immediately. Response streams over the already-open SSE connection.
4. **Session registry is in-memory.** Sessions survive restart because their JSONL files persist on disk; the registry is rebuilt lazily as SSE clients reconnect.
5. **Auth is global with explicit opt-out.** Public routes require explicit annotation.
6. **Never return raw secrets.** API key endpoints return presence/source only, never actual values.
7. **All config/data writes are atomic** (write `.tmp` then `rename()`).
8. **SSE clients must handle `snapshot` first** and silently ignore unknown event types.

---

## Pi SDK Facts That Are Easy To Get Wrong

- `createAgentSession()` is async and must be awaited.
- `session.prompt()` resolves only after the full agent run finishes (including retries + compaction). Prompt routes should fire-and-forget and return 202; output streams over SSE.
- `session.subscribe()` returns an unsubscribe function. Call it on dispose.
- `AgentSessionEvent` is a union. Always switch on `event.type`.
- Session JSONL first line is the header. Parse it for metadata without loading the whole file.
- `session.navigateTree()` mutates the current session file in place. `session.fork()` creates a new session file.
- `session.steer()` and `session.followUp()` expand file-based prompt templates but error on extension commands (extension commands cannot be queued).
- During streaming without `streamingBehavior`, `prompt()` throws. Use `steer()` / `followUp()` directly, or specify `{ streamingBehavior: "steer" | "followUp" }`.

---

## Development

### Prerequisites

- Node.js >= 18
- npm / pnpm / yarn
- A pi agent installation (for SDK reference)

### Getting Started

```bash
# Install dependencies
npm install

# Start development server (server + client)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

### Project Structure (Proposed)

```
pi-kot/
├── AGENTS.md                  # This file
├── .gitignore
├── package.json
├── packages/
│   ├── server/                # HTTP server (Fastify / Express / Hono)
│   │   ├── src/
│   │   │   ├── index.ts       # Server entry + route registration
│   │   │   ├── config.ts      # Env vars + CLI flags
│   │   │   ├── auth.ts        # JWT + password auth
│   │   │   ├── session-registry.ts  # In-memory LiveSession Map
│   │   │   ├── sse-bridge.ts  # AgentSessionEvent → SSE
│   │   │   ├── file-manager.ts      # Path-validated fs operations
│   │   │   ├── git-runner.ts        # Git subprocess wrapper
│   │   │   ├── pty-manager.ts       # node-pty lifecycle
│   │   │   └── routes/        # Route handlers
│   │   │       ├── auth.ts
│   │   │       ├── projects.ts
│   │   │       ├── sessions.ts
│   │   │       ├── files.ts
│   │   │       ├── git.ts
│   │   │       ├── config.ts
│   │   │       └── terminal.ts
│   │   └── package.json
│   └── client/                # Web UI
│       ├── src/
│       │   ├── App.tsx
│       │   ├── components/    # UI components
│       │   ├── stores/        # State management (Zustand)
│       │   ├── lib/           # API client, SSE client
│       │   └── ...
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── docs/                      # Documentation
│   └── agent/                 # Agent-specific guides (as project grows)
└── tests/                     # Integration tests
```

---

## Critical Conventions

0. **Never commit unless explicitly told to.** Do not stage, commit, push, or otherwise version-control changes unless the user says "commit" or "push". Staging/committing is a user-only decision.

1. **Never start or stop the server/processes unless explicitly told to.** Do not run npm scripts, restart processes, or manage running services. Leave process lifecycle to the user.

2. **Named exports only.** No default exports.
3. **All AgentSession interactions go through `session-registry.ts`.**
4. **All filesystem operations go through `file-manager.ts` or `git-runner.ts`.**
5. **Route files export plugin functions; they do not register themselves.**
6. **Traversal attempts return 403, not 500.**
7. **Config/data writes are atomic** (tmp file + rename).
8. **SSE clients must handle `snapshot` first** and silently ignore unknown event types.
9. **Prefixed project references** — always use `pi-forge` not "the reference project" when referring to pi-forge in this directory.

10. **Actively update ROADMAP.md** — After completing a task or feature, update the corresponding phase table in `ROADMAP.md` to reflect the new status (🔴 → 🟢 or 🟡). Also update the Quick Reference: Route Map and Current Implementation Summary sections. Keep the roadmap in sync with the codebase so it remains an accurate progress indicator.

---

## Recent UI Decisions (May–Jun 2026)

### Sticky User Header (toggleable)
- **Opt-in** via Settings → Appearance → "Sticky user header"
- Pins the user message at the top of the chat while scrolling through the assistant's reply
- Long messages auto-collapse to 2 lines with "Show more/less" toggle
- Uses `ResizeObserver` for overflow detection
- `paddingTop: 55px` on messages-container to clear the absolute-positioned app header
- `chat-scroll` has `overflow: visible` to make `messages-container` the single scroll container for reliable sticky positioning
- Stored in `preferences-store.ts` (Zustand + localStorage)

### New Session Button
- Compact `+` button on the project header row, hidden by default, appears on hover
- Replaced the full-width `+ New Session` button that sat under the session list
- CSS: `.new-session-inline` with `margin-left: auto` for right-alignment

### Agent Settings: Dynamic Provider/Model Dropdowns
- Replaced manual text inputs with `<select>` dropdowns populated from `/api/v1/config/providers`
- Provider dropdown lists all available LLM providers
- Model dropdown filters to only models for the selected provider
- Switching provider auto-clears model if incompatible
- Both save immediately on change (no separate Save button)
- Model dropdown is disabled until a provider is chosen

### Copy Button (attempted, reverted)
- Attempted to add a copy-to-clipboard button on assistant message bubbles
- First placed at top-right, then bottom-right, then bottom of bubble
- Reworked to appear below each assistant message (not just string-content ones)
- Reverted — needs a cleaner implementation

## Key Bugfixes (in history)

| Commit | Fix |
|---|---|
| `fea8a84` | AuthStorage: was receiving dir path instead of file path → `hasAuth()` silently returned false for all providers |
| `36df437` | Model stub bug: `setModel()` received `{provider, id}` instead of full model object — agent needs `api`, `baseUrl`, contextWindow, etc. |
| `525f605` | Settings panel height: `maxHeight: 82vh` → fixed `height: 520px` to prevent resizing when switching tabs |
| `8f0245a` | Sticky user header with collapse/expand (ported from openkot) |
| `52eddd7` | Fixed sticky header hidden behind absolute header bar (nested scroll containers) |
| `9f8757f` | Aligned sticky header with sidebar file explorer position (44px → 55px settled) |
| `4c40a25` | Moved new-session button to project header row |
| `1e4e2b5` | Dynamic provider/model dropdowns in Agent settings |
| `8e6cde7` | Added per-server enable/disable toggle + Edit button to MCPPanel (edit pre-fills config, locks name/kind on edit). Added enabled checkbox in server form. Secret redaction sentinel round-trip for headers/env. Stable `stableJson()` change detection in mcp-store to prevent unnecessary re-renders on poll. `refreshInFlight` guard to prevent double-poll races. `EMPTY_STATUS` constant to fix 'Maximum update depth exceeded' crash. Fire-and-forget `rebuildTooling()` after every MCP state change so live sessions pick up updated tools without SSE reconnect. |
| *(current)* | Removed server-side `checkpoints.ts` route entirely (had wrong git repo logic + duplicating pi-rewind). RewindModal now delegates to `POST /command { command: "rewind" }` — the extension handles everything via the SSE bridge. Created `ExtensionUIInteractionModal` to render select/confirm/input bridge events. Fixed bridge `custom()` being a no-op (undefined → fall back to `select()`). |

## Current Working State

- All core chat, session, and project features functional
- Settings panel: Appearance (theme + sticky header toggle), Providers (API keys + models.json), Agent (dynamic provider/model/thinking), General
- Sticky user header is opt-in, defaults to off
- Session archiving is per-project (`_archived/` subfolder in session dir)

## References

- **pi SDK docs**: https://pi.dev/docs/latest/sdk
- **pi-forge** (inspiration): `./pi-forge/` in this directory
- **SDK source + examples** (full repo clone): `./pi-ref/`
  - SDK examples: `./pi-ref/packages/coding-agent/examples/`
  - SDK source: `./pi-ref/packages/coding-agent/src/`
  - Author: Mario Zechner (@earendil-works)
  - GitHub: https://github.com/earendil-works/pi
- **SDK package**: `@earendil-works/pi-coding-agent` on npm
- **OpenKot** (UX pattern reference): `./openkot-ref/`
- **pi-rewind extension** (checkpoint/rewind reference): `./node_modules/@ayulab/pi-rewind/`
  - Entry: `index.js` — registers `/rewind` command, auto-checkpoint lifecycle via `pi.on('turn_start'/'turn_end'/'agent_end')`
  - Checkpoint engine: `@ayulab__pi-checkpoint.js` — git-based checkpoint repo, config loading, diff parsing, safe checkout
  - Config path: `ayu.rewind` / `ayu.checkpoint` in settings, merged recursively from `~/.pi/agent/settings.json` + `.pi/settings.json`
  - Key patterns:
    - `AutoCheckpointProducer` wraps git snapshots around each agent turn
    - `sessionTasks` queue prevents concurrent checkpoint operations per session
    - Fork/clone copies checkpoint storage via `cloneSessionCheckpointStorage()`
    - Tree navigation hooks (`session_before_tree` / `session_tree`) conditionally restore file state
    - `safeRestore()` stages all, checkouts target commit, with rollback on failure
