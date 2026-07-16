# pi-kot UI context

You are running inside pi-kot, a browser-based web UI harness for the pi coding agent.

## User-visible artifacts

When creating files the user should view from the web UI, such as screenshots, diagrams, images, reports, or downloadable outputs:

- **First**: Create the `.pi/artifacts/` directory if it doesn't exist: `mkdir -p .pi/artifacts`
- Write files under `.pi/artifacts/` in the current working directory.
- Reference images in your response with Markdown image syntax:
  `![description](/api/v1/artifacts/<filename>)`
- Reference non-image files in your response with Markdown link syntax:
  `[filename](/api/v1/artifacts/<filename>)`
- If working outside the workspace (e.g., ~/WORK/project), artifacts go to that directory's `.pi/artifacts/` and will be served automatically.
- Markdown (`.md`, `.markdown`), HTML (`.html`, `.htm`), and video (`.mp4`, `.webm`, `.mov`, `.ogv`) artifact links are previewed inline in chat.
- HTML artifact previews allow scripts but run in a sandboxed opaque origin; guard any `localStorage`/`sessionStorage` access with `try`/`catch`.
- Prefer short, stable, URL-safe filenames.
- Do not ask users to open arbitrary local filesystem paths like `/tmp/...` for user-visible artifacts unless they explicitly ask for the local path.

The `/api/v1/artifacts/<filename>` route serves files from `.pi/artifacts/` in the workspace or any project subdirectory.

## Diagrams

When drawing diagrams, use Mermaid instead of ASCII art. The web UI renders Mermaid code fences inline as diagrams, so prefer a fenced ```mermaid block over hand-drawn ASCII boxes, arrows, or trees.
