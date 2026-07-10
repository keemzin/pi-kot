---
name: pi-kot
description: Browser UI wrapper for the pi coding agent SDK — chat, terminal, tools
colors:
  bg-solid: "#212121"
  bg-frosted: "rgba(33,33,33,0.85)"
  text-primary: "rgba(255,255,255,0.88)"
  text-secondary: "rgba(255,255,255,0.60)"
  accent: "#a0a0a0"
  accent-text: "#c0c0c0"
  border: "rgba(255,255,255,0.06)"
  input-bg: "rgba(255,255,255,0.04)"
  success: "#34d399"
  error: "#f87171"
  warning: "#fbbf24"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "16px"
  pill: "100px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-default:
    backgroundColor: "var(--bg-glass)"
    textColor: "var(--text-primary)"
    rounded: "var(--radius-sm)"
    padding: "6px 12px"
  button-primary:
    backgroundColor: "var(--accent)"
    textColor: "var(--text-primary)"
    rounded: "var(--radius-sm)"
    padding: "8px 16px"
  input-text:
    backgroundColor: "var(--input-bg)"
    textColor: "var(--text-primary)"
    rounded: "var(--radius-sm)"
    padding: "8px 12px"
  card-default:
    backgroundColor: "var(--bg-glass)"
    textColor: "var(--text-primary)"
    rounded: "var(--radius-md)"
  user-bubble:
    backgroundColor: "var(--user-bubble)"
    textColor: "var(--user-bubble-text)"
    rounded: "var(--radius-md)"
  assistant-bubble:
    backgroundColor: "transparent"
    textColor: "var(--text-primary)"
    rounded: "0"
---

# Design System: pi-kot

## 1. Overview

**Creative North Star: "The Terminal Atelier"**

pi-kot's interface lives at the intersection of a finely tuned code editor and a modern chat surface. It's a workspace where a developer and an AI agent collaborate — not a generic chatbot wrapper. The aesthetic is dark-native with a glassy crispness: deep solid backgrounds, frosted floating panels, and an accent palette that signals state without demanding attention.

The design rejects density-for-its-own-sake. Information is surfaced through smart disclosure (collapsible tool calls, expandable output, compacted history) rather than crammed into view. Every panel — chat, terminal, file tree, settings — earns its place through utility, not decoration.

Three visual dialects coexist: the **chat surface** (clean prose, markdown-rendered, streaming-aware), the **tool execution timeline** (collapsible cards with monospace detail panes), and the **terminal panel** (pure dark utility, xterm-native, no glass). Each feels native to its mode while sharing a consistent token system.

**Key Characteristics:**
- Dark-native with frosted-glass floating surfaces
- Glassy but not decorative — every blur has a purpose
- Smart disclosure as a design principle, not an implementation detail
- Three visual dialects (chat / tools / terminal) under one token system
- Subdued accent palette — grays and muted tones, not saturated primaries

## 2. Colors

The palette is restrained by default: tinted neutrals with a single accent ≤10% of any surface. Each theme translates this philosophy into its own hue family.

