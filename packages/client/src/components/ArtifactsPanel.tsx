/**
 * ArtifactList — shows artifact items as a clickable list in the explorer's Artifacts tab.
 * Clicking an artifact opens it in the ArtifactViewer (slides beside the chat).
 */
import { useLayoutStore } from "../stores/layout-store";

const ARTIFACT_ICONS: Record<string, string> = {
  html: "◈", svg: "◇", markdown: "📝", json: "{}", text: "¶", image: "🖼",
};

export function ArtifactsPanel() {
  const artifactItems       = useLayoutStore((s) => s.artifactItems);
  const artifactActiveId    = useLayoutStore((s) => s.artifactActiveId);
  const setArtifactActiveId = useLayoutStore((s) => s.setArtifactActiveId);
  const openArtifactViewer  = useLayoutStore((s) => s.openArtifactViewer);
  const setExplorerTab      = useLayoutStore((s) => s.setExplorerTab);
  const isMobile            = useLayoutStore((s) => s.isMobile);

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

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {artifactItems.length === 0 ? (
          <div
            style={{
              padding: "24px 16px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: 13,
            }}
          >
            No artifacts yet.
            <br />
            <span style={{ fontSize: 11 }}>
              Tool outputs and fenced code blocks will appear here.
            </span>
          </div>
        ) : (
          artifactItems.map((item) => {
            const isActive = item.id === artifactActiveId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setArtifactActiveId(item.id);
                  openArtifactViewer(item.id, item.title, item.type);
                  // On mobile, close the explorer overlay so the viewer is unobstructed
                  if (isMobile) setExplorerTab(undefined);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setArtifactActiveId(item.id);
                  openArtifactViewer(item.id, item.title, item.type);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  width: "100%",
                  padding: "6px 12px",
                  border: "none",
                  background: isActive ? "var(--accent-subtle)" : "transparent",
                  color: isActive ? "var(--accent-text)" : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 12,
                  textAlign: "left",
                  borderRadius: 0,
                  borderLeft: isActive ? "3px solid var(--accent-text)" : "3px solid transparent",
                  transition: "all 0.1s ease",
                }}
                title={item.title}
              >
                <span style={{ flexShrink: 0, fontSize: 14, lineHeight: 1 }}>
                  {ARTIFACT_ICONS[item.type] ?? "◈"}
                </span>
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.title}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--text-tertiary)",
                    flexShrink: 0,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  {item.type}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
