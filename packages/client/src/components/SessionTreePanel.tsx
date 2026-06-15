import { useEffect, useMemo, useState } from "react";
import {
  getSessionTree,
  navigateSession,
  forkSession as forkSessionAPI,
  type SessionTreeEntry,
  type SessionTreeResponse,
} from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";

/**
 * Session Tree Panel — modal overlay showing branching history.
 * Adapted from pi-forge's SessionTreePanel.
 *
 * Two views:
 *   - List: indented vertical list with role badges
 *   - Graph: branching graph with connected columns
 *
 * Actions per entry:
 *   - Navigate: click to move the session leaf to this entry (in-place)
 *   - Fork: create a new session from this entry
 */

interface Props {
  sessionId: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
}

interface NodeView extends SessionTreeEntry {
  depth: number;
  branchLevel: number;
  onActivePath: boolean;
  isLeaf: boolean;
  siblings: number;
  isBranchHead: boolean;
}

const MODEL_KEY_PREFIX = "pi-kot/model/";

export function SessionTreePanel({ sessionId, projectId, open, onClose }: Props) {
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const loadProjectSessions = useSessionStore((s) => s.loadProjectSessions);
  const refreshSessions = useSessionStore((s) => s.refreshSessions);
  const reloadMessages = useSessionStore((s) => s.reloadMessages);

  const [tree, setTree] = useState<SessionTreeResponse | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState<{
    entryId: string;
    abandons: boolean;
    streaming: boolean;
  } | undefined>(undefined);

  const refresh = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const t = await getSessionTree(sessionId);
      setTree(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tree");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [sessionId]);

  // Auto-refresh every 5 seconds while streaming
  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [isStreaming, sessionId]);

  const nodes = useMemo(() => {
    if (tree === undefined) return [];
    return flattenTree(tree);
  }, [tree]);

  const navigate = (entryId: string) => {
    if (busy || tree === undefined) return;
    if (tree.leafId === entryId) return;
    const abandons = tree.leafId !== null && currentLeafAbandonedBy(tree, entryId);
    if (isStreaming || abandons) {
      setShowConfirm({ entryId, abandons, streaming: isStreaming });
      return;
    }
    void executeNavigate(entryId, {});
  };

  const executeNavigate = async (
    entryId: string,
    opts: { summarize?: boolean; customInstructions?: string; label?: string },
  ): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await navigateSession(sessionId, entryId, opts);
      // pi-forge behavior: refresh tree + reload messages in-place.
      // Do NOT close the panel or re-activate the session — that
      // would reconnect SSE unnecessarily and can make it look like
      // a new session appeared in the sidebar.
      await refresh();
      await reloadMessages(sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Navigate failed");
    } finally {
      setBusy(false);
    }
  };

  const fork = async (
    entryId: string,
    opts: { editDraft?: string; parentId?: string | null } = {},
  ) => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const forkAt =
        opts.parentId !== undefined && opts.parentId !== null ? opts.parentId : entryId;
      const forked = await forkSessionAPI(sessionId, forkAt);
      // Carry the per-session model choice across the fork
      try {
        const sourceModel = localStorage.getItem(MODEL_KEY_PREFIX + sessionId);
        if (sourceModel !== null && sourceModel.length > 0) {
          localStorage.setItem(MODEL_KEY_PREFIX + forked.sessionId, sourceModel);
        }
      } catch {
        // private-mode storage failure
      }
      await loadProjectSessions(projectId);
      setActiveSession(forked.sessionId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fork failed");
      setBusy(false);
    }
  };

  const [view, setView] = useState<"list" | "graph">("list");

  return (
    <div
      className="settings-overlay"
      style={{
        pointerEvents: open ? "auto" : "none",
        opacity: open ? 1 : 0,
        transition: "opacity 0.18s ease",
      }}
      onClick={open ? onClose : undefined}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="settings-panel"
        style={{ width: 640, maxWidth: "92vw", maxHeight: "80vh" }}
      >
        {/* Header */}
        <header className="settings-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-dim)" }}>🌿</span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
              Session Tree
            </span>
            {busy && <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>working...</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                display: "flex",
                overflow: "hidden",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
              }}
            >
              <button
                onClick={() => setView("list")}
                style={{
                  padding: "2px 10px",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  border: "none",
                  background: view === "list" ? "var(--bg-glass-strong)" : "transparent",
                  color: view === "list" ? "var(--text-primary)" : "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                List
              </button>
              <button
                onClick={() => setView("graph")}
                style={{
                  padding: "2px 10px",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  border: "none",
                  background: view === "graph" ? "var(--bg-glass-strong)" : "transparent",
                  color: view === "graph" ? "var(--text-primary)" : "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                Graph
              </button>
            </div>
            <button
              onClick={() => void refresh()}
              disabled={loading || busy}
              className="settings-close"
              title="Refresh"
              style={{ fontSize: "13px" }}
            >
              ↻
            </button>
            <button
              onClick={onClose}
              className="settings-close"
              title="Close"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Error */}
        {error !== undefined && (
          <div className="settings-error">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="settings-body" style={{ padding: "12px" }}>
          {loading && tree === undefined && (
            <div style={{ textAlign: "center", padding: "24px", color: "var(--text-dim)", fontSize: "12px" }}>
              Loading tree…
            </div>
          )}
          {!loading && nodes.length === 0 && (
            <div style={{ textAlign: "center", padding: "24px", color: "var(--text-dim)", fontSize: "12px" }}>
              No entries yet.
            </div>
          )}
          {view === "list" && nodes.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {nodes.map((n) => (
                <TreeRow
                  key={n.id}
                  node={n}
                  disabled={busy}
                  onNavigate={() => navigate(n.id)}
                  onFork={() =>
                    fork(n.id, {
                      ...(n.type === "message" && n.role === "user"
                        ? { editDraft: n.preview ?? "", parentId: n.parentId }
                        : {}),
                    })
                  }
                />
              ))}
            </ul>
          )}
          {view === "graph" && tree !== undefined && (
            <SessionTreeGraph
              tree={tree}
              disabled={busy}
              onNavigate={(id) => navigate(id)}
              onForkAfterTurn={(lastEntryId) => fork(lastEntryId)}
            />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: "10px",
            color: "var(--text-dim)",
          }}
        >
          <span>Click a row to navigate · ↻ on user messages to fork</span>
          {tree !== undefined && (
            <span>{tree.entries.length} {tree.entries.length === 1 ? "entry" : "entries"}</span>
          )}
        </div>
      </div>

      {/* Confirm dialog */}
      {showConfirm !== undefined && (
        <NavigateConfirmDialog
          state={showConfirm}
          onCancel={() => setShowConfirm(undefined)}
          onConfirm={(opts) => {
            const entryId = showConfirm.entryId;
            setShowConfirm(undefined);
            void executeNavigate(entryId, opts);
          }}
        />
      )}
    </div>
  );
}

/* ── Navigate Confirm Dialog ── */

interface ConfirmState {
  entryId: string;
  abandons: boolean;
  streaming: boolean;
}

function NavigateConfirmDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: ConfirmState;
  onCancel: () => void;
  onConfirm: (opts: { summarize?: boolean; customInstructions?: string; label?: string }) => void;
}) {
  const [label, setLabel] = useState("");
  const [summarize, setSummarize] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");

  const dialogStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: 1100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.5)",
    padding: "16px",
  };

  const panelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    width: state.abandons ? "440px" : "360px",
    borderRadius: "var(--radius)",
    border: "1px solid var(--tool-border)",
    background: "var(--bg-frosted)",
    backdropFilter: "blur(var(--blur-heavy))",
    padding: "16px",
    gap: "12px",
  };

  return (
    <div style={dialogStyle} onClick={onCancel}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
          Navigate session leaf
        </div>

        {state.streaming && (
          <div
            style={{
              padding: "6px 10px",
              fontSize: "11px",
              borderRadius: "var(--radius-sm)",
              background: "color-mix(in srgb, var(--warning, #fbbf24) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--warning, #fbbf24) 30%, transparent)",
              color: "var(--warning)",
            }}
          >
            The agent is currently running. Navigating will abort the in-progress turn.
          </div>
        )}

        {state.abandons && (
          <>
            <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: 0 }}>
              You&rsquo;re leaving the current branch behind. You can bookmark or summarize it.
            </p>
            <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                Label for the abandoned branch <span style={{ opacity: 0.5 }}>(optional)</span>
              </span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. wrong-approach"
                maxLength={200}
                style={{
                  padding: "6px 8px",
                  fontSize: "11px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: "var(--bg-solid)",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "8px",
                padding: "8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--tool-border)",
                background: "var(--bg-solid)",
              }}
            >
              <input
                type="checkbox"
                checked={summarize}
                onChange={(e) => setSummarize(e.target.checked)}
                style={{ marginTop: "2px" }}
              />
              <span style={{ fontSize: "11px", color: "var(--text-secondary)", flex: 1 }}>
                Have pi write a <code style={{ fontSize: "10px" }}>branch_summary</code> entry
                capturing what this branch did.
              </span>
            </label>
            {summarize && (
              <label style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
                  Custom instructions <span style={{ opacity: 0.5 }}>(optional)</span>
                </span>
                <textarea
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  rows={3}
                  placeholder="e.g. Focus on what files were changed"
                  style={{
                    padding: "6px 8px",
                    fontSize: "11px",
                    fontFamily: "monospace",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: "var(--bg-solid)",
                    color: "var(--text-primary)",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              </label>
            )}
          </>
        )}

        {!state.streaming && !state.abandons && (
          <p style={{ fontSize: "11px", color: "var(--text-secondary)", margin: 0 }}>
            Confirm navigation?
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", paddingTop: "4px" }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              fontSize: "11px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const opts: { summarize?: boolean; customInstructions?: string; label?: string } = {};
              const trimmedLabel = label.trim();
              if (trimmedLabel.length > 0) opts.label = trimmedLabel;
              if (summarize) {
                opts.summarize = true;
                const trimmedInstr = customInstructions.trim();
                if (trimmedInstr.length > 0) opts.customInstructions = trimmedInstr;
              }
              onConfirm(opts);
            }}
            style={{
              padding: "6px 14px",
              fontSize: "11px",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              border: "none",
              background: state.streaming ? "var(--warning, #d97706)" : "var(--text-primary)",
              color: state.streaming ? "#fff" : "var(--bg-solid)",
              cursor: "pointer",
            }}
          >
            {state.streaming ? "Abort & navigate" : "Navigate"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Tree Row ── */

const MAX_INDENT_DEPTH = 4;
const INDENT_PX = 18;
const BRANCH_OFFSET_PX = 10;
const MAX_BRANCH_LEVEL = 8;

const BRANCH_PALETTE = [
  "var(--accent-orng, #f59e0b)",
  "var(--accent-blue, #0ea5e9)",
  "var(--accent-pink, #ec4899)",
  "var(--accent-grn, #10b981)",
  "var(--accent-purp, #8b5cf6)",
  "var(--accent-orng2, #f97316)",
];

function branchAccent(level: number): string {
  if (level <= 0) return "transparent";
  return BRANCH_PALETTE[(level - 1) % BRANCH_PALETTE.length]!;
}

function entryTypeLabel(node: SessionTreeEntry): string {
  if (node.type === "message") return node.role ?? "message";
  if (node.type === "thinking_level_change") return "thinking";
  if (node.type === "model_change") return "model";
  if (node.type === "compaction") return "compact";
  if (node.type === "branch_summary") return "branch";
  if (node.type === "label") return "label";
  if (node.type === "session_info") return "info";
  if (node.type === "custom") return "custom";
  if (node.type === "custom_message") return "extension";
  return node.type;
}

function roleBadgeColor(role?: string, type?: string): React.CSSProperties {
  if (role === "user") return { background: "color-mix(in srgb, var(--accent-blue, #38bdf8) 15%, transparent)", color: "var(--accent-blue, #38bdf8)" };
  if (role === "assistant") return { background: "color-mix(in srgb, var(--accent-purp, #a78bfa) 15%, transparent)", color: "var(--accent-purp, #a78bfa)" };
  if (type === "branch_summary") return { background: "color-mix(in srgb, var(--warning, #fbbf24) 15%, transparent)", color: "var(--warning, #fbbf24)" };
  if (type === "compaction") return { background: "color-mix(in srgb, var(--accent-pink, #f472b6) 15%, transparent)", color: "var(--accent-pink, #f472b6)" };
  return { background: "rgba(255,255,255,0.04)", color: "var(--text-dim)" };
}

function TreeRow({
  node,
  disabled,
  onNavigate,
  onFork,
}: {
  node: NodeView;
  disabled: boolean;
  onNavigate: () => void;
  onFork: () => void;
}) {
  const indent =
    Math.min(node.depth, MAX_INDENT_DEPTH) * INDENT_PX +
    Math.min(node.branchLevel, MAX_BRANCH_LEVEL) * BRANCH_OFFSET_PX;
  const isUserMessage = node.type === "message" && node.role === "user";
  const dim = !node.onActivePath;
  const labelText = entryTypeLabel(node);

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid",
    padding: "6px 8px",
    ...(node.isLeaf
      ? { borderColor: "color-mix(in srgb, var(--success, #34d399) 40%, transparent)", background: "color-mix(in srgb, var(--success, #34d399) 6%, transparent)" }
      : node.onActivePath
        ? { borderColor: "var(--tool-border)", background: "var(--bg-glass)" }
        : { borderColor: "var(--tool-border)", background: "transparent" }),
    opacity: dim ? 0.55 : 1,
    ...(node.branchLevel > 0
      ? { boxShadow: `inset 3px 0 0 ${branchAccent(node.branchLevel)}` }
      : {}),
  };

  return (
    <li style={{ paddingLeft: `${indent}px`, minWidth: 0 }}>
      <div style={rowStyle}>
        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "2px", paddingTop: "1px", flexShrink: 0 }}>
          {!node.isLeaf ? (
            <button
              onClick={onNavigate}
              disabled={disabled}
              title="Navigate to this entry"
              style={{
                padding: "2px",
                fontSize: "11px",
                border: "none",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: disabled ? "default" : "pointer",
                borderRadius: "3px",
                lineHeight: 1,
              }}
            >
              ◎
            </button>
          ) : (
            <span style={{ display: "inline-block", width: "18px" }} />
          )}
          {isUserMessage ? (
            <button
              onClick={onFork}
              disabled={disabled}
              title="Fork from this message"
              style={{
                padding: "2px",
                fontSize: "11px",
                border: "none",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: disabled ? "default" : "pointer",
                borderRadius: "3px",
                lineHeight: 1,
              }}
            >
              ↻
            </button>
          ) : (
            <span style={{ display: "inline-block", width: "18px" }} />
          )}
        </div>

        {/* Content */}
        <button
          onClick={onNavigate}
          disabled={disabled || node.isLeaf}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "2px",
            textAlign: "left",
            border: "none",
            background: "transparent",
            cursor: disabled || node.isLeaf ? "default" : "pointer",
            padding: 0,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px" }}>
            <span
              style={{
                padding: "1px 6px",
                fontSize: "9px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.03em",
                borderRadius: "3px",
                ...roleBadgeColor(node.role, node.type),
              }}
            >
              {labelText}
            </span>
            {node.isBranchHead && (
              <span
                style={{
                  padding: "1px 6px",
                  fontSize: "9px",
                  textTransform: "uppercase",
                  borderRadius: "3px",
                  background: `${branchAccent(node.branchLevel)}33`,
                  color: branchAccent(node.branchLevel),
                }}
              >
                branch {node.branchLevel}
              </span>
            )}
            {node.label !== undefined && node.label.length > 0 && (
              <span
                style={{
                  padding: "1px 6px",
                  fontSize: "9px",
                  borderRadius: "3px",
                  background: "var(--bg-glass-strong)",
                  color: "var(--text-secondary)",
                }}
              >
                ★ {node.label}
              </span>
            )}
            {node.isLeaf && (
              <span
                style={{
                  padding: "1px 6px",
                  fontSize: "9px",
                  borderRadius: "3px",
                  background: "color-mix(in srgb, var(--success, #34d399) 15%, transparent)",
                  color: "var(--success, #34d399)",
                }}
              >
                leaf
              </span>
            )}
            {node.siblings > 1 && (
              <span style={{ fontSize: "9px", color: "var(--warning)" }} title={`${node.siblings} branches diverge here`}>
                ⑂ {node.siblings}
              </span>
            )}
            <span style={{ fontSize: "9px", color: "var(--text-ghost)" }}>
              {new Date(node.timestamp).toLocaleString()}
            </span>
          </div>
          {node.preview !== undefined && (
            <p
              style={{
                width: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                margin: 0,
                fontSize: "11px",
                color: "var(--text-secondary)",
              }}
            >
              {node.preview}
            </p>
          )}
        </button>
      </div>
    </li>
  );
}

