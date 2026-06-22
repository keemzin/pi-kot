import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { RenderedView } from "./RenderedView";
import { GitPanel } from "./GitPanel";
import { filesTree, filesRead, filesWrite, filesRename, filesMkdir, filesDelete, filesSearch } from "../lib/api-client";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

export type ExplorerTab = "files" | "git";

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
  initialTab?: ExplorerTab;
}

interface SearchMatch {
  path: string;
  line: number;
  column: number;
  length: number;
  lineSnippet: string;
}

interface SearchResult {
  engine: "ripgrep" | "node";
  matches: SearchMatch[];
  truncated: boolean;
}

interface OpenFileState {
  path: string;
  content: string;
  saved: string;
  dirty: boolean;
  language: string;
  saving: boolean;
  loadingError?: string;
}

type PaneView = "tree" | "editor";

const DEFAULT_EXPLORER_WIDTH = 360;
const MIN_EXPLORER_WIDTH = 220;
const MAX_EXPLORER_WIDTH = 800;

const CONTENT_SEARCH_DEBOUNCE_MS = 300;
const MIN_CONTENT_SEARCH_LEN = 3;

function groupByPath(matches: SearchMatch[]): [string, SearchMatch[]][] {
  const map = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const list = map.get(m.path);
    if (list === undefined) map.set(m.path, [m]);
    else list.push(m);
  }
  return Array.from(map.entries());
}

