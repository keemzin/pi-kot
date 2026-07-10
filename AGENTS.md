# AGENTS.md (pi-kot context)

## 🧠 FOR SMALL MODELS (4B and below) — JUST FOLLOW THESE 3 RULES

Your context window is tiny. Do NOT read files or dump command output. Use context-mode tools ONLY.

### RULE 1: Answer questions about code → `ctx_execute_file`
```
ctx_execute_file(path: "some-file.ts", language: "javascript", code: `
  const lines = FILE_CONTENT.split('\n');
  const errors = lines.filter(l => l.includes('ERROR'));
  console.log(errors.length + ' errors out of ' + lines.length + ' lines');
  console.log(errors.slice(0,5).join('\n'));
`)
```

### RULE 2: Research the codebase → `ctx_batch_execute`
Run 3-5 commands at once. Add queries to get answers immediately.
```
ctx_batch_execute(commands: [
  {label: "recent", command: "git log --oneline -10"},
  {label: "routes", command: "grep -rn 'router.get|router.post' src/ | head -20"},
  {label: "size", command: "find src -name '*.ts' | xargs wc -l | tail -5"}
], queries: ["what is the recent work", "what routes exist"])
```

### RULE 3: Remembering past work → `ctx_search`
```
ctx_search(queries: ["previous decision about X", "error Y resolution"])
```

### 🚫 NEVER DO THESE (they fill your tiny context):
- `bash` + `cat` / `head` / `tail` on files — use `ctx_execute_file`
- `bash` + `curl` without processing — use `ctx_execute` with `fetch()`
- `read` on files larger than 50 lines — use `ctx_execute_file`
- Sequential bash commands — batch them in `ctx_batch_execute`

When in doubt: run code in ctx_execute, print only the answer.

---

## 🚫 No Server Control / No Auto-Commit
- **Actions like restart, stop, or start are user-only.** Never attempt to restart, stop, or start any server or service yourself.
- **If the project needs a server restart**, clearly tell the user to do it. Do not try to execute restart commands.
- **No automatic commits.** Never `git commit`, `git push`, or create a PR unless the user explicitly tells you to.

## 🚫 Working Directory & Path Guards (CRITICAL)
- **Project Root**: `/home/hakeem/pi-kot/`. You MUST stay inside this directory.
- **No `cd` Loops**: Never issue a naked `cd` command. Never execute consecutive `cd` steps.
- **Chained Commands**: Combine directory changes and actions into a single string using `&&` (e.g., `cd packages/ui && npm run build`).
- **Absolute Paths**: Always prefer absolute paths starting with `/home/hakeem/pi-kot/` for `read`, `write`, `edit`, and `bash` tools to prevent state loss.
- **Subagent Exploration**: For deep codebase exploration, directory analysis, or file auditing, immediately spawn a specialized subagent to keep the main path clean and avoid context bloat.
- **Circuit Breaker**: If any path change fails or commands repeat sequentially, STOP instantly and print: `[AGENT_LOOP_DETECTED] Interrupted for user guidance.`

