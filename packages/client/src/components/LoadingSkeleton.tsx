import { useId, type CSSProperties } from "react";

interface Props {
  /** Skeleton variant */
  variant?: "text" | "card" | "list" | "tree" | "circle";
  /** Number of lines/items to show (for text/list variants) */
  count?: number;
  /** Width override (e.g. "60%", "200px") */
  width?: string;
  /** Height override (e.g. "40px") */
  height?: string;
  /** Additional inline styles */
  style?: CSSProperties;
}

/**
 * Animated loading skeleton placeholder.
 *
 * Variants:
 *   text   — multiple shimmer lines (default: 3 lines, last 60% width)
 *   card   — a full card block with title + description lines
 *   list   — row items with icon circle + text lines
 *   tree   — indented file tree lines
 *   circle — circular shimmer (avatar/icon placeholder)
 *
 * Usage:
 *   <LoadingSkeleton variant="list" count={5} />
 *   <LoadingSkeleton variant="card" count={2} />
 */
export function LoadingSkeleton({ variant = "text", count = 1, width, height, style }: Props) {
  const uid = useId();

  const shared: CSSProperties = {
    borderRadius: "4px",
    background: `linear-gradient(90deg,
      var(--text-ghost, rgba(255,255,255,0.10)) 25%,
      var(--text-dim, rgba(255,255,255,0.35)) 50%,
      var(--text-ghost, rgba(255,255,255,0.10)) 75%)`,
    backgroundSize: "200% 100%",
    animation: `${uid}-shimmer 1.4s ease-in-out infinite`,
    width,
    height,
  };

  const animationStyle = `
@keyframes ${uid}-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}`;

  if (variant === "circle") {
    return (
      <>
        <style>{animationStyle}</style>
        <div
          style={{
            ...shared,
            width: width ?? "32px",
            height: height ?? "32px",
            borderRadius: "50%",
            flexShrink: 0,
            ...style,
          }}
        />
      </>
    );
  }

  if (variant === "card") {
    return (
      <>
        <style>{animationStyle}</style>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}>
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              style={{
                padding: "14px",
                borderRadius: "8px",
                border: "1px solid var(--border, #444)",
                background: "var(--header-bg, rgba(55,55,60,0.75))",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ ...shared, height: "14px", width: "55%" }} />
              <div style={{ ...shared, height: "10px", width: "85%" }} />
              <div style={{ ...shared, height: "10px", width: "40%" }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (variant === "tree") {
    return (
      <>
        <style>{animationStyle}</style>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0", ...style }}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: `${(i % 3) * 16 + 8}px` }}>
              <div style={{ ...shared, width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0 }} />
              <div style={{ ...shared, height: "10px", width: `${50 + (i % 3) * 20}%` }} />
            </div>
          ))}
        </div>
      </>
    );
  }

  if (variant === "list") {
    return (
      <>
        <style>{animationStyle}</style>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
          {Array.from({ length: count }, (_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <div style={{ ...shared, width: "24px", height: "24px", borderRadius: "4px", flexShrink: 0 }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ ...shared, height: "10px", width: `${65 + (i % 3) * 15}%` }} />
                <div style={{ ...shared, height: "8px", width: `${40 + (i % 2) * 20}%` }} />
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

  // text variant (default)
  return (
    <>
      <style>{animationStyle}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, ...style }}>
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            style={{
              ...shared,
              height: "10px",
              width: i === count - 1 && count > 1 ? "60%" : "100%",
            }}
          />
        ))}
      </div>
    </>
  );
}