export function FileExplorer({ projectId, open, onClose, initialTab }: Props) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [renaming, setRenaming] = useState<string | undefined>();
  const [renameDraft, setRenameDraft] = useState("");
  const [showCreate, setShowCreate] = useState<"file" | "folder" | undefined>();
  const [createParent, setCreateParent] = useState("");
  const [createName, setCreateName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | undefined>();
  const [openFiles, setOpenFiles] = useState<OpenFileState[]>([]);
  const [activePath, setActivePath] = useState<string | undefined>();
  const [tab, setTab] = useState<ExplorerTab>(initialTab ?? "files");
  const [view, setView] = useState<PaneView>("tree");

  // Sync initialTab changes (e.g. when header git button clicked while panel is open)
  useEffect(() => {
    if (initialTab !== undefined && initialTab !== tab) {
      setTab(initialTab);
      if (initialTab === "files") setView("tree");
    }
  }, [initialTab]);
  const [editorMode, setEditorMode] = useState<"raw" | "rendered">("raw");
  const [wordWrap, setWordWrap] = useState(true);

  // ── Resizable panel ──
  const [panelWidth, setPanelWidth] = useState(DEFAULT_EXPLORER_WIDTH);
  const resizeRef = useRef<{ startX: number; startW: number } | undefined>(undefined);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startW: panelWidth };
    const onMove = (ev: MouseEvent) => {
      if (resizeRef.current === undefined) return;
      const dx = ev.clientX - resizeRef.current.startX;
      const w = Math.min(MAX_EXPLORER_WIDTH, Math.max(MIN_EXPLORER_WIDTH, resizeRef.current.startW - dx));
      setPanelWidth(w);
    };
    const onUp = () => {
      resizeRef.current = undefined;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [panelWidth]);

  // ── Content search state (integrated into Files tab) ──
  const [contentSearchResults, setContentSearchResults] = useState<SearchResult | undefined>(undefined);
  const [contentSearchLoading, setContentSearchLoading] = useState(false);
  const [contentSearchError, setContentSearchError] = useState<string | undefined>();
  const [expandedSearchFiles, setExpandedSearchFiles] = useState<Set<string>>(new Set());

  // Debounced content search that fires when the tree's filename search is long enough
  useEffect(() => {
    if (tab !== "files" || !open) {
      setContentSearchResults(undefined);
      return;
    }
    const q = search.trim();
    if (q.length < MIN_CONTENT_SEARCH_LEN) {
      setContentSearchResults(undefined);
      setContentSearchError(undefined);
      setContentSearchLoading(false);
      return;
    }
    setContentSearchLoading(true);
    setContentSearchError(undefined);

    const timer = setTimeout(async () => {
      try {
        const res = await filesSearch(projectId, q);
        setContentSearchResults(res);
        const groups = groupByPath(res.matches);
        setExpandedSearchFiles(new Set(groups.slice(0, 5).map(([p]) => p)));
      } catch (err) {
        setContentSearchError(err instanceof Error ? err.message : "search failed");
        setContentSearchResults(undefined);
      } finally {
        setContentSearchLoading(false);
      }
    }, CONTENT_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search, tab, open, projectId]);

  const renameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const data = await filesTree(projectId);
      setTree((data as { children?: TreeNode[] }).children ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    if (showCreate) createRef.current?.focus();
  }, [showCreate]);
  useEffect(() => {
    if (renaming !== undefined) renameRef.current?.focus();
  }, [renaming]);

  const openFile = useCallback(async (path: string) => {
    const existing = openFiles.find((f) => f.path === path);
    if (existing) {
      setActivePath(path);
      setView("editor");
      return;
    }

    setError(undefined);
    const placeholder: OpenFileState = {
      path, content: "", saved: "", dirty: false, language: "", saving: false,
    };
    setOpenFiles((prev) => [...prev, placeholder]);
    setActivePath(path);
    setView("editor");

    try {
      const data = await filesRead(projectId, path);
      const content = data.binary ? "(binary file)" : data.content ?? "";
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === path ? { ...f, content, saved: content, language: data.language, dirty: false } : f,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "read failed");
      setOpenFiles((prev) => prev.filter((f) => f.path !== path));
      setActivePath((prev) => (prev === path ? undefined : prev));
      setView("tree");
    }
  }, [openFiles, activePath, projectId]);

  const handleTabClose = useCallback((path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    setActivePath((prev) => {
      if (prev !== path) return prev;
      const remaining = openFiles.filter((f) => f.path !== path);
      return remaining.length > 0 ? remaining[remaining.length - 1].path : undefined;
    });
  }, [openFiles]);

  const handleSave = async () => {
    if (!activePath) return;
    const file = openFiles.find((f) => f.path === activePath);
    if (!file || file.saving) return;

    setOpenFiles((prev) => prev.map((f) => (f.path === activePath ? { ...f, saving: true } : f)));
    setError(undefined);
    try {
      await filesWrite(projectId, activePath, file.content);
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === activePath ? { ...f, dirty: false, saved: file.content, saving: false } : f,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
      setOpenFiles((prev) => prev.map((f) => (f.path === activePath ? { ...f, saving: false } : f)));
    }
  };

  const handleContentChange = useCallback((value: string) => {
    if (!activePath) return;
    setOpenFiles((prev) =>
      prev.map((f) =>
        f.path === activePath ? { ...f, content: value, dirty: value !== f.saved } : f,
      ),
    );
  }, [activePath]);

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  const handleRename = async (oldPath: string) => {
    const name = renameDraft.trim();
    if (!name || name === oldPath.split("/").pop()) {
      setRenaming(undefined);
      return;
    }
    try {
      await filesRename(projectId, oldPath, name);
      setRenaming(undefined);
      setOpenFiles((prev) =>
        prev.map((f) => {
          const parent = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
          const newPath = parent ? `${parent}/${name}` : name;
          return f.path === oldPath ? { ...f, path: newPath } : f;
        }),
      );
      if (activePath === oldPath) {
        const parent = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
        setActivePath(parent ? `${parent}/${name}` : name);
      }
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "rename failed");
      setRenaming(undefined);
    }
  };

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) { setShowCreate(undefined); return; }
    try {
      if (showCreate === "folder") {
        const parent = createParent || "/";
        await filesMkdir(projectId, parent, name);
      } else {
        const path = createParent ? `${createParent}/${name}` : `/${name}`;
        await filesWrite(projectId, path, "");
      }
      setShowCreate(undefined);
      setCreateName("");
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
      setShowCreate(undefined);
    }
  };

  const handleDelete = async (path: string) => {
    try {
      await filesDelete(projectId, path, { recursive: true });
      setConfirmDelete(undefined);
      setOpenFiles((prev) => prev.filter((f) => f.path !== path));
      setActivePath((prev) => {
        if (prev !== path) return prev;
        const remaining = openFiles.filter((f) => f.path !== path);
        return remaining.length > 0 ? remaining[0].path : undefined;
      });
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
      setConfirmDelete(undefined);
    }
  };

  // Filter tree by search
  const filteredTree = useMemo(() => {
    if (!search) return tree;
    const q = search.toLowerCase();
    const filter = (nodes: TreeNode[]): TreeNode[] =>
      nodes.filter((n) => {
        const match = n.name.toLowerCase().includes(q);
        if (n.type === "directory" && n.children) {
          const filtered = filter(n.children);
          return match || filtered.length > 0;
        }
        return match;
      });
    return filter(tree);
  }, [tree, search]);

  // ---- Tree node renderer ----
  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expanded.has(node.path);
    const isDir = node.type === "directory";
    const isRenaming = renaming === node.path;

    return (
      <div key={node.path}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: "2px",
            padding: "2px 0", paddingLeft: `${8 + depth * 16}px`,
          }}
          className="file-tree-row"
        >
          {isDir ? (
            <button
              onClick={() => toggleFolder(node.path)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", fontSize: "10px", color: "var(--text-dim)", width: "16px", flexShrink: 0 }}
              type="button"
            >
              {isExpanded ? "▾" : "▸"}
            </button>
          ) : (
            <span style={{ width: "16px", flexShrink: 0 }} />
          )}
          <span style={{ fontSize: "12px", width: "18px", flexShrink: 0 }}>
            {isDir ? (isExpanded ? "📂" : "📁") : "📄"}
          </span>

          {isRenaming ? (
            <input
              ref={renameRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => handleRename(node.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(node.path);
                if (e.key === "Escape") setRenaming(undefined);
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                flex: 1, background: "var(--bg-solid)", border: "1px solid var(--border-bright)",
                borderRadius: "var(--radius-sm)", padding: "1px 4px", fontSize: "12px",
                color: "var(--text-primary)", outline: "none", minWidth: 0,
              }}
            />
          ) : (
            <button
              onClick={() => { if (isDir) toggleFolder(node.path); else openFile(node.path); }}
              style={{
                flex: 1, background: "none", border: "none",
                color: "var(--text-secondary)", cursor: "pointer", fontSize: "12px",
                textAlign: "left", padding: "1px 4px", borderRadius: "var(--radius-sm)",
                minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
              title={node.path}
              type="button"
            >
              {node.name}
            </button>
          )}

          {!isRenaming && (
            <div style={{ display: "flex", gap: "1px", opacity: 0.7, flexShrink: 0 }} className="file-row-actions">
              {isDir && (
                <button
                  onClick={() => { setCreateParent(node.path); setShowCreate("file"); setCreateName(""); }}
                  title="New file in this folder"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 3px", fontSize: "11px", color: "var(--text-dim)" }} type="button"
                >+</button>
              )}
              <button
                onClick={() => { setRenaming(node.path); setRenameDraft(node.name); setTimeout(() => renameRef.current?.focus(), 50); }}
                title="Rename"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 3px", fontSize: "11px", color: "var(--text-dim)" }} type="button"
              >✏️</button>
              <button
                onClick={() => setConfirmDelete(node.path)}
                title="Delete"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 3px", fontSize: "11px", color: "var(--text-dim)" }} type="button"
              >🗑</button>
            </div>
          )}
        </div>
        {isDir && isExpanded && node.children && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const activeFile = openFiles.find((f) => f.path === activePath);

  return (
    <div
      className="file-explorer-panel"
      style={{
        position: "fixed",
        top: 50,
        right: 0,
        bottom: 0,
        zIndex: 120,
        background: "var(--bg-solid)",
        borderLeft: "1px solid var(--border)",
        boxShadow: "-10px 0 28px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        width: panelWidth,
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.18s ease",
        willChange: "transform",
        userSelect: resizeRef.current !== undefined ? "none" : undefined,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ── Resize handle ── */}
      <div
        onMouseDown={onResizeStart}
        className="file-explorer-resize-handle"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: "5px",
          cursor: "col-resize",
          zIndex: 10,
          background: "transparent",
          transition: "background 0.15s ease",
        }}
      />

      {/* ── Tab bar ── */}
      <div className="fe-tab-bar" style={{
        display: "flex", borderBottom: "1px solid var(--border)",
        background: "var(--bg-glass)", flexShrink: 0,
      }}>
        <button
          onClick={() => { setTab("files"); setView("tree"); }}
          style={{
            flex: 1, padding: "11px 12px", fontSize: "13px", fontWeight: 600,
            background: tab === "files" ? "var(--bg-solid)" : "transparent",
            color: tab === "files" ? "var(--accent-text)" : "var(--text-dim)",
            border: "none", borderBottom: tab === "files" ? "2px solid var(--accent-text)" : "2px solid transparent",
            cursor: "pointer", transition: "all 0.12s ease",
          }}
          type="button"
        >
          📁 Files
        </button>
        <button
          onClick={() => setTab("git")}
          style={{
            flex: 1, padding: "11px 12px", fontSize: "13px", fontWeight: 600,
            background: tab === "git" ? "var(--bg-solid)" : "transparent",
            color: tab === "git" ? "var(--accent-text)" : "var(--text-dim)",
            border: "none", borderBottom: tab === "git" ? "2px solid var(--accent-text)" : "2px solid transparent",
            cursor: "pointer", transition: "all 0.12s ease",
          }}
          type="button"
        >
          ⎇ Git
        </button>

      </div>

      {/* ── Git tab ── */}
      {tab === "git" && (
        <GitPanel projectId={projectId} />
      )}

      {/* ── Files tab ── */}
      {tab === "files" && view === "tree" && (
        <>
          {/* Header */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 12px", borderBottom: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>
                Files
              </span>
              {loading && <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>loading...</span>}
            </div>
            <div style={{ display: "flex", gap: "2px" }}>
              <button onClick={() => { setCreateParent(""); setShowCreate("file"); setCreateName(""); }} title="New file" style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: "2px 5px", fontSize: "13px", borderRadius: "var(--radius-sm)" }} type="button">+📄</button>
              <button onClick={() => { setCreateParent(""); setShowCreate("folder"); setCreateName(""); }} title="New folder" style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: "2px 5px", fontSize: "13px", borderRadius: "var(--radius-sm)" }} type="button">+📁</button>
              <button onClick={loadTree} title="Refresh" style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: "2px 5px", fontSize: "14px", borderRadius: "var(--radius-sm)" }} type="button">↻</button>
              <button onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", padding: "2px 5px", fontSize: "15px", borderRadius: "var(--radius-sm)" }} type="button">✕</button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: "4px 12px", fontSize: "10px", color: "var(--error)", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid var(--tool-border)" }}>
              {error}
            </div>
          )}

          {/* Search */}
          <div style={{ padding: "6px 10px" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files or code..."
              style={{
                width: "100%", background: "var(--bg-glass)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: "12px",
                color: "var(--text-primary)", outline: "none",
              }}
            />
          </div>

          {/* Create dialog */}
          {showCreate && (
            <div style={{ padding: "4px 10px 6px", borderBottom: "1px solid var(--border)", display: "flex", gap: "4px", alignItems: "center", fontSize: "11px" }}>
              <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                {showCreate === "file" ? "📄" : "📁"}:
              </span>
              <input
                ref={createRef}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(undefined); }}
                placeholder={showCreate === "file" ? "name.ts" : "folder-name"}
                style={{
                  flex: 1, background: "var(--bg-solid)", border: "1px solid var(--border-bright)",
                  borderRadius: "var(--radius-sm)", padding: "2px 5px", fontSize: "11px",
                  color: "var(--text-primary)", outline: "none",
                }}
              />
              <button onClick={handleCreate} style={{ padding: "2px 6px", fontSize: "10px", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", background: "var(--accent-bg)", color: "var(--accent-text)", cursor: "pointer" }} type="button">Create</button>
              <button onClick={() => setShowCreate(undefined)} style={{ padding: "2px 6px", fontSize: "10px", border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }} type="button">Cancel</button>
            </div>
          )}

          {/* Delete confirmation */}
          {confirmDelete && (
            <div style={{ padding: "4px 10px", borderBottom: "1px solid var(--border)", display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", background: "rgba(248,113,113,0.06)" }}>
              <span style={{ color: "var(--error)" }}>Delete {confirmDelete.split("/").pop()}?</span>
              <button onClick={() => handleDelete(confirmDelete)} style={{ padding: "2px 6px", fontSize: "10px", border: "1px solid var(--error)", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--error)", cursor: "pointer" }} type="button">Delete</button>
              <button onClick={() => setConfirmDelete(undefined)} style={{ padding: "2px 6px", fontSize: "10px", border: "none", background: "none", color: "var(--text-dim)", cursor: "pointer" }} type="button">Cancel</button>
            </div>
          )}

          {/* Tree + content search results */}
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", fontSize: "12px" }}>
            {loading && tree.length === 0 && (
              <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "12px" }}>Loading...</div>
            )}

            {/* ── Content search results (fires when search >= 3 chars) ── */}
            {contentSearchLoading && (
              <div style={{ padding: "4px 12px 2px", fontSize: "11px", color: "var(--text-dim)" }}>
                Searching file contents…
              </div>
            )}
            {contentSearchError !== undefined && (
              <div style={{ padding: "2px 12px", fontSize: "10px", color: "var(--error)" }}>
                {contentSearchError}
              </div>
            )}
            {!contentSearchLoading && contentSearchResults !== undefined && contentSearchResults.matches.length > 0 && (
              <>
                <div style={{
                  padding: "3px 12px", fontSize: "10px", color: "var(--text-dim)",
                  borderBottom: "1px solid var(--border)", display: "flex", gap: "8px", alignItems: "center",
                }}>
                  <span>📄 {contentSearchResults.matches.length} match{contentSearchResults.matches.length !== 1 ? "es" : ""} in {groupByPath(contentSearchResults.matches).length} file{groupByPath(contentSearchResults.matches).length !== 1 ? "s" : ""}</span>
                  {contentSearchResults.truncated && <span style={{ color: "var(--accent-bg)" }}>truncated</span>}
                  {contentSearchResults.engine === "node" && (
                    <span style={{
                      fontSize: "8px", fontWeight: 600, textTransform: "uppercase",
                      background: "rgba(229,188,96,0.15)", color: "var(--accent-bg)",
                      padding: "1px 5px", borderRadius: "var(--radius-sm)",
                    }}>fallback</span>
                  )}
                </div>
                {groupByPath(contentSearchResults.matches).map(([filePath, matches]) => {
                  const isExpanded = expandedSearchFiles.has(filePath);
                  return (
                    <div key={`cs-${filePath}`}>
                      <div
                        onClick={() => setExpandedSearchFiles((prev) => {
                          const next = new Set(prev);
                          if (next.has(filePath)) next.delete(filePath); else next.add(filePath);
                          return next;
                        })}
                        style={{
                          display: "flex", alignItems: "center", gap: "4px",
                          padding: "3px 10px", cursor: "pointer",
                          color: "var(--text-secondary)", fontSize: "11px",
                          fontFamily: "monospace",
                        }}
                      >
                        <span style={{ fontSize: "10px", width: "12px", flexShrink: 0 }}>{isExpanded ? "▾" : "▸"}</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filePath}</span>
                        <span style={{ fontSize: "10px", color: "var(--text-dim)", flexShrink: 0 }}>{matches.length}</span>
                      </div>
                      {isExpanded && matches.map((m, i) => (
                        <div
                          key={`${filePath}-${m.line}-${m.column}-${i}`}
                          onClick={() => openFile(filePath)}
                          title={`${filePath}:${m.line}:${m.column}`}
                          style={{
                            display: "flex", gap: "8px", padding: "1px 10px 1px 24px",
                            cursor: "pointer", fontSize: "11px", fontFamily: "monospace",
                            color: "var(--text-dim)",
                          }}
                          className="search-match-row"
                        >
                          <span style={{
                            color: "var(--text-dim)", width: "36px",
                            flexShrink: 0, textAlign: "right", fontSize: "10px",
                          }}>{m.line}</span>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {(() => {
                              const col = m.column - 1;
                              const len = m.length;
                              const snippet = m.lineSnippet;
                              const before = snippet.slice(0, col);
                              const hit = snippet.slice(col, col + len);
                              const after = snippet.slice(col + len);
                              return (
                                <>
                                  <span>{before}</span>
                                  <span style={{ background: "rgba(229,188,96,0.35)", color: "var(--text-primary)", borderRadius: "2px" }}>{hit}</span>
                                  <span>{after}</span>
                                </>
                              );
                            })()}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </>
            )}

            {/* ── File tree (filename filtered) ── */}
            {filteredTree.length === 0 && !loading && (
              <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "12px" }}>
                {search ? "No files match" : "No files"}
              </div>
            )}
            {filteredTree.map((node) => renderNode(node, 0))}
          </div>
        </>
      )}

      {/* ── VIEW: Editor ── */}
      {tab === "files" && view === "editor" && (
        <>
          {/* Editor header with back button + tabs */}
          <div style={{
            display: "flex", alignItems: "center", gap: "4px",
            padding: "6px 10px", borderBottom: "1px solid var(--border)",
            background: "var(--bg-glass)",
          }}>
            <button
              onClick={() => setView("tree")}
              title="Back to file tree"
              style={{
                background: "none", border: "none", color: "var(--text-secondary)",
                cursor: "pointer", padding: "4px 8px", fontSize: "14px",
                borderRadius: "var(--radius-sm)", flexShrink: 0, lineHeight: 1,
              }}
              type="button"
            >
              ←
            </button>

            {/* Tab strip */}
            <div style={{ display: "flex", flex: 1, overflowX: "auto", gap: "2px" }}>
              {openFiles.map((f) => {
                const isActive = f.path === activePath;
                return (
                  <div
                    key={f.path}
                    style={{
                      display: "flex", alignItems: "center", gap: "3px",
                      padding: "3px 8px", fontSize: "11px", whiteSpace: "nowrap",
                      borderRadius: "var(--radius-sm)",
                      background: isActive ? "var(--accent-subtle)" : "transparent",
                      color: isActive ? "var(--accent-text)" : "var(--text-dim)",
                      cursor: "default", minWidth: 0,
                    }}
                  >
                    <button
                      onClick={() => setActivePath(f.path)}
                      style={{
                        background: "none", border: "none", color: "inherit",
                        cursor: "pointer", padding: 0, fontSize: "11px",
                        overflow: "hidden", textOverflow: "ellipsis",
                      }}
                      type="button"
                    >
                      {f.dirty && (
                        <span style={{ color: "var(--accent-bg)", marginRight: "2px" }}>●</span>
                      )}
                      {f.path.split("/").pop()}
                    </button>
                    <button
                      onClick={() => handleTabClose(f.path)}
                      title="Close tab"
                      style={{
                        background: "none", border: "none", color: "var(--text-dim)",
                        cursor: "pointer", padding: "1px", fontSize: "10px",
                        opacity: 0.5, lineHeight: 1, flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              title="Close"
              style={{
                background: "none", border: "none", color: "var(--text-secondary)",
                cursor: "pointer", padding: "2px 5px", fontSize: "15px",
                borderRadius: "var(--radius-sm)", flexShrink: 0, lineHeight: 1,
              }}
              type="button"
            >
              ✕
            </button>
          </div>

          {/* Error */}
          {error && (
            <div style={{ padding: "4px 14px", fontSize: "10px", color: "var(--error)", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid var(--tool-border)" }}>
              {error}
            </div>
          )}

          {/* Active editor */}
          {activeFile ? (
            <>
              {/* Editor toolbar */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px",
                padding: "3px 10px", fontSize: "10px", color: "var(--text-dim)",
                borderBottom: "1px solid var(--border)",
              }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                  {activeFile.path}
                </span>

                {/* Raw / Rendered toggle */}
                <div style={{
                  display: "flex", gap: "1px",
                  background: "var(--bg-glass)", borderRadius: "var(--radius-sm)",
                  padding: "1px", flexShrink: 0,
                }}>
                  <button
                    onClick={() => setEditorMode("raw")}
                    style={{
                      background: editorMode === "raw" ? "var(--bg-solid)" : "transparent",
                      border: "none", cursor: "pointer",
                      color: editorMode === "raw" ? "var(--text-primary)" : "var(--text-dim)",
                      fontSize: "10px", fontWeight: 600,
                      padding: "2px 8px", borderRadius: "var(--radius-sm)",
                    }}
                    type="button"
                  >
                    Raw
                  </button>
                  <button
                    onClick={() => setEditorMode("rendered")}
                    style={{
                      background: editorMode === "rendered" ? "var(--bg-solid)" : "transparent",
                      border: "none", cursor: "pointer",
                      color: editorMode === "rendered" ? "var(--text-primary)" : "var(--text-dim)",
                      fontSize: "10px", fontWeight: 600,
                      padding: "2px 8px", borderRadius: "var(--radius-sm)",
                    }}
                    type="button"
                  >
                    Rendered
                  </button>
                </div>

                {/* Word wrap toggle */}
                {editorMode === "raw" && (
                  <button
                    onClick={() => setWordWrap((w) => !w)}
                    title="Toggle word wrap"
                    style={{
                      padding: "2px 6px", fontSize: "9px", fontWeight: 600,
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      background: wordWrap ? "var(--accent-bg)" : "transparent",
                      color: wordWrap ? "var(--accent-text)" : "var(--text-dim)",
                      cursor: "pointer", flexShrink: 0,
                    }}
                    type="button"
                  >
                    WRAP
                  </button>
                )}

                <button
                  onClick={handleSave}
                  disabled={!activeFile.dirty || activeFile.saving}
                  style={{
                    padding: "2px 8px", fontSize: "10px", fontWeight: 600, flexShrink: 0,
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    background: activeFile.dirty ? "var(--accent-bg)" : "transparent",
                    color: activeFile.dirty ? "var(--accent-text)" : "var(--text-dim)",
                    cursor: activeFile.dirty && !activeFile.saving ? "pointer" : "default",
                  }}
                  type="button"
                >
                  {activeFile.saving ? "Saving…" : activeFile.dirty ? "Save" : "Saved"}
                </button>
              </div>

              {editorMode === "raw" ? (
                <CodeMirrorEditor
                  key={`editor-${activeFile.path}`}
                  value={activeFile.content}
                  onChange={(val) => handleContentChange(val)}
                  onSave={handleSave}
                  fileName={activeFile.path.split("/").pop() ?? activeFile.path}
                  wordWrap={wordWrap}
                />
              ) : (
                <RenderedView
                  content={activeFile.content}
                  fileName={activeFile.path.split("/").pop() ?? activeFile.path}
                />
              )}
            </>
          ) : (
            <div style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "12px", color: "var(--text-dim)",
            }}>
              No file selected
            </div>
          )}
        </>
      )}
    </div>
  );
}