## 🛠️ Project Definition & Architecture
- **pi-kot** is an HTTP bridge and browser UI wrapper for the [pi coding agent](https://pi.dev).
- It embeds the `@earendil-works/pi-coding-agent` SDK and exposes capabilities via REST, Server-Sent Events (SSE), and WebSockets.
- It is **NOT** a rewrite of the agent loop; it is a web frontend.
- **SDK Rules**: Canonical documentation lives at `https://pi.dev/docs/latest`. Prioritize asynchronous SDK handlers like `createAgentSession()` and async event streams.

## 🥇 SDK-First Principle (CRITICAL)
- **Ask the SDK first, always**. The SDK carries everything — model/provider per message, usage tokens, stop reasons, streaming events. Before writing any custom logic, check what the SDK types/events already provide.
- Only add custom code when the SDK doesn't have what you need. The web UI is a thin presentation layer over SDK data.
- **If the SDK provides a field** (`AssistantMessage.model`, `AssistantMessage.provider`, `AssistantMessage.usage`, etc.) — read it from the message object, don't derive it from client state.
- **If the SDK emits an event** (`text_delta`, `message_end`, `tool_result`) — consume it directly instead of re-fetching or reconstructing.
- Default: SDK. Fallback: your own code. This keeps pi-kot lean and automatically gains features when the SDK updates.

## ⚠️ Parts-Based Message Architecture (normalize.ts)

**This is the single most important adapter in the codebase.** Understand it before touching any chat rendering.

### Architecture
```
SDK AssistantMessage  ──>  normalize.ts  ──>  UIMessage.parts[]  ──>  ChatView rendering
(Transport format)           (ADAPTER)          (UI format)            (renderAssistantParts)
```

### Key files
| File | Role |
|------|------|
| `packages/client/src/lib/normalize.ts` | **THE single adapter** — maps SDK types to UI parts. This is the ONLY file that reads SDK content blocks. |
| `packages/client/src/stores/session-store.ts` | Holds `partsMessages: UIMessage[]` and `streamingMessage: UIMessage \| undefined`. SSE handlers write to these. |
| `packages/client/src/components/ChatView.tsx` | Reads `msg.parts[]` and renders each part by type in `renderAssistantParts()`. |

### UIMessage.parts[] shape
```typescript
parts = [
  { type: 'text', text: '...', state: 'streaming' | 'done' },
  { type: 'thinking', text: '...' },
  { type: 'tool-call', toolName, toolCallId, args, state, output, errorText },
  { type: 'image', mimeType, data },
  { type: 'bash-exec', command, output, exitCode, ... },
]
```

### Tool grouping logic (critical for understanding)
Tools accumulate ACROSS assistant messages in one turn via `toolEntries[]` inside `renderAssistantParts`. They flush into a single `ToolCallBatchCard` when prose (text) appears or at the end of the turn.

Thinking blocks immediately before a tool call are extracted from prose (`extractTrailingThinking`) and bundled INSIDE the tool batch as `ToolBatchEntry` entries — they render inside the batch card's expandable details, NOT as separate bubbles.

### ⚠️ What to watch out for when the SDK updates

The pi SDK (`@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`) can change its content block types or event protocol. Here's what to check:

**1. SDK adds a new content block type** (e.g., `ReasoningContent` alongside `ThinkingContent`)
   - ONLY `normalize.ts` needs a new mapping (`normalizeAssistantContent` and `normalizePartialContent`)
   - `ChatView.tsx` needs a new `else if (part.type === "reasoning")` branch in `renderAssistantParts`
   - TypeScript's discriminated union tells you if you missed anything

**2. SDK changes field names** (e.g., `ToolCall.arguments` → `ToolCall.args`)
   - ONLY `normalize.ts` — update the field access in `normalizeAssistantContent`/`normalizePartialContent`
   - No changes needed in ChatView, session-store, or any other file

**3. SDK changes event protocol** (e.g., removes `message_update` events)
   - `session-store.ts` SSE handlers need updating
   - `normalize.ts` may need new entry points if the replacement data shape is different
   - ChatView is usually unaffected (it only reads the already-normalized `partsMessages`)

**4. SDK changes `AssistantMessage.content` type**
   - ONLY `normalize.ts` — this is the only consumer of the raw content array
   - All other code reads `UIMessage.parts[]` which stays stable

**5. Tool result pairing breaks** (tool results not showing)
   - Check `normalizeMessages()` in `normalize.ts` — the first pass collects tool results by `toolCallId`
   - Check `refetchMessages()` in `session-store.ts` — it calls `normalizeMessages()` to rebuild `partsMessages`

### The golden rule
> **If a bug relates to how a message looks in the chat UI, first check what `partsMessages` contains. Then trace back through `normalize.ts` to see how the SDK data was mapped.**

Never bypass `normalize.ts` by reading SDK types directly in ChatView. If you need a new field from AssistantMessage in the UI, add it to `UIMessage` and map it in `normalize.ts`.

### Reverting (if ever needed)
```bash
# Restore the old entire client from the reference commit:
git checkout 1a37982 -- packages/client/src/
```

## 🎨 Artifacts Panel — Multi-Format Support

**`packages/client/src/components/ArtifactsPanel.tsx`** — Artifacts panel that renders tool outputs and fenced code blocks from the chat as rich previews.

### Supported formats

| Format | Source | Renderer |
|--------|--------|----------|
| `html` | ` ```html`, tool output starting with `<!DOCTYPE html>` or `<html>` | Sandboxed iframe |
| `svg` | ` ```svg`, tool output starting with `<svg>` | Sandboxed iframe (wrapped in HTML doc) |
| `markdown` | ` ```markdown`, ` ```md` | `ChatMarkdown` (react-markdown + GFM + KaTeX) |
| `json` | ` ```json`, tool output starting with `{` or `[` (valid JSON) | Syntax-highlighted with prism |
| `text` | ` ```text`, ` ```plain`, ` ```txt` | Monospace pre (word-wrapped) |
| `image` | ` ```image`, tool output starting with `data:image/` | `<img>` tag with max-width containment |

### Detection logic (`ChatView.tsx`)

**Tool outputs**: Heuristic detection based on content prefix:
- `<!DOCTYPE html>` / `<html>` → `html`
- `<svg>...</svg>` → `svg`
- `data:image/...` → `image`
- `{` / `[` that parses as JSON → `json`

**Assistant text**: Fenced code blocks are detected by language tag:
```
```html ... ```       → html
```svg ... ```        → svg
```json ... ```       → json
```markdown / ```md   → markdown
```text / ```plain    → text
```image ... ```      → image
```

### Key files
| File | Role |
|------|------|
| `packages/client/src/stores/layout-store.ts` | `ArtifactItem` type + `pushArtifact()` action |
| `packages/client/src/components/ChatView.tsx` | Scans parts for artifacts on every render |
| `packages/client/src/components/ArtifactsPanel.tsx` | Renders artifacts by type |

### Non-goal
Artifacts only capture content that passes **through the chat** (tool outputs, assistant text). Files written to disk via `write`/`edit` tools never become artifacts — they produce text output that renders in `ToolCallBatchCard`.

## 🧩 Tool Renderer Registry (`toolRegistry.tsx`)

**`packages/client/src/lib/tool-registry.tsx`** — A registry that maps tool names to custom React renderer components, replacing hardcoded `if/else` chains in `ChatView.tsx`.

### Architecture
```
tool-call part  ──>  toolRegistry.get(toolName)  ──>  found? → CustomRenderer
                                                    └─> not found? → ToolCallBatchCard (default)
```

### Key files
| File | Role |
|------|------|
| `packages/client/src/lib/tool-registry.tsx` | Defines `ToolRegistry` class + singleton `toolRegistry` export |
| `packages/client/src/components/ChatView.tsx` | Calls `toolRegistry.get(part.toolName)` and renders custom components |

### API
```typescript
import { toolRegistry } from "../lib/tool-registry";

// Register a custom renderer for any tool
toolRegistry.register("javascript_repl", ({ part, messageId }) => (
  <ReplSandbox
    code={(part.args?.code as string) ?? ""}
    title={(part.args?.title as string) ?? ""}
    isRunning={part.state === "running"}
  />
));
```

### Behavior
- **If a tool is registered**: `ChatView` renders it as a standalone message bubble (flushes any pending `ToolCallBatchCard` first).
- **If a tool is NOT registered**: Falls through to `ToolCallBatchCard` (default tool card). **No behavior changes** — all existing tools work exactly as before.
- **Registration can happen anywhere**: At the top of `ChatView.tsx`, in a separate module, or loaded dynamically from an extension bundle.

### When adding a new custom renderer
1. Create a React component that accepts `ToolRendererProps` (`{ part: ToolCallPart, messageId: string }`).
2. Register it with `toolRegistry.register("tool_name", MyComponent)`.
3. Done. **Do NOT modify `ChatView.tsx`.**

### Extension auto-loading (future)
This registry enables a future pipeline where server extensions ship a `clientScript` bundle that registers renderers on load:
```
Extension installed  →  Server serves client bundle  →  App loads bundle  →  toolRegistry.register() fires  →  ChatView renders custom UI
```

## 🔍 context-mode First Code Lookup (CRITICAL)
- **Use context-mode tools for all code exploration, file analysis, and multi-command research.** Refer to the tool hierarchy below.
- **`ctx_search` (knowledge base)**: First stop for any codebase query. Searches previously indexed content, auto-captured session events (decisions, errors, blockers, plans), and documentation. Use 2-4 specific technical terms per query.
- **`ctx_execute_file` (file analysis)**: Run code over a file when you need to derive an answer (count lines, match patterns, parse JSON, analyze structure). Returns only `console.log()` output — raw file bytes stay out of conversation memory.
- **`ctx_batch_execute` (multi-command research)**: Batch related commands (multi-file grep, git log + diff, directory scans) in one call. Auto-indexes output for follow-up queries.
- **`ctx_index` (store knowledge)**: Index module summaries, API docs, design decisions, and any content you'll query later. Use `ctx_index(path: ..., source: "...")` for local files, `ctx_index(content: ..., source: "...")` for inline content.
- **`ctx_fetch_and_index` (web docs)**: Fetch pi.dev SDK docs or other web references and index them directly — no read needed.
- **Only fall through to bash/grep/find/read** when context-mode cannot answer (rare — typically very specific single-line content where `read` is simpler).

## 📎 Qdrant — Manual Only
- **Do NOT use Qdrant automatically.** Only `qdrat__qdrant-store` or `qdrat__qdrant-find` when the user explicitly asks for it.
- **Still valid**: If the user says "store this in Qdrant" or "search Qdrant for...", use it. Otherwise ignore.
- **Collection**: `pi-kot-codebase` if used.

## 🧪 Testing Workflow (Vitest)

Tests live alongside source files as `*.test.ts`. The test runner is Vitest.

### Running tests
```bash
npm test                          # all workspaces
npm -w packages/client test       # client only
npm -w packages/server test       # server only
npx vitest                        # watch mode — re-runs on save
```

### When to update tests
| Situation | Action |
|-----------|--------|
| **Bug fix** | Add the test that would have caught the bug (regression guard) |
| **New feature** | Add tests covering the new paths and edge cases |
| **Refactor** (no behavior change) | Tests should pass unchanged. If they don't, you accidentally changed behavior |

### Agent can handle tests
Just ask: *"update the tests for this change"* or *"add tests for this new function"*. The agent writes them, runs them, and fixes any failures.

### Example
```bash
# After changing a function:
npm test          # 233ms — instant feedback
# All green → good to commit
# Red → fix before committing
```

---

## 📁 Modular Components Pattern

Settings panels and other complex components live in `components/<name>/` with one file per tab/section. This keeps files small (<200 lines), makes each tab independently editable, and lets agents target specific files without reading unrelated code.

```
components/
  SettingsPanel.tsx          ← shell (tabs + nav only)
  settings/
    shared.tsx               ← shared sub-components
    AppearanceTab.tsx
    ProvidersTab.tsx
    AgentTab.tsx
    GeneralTab.tsx
```

New tabs just drop in as new files — no need to modify the shell beyond adding the import and tab entry.

### Server-Side UI Settings Persistence

UI preferences (theme, toggles) follow pi-web's pattern:
- **`packages/server/src/ui-settings-store.ts`** — typed schema (`UiSettings`), atomic writes (`writeFile` + `rename`), cached reads, patch with normalization
- **`GET/PUT /config/ui-settings`** — Fastify routes for read/patch
- **`api-client.ts`** — `getUiSettings()` / `updateUiSettings()`
- Settings saved to `~/.pi/agent/ui-settings.json`; falls back to localStorage when server is unreachable
- Adding a new persisted preference: add property to `UiSettings` type + default in `DEFAULTS` + handler in `normalize()` — no route changes needed

---

## 💬 Communication Style
- Keep responses short, technical, and direct. 
- State your terminal or code action in exactly one sentence, then execute it. No fluff.

## 🔌 Extension Integration Pattern (SDK + SSE)

When integrating a new pi extension into pi-kot, extensions that use `ctx.ui.*` (select, confirm, input, editor) or check `ctx.hasUI` will fail because pi-kot runs the SDK without a TUI. The fix is always:

### Step 1: Identify the TUI boundary
Read the extension's `registerTool({ execute: ... })` and `pi.on(...)` handlers. If it calls `ctx.ui.select()`, `ctx.ui.confirm()`, `ctx.ui.editor()`, or checks `ctx.hasUI`, those paths don't work in pi-kot.

### Step 2: Replace the tool definition
Create a file under `packages/server/src/ask-user-question/` (or a new module if unrelated to questions) that exports a `createXxxTool(sessionId): ToolDefinition` function. Use the exact same tool `name` as the extension's tool so the SDK's `Map.set()` overwrite in the tool registry (extension tools loaded first, customTools second) takes effect.

```typescript
// packages/server/src/ask-user-question/plan-mode-question-tool.ts
import { registerPending } from "./registry.js";

export function createPlanModeQuestionTool(sessionId: string): ToolDefinition {
  return {
    name: "plan_mode_question",       // same name as extension's tool
    // ... same schema, promptSnippet, promptGuidelines
    async execute(_toolCallId, params, signal) {
      // Don't use ctx.ui — use registerPending() instead
      const { result } = registerPending({ sessionId, questions, signal });
      return await result;
    },
  };
}
```

### Step 3: The ask-user-question pipeline (for user-facing tools)
`registerPending()` in `packages/server/src/ask-user-question/registry.ts` handles everything:
- **In-memory registry**: stores pending questions per session
- **SSE events**: fires `ask_user_question` events → bridged to web UI via `initOrchestrationAskUserQuestionBridge()` in `orchestration/init.ts`
- **REST endpoint**: `POST /api/v1/sessions/:id/ask-user-question/:requestId/answer` — the web UI calls this to submit answers
- **Promise resolution**: the tool's `execute()` awaits the result, blocking the LLM until the user answers
- **Abort support**: pass `signal` from the tool's execute to handle agent abort cleanly

No frontend changes are needed — the existing `AskUserQuestionPanel` component handles rendering and interaction.

### Step 4: Wire into all 4 session-creation sites
`packages/server/src/session-store.ts` has 4 places where `customTools` are built:
1. **New session** (`createSession`, ~line 231) — first-time session creation
2. **Rebuild session** (~line 565) — after tool config changes
3. **Resume session** (~line 743) — re-opening an existing session
4. **Fork session** (~line 852) — forking from an existing session

Add the new tool function to ALL 4 arrays. If a session was created before your change, it won't include the new tool until the session is rebuilt (restart server + new session).

### Step 5: Add to recommended extensions
Update 3 files to show the extension in the web UI:
- `README.md` — add row to the extensions table + mention in tip section
- `HOWTO.md` — add row to the extensions table
- `packages/server/src/extension-manager.ts` — add entry to the EXTENSIONS array (category, verified, enablesFeatures, icon)

### SSE observation only (don't use as interception)
`session.subscribe()` events (`tool_execution_start`, `tool_execution_end`, `tool_result`) are **observable only** — they fire after the tool has already executed. You cannot change a tool's return value from these events. Tool replacement via `customTools` is the only way to change behavior.
