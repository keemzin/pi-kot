# Changelog

All notable changes to pi-kot, with focus on SDK upgrades and behavior that affects users.

## [1.1.0] — 2026-10-14

### Highlights & Features

- **Quick-Pick Command Palette (`Cmd+O` / `Ctrl+O`)**: Redesigned the Add/Open Project flow into a top-pinned, floating command palette with smart Git repo detection, real-time filesystem directory browsing, clickable breadcrumb navigation, and inline folder creation (`mkdir`).
- **Slide-in Settings Drawer**: Evolved the Settings dialog from a centered popup box into a modern right-side slide-in sheet on desktop, keeping active chat sessions and the code editor in view while configuring options.
- **Backdrop Dismissal Protection**: Disabled accidental outside clicks across all dialogs and modals (`Modal`, `SlidePanel`, `AddProjectDialog`, `AddProviderDialog`, `RewindModal`, `ExtensionUIInteractionModal`, `GlobalConfirmDialog`), preventing loss of user work during interactions.
- **Enhanced Code Blocks & Shell Highlighting**: Integrated Prism syntax grammars for `bash`, `sh`, `zsh`, and `shell` scripts. Added a dedicated code block header bar displaying language tags, artifact preview trigger, and copy actions with clean full-width code scrolling.
- **Customizable Inline Code Chips**: Refined inline monospace chips to soft, neutral styling with an optional "Accent-colored inline code" toggle in *Settings → Appearance* that persists server-side.
- **Compact User Prompt Bubbles**: Restored compact 2-line clamping for user messages with instant `▼ Show more` expansion, keeping the conversation stream clean during long prompts and script pastes.
- **Chat Layout Polish**: Increased bottom scroll padding to 40px to eliminate input bar overlap, and elevated the floating prompt input container with backdrop blur and accent focus glow.

## [1.0.0] — 2026-10-12

### 🎉 Major Release: 1.0.0 Stable & SDK 1.1.0 Upgrade

#### Highlights & Features

- **pi Coding Agent SDK 1.1.0 Upgrade**: Upgraded `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, and `@earendil-works/pi-agent-core` to `^1.1.0`.
- **Full-Width Editor Diff Tabs**: Working tree, staged changes, and commit diffs now open directly in the main editor area as dedicated tabs (`git-diff://`) instead of cramped sidebar accordions.
- **Dedicated Diff Action Toolbar**: Added `DiffEditorView` with directory breadcrumbs, status pills (`WORKING TREE`, `STAGED`, `COMMIT`), `+add / −del` statistics, and segmented Unified ↔ Split view switcher.
- **Quick Diff Controls**: One-click "Open File" to switch into live code editor, Stage/Unstage toggle, Discard changes with 2-click confirmation safety, and Copy Path with instant feedback.
- **Modernized Turn Diffs & Syntax Highlighting**: Tokenized Prism syntax highlighting with intraline character-level diff detection across chat turns and file cards.
- **Modern UI Dialogs & Floating Toasts**: Replaced native browser popups (`confirm`, `alert`) with themed accessible modal dialogs and non-blocking floating notifications.
- **Chat & Orchestration Polish**: Streamlined chat input bar with rich orchestration popovers, notification event cards, and refined tool grouping.

## [0.1.41] — 2026-10-12

### Highlights & Features

- **Batch ZIP Download**: Added multi-item selection and one-click "Download as ZIP" in the file explorer, streaming files and directories directly without intermediate disk spikes.
- **Responsive Toolbar Tabs**: Replaced global media queries with container queries on the file explorer panel, collapsing inactive tab labels to icons under compact widths (<500px) and locking action button flex-shrink so sync, upload, and create buttons are never clipped.
- **Docker & Containerization**: Added multi-stage Debian Bookworm container deployment in `docker/` bundling Node 22, Python 3.12, Git, Ripgrep, and native build toolchains with configurable sudo policies and defensive path fallbacks.

## [0.1.40] — 2026-09-28

### Highlights & Features

- **UI & Mobile Modernization**: Redesigned settings panel tabs, streamlined providers view, and optimized mobile chat toolbar to ensure action controls and send buttons remain fully accessible on narrow viewports.
- **Background Process Manager**: Added background process manager tool with dedicated process monitoring UI.
- **Session Explorer**: Modernized session list with Lucide icons, relative timestamps, and refined active session indicators.
- **Git Panel & Diff Viewer**: Polished Git panel file rows, staging actions, and diff toolbar.
- **File Management**: Added multi-file selection, batch delete, and drag-and-drop batch move in the file explorer; redesigned file editor toolbar.
- **Archive Retention**: Automated 30-day archive retention purge and permanent deletion support.
- **Session Favorites**: Server-persisted starred sessions across devices and resolved sidebar pagination edge cases.
- **Streaming Performance**: Decoupled artifact parsing from streaming token processing for smoother chat output and chronological `!command` execution order.

## [0.1.39] — 2026-09-25