### Primary
- **Accent Gray** (#a0a0a0 / var(--accent)): Used for interactive indicators — focus rings, active tab underlines, input focus borders, toggle handles. Never used as a background fill at large scale. Its rarity is the point.
- **Accent Text** (#c0c0c0 / var(--accent-text)): Secondary interactive color for hover states, links within assistant messages, and subtle CTA text.

### Neutral
- **Surface Solid** (#212121 / var(--bg-solid)): The primary content background. Dark, warm-neutral, never pure black.
- **Surface Frosted** (rgba(33,33,33,0.85) / var(--bg-frosted)): Floating panels, overlays. Backdrop-filter blur creates depth without shadow.
- **Text Primary** (rgba(255,255,255,0.88) / var(--text-primary)): Primary body and heading text.
- **Text Secondary** (rgba(255,255,255,0.60) / var(--text-secondary)): Metadata, labels, secondary content.
- **Text Dim** (rgba(255,255,255,0.40) / var(--text-dim)): Placeholder text, disabled states, non-essential info.
- **Border** (rgba(255,255,255,0.06) / var(--border)): Default unemphasized border for panels, inputs, dividers.

### Semantic
- **Success** (#34d399): Positive exit codes, completion states.
- **Error** (#f87171): Failed tool calls, error banners, negative exit codes.
- **Warning** (#fbbf24): Warnings, truncated output indicators, attention signals.

### Per-Theme Color Strategy

Each accent theme restates the same variable set with its own hue family:

| Theme | Base | Character | Solid | Accent |
|---|---|---|---|---|
| Dusk (night) | dark | Clean neutral | #212121 | #a0a0a0 |
| Midnight | dark | OLED black tint | #000000 | #6a7a88 |
| Dawn | dark | Warm blue | #1a1d26 | #7a8ab0 |
| Monokai | dark | Syntax-highlight inspired | #272822 | #ae81ff |
| Dracula | dark | Purple-cast dark | #282a36 | #bd93f9 |
| Nord | dark | Arctic frost | #2e3440 | #88c0d0 |
| Bourbon | dark | Warm amber | #1a1410 | #d4a054 |
| Flexoki Dark | dark | Ink-on-paper dark | #171515 | #da702c |
| Clean | light | Pure white minimal | #ffffff | #0580c4 |
| Terracotta | light | Warm clay | #f4f1ec | #b06a48 |
| Sage | light | Soft green | #f0f2ec | #6a7d5a |
| Flexoki Light | light | Paper-toned | #fffdf4 | #bc5215 |

### Named Rules

**The Restraint Rule.** The accent color occupies ≤10% of any given surface. Its rarity makes it meaningful. Accent is for edges, focus rings, and interactive indicators — never for large background fills or decorative gradients.

**The Glass-Over-Solid Rule.** Floating panels use `var(--bg-frosted)` with backdrop-filter blur, never opaque overlays. The solid background (`var(--bg-solid)`) is always visible underneath, maintaining spatial hierarchy.

## 3. Typography

**Display/Body Font:** Inter (with -apple-system, BlinkMacSystemFont, Segoe UI, system-ui fallback)
**Mono Font:** JetBrains Mono (with Fira Code, Cascadia Code, Consolas fallback)

**Character:** A single sans family tuned for long-form reading and compact UI. Inter at 14px body provides comfortable readability across monitors. Mono is reserved for code blocks, tool call details, terminal output, and any data where alignment matters.

### Hierarchy
- **Body** (400, 14px, 1.6): Primary message content, settings panels, descriptions. Line length capped at 65–75ch for prose blocks.
- **Label** (500, 12px, 1.4): Tab labels, button text, input labels, metadata badges, section headers.
- **Medium** (500, 14px, 1.5): Secondary headings, emphasized in-line text, active nav items.
- **Mono** (400, 13px, 1.5): Code blocks, tool call arguments, terminal output, file paths, diffs.
- **Heading 1** (700, 18px, 1.3): Welcome screen titles, section headings.
- **Heading 2** (600, 16px, 1.3): Panel headers, conversation turn labels.
- **Heading 3** (600, 14px, 1.4): Card titles, feature labels.

### Named Rules

**The Only-Sans Rule.** No display font pairing. Inter at varying weights and sizes carries the full hierarchy. One family is right for a product UI; a second display face adds noise, not signal.

**The Mono-Confined Rule.** Monospace is bounded to code-shaped content: tool call IO, terminal streams, diff views, file paths, and inline code spans. Prose and labels never use the mono stack.

## 4. Elevation

pi-kot uses tonal layering and backdrop blur rather than box shadows for depth. The design is functionally flat — depth is conveyed through color perception (solid → frosted → glass), not through drop shadows or z-height.

Three layers:
1. **Solid** (`var(--bg-solid)`): The base canvas. Chat surface, file viewer, settings.
2. **Frosted** (`var(--bg-frosted)` + `backdrop-filter: blur(24px)`): Floating panels — sidebar, settings drawer, modal overlays, slide panels. The blur provides spatial separation without shadows.
3. **Glass** (`var(--bg-glass)` / `var(--bg-glass-hover)` / `var(--bg-glass-active)`): Interactive surfaces on top of frosted or solid backgrounds — buttons, input fields, dropdowns, tool call cards.

No box shadows exist in the token system. If a surface needs to lift above another, it uses frosted blur + a brighter border, never a shadow.

### Named Rules

**The Zero-Shadow Rule.** No drop shadows on any surface. Depth comes from blur, transparency layering, and border contrast. A shadow implies weight; pi-kot's surfaces feel weightless.

## 5. Components

### Buttons
- **Shape:** Gently curved (6px / var(--radius-sm))
- **Default / Ghost:** `var(--bg-glass)` background, `var(--text-primary)` text. Hover → `var(--bg-glass-hover)`. Active → `var(--bg-glass-active)`.
- **Primary:** `var(--accent)` background on hover/keyboard focus only. At rest, primary actions are visually default — only the first/tab position signals them.
- **Icon buttons:** Same token system, 28–32px squared. Used for close, copy, expand, and other atomic actions.
- **State coverage:** default, hover, focus-visible, active, disabled (opacity 0.35), loading (inline spinner via text replacement).

### Inputs & Fields
- **Style:** `var(--input-bg)` background, `var(--input-border)` 1px stroke, `var(--radius-sm)`.
- **Focus:** Border swaps to `var(--input-focus-border)` (→ `var(--accent)`). No glow, no ring — just a color shift.
- **Placeholder:** `var(--text-dim)`.
- **Disabled:** `opacity: 0.45`, no pointer events.
- **Error:** Red border tint (`var(--error)` at 50% opacity).

### Cards / Containers
- **Corner Style:** 10px (`var(--radius-md)`) for most cards; 6px (`var(--radius-sm)`) for tight inline containers.
- **Background:** `var(--bg-glass)` for chat tool-call cards, settings sections, and floating info panels.
- **Border:** `var(--border)` at rest. `var(--border-hover)` on interactive card hover.
- **No Shadow.** See The Zero-Shadow Rule.
- **Internal Padding:** 12–16px depending on density need.

### Chat Messages
- **User Bubble:** `var(--user-bubble)` background, `var(--user-bubble-border)` stroke at 1px, `var(--radius-md)` corners. Optional image attachments shown as thumbnail row above text.
- **Assistant Prose:** No background — transparent on the solid canvas. Text is `var(--text-primary)`. Markdown-rendered with Inter body scale.
- **Tool Call Timeline:** Collapsible `<details>` element. Header shows icon + tool name + arg preview + status indicator. Expanded detail panes use mono font at 13px. Background `var(--tool-bg)` with `var(--tool-border)`.
- **Thinking Block:** Collapsible accordion previewing "Thinking…" with `var(--thinking-accent)` color. Content in mono italic.
- **Streaming State:** Pulsing cursor character (`▊`) at end of stream text. Active tool badge shown when agent is executing a tool mid-stream.

### Navigation (Sidebar)
- **Style:** `var(--sidebar-bg)` at 0.95 opacity with `backdrop-filter: blur(var(--blur))`. Fixed width `var(--sidebar-width): 260px`.
- **Project Items:** `var(--radius-sm)` on hover/active highlight. Active state uses `var(--bg-glass-active)`.
- **Session Items:** Nested under projects. `var(--text-secondary)` at rest, `var(--text-primary)` on active. Favorite toggle via star icon, archive via hide.
- **Collapsed mode:** Icon-only at 48px. Hover expands the sidebar.

### Settings Panel
- **Layout:** Slide-over from the right, full-height, `380px` wide at desktop, full-width on mobile (<600px).
- **Tabs:** Horizontal tab bar at top. Active tab: `var(--accent-text)` underline + color. Inactive: `var(--text-secondary)`.
- **Sections:** Grouped by function (General, Appearance, Providers, Agent, Extensions) each as a `<div>` with `var(--bg-glass)` card treatment.

### Terminal Panel
- **Dialect:** Pure dark utility. No glass, no border complexity. `var(--bg-solid)` with xterm canvas filling available height.
- **Resize:** Draggable handle at top edge. Toggle visibility via keyboard shortcut or toolbar button.

### Modals & Dialogs
- **Overlay:** `var(--bg-frosted)` at 0.6 opacity with `backdrop-filter: blur(var(--blur))`.
- **Content:** `var(--bg-solid)` with `var(--radius-lg)` (16px) corners. Centered, max-width determined by content type.
- **Close:** Icon button in top-right corner.

## 6. Do's and Don'ts

### Do:
- **Do** use the glass-over-solid layering for panels and dialogs — the solid canvas must always be partially visible underneath.
- **Do** collapse tool call details by default. Smart disclosure keeps the chat surface readable.
- **Do** use mono for all code-shaped content: tool IO, terminal, diffs, file paths.
- **Do** tint every neutral toward the theme's brand hue. Even a barely-perceptible chroma (0.005–0.01) prevents gray from feeling dead.
- **Do** match accent usage to purpose: ≤10% of any given surface, reserved for interactive edges and focus indicators.

### Don't:
- **Don't** use box shadows anywhere. Depth comes from blur and transparency, not shadows.
- **Don't** apply glass effects to the terminal panel. Terminal earns a distinct visual dialect — pure solid, no blur, no frills.
- **Don't** use gradient text (`background-clip: text`) or decorative glassmorphism. Accent is a single solid color.
- **Don't** use border-left or border-right greater than 1px as a colored accent stripe. Use full borders, background tints, or nothing.
- **Don't** reuse the same card pattern across different contexts. Chat bubbles, tool calls, and settings cards each have distinct shapes and token assignments.
- **Don't** use display fonts or decorative type anywhere in the UI. The full hierarchy is covered by Inter weight/size steps.
- **Don't** make the accent the primary action background at rest. Accent appears on hover/focus only for interactive elements; at rest, actions are ghost/default.
