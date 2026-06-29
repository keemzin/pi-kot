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

## 🔍 Qdrant-First Code Lookup (CRITICAL)
- **Always query Qdrant first** when asked to find code, understand a module, or explore the codebase. Use `qdrat__qdrant-find` with the collection `pi-kot-codebase` before running any grep/find/read.
- **Why**: Qdrant stores indexed summaries of every module, route, component, and subsystem. A single query gives you the file name, purpose, and key exports — so you know exactly which file to read without grepping blindly.
- **Fall through only after a miss**: If Qdrant returns nothing useful for your query, then use `bash` (find/grep/rg) to locate files and `read` to inspect them. Do not skip the Qdrant step.
- **Store findings after file reads**: After reading any file to answer a question (font sizes, CSS values, exports, logic), store the discovered details with `qdrat__qdrant-store`. This caches the answer so next time Qdrant returns it directly — no grep/read needed.
  - Example: after reading themes.css and ChatView.tsx for font sizes, store `"Chat font sizes: body 16px, assistant p inherits, h1 18px, h2 16px, h3 14px, headings drop to 15/14/13 outside assistant bubbles. 12 themes (8 dark/4 light)."`
- **Store module summaries**: After reading a new or unfamiliar module, store a brief Qdrant entry with `qdrat__qdrant-store` so future lookups are instant. Use metadata `type` (e.g. `"type":"server_module"`, `"type":"client_component"`).
- **Collection invariant**: All pi-kot codebase memories go in `pi-kot-codebase`. Do not create other collections for this project.

## 💬 Communication Style
- Keep responses short, technical, and direct. 
- State your terminal or code action in exactly one sentence, then execute it. No fluff.
