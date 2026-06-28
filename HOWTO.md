# pi-kot HOWTO

A practical guide to using pi-kot day-to-day.

---

## Table of Contents

1. [Building & Running](#1-building--running)
2. [Authentication](#2-authentication)
3. [Chat Basics](#3-chat-basics)
4. [Using the Terminal](#4-using-the-terminal)
5. [Touch Gestures (Mobile)](#5-touch-gestures-mobile)
6. [File Explorer](#6-file-explorer)
7. [MCP Servers](#7-mcp-servers)
8. [Orchestration](#8-orchestration)
9. [Git Panel](#9-git-panel)
10. [Settings](#10-settings)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Building & Running

### First time

```bash
cd pi-kot
npm install
```

### Development (hot-reload)

```bash
npm run dev
```

This starts two processes:
- **Server** on port **3332** (API, WebSocket, SSE)
- **Vite dev server** on port **5173** (frontend with hot reload)

Open **http://localhost:5173** in your browser.

### Production

```bash
npm run build
npm run start
```

Serves everything on **http://localhost:3333**.

### Via npx

```bash
npx pi-kot                # defaults
npx pi-kot --port 4000    # custom port
npx pi-kot --help         # all flags
```

---

## 2. Authentication

By default, pi-kot runs **without authentication**. To enable it:

```bash
UI_PASSWORD=yourpassword npm run dev
```

Or via CLI:

```bash
npx pi-kot --password yourpassword
```

You can also set an API key for automation:

```bash
API_KEY=sk-abc123 npm run start
curl -H "Authorization: Bearer sk-abc123" http://localhost:3333/api/v1/projects
```

---

## 3. Chat Basics

pi-kot gives you a conversational interface to the pi coding agent.

- **Send a message**: Type in the chat input and press Enter
- **Code blocks**: Agent responses include syntax-highlighted code with copy buttons
- **Diffs**: File edits show as inline diffs
- **Streaming**: Responses appear token-by-token as they're generated
- **Session history**: Previous sessions appear in the sidebar — click to revisit
- **Model switching**: Change the model mid-session via the dropdown in the header
- **Ask User Question**: When the agent needs your input, a panel appears above the chat input

### Key UI areas

| Area | What it does |
|---|---|
| **Sidebar** (left) | Session list, project explorer, file tree |
| **Header** (top) | Model selector, project name, settings, sign out |
| **Chat area** (center) | Main agent conversation |
| **Chat input** (bottom) | Type messages, attach images, drag-drop files |
| **Bottom panel** (togglable) | Terminal, Git panel, MCP settings |

---

## 4. Using the Terminal

The terminal is a full xterm.js instance connected to a persistent PTY on the server.

### Opening the terminal

Click the **`>_`** button in the toolbar or the bottom panel toggle. The terminal panel slides up from the bottom.

### Tab management

- **New tab**: Click **`+ New`** in the tab bar
- **Switch tabs**: Click a tab label
- **Close tab**: Click the **✕** on a tab

Each tab has its own persistent PTY session. Tabs survive panel close/reopen and even page reload (via sessionStorage).

### Keyboard shortcuts (desktop)

The terminal supports standard terminal keyboard input. The mobile quick-keys bar at the bottom provides:

| Key | What it sends |
|---|---|
| **CTRL** | Toggle: next letter gets the CTRL modifier (e.g. type `c` → `^C`) |
| **^C** | SIGINT / cancel |
| **ESC** | Escape |
| **TAB** | Tab / autocomplete |
| **↑ ↓ ← →** | Arrow keys |

### Mobile usage

On mobile, the terminal goes fullscreen and shows a quick-keys bar above the keyboard. Use the **touch gestures** below for efficient navigation.

---

## 5. Touch Gestures (Mobile)

pi-kot's terminal gestures are inspired by **Termius** — designed to make terminal work on a phone feel natural.

| Gesture | Action | How to use |
|---|---|---|
| **👆 Long-press + drag** | Arrow keys | Press and hold your finger still for ~150ms, then drag. The arrow direction follows your drag. Drag further from the starting point to increase speed (3 gears). Lift to stop. |
| **👆👆 Double-tap** | Tab (autocomplete) | Two quick taps anywhere on the terminal. Great for autocomplete, indentation, or switching contexts. |
| **✋✋✋ 3-finger tap** | Paste | Tap with three fingers simultaneously to paste from your clipboard into the terminal. |
| **🤏 2-finger scroll** | Scroll buffer | Use two fingers to scroll up/down through terminal history output. |

> **Tip:** The long-press + drag gesture works like the iOS cursor movement gesture — hold still first, then drag. Don't swipe; *press, wait, then drag*.

### Speed gears

When using the long-press + drag for arrows, the speed increases as you drag further:

| Distance from start | Gear | Interval | Use case |
|---|---|---|---|
| 0–100px | 1 — Normal | 150ms | Line-by-line navigation |
| 100–200px | 2 — Fast | 80ms | Moving through history |
| 200px+ | 3 — Turbo | 40ms | Scrolling large outputs |

The gear shifts in real-time as you move your finger.

---

## 6. File Explorer

Browse and manage files in your project workspace.

- **Open**: Click a file to read it
- **Edit**: Modify content directly in the editor (CodeMirror)
- **New file/folder**: Right-click in the tree
- **Delete**: Right-click a file

The file explorer also shows files the agent has created or modified during the session.

---

## 7. MCP Servers

pi-kot supports Model Context Protocol (MCP) servers — tools, resources, and prompts exposed by external services.

### Adding a server

1. Open **Settings** → **MCP** tab
2. Click **Add Server**
3. Choose **Stdio** (local command) or **HTTP** (remote URL)
4. Configure and save

### Managing tools

Each MCP server exposes tools that the agent can use. You can enable/disable individual tools per project from the MCP settings panel.

---

## 8. Orchestration

pi-kot supports multi-agent workflows — a supervisor session can spawn worker sub-agents to handle tasks in parallel.

### Enabling orchestration

Click the **⚡** (Orchestration) toggle in the toolbar.

### Managing workers

- Workers appear nested under their supervisor in the sidebar
- Expanding workers show their own message stream
- Workers can be interrupted, killed, or detached individually

---

## 9. Git Panel

The Git panel shows the current repository's status — modified files, staged changes, commit history, and branch information.

- **View changes**: See diffs of modified files
- **Stage/unstage**: Stage files for commit
- **Commit**: Write and execute commits
- **Branch**: Switch branches

---

## 10. Settings

Access settings via the **⚙** icon in the header.

| Section | What you can configure |
|---|---|
| **General** | Theme (light/dark), font size, model defaults |
| **MCP** | MCP server registry, tool enable/disable |
| **Extensions** | Install/manage pi extensions |
| **Skills** | Enable/disable agent skills |
| **Auth** | Password change, API key management |
| **About** | Version, credits, links |

---

## 11. Troubleshooting

### "Connection lost" in terminal

The terminal reconnects automatically with exponential backoff. If it doesn't reconnect:

1. Check that the server is still running
2. Refresh the page — tabs are restored from sessionStorage
3. If the server restarted, PTY sessions are lost — close and reopen tabs

### Login form keeps showing

Your token expired or the server password changed. Sign out and log in again.

### Terminal feels laggy on mobile

- Tap responsiveness: the terminal uses native touch events with minimal delay
- Network latency: arrow keys and input travel over WebSocket to the server — if the server is far away, you'll feel it. Try a local server for snappier response.
- Try the **CTRL toggle** (quick-keys bar) instead of long-press for Ctrl+letter combinations

### Touch gestures not working

- Make sure you're touching the terminal area, not the tab bar or quick-keys bar
- For long-press + drag: **hold still for 150ms first**, then drag — don't swipe immediately
- If text gets selected, the browser's default behavior is interfering — try tapping once to focus the terminal first

### Keyboard not appearing on mobile

Tap anywhere on the terminal area to focus it. The quick-keys bar should appear, and the system keyboard should open.

---

> **Love & curiosity** — pi-kot is built for the joy of making tools that feel good to use. If something doesn't work, it's probably just waiting for a fix. Pull requests welcome.
