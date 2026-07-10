import { useEffect, useRef, useState } from "react";
import { useLayoutStore, type ArtifactItem } from "../stores/layout-store";
import { displayInSandbox } from "../lib/sandbox";

const ARTIFACT_MIN_WIDTH = 280;
const ARTIFACT_MAX_WIDTH = 900;

function ArtifactPreview({ item }: { item: ArtifactItem }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Wrap SVG in a full HTML doc so it renders properly
    const html =
      item.type === "svg"
        ? `<!DOCTYPE html><html><head><meta charset="utf-8">
           <style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style>
           </head><body>${item.content}</body></html>`
        : item.content;

    const cleanup = displayInSandbox(el, html);
    return cleanup;
  }, [item]);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
    />
  );
}

export function ArtifactsPanel() {
  const artifactItems    = useLayoutStore((s) => s.artifactItems);
  const artifactActiveId = useLayoutStore((s) => s.artifactActiveId);
  const setArtifactActiveId = useLayoutStore((s) => s.setArtifactActiveId);

  const activeItem = artifactItems.find((a) => a.id === artifactActiveId) ?? artifactItems[artifactItems.length - 1];

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        background: "var(--bg-primary)",
      }}
    >
      {/* Panel content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-glass-strong)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
            🎨 Artifacts
          </span>
          <span
            style={{ fontSize: 11, color: "var(--text-tertiary)", background: "var(--bg-glass)", padding: "1px 6px", borderRadius: 10 }}
          >
            {artifactItems.length}
          </span>
        </div>

        {/* Tab bar — one tab per artifact */}
        {artifactItems.length > 1 && (
          <div
            style={{
              display: "flex",
              overflowX: "auto",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-glass)",
              flexShrink: 0,
            }}
          >
            {artifactItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setArtifactActiveId(item.id)}
                style={{
                  flexShrink: 0,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: item.id === activeItem?.id ? 600 : 400,
                  color: item.id === activeItem?.id ? "var(--accent-text)" : "var(--text-secondary)",
                  background: item.id === activeItem?.id ? "var(--bg-glass-strong)" : "transparent",
                  border: "none",
                  borderBottom: item.id === activeItem?.id ? "2px solid var(--accent-bg)" : "2px solid transparent",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  maxWidth: 140,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={item.title}
              >
                {item.type === "svg" ? "◇" : "◈"} {item.title}
              </button>
            ))}
          </div>
        )}

        {/* Active artifact title (single artifact) */}
        {artifactItems.length === 1 && activeItem && (
          <div
            style={{
              padding: "4px 10px",
              fontSize: 11,
              color: "var(--text-secondary)",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg-glass)",
              flexShrink: 0,
            }}
          >
            {activeItem.type === "svg" ? "◇ SVG" : "◈ HTML"} · {activeItem.title}
          </div>
        )}

        {/* Preview area */}
        {activeItem ? (
          <ArtifactPreview key={activeItem.id} item={activeItem} />
        ) : (
          <div
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--text-tertiary)", fontSize: 13,
            }}
          >
            No artifact selected
          </div>
        )}
      </div>
    </div>
  );
}
