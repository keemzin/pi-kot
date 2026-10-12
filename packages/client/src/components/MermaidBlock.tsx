import { useEffect, useState } from "react";
import { Workflow, Eye, Code, Copy, Check, AlertCircle } from "lucide-react";
import { Highlight, themes as prismThemes } from "prism-react-renderer";

interface Props {
  code: string;
  defaultMode?: "diagram" | "code";
}

const LIGHT_RE = /^light|clean|terracotta|sage$/i;

function useIsLight(): boolean {
  const [isLight, setIsLight] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const theme = document.documentElement.getAttribute("data-theme");
      if (theme && LIGHT_RE.test(theme)) return true;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const theme = root.getAttribute("data-theme");
      setIsLight(!!(theme && LIGHT_RE.test(theme)));
    };
    read();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handler = () => read();
    mq?.addEventListener?.("change", handler);
    const obs = new MutationObserver(handler);
    root && obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener?.("change", handler);
      obs.disconnect();
    };
  }, []);

  return isLight;
}

interface CacheEntry {
  svg?: string;
  error?: string;
}

// In-memory cache keyed by `${theme}::${trimmedCode}`
// Ensures that once a diagram succeeds or fails, it is never repeatedly re-parsed or re-rendered in a loop.
const renderCache = new Map<string, CacheEntry>();

let mermaidPromise: Promise<typeof import("mermaid")["default"]> | null = null;
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "loose",
        suppressErrorRendering: true,
      });
      mermaid.parseError = () => {
        // Suppress global window error emission to prevent dev server / Vite error loops
      };
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MermaidBlock({ code, defaultMode = "diagram" }: Props) {
  const isLight = useIsLight();
  const trimmed = code.trim();
  const cacheKey = `${isLight ? "light" : "dark"}::${trimmed}`;
  const cached = renderCache.get(cacheKey);

  const [viewMode, setViewMode] = useState<"diagram" | "code">(defaultMode);
  const [svg, setSvg] = useState<string | null>(() => cached?.svg ?? null);
  const [error, setError] = useState<string | null>(() => cached?.error ?? null);
  const [loading, setLoading] = useState<boolean>(() => !cached && Boolean(trimmed) && defaultMode === "diagram");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Only parse and render when Diagram mode is active!
    // In Code mode (the default in chat), Mermaid is never called — zero overhead, zero stutter.
    if (typeof window === "undefined" || viewMode !== "diagram") return;

    if (!trimmed) {
      setLoading(false);
      setSvg(null);
      setError(null);
      return;
    }

    const currentCached = renderCache.get(cacheKey);
    if (currentCached) {
      if (currentCached.svg) {
        setSvg(currentCached.svg);
        setError(null);
      } else if (currentCached.error) {
        setError(currentCached.error);
        setSvg(null);
      }
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Debounce rendering slightly so multi-token or burst updates settle
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);

      const renderDiagram = async () => {
        let renderId: string | null = null;
        try {
          const mermaid = await getMermaid();
          if (cancelled) return;

          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "loose",
            suppressErrorRendering: true,
            theme: isLight ? "default" : "dark",
          });
          mermaid.parseError = () => {};

          renderId = `mmd_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
          const { svg: renderedSvg } = await mermaid.render(renderId, trimmed);

          if (!cancelled) {
            renderCache.set(cacheKey, { svg: renderedSvg });
            setSvg(renderedSvg);
            setError(null);
            setLoading(false);
          }
        } catch (err: unknown) {
          // Clean up temporary DOM elements mermaid leaves behind
          if (renderId) {
            try {
              const stray = document.querySelectorAll(`[id*="${renderId}"], [id^="dmmd_"]`);
              stray.forEach((el) => el.remove());
            } catch {}
          }

          if (!cancelled) {
            const rawMsg = err instanceof Error ? err.message : String(err);
            const cleanMsg = rawMsg.split("\n")[0] || "Invalid diagram syntax";
            renderCache.set(cacheKey, { error: cleanMsg });
            setError(cleanMsg);
            setSvg(null);
            setLoading(false);
          }
        }
      };

      void renderDiagram();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, isLight, cacheKey, viewMode]);

  const onCopy = () => {
    if (!code) return;
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const prismTheme = isLight ? prismThemes.vsLight : prismThemes.vsDark;

  const renderCodeBlock = (borderTop = false) => (
    <Highlight theme={prismTheme} code={code.trimEnd()} language="mermaid">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`code-block ${className}`}
          style={{
            ...style,
            margin: 0,
            padding: "10px 14px",
            fontSize: "12px",
            lineHeight: 1.6,
            overflowX: "auto",
            background: "var(--bg-glass-strong)",
            ...(borderTop ? { borderTop: "1px solid var(--border)" } : {}),
          }}
        >
          <code>
            {tokens.map((line, i) => {
              const { key: _lk, ...lineRest } = getLineProps({ line, key: i });
              return (
                <div key={i} {...lineRest}>
                  <span
                    style={{
                      display: "inline-block",
                      width: `${Math.max(2, String(tokens.length).length)}ch`,
                      textAlign: "right",
                      marginRight: "12px",
                      userSelect: "none",
                      opacity: 0.35,
                      fontSize: "11px",
                    }}
                  >
                    {i + 1}
                  </span>
                  {line.map((token, idx) => {
                    const { key: _tk, ...tokenRest } = getTokenProps({ token, key: idx });
                    return <span key={idx} {...tokenRest} />;
                  })}
                </div>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );

  return (
    <div className="mermaid-block-wrap">
      <div className="mermaid-block-header">
        <div className="mermaid-block-title">
          <Workflow size={13} style={{ color: "var(--accent-text)" }} />
          <span>Mermaid</span>
          {error && viewMode === "diagram" ? (
            <span className="mermaid-badge-error">Syntax Error</span>
          ) : loading && !svg && viewMode === "diagram" ? (
            <span className="mermaid-badge-loading">
              <span className="mermaid-spinner-sm" />
              Rendering…
            </span>
          ) : null}
        </div>

        <div className="mermaid-block-actions">
          <div className="mermaid-view-toggle">
            <button
              type="button"
              className={`mermaid-toggle-btn ${viewMode === "diagram" ? "active" : ""}`}
              onClick={() => setViewMode("diagram")}
              title="View visual diagram"
            >
              <Eye size={12} />
              <span>Diagram</span>
            </button>
            <button
              type="button"
              className={`mermaid-toggle-btn ${viewMode === "code" ? "active" : ""}`}
              onClick={() => setViewMode("code")}
              title="View source code"
            >
              <Code size={12} />
              <span>Code</span>
            </button>
          </div>

          <button
            type="button"
            className="mermaid-copy-btn"
            onClick={onCopy}
            title="Copy code"
            aria-label="Copy code"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>

      {viewMode === "diagram" ? (
        error ? (
          /* Graceful fallback: clean error bar + formatted source code without looping */
          <div className="mermaid-error-fallback">
            <div className="mermaid-error-bar">
              <AlertCircle size={13} style={{ flexShrink: 0, color: "var(--error, #ef4444)" }} />
              <span className="mermaid-error-text" title={error}>
                {error}
              </span>
            </div>
            {renderCodeBlock(true)}
          </div>
        ) : svg ? (
          <div className="mermaid-block-content">
            <div
              className="mermaid-svg-container"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        ) : (
          renderCodeBlock()
        )
      ) : (
        renderCodeBlock()
      )}
    </div>
  );
}