### SDK Upgrade: pi-coding-agent → 0.87.1

pi-kot now runs on `@earendil-works/pi-coding-agent@^0.87.1` (+ `pi-ai@^0.87.1` + `pi-agent-core@^0.87.1`).

#### Changed
- Bumped `@earendil-works` SDK dependencies across root, server, and client packages to `^0.87.1`.
- Updated split-flap board defaults to `PI-KOT 0.1.39` / `PI-SDK 0.87.1`.
- Hardened `@` reference chip parsing to ignore PowerShell/Java/Python syntax like `@(` or `@{`.
- Supported deep nested folder artifact previews under `.pi/artifacts/**`.

#### What users get (inherited from SDK 0.87.1)
- New frontier model support: Claude Opus 5.5 (1M context + adaptive thinking), GPT-6 Sol and Luna, Grok 4.7 default for xAI, Meta Muse Spark.
- Prompt cache warming support during long tool calls.
- Stricter schema handling and faster startup with Node compile cache.

## [0.1.25] — 2026-08-02

### SDK Upgrade: pi-coding-agent → 0.83.0

pi-kot now runs on `@earendil-works/pi-coding-agent@0.83.0` (+ `pi-ai@0.83.0` + `pi-agent-core@0.83.0`), the latest release (2026-07-29).

> **Correction uncovered during upgrade:** the server workspace previously pinned `^0.80.10` for `pi-coding-agent` / `pi-ai` / `pi-agent-core`, so the *server* was actually running on **0.80.10** while the root declared 0.82.1. All `@earendil-works/*` packages are now deduped to a single **0.83.0** copy across the tree — no more stale nested installs.

#### Changed

- **Dependencies** — bumped `@earendil-works/pi-coding-agent` to `^0.83.0` in both `package.json` (root) and `packages/server/package.json`; aligned `pi-ai` and `pi-agent-core` to `^0.83.0` in the server workspace.
- **Code migration** — `packages/server/src/routes/control.ts`: replaced removed `modelRuntime.reloadConfig()` with `modelRuntime.refresh()` in the set-model flow (0.83.0 removed `reloadConfig`; `refresh()` reloads `ModelConfig`, rebuilds providers, and re-checks auth — network catalog refresh stays off by default).

#### What users get (inherited from SDK 0.83.0)

- **Provider errors surface correctly** — unmapped terminal stop reasons (Google, Anthropic, Bedrock, Mistral, OpenAI) now show as provider errors instead of silently "succeeding".
- **`"pending"` stop reason** on partial streaming messages — handled as an opaque string by pi-kot; only finalized on `message_end`, so no UI impact.
- **Better model/auth freshness** — OAuth tokens refresh when <5 min validity remains instead of at expiration.
- **New providers/models available** — Claude Opus 5 via GitHub Copilot (1M context), OpenRouter/Kimi Code sign-in flows, `ctx.scopedModels` for extensions.
- **SDK fixes inherited** — session replacement mid-response no longer leaves dangling tool calls; llama.cpp streamed responses report token usage correctly.

#### ⚠️ What to be aware of

- **TypeBox breaking change (extension authors)** — 0.83.0 removed deprecated TypeBox aliases (`Type.Base`, `Type.Awaited`, `Type.Promise`, `Type.AsyncIterator`, `Type.Iterator`, `Type.Options`, `Value.Mutate`). pi-kot's own code uses none of them, but any **custom extension** using the removed APIs must migrate.
- **Behavioral change** — unknown terminal stop reasons now produce an error message instead of a silent success. If you see an error bubble where a reply used to appear, it's this change surfacing a real provider issue (usually a bad/expired key).
- **Set-model flow** — now goes through `refresh()`; if you added an API key after session creation, verify the key is picked up before setting a model (the migration path we tested).
- **Network** — `refresh()` defaults to no network catalog refresh (`modelNetworkEnabled` false), so no new outbound calls are introduced by the migration.

#### ✅ Test checklist (post-upgrade)

1. **Normal message** — streaming text renders, no console errors.
2. **Tool-call turn** — ask for a bash command / file write; tool card + result pair correctly.
3. **Set model** — Settings → pick a model → send a message (exercises the `refresh()` migration).
4. **API key added after session start** — add a key via Settings, set model, message works without server restart.
5. **Bad API key** — message shows the provider error, does not hang.
6. **Resume + fork a session** — no dangling tool calls, branch summary still works (patched `branch-summarization.js` intact).
7. **Thinking/reasoning model** (if configured) — thinking blocks render.

---

### Verified

- `npm install` clean; all `@earendil-works/*` deduped to 0.83.0 (no nested copies).
- Server `tsgo` build ✅ · Client Vite build ✅ · Client tests **36/36** ✅
- `patch-branch-summary.mjs` applies cleanly to 0.83.0 dist.
- SDK entrypoint loads under ESM (`createAgentSession`, `ModelRuntime`, …).
