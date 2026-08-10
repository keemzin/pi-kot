/**
 * Extract the distinct files a turn actually wrote, straight from SDK
 * messages — never from reply text.
 *
 * A turn's assistant messages contain `toolCall` content blocks. A file
 * counts as "written by this turn" when:
 *   - the tool is `write` or `edit` (the SDK's file-writing tools), and
 *   - its paired `toolResult` arrived and did not error.
 *
 * The paired result lives in a separate `toolResult` message and is
 * resolved via a per-turn `getResult(toolCallId)` callback — ChatView
 * already builds that map for tool-call rendering.
 *
 * Paths are taken from the tool call arguments (`path`), deduped and
 * kept in first-seen order. Paths the agent merely *mentions* in prose
 * are never a source here; the tool call is the record of what happened.
 */

export type ToolResultLike = {
  isError?: unknown;
};

export type GetToolResult = (toolCallId: string | undefined) => ToolResultLike | undefined;

const FILE_WRITING_TOOLS = new Set(["write", "edit"]);

export function extractTurnFilePaths(
  assistants: readonly Record<string, unknown>[],
  getResult: GetToolResult,
): string[] {
  const seen = new Set<string>();
  const files: string[] = [];

  for (const m of assistants) {
    const content = m.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as Record<string, unknown> | undefined;
      if (b?.type !== "toolCall") continue;
      const name = b.name;
      if (typeof name !== "string" || !FILE_WRITING_TOOLS.has(name)) continue;

      const id = typeof b.id === "string" ? b.id : undefined;
      const result = id === undefined ? undefined : getResult(id);
      // No result (still streaming) or the call failed — nothing was written.
      if (result === undefined || result.isError === true) continue;

      const args = b.arguments as { path?: unknown } | undefined;
      const path = typeof args?.path === "string" ? args.path : undefined;
      if (path === undefined || path.length === 0) continue;

      if (!seen.has(path)) {
        seen.add(path);
        files.push(path);
      }
    }
  }
  return files;
}

/** Basename helper shared by chip rendering. */
export function fileBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}