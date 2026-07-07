/**
 * SlidePanel — reusable overlay/modal shell for pi-kot panels.
 *
 * Three rendering modes determined by the props:
 *   1. **Simple** — pass `title` and `children`. Renders default header
 *      (title + close button) in the `.settings-header` layout.
 *   2. **Custom header** — pass `header` instead of `title`. The entire
 *      header area is replaced (you own the close button).
 *   3. **Right panel** — pass `side="right"`. Slides in from the right
 *      edge (for FileExplorer‑style layouts).
 *
 * Responsive: on ≤600px the overlay switches to a bottom‑sheet
 * presentation (`.settings-overlay` → `align-items: flex-end`,
 * `.settings-panel` → `sheetUp` animation). This is handled purely
 * in CSS so no JS breakpoint logic is needed.
 *
 * Includes Escape‑key dismiss and click‑outside‑to‑close.
 */

import { useEffect, useCallback, type ReactNode, type CSSProperties } from "react";

export type SlidePanelSide = "center" | "right";

interface SlidePanelProps {
  /** Whether the panel is visible */
  open: boolean;
  /** Called when the user closes (Escape / backdrop click / close button) */
  onClose: () => void;

  /** Simple header: string title with a default close button.
   *  Ignored when `header` is also provided. */
  title?: string;

  /** Full custom header JSX. When set, `title` is ignored and
   *  you must render your own close button (or wire one to `onClose`). */
  header?: ReactNode;

  /** Panel body content */
  children: ReactNode;

  /** Side from which the panel enters: "center" (modal, default)
   *  or "right" (slide‑in panel, e.g. FileExplorer). */
  side?: SlidePanelSide;

  /** Desktop width override (e.g. 640, "520px") */
  width?: number | string;
  /** Desktop max‑width override */
  maxWidth?: number | string;

  /** Extra class name forwarded to the `.settings-panel` element */
  className?: string;
  /** Extra inline styles forwarded to the `.settings-panel` element */
  style?: CSSProperties;
}

export function SlidePanel({
  open,
  onClose,
  title,
  header,
  children,
  side = "center",
  width,
  maxWidth,
  className = "",
  style,
}: SlidePanelProps) {
  // Escape‑key dismiss
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  // ── Right side panel (e.g. FileExplorer) ──
  if (side === "right") {
    return (
      <div className="slide-panel-overlay" onClick={onClose} role="dialog" aria-modal="true">
        <div
          className={`slide-panel slide-panel--right ${className}`}
          style={{
            width: typeof width === "number" ? `${width}px` : width,
            maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
            ...style,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }

  // ── Center modal (default) ──
  return (
    <div className="settings-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        className={`settings-panel ${className}`}
        style={{
          width: typeof width === "number" ? `${width}px` : width,
          maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
          ...style,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        {header !== undefined ? (
          header
        ) : (
          <header className="settings-header">
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {title}
            </span>
            <button type="button" className="settings-close" onClick={onClose}>
              ✕
            </button>
          </header>
        )}

        {/* ── Body ── */}
        <div className="settings-body">{children}</div>
      </div>
    </div>
  );
}
