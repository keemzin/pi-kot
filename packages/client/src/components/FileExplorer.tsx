import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

interface Props {
  projectId: string;
  onClose: () => void;
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

type View = "tree" | "editor";

export function FileExplorer({ projectId, onClose }: Props) {
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
  const [view, setView] = useState<View>("tree");
  const [panelWidth, setPanelWidth] = useState(520);
  const [resizing, setResizing] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const createRef = useRef<HTMLInputElement>(null);

  // Resize logic
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startW = panelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newW = Math.min(Math.max(startW + delta, 280), window.innerWidth * 0.85);
      setPanelWidth(newW);
    };
    const onMouseUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [panelWidth]);

  const loadTree = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/v1/files/tree?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error(`tree ${res.status}`);
      const data = (await res.json()) as { children?: TreeNode[] };
      setTree(data.children ?? []);
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
      const res = await fetch(
        `/api/v1/files/read?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
      );
      if (!res.ok) throw new Error(`read ${res.status}`);
      const data = (await res.json()) as { content: string; language: string; binary: boolean };
      const content = data.binary ? "(binary file)" : data.content ?? "";
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === path
            ? { ...f, content, saved: content, language: data.language, dirty: false }
            : f,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "read failed");
      setOpenFiles((prev) => prev.filter((f) => f.path !== path));
      if (activePath === path) setActivePath(undefined);
      setView("tree");
    }
  }, [openFiles, activePath, projectId]);

  const handleTabClose = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const remaining = prev.filter((f) => f.path !== path);
      return remaining;
    });
    setActivePath((prev) => {
      if (prev !== path) return prev;
      const remaining = openFiles.filter((f) => f.path !== path);
      if (remaining.length > 0) return remaining[remaining.length - 1].path;
      return undefined;
    });
  }, [openFiles]);

  const handleSave = async () => {
    if (!activePath) return;
    const file = openFiles.find((f) => f.path === activePath);
    if (!file || file.saving) return;

    setOpenFiles((prev) => prev.map((f) => (f.path === activePath ? { ...f, saving: true } : f)));
    setError(undefined);
    try {
      const res = await fetch("/api/v1/files/write", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, path: activePath, content: file.content }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `save failed (${res.status})`);
      }
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === activePath ? { ...f, dirty: false, saved: f.content, saving: false } : f,
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
      const res = await fetch("/api/v1/files/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, path: oldPath, name }),
      });
      if (!res.ok) throw new Error(`rename failed`);
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
        const res = await fetch("/api/v1/files/mkdir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, parentPath: parent, name }),
        });
        if (!res.ok) throw new Error(`mkdir failed`);
      } else {
        const path = createParent ? `${createParent}/${name}` : `/${name}`;
        const res = await fetch("/api/v1/files/write", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, path, content: "" }),
        });
        if (!res.ok) throw new Error(`create failed`);
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
      const res = await fetch(
        `/api/v1/files/delete?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&recursive=true`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`delete failed`);
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
            <div style={{ display: "flex", gap: "1px", opacity: 0, flexShrink: 0 }} className="file-row-actions">
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

  const baseOverlayStyle: React.CSSProperties = {
    position: "fixed",
    top: 52,
    bottom: 0,
    right: 0,
    zIndex: 100,
    width: Math.min(panelWidth, window.innerWidth * 0.85),
    background: "var(--bg-solid)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.3)",
    transition: resizing ? "none" : "width 0.15s ease",
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 99 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.35)" }} />

      {/* Overlay panel */}
      <div style={baseOverlayStyle}>
        {/* Resize handle */}
        <div
          onMouseDown={startResize}
          style={{
            position: "absolute", left: 0, top: 0, bottom: 0, width: "5px",
            cursor: "ew-resize", zIndex: 10,
          }}
          title="Drag to resize"
        />

        {/* ── VIEW: Tree ── */}
        {view === "tree" && (
          <>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 14px", borderBottom: "1px solid var(--border)",
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
              <div style={{ padding: "4px 14px", fontSize: "10px", color: "var(--error)", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid var(--tool-border)" }}>
                {error}
              </div>
            )}

            {/* Search */}
            <div style={{ padding: "6px 10px" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files..."
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

            {/* Tree */}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 0", fontSize: "12px" }}>
              {loading && tree.length === 0 && (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "12px" }}>Loading...</div>
              )}
              {!loading && filteredTree.length === 0 && (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "12px" }}>
                  {search ? "No files match search" : "No files"}
                </div>
              )}
              {filteredTree.map((node) => renderNode(node, 0))}
            </div>
          </>
        )}

        {/* ── VIEW: Editor ── */}
        {view === "editor" && (
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
                        type="button"
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
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "4px 10px", fontSize: "10px", color: "var(--text-dim)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {activeFile.path}
                  </span>
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
                <textarea
                  value={activeFile.content}
                  onChange={(e) => handleContentChange(e.target.value)}
                  spellCheck={false}
                  style={{
                    flex: 1, width: "100%", resize: "none",
                    background: "var(--bg-solid)", padding: "10px",
                    fontSize: "13px", fontFamily: "var(--font-mono)",
                    color: "var(--text-primary)", border: "none", outline: "none",
                    lineHeight: 1.5, minHeight: 0,
                  }}
                />
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
    </div>
  );
}
