# AGENTS.md (pi-kot context)

## 🚫 No Server Control
- **Actions like restart, stop, or start are user-only.** Never attempt to restart, stop, or start any server or service yourself.
- **If the project needs a server restart**, clearly tell the user to do it. Do not try to execute restart commands.

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
- **Reference template**: `./pi-forge/` contains reference design patterns, API structures, and SSE layouts.
- **SDK Rules**: Canonical documentation lives at `https://pi.dev/docs/latest`. Prioritize asynchronous SDK handlers like `createAgentSession()` and async event streams.

## 🥇 SDK-First Principle (CRITICAL)
- **Ask the SDK first, always**. The SDK carries everything — model/provider per message, usage tokens, stop reasons, streaming events. Before writing any custom logic, check what the SDK types/events already provide.
- Only add custom code when the SDK doesn't have what you need. The web UI is a thin presentation layer over SDK data.
- **If the SDK provides a field** (`AssistantMessage.model`, `AssistantMessage.provider`, `AssistantMessage.usage`, etc.) — read it from the message object, don't derive it from client state.
- **If the SDK emits an event** (`text_delta`, `message_end`, `tool_result`) — consume it directly instead of re-fetching or reconstructing.
- Default: SDK. Fallback: your own code. This keeps pi-kot lean and automatically gains features when the SDK updates.

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

## 💬 Communication Style
- Keep responses short, technical, and direct. 
- State your terminal or code action in exactly one sentence, then execute it. No fluff.
