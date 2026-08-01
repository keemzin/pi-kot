# Changelog

All notable changes to pi-kot, with focus on SDK upgrades and behavior that affects users.

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
