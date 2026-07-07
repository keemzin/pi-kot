import { useState, useRef, useEffect } from "react";
import { themes, type ThemeInfo } from "../lib/theme";
import { useSessionStore } from "../stores/session-store";

interface Props {
  currentTheme: string;
  onChange: (themeId: string) => void;
}

export function ThemePicker({ currentTheme, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = themes.find((t) => t.id === currentTheme) ?? themes[0];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={isStreaming}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          padding: "4px 8px",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          background: "var(--bg-glass)",
          color: "var(--text-secondary)",
          fontSize: "11px",
          fontFamily: "inherit",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s",
          opacity: isStreaming ? 0.5 : 1,
        }}
        onMouseEnter={(e) => {
          (e.target as HTMLElement).style.borderColor = "var(--border-hover)";
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLElement).style.borderColor = "var(--border)";
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: selected.colors[1],
            flexShrink: 0,
          }}
        />
        {selected.name}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          style={{
            transition: "transform 0.15s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <path
            d="M2 4L5 7L8 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 160,
            background: "var(--sidebar-bg)",
            border: "1px solid var(--border-hover)",
            borderRadius: "var(--radius-md)",
            padding: "4px",
            backdropFilter: "blur(24px) saturate(1.5)",
            zIndex: 1000,
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          }}
        >
          {themes.map((t: ThemeInfo) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onChange(t.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "6px 8px",
                borderRadius: "var(--radius-sm)",
                border: "none",
                background:
                  t.id === currentTheme ? "var(--accent-subtle)" : "transparent",
                color:
                  t.id === currentTheme
                    ? "var(--accent-text)"
                    : "var(--text-secondary)",
                fontSize: "12px",
                fontFamily: "inherit",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.1s",
              }}
              onMouseEnter={(e) => {
                if (t.id !== currentTheme) {
                  (e.target as HTMLElement).style.background =
                    "var(--bg-glass-hover)";
                }
              }}
              onMouseLeave={(e) => {
                if (t.id !== currentTheme) {
                  (e.target as HTMLElement).style.background = "transparent";
                }
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: t.colors[1],
                  flexShrink: 0,
                }}
              />
              <span style={{ flex: 1 }}>{t.name}</span>
              <span
                style={{
                  fontSize: "9px",
                  color: "var(--text-dim)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {t.base === "dark" ? "🌙" : "☀️"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
