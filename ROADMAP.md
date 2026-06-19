# pi-kot Roadmap

A phased build plan for creating a web UI wrapper around the pi coding agent SDK,
inspired by [pi-forge](./pi-forge/).

---

## Legend

| Icon | Meaning |
|---|---|
| 🔴 Not started | Work not begun |
| 🟡 In progress | Active development |
| 🟢 Done | Completed and tested |
| ⚪ Deferred | Postponed to later phase |

---

## Phase 1 — Chat MVP (Core Interaction)

**Goal:** Send a prompt, stream the response in a browser UI end-to-end.

### 1a — Server Foundation (Backend)

| # | Task | Status | Description |
|---|---|---|---|
| 1a.1 | Project scaffold | 🟢 | Root `package.json` with workspaces, TS config, npm scripts |
| 1a.2 | HTTP server bootstrap | 🟢 | Fastify server with CORS, JSON body parser, error handler |
| 1a.3 | Health endpoint | 🟢 | `GET /api/v1/health` — public, no auth |
| 1a.4 | Config module | 🟢 | `packages/server/src/config.ts` — env vars, CLI flags, defaults |
| 1a.5 | Auth module | 🟢 | HMAC-SHA256 token auth with `signHmac`/`verifyHmac`, login endpoint, bearer middleware, API key fallback |
| 1a.6 | Session registry | 🟢 | In-memory `Map<string, LiveSession>` — single source of truth for SDK state, disk discovery |
| 1a.7 | SSE bridge | 🟢 | `AgentSessionEvent` → SSE `data:` lines, snapshot on connect, allowed-event filter |
| 1a.8 | Session CRUD routes | 🟢 | `POST /sessions` (create), `GET /sessions` (list, with `?projectId` filter), `GET /sessions/:id/messages`, `DELETE /sessions/:id` (dispose) |
| 1a.9 | Prompt route | 🟢 | `POST /sessions/:id/prompt` — fire-and-forget, returns 202 |
| 1a.10 | Stream route | 🟢 | `GET /sessions/:id/stream` — SSE endpoint, auto-resumes cold sessions |
| 1a.11 | Abort route | 🟢 | `POST /sessions/:id/abort` — abort current agent run |
| 1a.12 | Steer / follow-up route | 🟢 | `POST /sessions/:id/steer` — queue steer or followUp during active streaming |
| 1a.13 | Per-session model route | 🟢 | `POST /sessions/:id/model` + `GET /sessions/:id/model` — set/get model via SDK ModelRegistry |

**Extra routes built (not in original plan):**
- `POST /sessions/:id/steer` — queues steer/followUp during active streaming
- `POST /sessions/:id/model` + `GET /sessions/:id/model` — per-session model override, validated against SDK ModelRegistry
- `PATCH /projects/:id` — rename or repath a project
- `POST /projects/clone` — clone a git repo into workspace and auto-create a project (SSE progress streaming)

### 1b — Chat UI (Frontend)

| # | Task | Status | Description |
|---|---|---|---|
| 1b.1 | Vite project scaffold | 🟢 | Vite + React, TypeScript, basic entry point |
| 1b.2 | API client layer | 🟢 | `lib/api-client.ts` — typed fetch wrappers for all routes, auth token management |
| 1b.3 | SSE client | 🟢 | `lib/sse-client.ts` — `fetch` + `ReadableStream` consumer with exponential backoff reconnection |
| 1b.4 | Session store | 🟢 | Zustand store — session state, messages, streaming text, connection status, tool pairing |
| 1b.5 | ChatView component | 🟢 | Message list — scrollable, user + assistant bubbles, tool call pairing, diff blocks, thinking blocks |
| 1b.6 | ChatInput component | 🟢 | Text input + send button, auto-resize, disabled during streaming |
| 1b.7 | Streaming text renderer | 🟢 | Real-time append of `text_delta` chunks via RAF-coalesced buffer |
| 1b.8 | Thinking indicator | 🟢 | Animated dots during `agent_start` → `agent_end`, active tool name badge |
| 1b.9 | Abort button | 🟢 | Appears during streaming, calls `POST /abort` |
| 1b.10 | Error handling | 🟢 | Connection lost banner, reconnection with exponential backoff, terminal status handling |
| 1b.11 | Markdown rendering | 🟢 | `react-markdown` with GFM tables, blockquotes, lists, links, inline code |
| 1b.12 | Code block display | 🟢 | `prism-react-renderer` syntax highlighting, copy button, light/dark theme-aware |