/* ── Tree flattening ── */

function flattenTree(tree: SessionTreeResponse): NodeView[] {
  const childrenByParent = new Map<string | null, SessionTreeEntry[]>();
  for (const e of tree.entries) {
    const list = childrenByParent.get(e.parentId);
    if (list === undefined) childrenByParent.set(e.parentId, [e]);
    else list.push(e);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  const onPath = new Set(tree.branchIds);
  const out: NodeView[] = [];
  const visit = (parentId: string | null, branchLevel: number) => {
    const list = childrenByParent.get(parentId);
    if (list === undefined) return;
    const siblings = list.length;
    list.forEach((e, idx) => {
      const childLevel = idx === 0 ? branchLevel : branchLevel + 1;
      const isBranchHead = idx > 0 && childLevel > 0;
      out.push({
        ...e,
        depth: e.type === "message" ? (e.role === "user" ? 0 : e.role === "tool" ? 2 : 1) : 0,
        branchLevel: childLevel,
        onActivePath: onPath.has(e.id),
        isLeaf: tree.leafId === e.id,
        siblings,
        isBranchHead,
      });
      visit(e.id, childLevel);
    });
  };
  visit(null, 0);
  return out;
}

function currentLeafAbandonedBy(tree: SessionTreeResponse, targetId: string): boolean {
  if (tree.leafId === null || tree.leafId === targetId) return false;
  const byId = new Map(tree.entries.map((e) => [e.id, e]));
  let cur: string | null = tree.leafId;
  while (cur !== null) {
    if (cur === targetId) return false;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return true;
}

/* ── Graph View ── */

interface TurnNode {
  id: string;
  parentId: string | null;
  col: number;
  row: number;
  isOnActivePath: boolean;
  isLeafTurn: boolean;
  roleLabel: string;
  preview: string;
  isUserAnchor: boolean;
  anchorParentId: string | null;
  lastEntryId: string;
  timestamp: string;
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 68;
const COL_GAP = 48;
const ROW_GAP = 24;
const PAD = 20;

function buildTurns(tree: SessionTreeResponse): TurnNode[] {
  const byId = new Map(tree.entries.map((e) => [e.id, e]));
  const childrenByParent = new Map<string | null, SessionTreeEntry[]>();
  for (const e of tree.entries) {
    const list = childrenByParent.get(e.parentId);
    if (list === undefined) childrenByParent.set(e.parentId, [e]);
    else list.push(e);
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // Build turns
  const owningTurn = new Map<string, string>();
  const computeOwner = (entry: SessionTreeEntry): string => {
    const cached = owningTurn.get(entry.id);
    if (cached !== undefined) return cached;
    if (entry.type === "message" && entry.role === "user") {
      owningTurn.set(entry.id, entry.id);
      return entry.id;
    }
    if (entry.parentId === null) {
      owningTurn.set(entry.id, entry.id);
      return entry.id;
    }
    const parent = byId.get(entry.parentId);
    if (parent === undefined) {
      owningTurn.set(entry.id, entry.id);
      return entry.id;
    }
    const owner = computeOwner(parent);
    owningTurn.set(entry.id, owner);
    return owner;
  };
  for (const e of tree.entries) computeOwner(e);

  const turnsByAnchor = new Map<string, TurnNode>();
  for (const e of tree.entries) {
    if (owningTurn.get(e.id) !== e.id) continue;
    const isUser = e.type === "message" && e.role === "user";
    turnsByAnchor.set(e.id, {
      id: e.id,
      parentId: null,
      col: 0,
      row: 0,
      isOnActivePath: false,
      isLeafTurn: false,
      roleLabel: isUser ? "user" : entryTypeLabel(e),
      preview: e.preview ?? "",
      isUserAnchor: isUser,
      anchorParentId: e.parentId,
      lastEntryId: e.id,
      timestamp: e.timestamp,
    });
  }

  // Update lastEntryId for each turn: walk all entries owned by the
  // turn and keep the one with the latest timestamp. Without this
  // pass lastEntryId stays on the anchor (the user message) so
  // navigating/forking lands on the parent instead of the reply.
  for (const e of tree.entries) {
    const owner = owningTurn.get(e.id)!;
    const turn = turnsByAnchor.get(owner);
    if (turn === undefined) continue;
    const currentLast = byId.get(turn.lastEntryId);
    if (
      currentLast === undefined ||
      e.timestamp.localeCompare(currentLast.timestamp) >= 0
    ) {
      turn.lastEntryId = e.id;
    }
  }

  // Parent-link turns
  for (const turn of turnsByAnchor.values()) {
    if (turn.anchorParentId === null) continue;
    const parentOwner = owningTurn.get(turn.anchorParentId);
    if (parentOwner === undefined || parentOwner === turn.id) continue;
    turn.parentId = parentOwner;
  }

  // Active-path + leaf flags
  const onPath = new Set(tree.branchIds);
  const leafOwner = tree.leafId !== null ? owningTurn.get(tree.leafId) : undefined;
  for (const t of turnsByAnchor.values()) {
    t.isOnActivePath = onPath.has(t.id);
    t.isLeafTurn = leafOwner === t.id;
  }

  // Layout: columns
  const childrenByTurnParent = new Map<string | null, TurnNode[]>();
  for (const t of turnsByAnchor.values()) {
    const list = childrenByTurnParent.get(t.parentId);
    if (list === undefined) childrenByTurnParent.set(t.parentId, [t]);
    else list.push(t);
  }
  for (const list of childrenByTurnParent.values()) {
    list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  let nextFreeCol = 0;
  const visit = (parentId: string | null, parentCol: number) => {
    const kids = childrenByTurnParent.get(parentId) ?? [];
    kids.forEach((kid, idx) => {
      let col: number;
      if (idx === 0) {
        col = parentCol;
      } else {
        col = nextFreeCol;
        nextFreeCol += 1;
      }
      kid.col = col;
      visit(kid.id, col);
    });
  };
  const roots = childrenByTurnParent.get(null) ?? [];
  roots.forEach((root, idx) => {
    if (idx === 0) {
      root.col = 0;
      nextFreeCol = Math.max(nextFreeCol, 1);
    } else {
      root.col = nextFreeCol;
      nextFreeCol += 1;
    }
    visit(root.id, root.col);
  });

  // Row assignment: chain-depth from root
  const depthMemo = new Map<string, number>();
  const computeDepth = (turn: TurnNode): number => {
    const cached = depthMemo.get(turn.id);
    if (cached !== undefined) return cached;
    if (turn.parentId === null) {
      depthMemo.set(turn.id, 0);
      return 0;
    }
    const parent = turnsByAnchor.get(turn.parentId);
    if (parent === undefined) {
      depthMemo.set(turn.id, 0);
      return 0;
    }
    const d = computeDepth(parent) + 1;
    depthMemo.set(turn.id, d);
    return d;
  };
  for (const t of turnsByAnchor.values()) t.row = computeDepth(t);

  return [...turnsByAnchor.values()].sort((a, b) =>
    a.row !== b.row ? a.row - b.row : a.col - b.col,
  );
}

function SessionTreeGraph({
  tree,
  disabled,
  onNavigate,
  onForkAfterTurn,
}: {
  tree: SessionTreeResponse;
  disabled: boolean;
  onNavigate: (entryId: string) => void;
  onForkAfterTurn: (lastEntryId: string) => void;
}) {
  const turns = useMemo(() => buildTurns(tree), [tree]);
  const layout = useMemo(() => {
    if (turns.length === 0) return { width: 0, height: 0 };
    const maxCol = turns.reduce((m, t) => Math.max(m, t.col), 0);
    const maxRow = turns.reduce((m, t) => Math.max(m, t.row), 0);
    return {
      width: PAD * 2 + (maxCol + 1) * NODE_WIDTH + maxCol * COL_GAP,
      height: PAD * 2 + (maxRow + 1) * NODE_HEIGHT + maxRow * ROW_GAP,
    };
  }, [turns]);

  if (turns.length === 0) {
    return <div style={{ textAlign: "center", padding: "24px", color: "var(--text-dim)", fontSize: "12px" }}>No turns to render.</div>;
  }

  const xOf = (col: number): number => PAD + col * (NODE_WIDTH + COL_GAP);
  const yOf = (row: number): number => PAD + row * (NODE_HEIGHT + ROW_GAP);
  const turnsById = new Map(turns.map((t) => [t.id, t]));

  return (
    <div style={{ position: "relative", width: `${layout.width}px`, height: `${layout.height}px` }}>
      <svg aria-hidden style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }} width={layout.width} height={layout.height}>
        {turns.map((t) => {
          if (t.parentId === null) return null;
          const parent = turnsById.get(t.parentId);
          if (parent === undefined) return null;
          const px = xOf(parent.col) + NODE_WIDTH / 2;
          const py = yOf(parent.row) + NODE_HEIGHT;
          const cx = xOf(t.col) + NODE_WIDTH / 2;
          const cy = yOf(t.row);
          const onActive = t.isOnActivePath && parent.isOnActivePath;
          const d = px === cx
            ? `M ${px} ${py} L ${cx} ${cy}`
            : (() => {
                const bendY = py + (cy - py) / 2;
                const r = 6;
                const goingRight = cx > px;
                const cornerInX = goingRight ? px + r : px - r;
                const cornerOutX = goingRight ? cx - r : cx + r;
                return [
                  `M ${px} ${py}`,
                  `L ${px} ${bendY - r}`,
                  `Q ${px} ${bendY} ${cornerInX} ${bendY}`,
                  `L ${cornerOutX} ${bendY}`,
                  `Q ${cx} ${bendY} ${cx} ${bendY + r}`,
                  `L ${cx} ${cy}`,
                ].join(" ");
              })();
          return (
            <path
              key={t.id}
              d={d}
              fill="none"
              stroke={onActive ? "#a3a3a3" : "#404040"}
              strokeWidth={onActive ? 1.5 : 1}
              strokeOpacity={onActive ? 0.85 : 0.5}
            />
          );
        })}
      </svg>
      {turns.map((t) => (
        <GraphNode
          key={t.id}
          turn={t}
          x={xOf(t.col)}
          y={yOf(t.row)}
          disabled={disabled}
          // Navigate to the LAST entry in the turn (assistant reply /
          // tool result). If the last entry happens to be a user message
          // (turn has no response yet), fall back to the turn's anchor
          // (also a user message) — the SDK navigates to the parent in
          // that case, which is the intended "edit" position.
          //
          // Never navigate to a user message entry directly: the SDK's
          // navigateTree sets leaf = parent for user messages, which
          // creates a -1 offset in the graph (click turn 4 → shows turn 3).
          onNavigate={() => onNavigate(t.lastEntryId)}
          onForkAfterTurn={() => onForkAfterTurn(t.lastEntryId)}
        />
      ))}
    </div>
  );
}

function GraphNode({
  turn,
  x,
  y,
  disabled,
  onNavigate,
  onForkAfterTurn,
}: {
  turn: TurnNode;
  x: number;
  y: number;
  disabled: boolean;
  onNavigate: () => void;
  onForkAfterTurn: () => void;
}) {
  const dim = !turn.isOnActivePath;
  const borderColor = turn.isLeafTurn
    ? "color-mix(in srgb, var(--success, #34d399) 50%, transparent)"
    : turn.isOnActivePath
      ? "var(--tool-border)"
      : "var(--tool-border)";

  return (
    <div
      style={{
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${NODE_WIDTH}px`,
        height: `${NODE_HEIGHT}px`,
        borderRadius: "var(--radius-sm)",
        border: "1px solid",
        borderColor,
        background: turn.isLeafTurn
          ? "color-mix(in srgb, var(--success, #34d399) 6%, transparent)"
          : turn.isOnActivePath
            ? "var(--bg-glass)"
            : "var(--bg-solid)",
        opacity: dim ? 0.55 : 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onNavigate}
        disabled={disabled}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "6px 8px",
          gap: "2px",
          textAlign: "left",
          border: "none",
          background: "transparent",
          cursor: disabled ? "default" : "pointer",
          width: "100%",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
          <span
            style={{
              padding: "1px 5px",
              fontSize: "8px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.03em",
              borderRadius: "2px",
              ...roleBadgeColor(
                turn.roleLabel === "user" ? "user" : turn.roleLabel === "assistant" ? "assistant" : undefined,
                undefined,
              ),
            }}
          >
            {turn.roleLabel}
          </span>
          {turn.isLeafTurn && (
            <span style={{ fontSize: "8px", color: "var(--success, #34d399)" }}>leaf</span>
          )}
        </div>
        {turn.preview.length > 0 && (
          <p
            style={{
              margin: 0,
              fontSize: "10px",
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
          >
            {turn.preview.slice(0, 60)}{turn.preview.length > 60 ? "…" : ""}
          </p>
        )}
      </button>
      {turn.isUserAnchor && (
        <button
          onClick={onForkAfterTurn}
          disabled={disabled}
          title="Fork from this turn"
          style={{
            padding: "1px 6px",
            fontSize: "9px",
            border: "none",
            borderTop: "1px solid var(--tool-border)",
            background: "transparent",
            color: "var(--text-dim)",
            cursor: disabled ? "default" : "pointer",
            width: "100%",
          }}
        >
          ↻ fork
        </button>
      )}
    </div>
  );
}
