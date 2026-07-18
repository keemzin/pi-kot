/**
 * File type detection utilities — ported from pi-web.
 * Determines how to render files in the viewer panel.
 */

export const IMAGE_EXTENSIONS = new Set([
	"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif",
]);

export const AUDIO_EXTENSIONS = new Set([
	"mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "webm",
]);

export const DOCUMENT_EXTENSIONS = new Set(["pdf", "docx"]);

function getExtension(filePath: string): string {
	return filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase().split(".").pop() ?? "";
}

export function isImagePath(filePath: string): boolean {
	return IMAGE_EXTENSIONS.has(getExtension(filePath));
}

export function isAudioPath(filePath: string): boolean {
	return AUDIO_EXTENSIONS.has(getExtension(filePath));
}

export function isDocumentPath(filePath: string): boolean {
	return DOCUMENT_EXTENSIONS.has(getExtension(filePath));
}

export function isHtmlPath(filePath: string): boolean {
	return getExtension(filePath) === "html" || getExtension(filePath) === "htm";
}

export function isMarkdownPath(filePath: string): boolean {
	const ext = getExtension(filePath);
	return ext === "md" || ext === "mdx";
}

/** Format bytes into human-readable size string. */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Get the file extension (lowercase, no dot). */
export function getFileExt(filePath: string): string {
	return getExtension(filePath);
}
