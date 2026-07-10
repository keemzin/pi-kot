# Product

## Register

product

## Users

Developers and software engineers using pi, the coding agent, for AI-assisted coding tasks. They're in deep focus sessions — often late at night, on large monitors or laptops — switching between chatting with the agent, reading files, running terminal commands, reviewing diffs, and managing multiple sessions across projects. The UI is a secondary concern; their primary attention is on the code and the agent's output.

## Product Purpose

pi-kot is an HTTP bridge and browser UI wrapper for the pi coding agent SDK. It exposes the agent's capabilities via REST, SSE, and WebSocket, providing a full-featured browser-based interface for running AI coding sessions. Think of it as the web frontend to a coding agent — chat, terminal, file explorer, tool call visualization, session management, and extension integration in one surface.

Success looks like: a developer opens pi-kot and immediately gets into flow. The interface doesn't demand attention; it presents agent output clearly, manages tool execution transparently, and stays out of the way.

## Brand Personality

Sleek, modern, confident. Vercel-meets-terminal — polished UI surfaces with an unapologetic dark-first ethos. Professional but not corporate. Crafted but not precious.

Three words: **sharp, transparent, essential.**

## Anti-references

No strong anti-references. pi-kot should avoid the feeling of a generic AI chat wrapper (blank white page, basic bubbles, no tooling context), but doesn't need to aggressively differentiate. The reference quality bar: Vercel, Linear, Stripe, Warp — interfaces that feel considered at every pixel.

## Design Principles

1. **Disappear into the task.** Developers aren't here to admire the UI. The interface earns its keep by presenting agent output clearly and getting out of the way. Every decorative element must justify itself.

2. **Terminal and chat coexist naturally.** Two modes — the agent's conversational reasoning (chat) and its tool execution (bash/file ops) — share the same surface. Tool call timelines, thinking blocks, and bash output should feel native alongside prose, not tacked on.

3. **Information density without clutter.** Sessions produce rich output: tool calls with arguments and results, file diffs, terminal streams, thinking traces, model usage. Surface the essence, collapse the detail. Smart disclosure everywhere.

4. **Dark-native with terminal roots.** Dark mode is not a theme; it's the origin. The UI treats dark as the native state. The terminal panel earns its own visual language (pure dark, monospace-adjacent, utilitarian) while the rest of the surface uses frosted glass and subtle borders. Light themes are respectful companions, not afterthoughts.

5. **Practice what you preach.** The UI for a coding agent should itself feel well-crafted. Consistent spacing, considered typography, purposeful motion. If the agent writes clean code, the UI should embody the same standard.

## Accessibility & Inclusion

- WCAG AA contrast as a target for all theme tokens
- Reduced motion support — no essential information conveyed through animation
- Keyboard navigable through all interactive surfaces
- Terminal and code output respects user font preferences where possible
- Theme system accommodates both dark-preferring and light-preferring users
