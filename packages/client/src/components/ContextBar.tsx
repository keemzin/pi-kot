import { useEffect, useRef, useState } from "react";
import { getSessionContext } from "../lib/api-client";
import type { SessionContextResponse } from "../lib/api-client/types";

interface Props {
  sessionId: string | undefined;
  onInspect?: (data: SessionContextResponse) => void;
}

export function ContextBar({ sessionId, onInspect }: Props) {
  const [data, setData] = useState<SessionContextResponse | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    if (sessionId === undefined) {
      setData(null);
      return;
    }

    const fetch = async () => {
      try {
        const res = await getSessionContext(sessionId);
        setData(res);
      } catch {
        setData(null);
      }
    };

    fetch();
    intervalRef.current = setInterval(fetch, 5000);

    return () => {
      clearInterval(intervalRef.current);
    };
  }, [sessionId]);

  const pct = data?.contextUsage?.percent ?? null;
  if (pct === null) return null;

  const rounded = Math.round(pct);

  return (
    <button
      type="button"
      className="ctx-bar-circle"
      onClick={() => data !== null && onInspect?.(data)}
      title={`Context: ${data!.contextUsage!.tokens?.toLocaleString() ?? "?"} / ${data!.contextUsage!.contextWindow.toLocaleString()} tokens`}
    >
      {rounded}
    </button>
  );
}

function formatCost(cost: number): string {
  if (cost < 0.001) return "$0.00";
  return `$${cost.toFixed(4)}`;
}

export function ContextInspectModal({ data, onClose }: { data: SessionContextResponse; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const usage = data.contextUsage;
  const s = data.stats;
  const pct = usage?.percent ?? null;
  const barColor =
    pct !== null && pct >= 90 ? "var(--error)" :
    pct !== null && pct >= 70 ? "var(--warning)" :
    "var(--accent)";

  return (
    <div className="settings-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={dialogRef}
        className="settings-panel"
        style={{ maxWidth: "420px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <span className="settings-section-title" style={{ margin: 0, textTransform: "none", letterSpacing: 0, fontSize: "13px" }}>
            Context Inspector
          </span>
          <button type="button" className="settings-close" onClick={onClose}>✕</button>
        </header>

        <div className="settings-body" style={{ padding: "12px 16px 16px" }}>
          {pct !== null && (
            <div className="settings-card" style={{ marginBottom: "10px" }}>
              <div className="settings-card-header">
                <div className="ctx-bar-track" style={{ flex: 1 }}>
                  <div className="ctx-bar-fill" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
                </div>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {Math.round(pct)}%
                </span>
              </div>
              <div className="ctx-bar-labels" style={{ padding: "0 12px 8px" }}>
                <span>{usage!.tokens?.toLocaleString() ?? "?"} / {usage!.contextWindow.toLocaleString()} tokens</span>
              </div>
            </div>
          )}

          <div className="settings-card" style={{ marginBottom: "10px" }}>
            <div className="settings-card-header">
              <span className="settings-section-title" style={{ margin: 0 }}>Tokens</span>
            </div>
            <div style={{ padding: "0 12px 8px" }}>
              <Row label="Input" value={s.tokens.input.toLocaleString()} />
              <Row label="Output" value={s.tokens.output.toLocaleString()} />
              <Row label="Cache Read" value={s.tokens.cacheRead.toLocaleString()} />
              <Row label="Cache Write" value={s.tokens.cacheWrite.toLocaleString()} />
              <Row label="Total" value={s.tokens.total.toLocaleString()} accent />
            </div>
          </div>

          <div className="settings-card" style={{ marginBottom: "10px" }}>
            <div className="settings-card-header">
              <span className="settings-section-title" style={{ margin: 0 }}>Cost</span>
            </div>
            <div style={{ padding: "0 12px 8px" }}>
              <Row label="Total spent" value={formatCost(s.cost)} />
            </div>
          </div>

          <div className="settings-card">
            <div className="settings-card-header">
              <span className="settings-section-title" style={{ margin: 0 }}>Conversation</span>
            </div>
            <div style={{ padding: "0 12px 8px" }}>
              <Row label="User messages" value={String(s.userMessages)} />
              <Row label="Assistant messages" value={String(s.assistantMessages)} />
              <Row label="Tool calls" value={String(s.toolCalls)} />
              <Row label="Tool results" value={String(s.toolResults)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "3px 0",
      fontSize: "12px",
      color: "var(--text-secondary)",
    }}>
      <span>{label}</span>
      <span style={{
        fontVariantNumeric: "tabular-nums",
        color: accent ? "var(--accent)" : "var(--text-primary)",
        fontWeight: accent ? 600 : 500,
      }}>{value}</span>
    </div>
  );
}
