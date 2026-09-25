/**
 * Formats a raw model name or file path into a concise, human-friendly display name.
 * Handles:
 * - Windows / POSIX file paths (e.g. V:\LLM\...\model.gguf -> model)
 * - Deeply nested paths (takes the last segment)
 * - File extensions (.gguf, .bin, .safetensors, .pt, .onnx)
 */
export function formatModelDisplayName(name?: string): string {
  if (!name) return "";
  let trimmed = name.trim();
  if (!trimmed) return "";

  // Check if it looks like a filesystem path or contains path separators:
  // - Windows drive letter: C:\ or C:/
  // - Absolute unix path: /path/to/...
  // - Any backslashes: foo\bar
  // - Known model extensions: .gguf, .bin, .safetensors, etc.
  // - More than one slash: a/b/c
  const isFilePath =
    /^[a-zA-Z]:[/\\]/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    /\.(gguf|bin|safetensors|pt|onnx)$/i.test(trimmed) ||
    trimmed.split("/").length > 2;

  if (isFilePath) {
    const segments = trimmed.split(/[/\\]/).filter(Boolean);
    if (segments.length > 0) {
      trimmed = segments[segments.length - 1];
    }
  }

  // Strip file extension if present (.gguf, .bin, etc.)
  trimmed = trimmed.replace(/\.(gguf|bin|safetensors|pt|onnx)$/i, "");

  return trimmed;
}
