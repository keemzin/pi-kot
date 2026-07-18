import { useEffect, useState, useRef } from "react";
import { formatFileSize, getFileExt } from "../lib/file-types";

interface Props {
	/** The raw file content (data URL or relative path) from filesRead */
	content: string;
	/** File path for display */
	filePath: string;
	/** Whether the file is binary */
	binary: boolean;
}

/**
 * ImageViewer — renders image files with a checkerboard transparency background,
 * natural size info, and file metadata. Ported from pi-web's ImageViewer.
 */
export function ImageViewer({ content, filePath, binary }: Props) {
	const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const imgRef = useRef<HTMLImageElement>(null);

	const ext = getFileExt(filePath) || "image";
	const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;

	// Reset state when content changes
	useEffect(() => {
		setNaturalSize(null);
		setError(null);
	}, [content]);

	// Build the image src — if binary, the content is a base64 data URL from the server
	const src = binary ? `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${content}` : content;

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
			{/* Info bar */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 12,
					padding: "4px 12px",
					borderBottom: "1px solid var(--border)",
					fontSize: 11,
					color: "var(--text-dim)",
					background: "var(--bg-glass)",
					flexShrink: 0,
				}}
			>
				<span
					style={{ fontFamily: "var(--font-mono, monospace)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
					title={filePath}
				>
					{fileName}
				</span>
				<span style={{ marginLeft: "auto" }}>{ext}</span>
				{naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
			</div>

			{/* Image area with checkerboard background */}
			<div
				style={{
					flex: 1,
					overflow: "auto",
					background: "var(--bg-panel, var(--bg))",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: 16,
					// Classic checkerboard transparency pattern
					backgroundImage:
						"linear-gradient(45deg, var(--bg) 25%, transparent 25%), " +
						"linear-gradient(-45deg, var(--bg) 25%, transparent 25%), " +
						"linear-gradient(45deg, transparent 75%, var(--bg) 75%), " +
						"linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
					backgroundSize: "16px 16px",
					backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
				}}
			>
				{error ? (
					<div style={{ color: "var(--error, #f87171)", fontSize: 13 }}>{error}</div>
				) : (
					<img
						ref={imgRef}
						src={src}
						alt={fileName}
						onLoad={(e) => {
							const img = e.currentTarget;
							setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
						}}
						onError={() => setError("Failed to load image")}
						style={{
							maxWidth: "100%",
							maxHeight: "100%",
							objectFit: "contain",
							boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
							borderRadius: 2,
						}}
					/>
				)}
			</div>
		</div>
	);
}
