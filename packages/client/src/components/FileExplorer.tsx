import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CodeMirrorEditor } from "./CodeMirrorEditor";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { GitPanel } from "./GitPanel";
import { SystemPromptTab } from "./SystemPromptTab";
import { ConfirmDialog } from "./Modal";
import { FileEditor } from "./FileEditor";
import { filesTree, filesRead, filesWrite, filesRename, filesMkdir, filesDelete, filesMove, filesSearch, filesUpload, filesDownload } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";
import { useLayoutStore } from "../stores/layout-store";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

// ─── Web FileSystem helpers for folder drag-and-drop ───
// Uses DataTransferItem.webkitGetAsEntry() → FileSystemDirectoryEntry → FileSystemFileEntry
// to recursively read directory contents from OS drag-and-drop.
// Works in Chrome/Edge/Safari. Firefox has partial support.

type FileSystemEntryLike = { name: string; isFile: boolean; isDirectory: boolean };
type FileSystemFileEntryLike = FileSystemEntryLike & {
  isFile: true;
  file: (success: (file: File) => void, failure?: (err: DOMException) => void) => void;
};
type FileSystemDirectoryEntryLike = FileSystemEntryLike & {
  isDirectory: true;
  createReader: () => { readEntries: (cb: (entries: FileSystemEntryLike[]) => void) => void };
};

function getDataTransferEntry(item: DataTransferItem): FileSystemEntryLike | null {
  const withEntry = item as unknown as { webkitGetAsEntry?: () => FileSystemEntryLike | null };
  return withEntry.webkitGetAsEntry?.() ?? null;
}

function withUploadRelativePath(file: File, relativePath: string): File {
  const uploadFile = file as File & { uploadRelativePath?: string };
  uploadFile.uploadRelativePath = relativePath;
  return uploadFile;
}

async function collectEntryFiles(
  entry: FileSystemEntryLike,
  relativePath: string,
  out: File[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntryLike).file(resolve, reject);
    });
    out.push(withUploadRelativePath(file, relativePath));
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntryLike).createReader();
  const children = await new Promise<FileSystemEntryLike[]>((resolve) => {
    reader.readEntries(resolve);
  });
  await Promise.all(
    children.map((child) => collectEntryFiles(child, `${relativePath}/${child.name}`, out)),
  );
}

async function collectDroppedUploadFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => getDataTransferEntry(item))
    .filter((entry): entry is FileSystemEntryLike => entry !== null);
  if (entries.length === 0) {
    // Fallback: plain file drag (no directory entries)
    return Array.from(dataTransfer.files).map((file) => withUploadRelativePath(file, file.name));
  }
  const files: File[] = [];
  for (const entry of entries) {
    await collectEntryFiles(entry, entry.name, files);
  }
  return files;
}

export type ExplorerTab = "files" | "git" | "system-prompt";

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
  initialTab?: ExplorerTab;
  /** When true, uses flex-flow width transition and delegates
   *  file editing to a separate FileViewerPanel. */
  flexLayout?: boolean;
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

/** When true, the editor view is delegated to FileViewerPanel
 *  and clicking a file opens it in the separate viewer. */
const USE_FLEX_LAYOUT = true;

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