### End of Phase 1 — Milestone

```
User can:
  ✓ Open the app in a browser
  ✓ Type a prompt and hit Send
  ✓ See the agent's response stream in real-time (character by character)
  ✓ See tool calls inline
  ✓ Abort a running agent
  ✓ Reconnect if the server restarts
  ✓ Switch between 6 themes from the header bar
  ✓ Collapse/expand the sidebar
  ✓ See rendered markdown with compact spacing
  ✓ Browse available models and select one from the header
```


### 1c — Theme System & Model Selector

**Goal:** Visual polish (tau themes) and model selection in the header bar.

| # | Task | Status | Description |
|---|---|---|---|
| 1c.1 | CSS theme system | 🟢 | Port 6 tau themes (night, midnight, dawn, clean, terracotta, sage) with CSS variables |
| 1c.2 | Theme picker | 🟢 | Custom dropdown in header, persisted to localStorage |
| 1c.3 | Collapsible sidebar | 🟢 | Sidebar toggle with slide animation (matching tau) |
| 1c.4 | Sticky header bar | 🟢 | Absolute-positioned glass header with session name, status dot, controls |
| 1c.5 | Compact markdown spacing | 🟢 | Tight line-height, paragraph/li margins matching tau's compact rendering |
| 1c.6 | Provider listing endpoint | 🟢 | `GET /api/v1/config/providers` — live models from SDK ModelRegistry |
| 1c.7 | Model dropdown | 🟢 | Searchable model selector in header bar (matching tau's `.model-dropdown`) |

---

## Phase 2 — Projects & Sessions

**Goal:** Multiple projects, persistent sessions, session tree navigation.

| # | Task | Status | Description |
|---|---|---|---|
| 2.1 | Project manager | 🟢 | `project-manager.ts` — CRUD for projects, on-disk `projects.json` |
| 2.2 | Project routes | 🟢 | `GET/POST/PATCH/DELETE /api/v1/projects` |
| 2.3 | Project sidebar | 🟢 | Sidebar component listing projects, collapsible tree |
| 2.4 | Session list | 🟢 | `GET /sessions?projectId=X` — list with name, message count, last activity |
| 2.5 | Session sidebar | 🟢 | Session list within a project in sidebar, create/switch |
| 2.6 | Persistent sessions | 🟢 | `SessionManager.create()` instead of in-memory, JSONL on disk |
| 2.7 | Session resume | 🟢 | Cold session auto-resume on SSE connect (lazy) |
| 2.8 | Session navigation | 🟢 | `POST /sessions/:id/navigate` — branch switching |
| 2.9 | Session fork | 🟢 | `POST /sessions/:id/fork` — branch into new session |
| 2.10 | Session tree panel | 🟢 | Visual tree of session branching history (🌿 button in header) |
| 2.11 | Session naming | 🟢 | Auto-name from first prompt via `autoNameSession()`, manual rename via `PATCH /sessions/:id/name` + double-click in sidebar |

### Extra Project Features Built

| # | Task | Status | Description |
|---|---|---|---|
| 2.12 | Git clone → project | 🟢 | `POST /projects/clone` — clone repo with SSE progress streaming, auto-create project on completion |
| 2.13 | PATCH project route | 🟢 | `PATCH /projects/:id` — update project name or path with validation |
| 2.14 | Project session unified listing | 🟢 | `GET /sessions?projectId=X` merges live + disk sessions with dedup, sorted by recency |

---

### End of Phase 2 — Milestone

```
User can:
  ✓ Create/delete projects via sidebar
  ✓ Expand/collapse project to see its sessions
  ✓ Switch between projects
  ✓ Create new sessions in any project
  ✓ Sessions persist to disk (JSONL after first assistant response)
  ✓ Session list shows correct message count and last activity time
  ✓ Session discovery deduplicates (live + disk merge)
  ✓ Previous sessions resume on SSE connect (cold → live)
  ✓ View message history from disk sessions
```

**Key insight from pi-forge:**

> The `LiveSession` registry is in-memory. Sessions survive restart because JSONL files persist on disk; the registry is rebuilt lazily as SSE clients reconnect.

---

## Phase 3 — File Browser & Editor

**Goal:** Browse, read, edit, search project files from the browser.

| # | Task | Status | Description |
|---|---|---|---|
|| 3.1 | File manager | 🟢 | `file-manager.ts` (17KB) — path-validated fs operations, atomic writes, tree, search, read, write |
|| 3.2 | File tree endpoint | 🟢 | `GET /api/v1/files/tree` — recursive directory listing (max depth, skips node_modules/.git) |
|| 3.3 | File read endpoint | 🟢 | `GET /api/v1/files/read` — UTF-8 content, language, size, 5MB cap |
|| 3.4 | File write endpoint | 🟢 | `PUT /api/v1/files/write` — atomic tmp+rename, creates parent dirs |
|| 3.5 | File search endpoint | 🟢 | `GET /api/v1/files/search` — ripgrep (fast, gitignore-aware) or Node fallback |
|| 3.6 | File upload endpoint | ⚪ | `POST /api/v1/files/upload` — multipart with SHA-256 verification (deferred: `@fastify/multipart` not wired) |
|| 3.7 | File download endpoint | 🟢 | `GET /api/v1/files/download` — single file or folder-as-tar.gz |
|| 3.8 | File browser panel | 🟢 | `FileExplorer.tsx` (28KB) — tree view, editor, view controls |
|| 3.9 | Code editor panel | 🟢 | `CodeMirrorEditor.tsx` (8KB) — syntax highlighting, line numbers |
|| 3.10 | File search UI (by name) | 🟢 | Filename filter in tree view |
|| 3.11 | Code search tab | 🟢 | 🔍 tab in FileExplorer — calls `GET /api/v1/files/search` (ripgrep/Node fallback), groups results by folder → file → match lines with highlighting, click to open file in editor |
|| 3.12 | Resizable explorer panel | 🟢 | Drag handle on left edge of FileExplorer panel (MIN 220px, MAX 800px), stores width in state |

---

## Phase 4 — Git Integration

**Goal:** View git status, diffs, stage, commit, push/pull from the browser.

| # | Task | Status | Description |
|---|---|---|---|
|| 4.1 | Git runner | 🟢 | `git-runner.ts` (1,037 lines) — security-hardened execFile wrapper with porcelain v1 status parser, custom log format, branch/remote validation, worktree support |
|| 4.2 | Git status endpoint | 🟢 | `GET /api/v1/git/status` — parsed porcelain v1 with staged/unstaged/untracked/renamed/conflicted |
|| 4.3 | Git diff endpoint | 🟢 | `GET /api/v1/git/diff` — unstaged, staged, per-file; `POST /api/v1/git/apply-hunks` — hunk-level staging via synthetic patches |
|| 4.4 | Git log endpoint | 🟢 | `GET /api/v1/git/log` — commit history, custom format with `%H%x1F%s%x1F%an%x1F%aI%x1F%P%x1F%D` |
|| 4.5 | Stage/unstage endpoints | 🟢 | `POST /api/v1/git/stage` and `POST /api/v1/git/unstage` — per-path, returns updated status |
|| 4.6 | Commit endpoint | 🟢 | `POST /api/v1/git/commit` — simple commit with message, returns hash |
|| 4.7 | Push/pull/fetch endpoints | 🟢 | `POST /api/v1/git/push`, `POST /api/v1/git/pull`, `POST /api/v1/git/fetch` — all with output capture |
|| 4.8 | Branch management | 🟢 | `GET /branches`, `POST /branch/create`, `DELETE /branch/:name`, `POST /checkout`, `GET /remotes`, `POST /remote/add`, `DELETE /remote/:name`, `POST /remote/tls`, `POST /init` — full branch + remote CRUD |
|| 4.9 | Git panel | 🟢 | `GitPanel.tsx` (730 lines) — status display, file staging/unstage/revert, inline diffs, commit form, push/pull/fetch, log, branch list + checkout, init button |
|| 4.10 | Tab-integrated explorer | 🟢 | FileExplorer converted to tabbed panel — 📁 Files + ⎇ Git tabs, git icon in header bar alongside 📂, tab state sync via Props |

**Extra routes built (not in original Phase 4 plan):**
- `POST /api/v1/git/revert` — revert files via `git checkout -- <paths>`
- `POST /api/v1/git/init` — initialize new git repo in project directory
- `GET /api/v1/git/worktrees` — list worktrees
- `GET /api/v1/git/remotes` — list remotes
- `POST /api/v1/git/remote/add` — add remote
- `DELETE /api/v1/git/remote/:name` — remove remote
- `POST /api/v1/git/remote/tls` — set remote as insecureTLS
- `POST /api/v1/git/apply-hunks` — hunk-level staging via synthetic patches + `git apply --cached --recount`

**Git runner exports:** `runGitRaw`, `isGitRepo`, `getStatus`, `getDiff`, `getStagedDiff`, `getFileDiff`, `getLog`, `getBranches`, `getWorktrees`, `getRemotes`, `commit`, `stagePaths`, `unstagePaths`, `revertPaths`, `checkoutBranch`, `createBranch`, `deleteBranch`, `fetch`, `pull`, `push`, `addRemote`, `removeRemote`, `setRemoteInsecureTls`, `initRepo`, `GitCommandError`, `GitNotInstalledError`, `InvalidBranchNameError`

**Hunk stager exports:** `applyHunks`, `extractHunks`, `HunkStagingError`, `ApplyMode`

---

## Phase 5 — Configuration UI

**Goal:** Manage API keys, models, settings, skills from the browser.

| # | Task | Status | Description |
|---|---|---|---|
|| 5.1 | Config manager | 🟢 | `config-manager.ts` (8KB) — read/write auth.json, settings.json, models.json |
|| 5.2 | Provider list endpoint | 🟢 | `GET /api/v1/config/providers` — live models from SDK ModelRegistry, presence only, no secrets |
|| 5.3 | API key endpoints | 🔴 | `PUT/DELETE /api/v1/config/auth/:provider` |
|| 5.4 | Settings endpoints | 🔴 | `GET/PUT /api/v1/config/settings` — shallow merge |
|| 5.5 | Models endpoints | 🔴 | `GET/PUT /api/v1/config/models` — keys redacted on GET |
|| 5.6 | Skills endpoints | 🔴 | `GET /api/v1/config/skills`, `PUT /skills/:name/enabled` |
|| 5.7 | Settings panel | 🔴 | UI for providers, API keys, model selection, thinking level |
|| 5.8 | Skills management UI | 🔴 | Enable/disable skills per project |

---

## Phase 6 — Terminal

**Goal:** Integrated terminal (PTY) accessible from the browser.

| # | Task | Status | Description |
|---|---|---|---|
| 6.1 | PTY manager | 🔴 | `pty-manager.ts` — node-pty lifecycle, detach/reattach |
| 6.2 | WebSocket terminal endpoint | 🔴 | `WebSocket /api/v1/terminal` — bidirectional PTY stream |
| 6.3 | Terminal panel | 🔴 | xterm.js component, connected via WebSocket |
| 6.4 | Multiple terminal tabs | 🔴 | Create/switch/close terminal sessions |
| 6.5 | Terminal resize | 🔴 | Send resize events over WS on container resize |

---

## Phase 7 — Polish & DX

**Goal:** Production-ready experience.

| # | Task | Status | Description |
|---|---|---|---|
|| 7.1 | Docker support | 🔴 | Dockerfile, docker-compose for self-hosting |
|| 7.2 | Authentication hardening | 🔴 | Token refresh, session expiry, CORS hardening |
|| 7.3 | Error boundaries | 🔴 | React error boundaries, graceful degradation |
|| 7.4 | Loading skeletons | 🔴 | Placeholder UI while data loads |
|| 7.5 | Keyboard shortcuts | 🟢 | `Ctrl+Enter` send done; `Ctrl+P` model cycle and other shortcuts pending |
|| 7.6 | Mobile responsive | 🔴 | Works on phone/tablet browsers |
|| 7.7 | PWA support | 🔴 | Service worker, manifest, install prompt |
|| 7.8 | Dark/light theme | 🟡 | 6 dark themes done (night, midnight, dawn, clean, terracotta, sage); light theme pending |
|| 7.9 | Accessibility | 🔴 | ARIA labels, keyboard navigation, screen reader support |
|| 7.10 | Testing | 🔴 | Integration tests for critical flows (session, prompt, stream) |

---

## Phase 8 — Advanced Features

**Goal:** pi-forge parity + unique enhancements.

| # | Task | Status | Description |
|---|---|---|---|
|| 8.1 | Turn diff panel | 🔴 | Show file changes from the last completed agent turn |
|| 8.2 | Context inspector | 🟡 | Token usage, cost breakdown, context window pressure — context percentage bar in header + server endpoint done; full cost/turn breakdown pending |
|| 8.3 | Image attachments | 🔴 | Send images with prompts (base64), display in chat |
|| 8.4 | Model switching | 🟢 | Per-session model override via `POST /sessions/:id/model` done; mid-session cycling UI (dropdown during streaming) pending |
|| 8.5 | Compaction awareness | 🔴 | UI indicator when compaction runs, summary display |
|| 8.6 | Auto-retry UI | 🔴 | Countdown banner during rate-limit backoff |
|| 8.7 | Quick actions | 🔴 | Pre-built prompts (fix lint, add tests, etc.) |
|| 8.8 | Webhooks | 🔴 | Outbound webhooks on session events |
|| 8.9 | Baked-in ask_user_question tool | 🟢 | Native tool + SSE events + REST endpoints + UI panel — agent can present structured questions with single/multi-select/custom options, user answers via panel above chat input |
|| 8.10 | MCP settings UI | 🟢 | MCP settings panel (enable/disable, server CRUD, probe, status indicators, stdio trust, global per-tool enable/disable, per-project tool overrides with TriStatePicker) — toolbar button, MCPPanel component, mcp-store with 30s polling; full server-side routes for settings, servers, trust, tools, overrides |
|| 8.11 | Orchestration | 🟢 | Multi-agent workflows, sub-agent management — 8 `orchestrate_*` tools: spawn, list, read, send, interrupt, kill, detach, read_inbox. REST endpoints for enable/disable/inbox/workers/mgmt. Orch toggle (⚡) + enable/disable panel in UI. Workers nest under supervisor in sidebar, collapsed by default, auto-expand + pulsating dot when streaming |

---

## Dependency Graph

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4
  │                           │
  │                           ▼
  └─────────────────────► Phase 5
  │
  └─────────────────────► Phase 6

Phase 7 (polish) — can start in parallel from Phase 3 onward
Phase 8 (advanced) — depends on all earlier phases
```

Phases are intentionally ordered so each one:
- Delivers a **usable, shippable increment**
- **Unblocks** the next phase
- **Validates** the architecture before adding complexity

---

## Quick Reference: Route Map

`````
/api/v1/
├── health          ✅ (Phase 1a — done)
├── auth/
│   ├── status      ✅ (Phase 1a — done)
│   ├── login       ✅ (Phase 1a — done)
│   └── logout      ✅ (Phase 1a — done, extra)
├── ui-config       ✅ (Phase 1a — done, extra)
├── projects/       ✅ (Phase 2 — done)
│   └── clone       ✅ (Phase 2 — done, extra)
├── sessions/       ✅ (Phase 1a → Phase 2 — mostly done)
│   ├── POST /                    ✅ create
│   ├── GET /                     ✅ list (supports ?projectId filter)
│   ├── GET /:id/messages         ✅ history
│   ├── GET /:id/context          ✅ token telemetry (extra)
│   ├── GET /:id/tree             ✅ session tree (Phase 2)
│   ├── POST /:id/prompt          ✅ send prompt
│   ├── GET /:id/stream           ✅ SSE stream (cold resume)
│   ├── POST /:id/abort           ✅ abort
│   ├── POST /:id/steer           ✅ steer / follow-up
│   ├── POST /:id/navigate        ✅ branch switch (Phase 2)
│   ├── POST /:id/fork            ✅ fork (Phase 2)
│   ├── POST /:id/model           ✅ set model (extra)
│   ├── GET /:id/model            ✅ get model (extra)
│   ├── GET /:id/ask-user-question/pending   ✅ pending questions
│   ├── POST /:id/ask-user-question/answer   ✅ answer questions
│   ├── POST /:id/archive         ✅ archive (Phase 2)
│   ├── POST /:id/unarchive       ✅ restore from archive (Phase 2)
│   ├── DELETE /:id               ✅ dispose
│   └── GET /:id/turn-diff        ✅ turn diff (extra)
├── files/          ✅ (Phase 3 — 10/10 + 2 extra, upload deferred)
│   ├── tree           ✅
│   ├── read            ✅
│   ├── write           ✅
│   ├── search          ✅
│   ├── upload          ⚪ deferred (multipart not wired)
│   └── download        ✅
├── git/            🟢 (Phase 4 — all 19 endpoints, full git panel UI)
│   ├── status          🟢
│   ├── diff            🟢
│   ├── diff/staged     🟢
│   ├── diff/file       🟢
│   ├── log             🟢
│   ├── branches        🟢
│   ├── branch/create   🟢
│   ├── branch/:name    🟢 (DELETE)
│   ├── remotes         🟢
│   ├── remote/add      🟢
│   ├── remote/:name    🟢 (DELETE)
│   ├── remote/tls      🟢
│   ├── worktrees       🟢
│   ├── init            🟢
│   ├── stage           🟢
│   ├── unstage         🟢
│   ├── commit          🟢
│   ├── revert          🟢
│   ├── apply-hunks     🟢
│   ├── fetch           🟢
│   ├── pull            🟢
│   └── push            🟢
├── config/         🟡 (Phase 5 — partial)
│   ├── providers   ✅ done
│   ├── auth/:provider  🔴 not started
│   ├── settings         🔴 not started
│   ├── models          🔴 not started
│   ├── skills/...       🔴 not started
│   └── tools/          🟢 full CRUD — list, overrides cascade, PUT/DELETE per-project tool toggle
├── extensions/     ✅ (Phase 8 — runtime discovery + install)
│   ├── GET /            ✅ list detected + recommended
│   └── POST /install    ✅ install a package
├── orchestration/  ✅ (Phase 8)
├── mcp/            🟢 (Phase 8 — full CRUD)
│   ├── settings    🟢 GET + PUT master toggle
│   ├── servers     🟢 GET list, PUT upsert, DELETE remove, POST probe
│   ├── trust/:id   🟢 POST grant, DELETE revoke
│   └── tools       🟢 GET per-project tool listing with effective state
└── terminal        🔴 (Phase 6 — WebSocket, not started)
`````

---

## References

- **pi SDK docs**: https://pi.dev/docs/latest/sdk
- **pi-forge** (inspiration): `./pi-forge/` in this directory
- **AGENTS.md**: `./AGENTS.md` — full project context for coding agents

---

## 📊 **Current Implementation Summary**

| **Total: ~52/72 tasks completed (~72% of roadmap)**

### **By Phase:**
- **Phase 1 (Chat MVP):** ✅ **92% done** (15/16 routes)
- **Phase 2 (Projects & Sessions):** ✅ **93% done** (14/15 tasks)
- **Phase 3 (File Browser & Editor):** ✅ **92% done** (12/13 tasks, 1 deferred)
- **Phase 4 (Git Integration):** ✅ **100% done** (10/10 tasks + 12 extra endpoints)
- **Phase 5 (Config UI):** ✅ **25% done** (2/8 tasks, provider list + config manager)
- **Phase 6 (Terminal):** ✅ **0% done** (0/5 tasks)
- **Phase 7 (Polish & DX):** ✅ **20% done** (2/10 tasks, keyboard shortcuts + 6 themes)
- **Phase 8 (Advanced):** ✅ **54% done** (6/12 tasks + context inspector partial + MCP UI — model switching + ask_user_question + orchestration + extension discovery + MCP settings + per-project tool overrides)

### **Key Completed Features:**
- ✅ Full chat MVP with streaming responses
- ✅ 6 dark themes (night, midnight, dawn, clean, terracotta, sage)
- ✅ Session tree navigation, forking, archiving
- ✅ File browser (tree, read, write, search, download)
- ✅ Code search tab (🔍 in explorer — ripgrep/Node fallback, grouped by folder, highlighted matches)
- ✅ Resizable explorer panel (drag handle, 220–800px)
- ✅ `ask_user_question` tool with UI panel
- ✅ Per-session model override
- ✅ Orchestration — supervisor spawns/list/reads/sends/interrupts/kills/detaches worker sessions
- ✅ Runtime extension discovery — detect installed pi.dev extensions + curated recommendations with one-click install; dynamic agent type settings when pi-subagents detected
- ✅ Extension update checking — npm registry version comparison + one-click update button per installed extension
- ✅ Agent reload — `/reload` button delegating to `pi reload` CLI or in-process MCP reload fallback
- ✅ Context inspector — context percentage bar in header (polls live session), agent-running pulse on send/abort button
- 🟢 MCP settings UI — server CRUD, enable/disable toggle, probe, stdio trust, tool listing with global per-tool toggle + per-project TriStatePicker overrides; toolbar button + settings panel + Zustand store with 30s polling; full server-side routes

### **Remaining Work:**
- Terminal (PTY, WebSocket, xterm.js)
- Config UI (API keys, settings, models, skills)
- Polish (mobile responsive, PWA, accessibility, testing)
- Advanced (turn diff, full cost/turn breakdown, image attachments, compaction awareness, auto-retry UI)

---