export function FileExplorer({ projectId, open, onClose, initialTab, flexLayout = USE_FLEX_LAYOUT }: Props) {
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

  const openFileViewer = useLayoutStore((s) => s.openFileViewer);

  // Sync initialTab changes (e.g. when header git button clicked while panel is open)
  useEffect(() => {
    if (initialTab !== undefined && initialTab !== tab) {
      setTab(initialTab);
      if (initialTab === "files") setView("tree");
    }
  }, [initialTab]);
  const [pendingCloseTab, setPendingCloseTab] = useState<string | undefined>(undefined);
  // ── Context menu for right-click / long-press ──
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: TreeNode;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadFolderRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dropTargetFolder, setDropTargetFolder] = useState<string | undefined>(undefined);
  const dragOverFolder = useRef<string | undefined>(undefined);
  const projectPath = useSessionStore((s) =>
    s.projects.find((p) => p.id === projectId)?.path ?? "",
  );

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

  // ── Close context menu on click outside / Escape ──
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    // Delay adding listener to avoid the same click that opened the menu from closing it
    const raf = requestAnimationFrame(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    });
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // ── Clipboard helpers ──
  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setError(undefined);
    } catch {
      // Fallback for insecure contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }, []);

  const handleCopyRelativePath = useCallback((path: string) => {
    copyToClipboard(path, "Relative path");
    setContextMenu(null);
  }, [copyToClipboard]);

  const handleCopyAbsolutePath = useCallback((path: string) => {
    const abs = projectPath ? `${projectPath}/${path}`.replace(/\/$/, "") : path;
    copyToClipboard(abs, "Absolute path");
    setContextMenu(null);
  }, [projectPath, copyToClipboard]);

  // ── Context menu handlers ──
  const showContextMenu = useCallback((e: React.MouseEvent | { clientX: number; clientY: number }, node: TreeNode) => {
    const panel = document.querySelector(".file-explorer-panel");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    // Clamp to panel bounds
    const x = Math.min(e.clientX - rect.left, rect.width - 180);
    const y = Math.min(e.clientY - rect.top, rect.height - 120);
    setContextMenu({ x: Math.max(4, x), y: Math.max(4, y), node });
  }, []);

  const handleRowContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e, node);
  }, [showContextMenu]);

  const handleTouchStart = useCallback((e: React.TouchEvent, node: TreeNode) => {
    const touch = e.touches[0];
    longPressPos.current = { x: touch.clientX, y: touch.clientY };
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = undefined;
      showContextMenu({ clientX: touch.clientX, clientY: touch.clientY }, node);
    }, 500);
  }, [showContextMenu]);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
  }, []);

  const handleTouchMove = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = undefined;
    }
  }, []);

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

  /**
   * Upload files into a project folder. `parentPath` is project-relative
   * ("" for root, "src" for src/, "src/components" for nested).
   * Files with `uploadRelativePath` (Web FileSystem API from drag-and-drop)
   * or `webkitRelativePath` (folder picker) have their sub-path
   * preserved automatically via the `path:<index>` field.
   */
  const handleUpload = useCallback(async (files: File[] | null, parentPath?: string) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(undefined);
    try {
      const fileArray = Array.from(files);
      await filesUpload(projectId, parentPath ?? "", fileArray);
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  }, [projectId, loadTree]);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    if (showCreate) createRef.current?.focus();
  }, [showCreate]);
  useEffect(() => {
    if (renaming !== undefined) renameRef.current?.focus();
  }, [renaming]);

  const openFile = useCallback(async (path: string) => {
    if (flexLayout) {
      // In flex mode, delegate file viewing to the separate FileViewerPanel
      const name = path.split("/").pop() || path;
      openFileViewer(path, name);
      return;
    }

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
      const raw = data.binary ? "(binary file)" : data.content ?? "";
      // CM6 always terminates documents with \n — normalize so the
      // onChange callback doesn't fire on first render and mark a
      // freshly opened file as dirty (same fix as FileViewerPanel).
      const content = raw === "" || raw.endsWith("\n") ? raw : raw + "\n";
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
    // Check if file is dirty before closing
    const file = openFiles.find((f) => f.path === path);
    if (file?.dirty) {
      setPendingCloseTab(path);
      return;
    }

    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    setActivePath((prev) => {
      if (prev !== path) return prev;
      const remaining = openFiles.filter((f) => f.path !== path);
      return remaining.length > 0 ? remaining[remaining.length - 1].path : undefined;
    });
  }, [openFiles]);

  const confirmTabClose = useCallback((path: string) => {
    setOpenFiles((prev) => prev.filter((f) => f.path !== path));
    setActivePath((prev) => {
      if (prev !== path) return prev;
      const remaining = openFiles.filter((f) => f.path !== path);
      return remaining.length > 0 ? remaining[remaining.length - 1].path : undefined;
    });
    setPendingCloseTab(undefined);
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
    const isDropTarget = isDir && dropTargetFolder === node.path;

    return (
      <div key={node.path}>
        <div
          onContextMenu={(e) => handleRowContextMenu(e, node)}
          onTouchStart={(e) => handleTouchStart(e, node)}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData("application/x-pi-path", node.path);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={isDir ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            const hasPiPath = e.dataTransfer.types.includes("application/x-pi-path");
            e.dataTransfer.dropEffect = hasPiPath ? "move" : "copy";
            dragOverFolder.current = node.path;
            setDropTargetFolder(node.path);
          } : undefined}
          onDragLeave={isDir ? () => {
            if (dragOverFolder.current === node.path) {
              dragOverFolder.current = undefined;
              setDropTargetFolder(undefined);
            }
          } : undefined}
          onDrop={isDir ? async (e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTargetFolder(undefined);
            dragOverFolder.current = undefined;

            // Unified drop handler: check for in-app drag (move) first,
            // then fall back to OS file drag (upload).
            const src = e.dataTransfer.getData("application/x-pi-path");
            if (src.length > 0) {
              // In-app drag → MOVE
              if (src === node.path) return;  // same dir = no-op
              if (node.path.startsWith(`${src}/`)) return;  // refuse descendant
              const name = src.split("/").pop() ?? "";
              const dest = `${node.path}/${name}`;
              try {
                await filesMove(projectId, src, dest);
                await loadTree();
              } catch {
                // error rendered via store/error slot
              }
              return;
            }

            // OS file drag → UPLOAD
            const files = await collectDroppedUploadFiles(e.dataTransfer);
            if (files.length > 0) await handleUpload(files, node.path);
          } : undefined}
          style={{
            display: "flex", alignItems: "center", gap: "2px",
            padding: "2px 0", paddingLeft: `${8 + depth * 16}px`,
            position: "relative",
            outline: isDropTarget ? "1px solid var(--accent)" : undefined,
            outlineOffset: "-1px",
            borderRadius: "2px",
          }}
          className={`file-tree-row${contextMenu?.node.path === node.path ? " file-tree-row-active" : ""}${isDropTarget ? " file-tree-row-drop-target" : ""}`}
          draggable={true}
        >
          {isDir ? (
            <button
              onClick={() => toggleFolder(node.path)}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", width: "20px", height: "20px", flexShrink: 0, color: "var(--accent)" }}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", flexShrink: 0, color: "var(--text-dim)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </span>
          )}

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
                color: "var(--text-primary)", cursor: "pointer", fontSize: "12px",
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
            <div style={{ display: "flex", gap: "1px", flexShrink: 0 }} className="file-row-actions">
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

  // Flex layout: use width transition instead of translateX
  const outStyle: React.CSSProperties = flexLayout ? {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    width: open ? panelWidth : 0,
    minWidth: open ? MIN_EXPLORER_WIDTH : 0,
    flexShrink: 0,
    overflow: "hidden",
    background: "var(--bg-solid)",
    borderLeft: open ? "1px solid var(--border)" : "none",
    transition: "width 0.2s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
    willChange: "width",
    userSelect: resizeRef.current !== undefined ? "none" : undefined,
    position: "relative",
    paddingTop: "50px",
  } : {
    position: "fixed",
    top: 50,
    right: 0,
    bottom: 0,
    zIndex: 120,
    background: "var(--bg-solid)",
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    width: panelWidth,
    transform: open ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.18s ease",
    willChange: "transform",
    userSelect: resizeRef.current !== undefined ? "none" : undefined,
  };

  return (
    <div
      className="file-explorer-panel"
      style={outStyle}
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
        <button
          onClick={() => setTab("system-prompt")}
          style={{
            flex: 1, padding: "11px 12px", fontSize: "13px", fontWeight: 600,
            background: tab === "system-prompt" ? "var(--bg-solid)" : "transparent",
            color: tab === "system-prompt" ? "var(--accent-text)" : "var(--text-dim)",
            border: "none", borderBottom: tab === "system-prompt" ? "2px solid var(--accent-text)" : "2px solid transparent",
            cursor: "pointer", transition: "all 0.12s ease",
          }}
          type="button"
        >
          ✦ Prompt
        </button>

      </div>

      {/* ── Git tab ── */}
      {tab === "git" && (
        <GitPanel projectId={projectId} />
      )}

      {/* ── System Prompt tab ── */}
      {tab === "system-prompt" && (
        <SystemPromptTab projectId={projectId} />
      )}

      {/* ── Files tab ── */}
      {tab === "files" && view === "tree" && (
        <>
          {/* Hidden file inputs for upload */}
          <input
            ref={uploadRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => { handleUpload(e.target.files ? Array.from(e.target.files) : null); e.target.value = ""; }}
          />
          <input
            ref={uploadFolderRef}
            type="file"
            /* @ts-ignore — webkitdirectory is a webkit extension but works in all major browsers */
            webkitdirectory
            style={{ display: "none" }}
            onChange={(e) => { handleUpload(e.target.files ? Array.from(e.target.files) : null); e.target.value = ""; }}
          />

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
              <button onClick={() => uploadRef.current?.click()} title="Upload files" disabled={uploading} style={{ background: "none", border: "none", color: uploading ? "var(--text-dim)" : "var(--text-secondary)", cursor: uploading ? "default" : "pointer", padding: "2px 5px", fontSize: "13px", borderRadius: "var(--radius-sm)" }} type="button">{uploading ? "⏳" : "↑"}</button>
              <button onClick={() => uploadFolderRef.current?.click()} title="Upload folder" disabled={uploading} style={{ background: "none", border: "none", color: uploading ? "var(--text-dim)" : "var(--text-secondary)", cursor: uploading ? "default" : "pointer", padding: "2px 5px", fontSize: "13px", borderRadius: "var(--radius-sm)" }} type="button">{uploading ? "⏳" : "📁↑"}</button>
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

          {/* Drag-drop overlay hint */}
          {uploading && (
            <div style={{
              position: "absolute", inset: 0, zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--bg-glass)",
              fontSize: "13px", color: "var(--accent-text)",
            }}>
              Uploading…
            </div>
          )}

          {/* Tree + content search results */}
          <div
            style={{ flex: 1, overflowY: "auto", padding: "4px 0", fontSize: "12px", position: "relative" }}
            onDragOver={(e) => {
              e.preventDefault();
              // Set dropEffect based on drag source: in-app drags use "move",
              // OS drags (files, folders from desktop) use "copy".
              const hasCustomMime = e.dataTransfer.types.includes("application/x-pi-path");
              e.dataTransfer.dropEffect = hasCustomMime ? "move" : "copy";
              // Capture the folder being hovered from the ref set by row-level
              // onDragOver handlers. The ref lets us read the latest value
              // without re-rendering on every dragover event.
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDropTargetFolder(undefined);

              // Unified drop handler: check for in-app drag (move) first,
              // then fall back to OS file drag (upload).
              const src = e.dataTransfer.getData("application/x-pi-path");
              if (src.length > 0) {
                // In-app drag → MOVE to project root (empty area = root)
                const name = src.split("/").pop() ?? "";
                const dest = name;  // root = no folder prefix
                try {
                  await filesMove(projectId, src, dest);
                  await loadTree();
                } catch {
                  // error rendered via store/error slot
                }
                dragOverFolder.current = undefined;
                return;
              }

              // OS file drag → UPLOAD to root (empty area = root)
              const files = await collectDroppedUploadFiles(e.dataTransfer);
              if (files.length > 0) {
                await handleUpload(files, "");  // root for container drops
                dragOverFolder.current = undefined;
              }
            }}
          >
            {loading && tree.length === 0 && (
              <div style={{ padding: "8px 12px" }}>
                <LoadingSkeleton variant="tree" count={8} />
              </div>
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
            <FileEditor
              path={activeFile.path}
              fileName={activeFile.path.split("/").pop() ?? activeFile.path}
              content={activeFile.content}
              language={activeFile.language}
              saving={activeFile.saving}
              dirty={activeFile.dirty}
              onChange={handleContentChange}
              onSave={handleSave}
              error={error}
            />
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

      {/* ── Context menu ── */}
      {contextMenu && (
        <>
          {/* Backdrop to capture clicks outside on mobile */}
          <div
            style={{
              position: "fixed", inset: 0, zIndex: 999,
              background: "transparent",
            }}
            onClick={() => setContextMenu(null)}
          />
          <div
            ref={contextMenuRef}
            style={{
              position: "absolute",
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 1000,
              minWidth: "180px",
              background: "var(--bg-solid)",
              border: "1px solid var(--border-bright)",
              borderRadius: "var(--radius-sm)",
              padding: "4px 0",
              fontSize: "12px",
              userSelect: "none",
            }}
            onClick={() => setContextMenu(null)}
          >
            {/* Header showing the file/folder name */}
            <div style={{
              padding: "4px 12px 6px",
              borderBottom: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontWeight: 600,
              fontSize: "11px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: "220px",
            }}>
              {contextMenu.node.type === "directory" ? "📁" : "📄"} {contextMenu.node.name}
            </div>

            {/* Copy Relative Path */}
            <div
              className="context-menu-item"
              onClick={(e) => { e.stopPropagation(); handleCopyRelativePath(contextMenu.node.path); }}
              style={contextMenuItemStyle}
            >
              <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>📋</span>
              <span>Copy Relative Path</span>
            </div>

            {/* Copy Absolute Path */}
            <div
              className="context-menu-item"
              onClick={(e) => { e.stopPropagation(); handleCopyAbsolutePath(contextMenu.node.path); }}
              style={contextMenuItemStyle}
            >
              <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>📎</span>
              <span>Copy Absolute Path</span>
            </div>

            {/* Download */}
            <div
              className="context-menu-item"
              onClick={async (e) => {
                e.stopPropagation();
                setContextMenu(null);
                try {
                  await filesDownload(projectId, contextMenu.node.path);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "download failed");
                }
              }}
              style={contextMenuItemStyle}
            >
              <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>⬇️</span>
              <span>{contextMenu.node.type === "directory" ? "Download as Zip" : "Download"}</span>
            </div>

            {/* Separator */}
            <div style={{ height: "1px", background: "var(--border)", margin: "4px 0" }} />

            {/* New File (directories only) */}
            {contextMenu.node.type === "directory" && (
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  setCreateParent(contextMenu.node.path);
                  setShowCreate("file");
                  setCreateName("");
                }}
                style={contextMenuItemStyle}
              >
                <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>📄</span>
                <span>New File</span>
              </div>
            )}

            {/* New Folder (directories only) */}
            {contextMenu.node.type === "directory" && (
              <div
                className="context-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenu(null);
                  setCreateParent(contextMenu.node.path);
                  setShowCreate("folder");
                  setCreateName("");
                }}
                style={contextMenuItemStyle}
              >
                <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>📁</span>
                <span>New Folder</span>
              </div>
            )}

            {/* Rename */}
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu(null);
                setRenaming(contextMenu.node.path);
                setRenameDraft(contextMenu.node.name);
                setTimeout(() => renameRef.current?.focus(), 50);
              }}
              style={contextMenuItemStyle}
            >
              <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>✏️</span>
              <span>Rename</span>
            </div>

            {/* Delete */}
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu(null);
                setConfirmDelete(contextMenu.node.path);
              }}
              style={{
                ...contextMenuItemStyle,
                color: "var(--error)",
              }}
            >
              <span style={{ width: "16px", textAlign: "center", flexShrink: 0 }}>🗑</span>
              <span>Delete</span>
            </div>
          </div>
        </>
      )}

      {/* ── Unsaved changes confirmation dialog ── */}
      <ConfirmDialog
        open={pendingCloseTab !== undefined}
        onClose={() => setPendingCloseTab(undefined)}
        onConfirm={() => {
          if (pendingCloseTab) confirmTabClose(pendingCloseTab);
        }}
        title="Unsaved changes"
        message={`Close "${pendingCloseTab?.split("/").pop() ?? ""}"? Unsaved changes will be lost.`}
        primaryLabel="Discard & close"
        tone="danger"
      />
    </div>
  );
}

const contextMenuItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  padding: "6px 12px",
  cursor: "pointer",
  color: "var(--text-secondary)",
  transition: "background 0.1s ease",
};
