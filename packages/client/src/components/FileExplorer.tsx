import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { GitPanel } from "./GitPanel";
import { SystemPromptTab } from "./SystemPromptTab";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { filesTree, filesWrite, filesRename, filesMkdir, filesDelete, filesBatchDelete, filesBatchMove, filesMove, filesSearch, filesUpload, filesDownload } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";
import { useLayoutStore } from "../stores/layout-store";
import { getFileTypeIcon } from "./FileIcon";

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

export type ExplorerTab = "files" | "git" | "artifacts" | "system-prompt";

interface Props {
  projectId: string;
  open: boolean;
  onClose: () => void;
  initialTab?: ExplorerTab;
  /** When true, uses flex-flow width transition instead of translateX overlay. */
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

const DEFAULT_EXPLORER_WIDTH = 360;
const MIN_EXPLORER_WIDTH = 220;
const MAX_EXPLORER_WIDTH = 800;

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
  const [tab, setTab] = useState<ExplorerTab>(initialTab ?? "files");

  // ── Multi-select & Batch Delete ──
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);

  useEffect(() => {
    setSelectedPaths(new Set());
    setLastSelectedPath(null);
    setSelectMode(false);
  }, [projectId]);

  const openFileViewer = useLayoutStore((s) => s.openFileViewer);

  // Sync initialTab changes (e.g. when header git button clicked while panel is open)
  useEffect(() => {
    if (initialTab !== undefined && initialTab !== tab) {
      setTab(initialTab);
    }
  }, [initialTab]);
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
    if (!selectedPaths.has(node.path)) {
      setSelectedPaths(new Set([node.path]));
      setLastSelectedPath(node.path);
    }
    showContextMenu(e, node);
  }, [showContextMenu, selectedPaths]);

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
    const name = path.split("/").pop() || path;
    openFileViewer(path, name);
    // In overlay mode (mobile), close the explorer so it doesn't float
    // on top of the full-screen viewer. In flex mode (desktop), keep
    // the tree open alongside the viewer.
    if (!flexLayout) onClose();
  }, [openFileViewer, flexLayout, onClose]);



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

  // Flattened visible nodes in current tree order (accounting for search & expanded folders)
  const flattenedVisibleNodes = useMemo(() => {
    const list: TreeNode[] = [];
    const traverse = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        list.push(n);
        if (n.type === "directory" && expanded.has(n.path) && n.children) {
          traverse(n.children);
        }
      }
    };
    traverse(filteredTree);
    return list;
  }, [filteredTree, expanded]);

  const handleToggleSelect = useCallback((path: string, isShift: boolean, isMulti: boolean) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (isShift && lastSelectedPath) {
        const idx1 = flattenedVisibleNodes.findIndex((n) => n.path === lastSelectedPath);
        const idx2 = flattenedVisibleNodes.findIndex((n) => n.path === path);
        if (idx1 !== -1 && idx2 !== -1) {
          const start = Math.min(idx1, idx2);
          const end = Math.max(idx1, idx2);
          for (let i = start; i <= end; i++) {
            next.add(flattenedVisibleNodes[i].path);
          }
          return next;
        }
      }
      if (next.has(path)) {
        next.delete(path);
        if (lastSelectedPath === path) setLastSelectedPath(null);
      } else {
        next.add(path);
        setLastSelectedPath(path);
      }
      return next;
    });
  }, [flattenedVisibleNodes, lastSelectedPath]);

  const selectAllVisible = useCallback(() => {
    setSelectedPaths(new Set(flattenedVisibleNodes.map((n) => n.path)));
  }, [flattenedVisibleNodes]);

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setLastSelectedPath(null);
  }, []);

  const handleBatchDelete = async () => {
    if (selectedPaths.size === 0) return;
    setBatchDeleting(true);
    setError(undefined);
    try {
      const paths = Array.from(selectedPaths);
      const res = await filesBatchDelete(projectId, paths, { recursive: true });
      setSelectedPaths(new Set());
      setLastSelectedPath(null);
      setConfirmBatchDelete(false);
      await loadTree();
      if (res.errors && Object.keys(res.errors).length > 0) {
        const errList = Object.entries(res.errors).map(([p, msg]) => `${p}: ${msg}`).join(", ");
        setError(`Deleted ${res.deleted.length} items. Errors: ${errList}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "batch delete failed");
    } finally {
      setBatchDeleting(false);
    }
  };

  const handleMoveEntries = useCallback(async (srcPaths: string[], targetDir: string) => {
    // Filter out invalid moves
    const validMoves: Array<{ src: string; dest: string }> = [];
    for (const src of srcPaths) {
      if (src === targetDir) continue; // cannot move into itself
      if (targetDir && (targetDir === src || targetDir.startsWith(`${src}/`))) continue; // cannot move into descendant
      const parent = src.includes("/") ? src.slice(0, src.lastIndexOf("/")) : "";
      if (parent === targetDir) continue; // already in target folder
      const name = src.split("/").pop() ?? "";
      const dest = targetDir ? `${targetDir}/${name}` : name;
      if (src === dest) continue;
      validMoves.push({ src, dest });
    }

    if (validMoves.length === 0) return;

    setError(undefined);
    try {
      let errors: Record<string, string> | undefined;
      try {
        const res = await filesBatchMove(projectId, validMoves);
        errors = res.errors;
      } catch {
        // Fallback to individual filesMove if batch endpoint is not available
        const results = await Promise.allSettled(
          validMoves.map((m) => filesMove(projectId, m.src, m.dest)),
        );
        const errMap: Record<string, string> = {};
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            errMap[validMoves[idx].src] = r.reason instanceof Error ? r.reason.message : "Move failed";
          }
        });
        if (Object.keys(errMap).length > 0) errors = errMap;
      }

      if (errors && Object.keys(errors).length > 0) {
        const errList = Object.entries(errors).map(([p, msg]) => `${p}: ${msg}`).join(", ");
        setError(`Moved with errors: ${errList}`);
      }
      setSelectedPaths(new Set());
      setLastSelectedPath(null);
      await loadTree();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Move failed");
    }
  }, [projectId, loadTree]);

  // Keyboard shortcuts: Delete/Backspace to delete selected, Ctrl+A to select all, Escape to cancel
  useEffect(() => {
    if (tab !== "files" || !open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedPaths.size > 0) {
          e.preventDefault();
          setConfirmBatchDelete(true);
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        selectAllVisible();
      } else if (e.key === "Escape") {
        if (confirmBatchDelete) {
          setConfirmBatchDelete(false);
        } else if (selectedPaths.size > 0) {
          clearSelection();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tab, open, selectedPaths, confirmBatchDelete, selectAllVisible, clearSelection]);

  // ---- Tree node renderer ----
  const renderNode = (node: TreeNode, depth: number) => {
    const isExpanded = expanded.has(node.path);
    const isDir = node.type === "directory";
    const isRenaming = renaming === node.path;
    const isDropTarget = isDir && dropTargetFolder === node.path;
    const isSelected = selectedPaths.has(node.path);
    const showCheckboxes = selectMode || selectedPaths.size > 0;

    return (
      <div key={node.path}>
        <div
          onContextMenu={(e) => handleRowContextMenu(e, node)}
          onTouchStart={(e) => handleTouchStart(e, node)}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onClick={(e) => {
            if (isRenaming) return;
            if (e.ctrlKey || e.metaKey) {
              handleToggleSelect(node.path, false, true);
            } else if (e.shiftKey) {
              handleToggleSelect(node.path, true, false);
            } else if (selectMode) {
              handleToggleSelect(node.path, false, true);
            }
          }}
          onDragStart={(e) => {
            e.stopPropagation();
            const pathsToMove = selectedPaths.has(node.path) && selectedPaths.size > 0
              ? Array.from(selectedPaths)
              : [node.path];

            e.dataTransfer.setData("application/x-pi-paths", JSON.stringify(pathsToMove));
            e.dataTransfer.setData("application/x-pi-path", node.path);
            e.dataTransfer.effectAllowed = "move";

            // Visual badge when dragging multiple files
            if (pathsToMove.length > 1) {
              const badge = document.createElement("div");
              badge.style.position = "absolute";
              badge.style.top = "-9999px";
              badge.style.left = "-9999px";
              badge.style.background = "var(--accent, #6366f1)";
              badge.style.color = "#ffffff";
              badge.style.padding = "4px 10px";
              badge.style.borderRadius = "12px";
              badge.style.fontSize = "12px";
              badge.style.fontWeight = "600";
              badge.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
              badge.style.pointerEvents = "none";
              badge.textContent = `Moving ${pathsToMove.length} items`;
              document.body.appendChild(badge);
              e.dataTransfer.setDragImage(badge, 20, 15);
              setTimeout(() => {
                if (document.body.contains(badge)) document.body.removeChild(badge);
              }, 0);
            }
          }}
          onDragOver={isDir ? (e) => {
            e.preventDefault();
            e.stopPropagation();
            const hasPiPath = e.dataTransfer.types.includes("application/x-pi-path") || e.dataTransfer.types.includes("application/x-pi-paths");
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
            const rawPaths = e.dataTransfer.getData("application/x-pi-paths");
            const singleSrc = e.dataTransfer.getData("application/x-pi-path");
            let paths: string[] = [];
            if (rawPaths) {
              try {
                paths = JSON.parse(rawPaths);
              } catch {
                paths = singleSrc ? [singleSrc] : [];
              }
            } else if (singleSrc) {
              paths = [singleSrc];
            }

            if (paths.length > 0) {
              await handleMoveEntries(paths, node.path);
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
          className={`file-tree-row${isSelected ? " file-tree-row-selected" : ""}${contextMenu?.node.path === node.path ? " file-tree-row-active" : ""}${isDropTarget ? " file-tree-row-drop-target" : ""}`}
          draggable={true}
        >
          {showCheckboxes && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => {
                e.stopPropagation();
                handleToggleSelect(node.path, false, true);
              }}
              onClick={(e) => e.stopPropagation()}
              className="file-tree-checkbox"
              title="Select"
            />
          )}

          {isDir ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleFolder(node.path);
              }}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", padding: "2px", width: "20px", height: "20px", flexShrink: 0, color: "var(--accent)" }}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "20px", height: "20px", flexShrink: 0 }}>
              {getFileTypeIcon(node.name, 15)}
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
              onClick={(e) => {
                if (e.ctrlKey || e.metaKey) {
                  e.stopPropagation();
                  handleToggleSelect(node.path, false, true);
                } else if (e.shiftKey) {
                  e.stopPropagation();
                  handleToggleSelect(node.path, true, false);
                } else if (selectMode) {
                  e.stopPropagation();
                  handleToggleSelect(node.path, false, true);
                } else {
                  if (selectedPaths.size > 0) {
                    clearSelection();
                  }
                  if (isDir) toggleFolder(node.path);
                  else openFile(node.path);
                }
              }}
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
                  onClick={(e) => { e.stopPropagation(); setCreateParent(node.path); setShowCreate("file"); setCreateName(""); }}
                  title="New file in this folder"
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 3px", fontSize: "11px", color: "var(--text-dim)" }} type="button"
                >+</button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setRenaming(node.path); setRenameDraft(node.name); setTimeout(() => renameRef.current?.focus(), 50); }}
                title="Rename"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 3px", fontSize: "11px", color: "var(--text-dim)" }} type="button"
              >✏️</button>
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDelete(node.path); }}
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
        alignItems: "center", padding: "0 6px", gap: "2px",
        height: "38px", minHeight: "38px", boxSizing: "border-box",
      }}>
        {(
          [
            { key: "files",         label: "Files",    icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>, onClick: () => { setTab("files"); } },
            { key: "git",           label: "Git",      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>, onClick: () => setTab("git") },
            { key: "artifacts",     label: "Artifacts",icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>, onClick: () => setTab("artifacts") },
          ] as { key: string; label: string; icon: React.ReactNode; onClick: () => void }[]
        ).map(({ key, label, icon, onClick }) => (
          <button
            key={key}
            onClick={onClick}
            title={label}
            type="button"
            className={`fe-tab-btn${tab === key ? " active" : ""}`}
          >
            {icon}
            <span className="fe-tab-label">{label}</span>
          </button>
        ))}

        {/* When in Files tab: action icons integrated directly into the tab bar */}
        {tab === "files" && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1px" }}>
            {/* Multi-select toggle */}
            <button
              onClick={() => {
                const next = !selectMode;
                setSelectMode(next);
                if (!next) {
                  clearSelection();
                }
              }}
              title={selectMode ? "Exit selection mode" : "Select multiple files"}
              className={`fe-toolbar-btn${selectMode ? " fe-toolbar-btn-active" : ""}`}
              style={selectMode ? { color: "var(--accent)", background: "var(--accent-subtle)" } : undefined}
              type="button"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </button>

            {/* Upload files */}
            <button onClick={() => uploadRef.current?.click()} title="Upload files" disabled={uploading} className="fe-toolbar-btn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </button>

            {/* Upload folder */}
            <button onClick={() => uploadFolderRef.current?.click()} title="Upload folder" disabled={uploading} className="fe-toolbar-btn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <polyline points="12 11 12 17"/>
                <polyline points="9 14 12 11 15 14"/>
              </svg>
            </button>

            {/* New file */}
            <button onClick={() => { setCreateParent(""); setShowCreate("file"); setCreateName(""); }} title="New file" className="fe-toolbar-btn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="12" y1="18" x2="12" y2="12"/>
                <line x1="9" y1="15" x2="15" y2="15"/>
              </svg>
            </button>

            {/* New folder */}
            <button onClick={() => { setCreateParent(""); setShowCreate("folder"); setCreateName(""); }} title="New folder" className="fe-toolbar-btn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="12" y1="11" x2="12" y2="17"/>
                <line x1="9" y1="14" x2="15" y2="14"/>
              </svg>
            </button>

            {/* Refresh */}
            <button onClick={loadTree} title="Refresh" className="fe-toolbar-btn" type="button">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={loading ? { animation: "spin 1s linear infinite" } : undefined}>
                <polyline points="23 4 23 10 17 10"/>
                <polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>

            <span style={{ width: "1px", height: "14px", background: "var(--border)", margin: "0 2px 0 3px", flexShrink: 0 }} />
          </div>
        )}

        {/* Close panel */}
        {onClose && (
          <button
            onClick={onClose}
            title="Close panel"
            type="button"
            className="fe-tab-close"
            style={{ marginLeft: tab === "files" ? "0" : "auto" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Git tab ── */}
      {tab === "git" && (
        <GitPanel projectId={projectId} />
      )}

      {/* ── System Prompt tab ── */}
      {tab === "system-prompt" && (
        <SystemPromptTab projectId={projectId} />
      )}

      {/* ── Artifacts tab ── */}
      {tab === "artifacts" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
          <ArtifactsPanel />
        </div>
      )}

      {/* ── Files tab ── */}
      {tab === "files" && (
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
            /* @ts-expect-error — webkitdirectory is a webkit extension but works in all major browsers */
            webkitdirectory="true"
            style={{ display: "none" }}
            onChange={(e) => { handleUpload(e.target.files ? Array.from(e.target.files) : null); e.target.value = ""; }}
          />

          {/* Error */}
          {error && (
            <div style={{ padding: "4px 12px", fontSize: "10px", color: "var(--error)", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid var(--tool-border)" }}>
              {error}
            </div>
          )}

          {/* Search */}
          <div style={{ padding: "6px 10px" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ position: "absolute", left: "8px", color: "var(--text-dim)", pointerEvents: "none" }}
              >
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files..."
                style={{
                  width: "100%",
                  background: "var(--bg-glass)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "4px 8px 4px 26px",
                  fontSize: "12px",
                  color: "var(--text-primary)",
                  outline: "none",
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  type="button"
                  style={{
                    position: "absolute",
                    right: "6px",
                    background: "none",
                    border: "none",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    padding: "2px",
                    lineHeight: 1,
                  }}
                  title="Clear search"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* Create dialog */}
          {showCreate && (
            <div style={{ padding: "4px 10px 6px", borderBottom: "1px solid var(--border)", display: "flex", gap: "4px", alignItems: "center", fontSize: "11px" }}>
              <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                {showCreate === "file" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                )}
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
              const hasCustomMime = e.dataTransfer.types.includes("application/x-pi-path") || e.dataTransfer.types.includes("application/x-pi-paths");
              e.dataTransfer.dropEffect = hasCustomMime ? "move" : "copy";
            }}
            onDrop={async (e) => {
              e.preventDefault();
              setDropTargetFolder(undefined);

              // Unified drop handler: check for in-app drag (move) first,
              // then fall back to OS file drag (upload).
              const rawPaths = e.dataTransfer.getData("application/x-pi-paths");
              const singleSrc = e.dataTransfer.getData("application/x-pi-path");
              let paths: string[] = [];
              if (rawPaths) {
                try {
                  paths = JSON.parse(rawPaths);
                } catch {
                  paths = singleSrc ? [singleSrc] : [];
                }
              } else if (singleSrc) {
                paths = [singleSrc];
              }

              if (paths.length > 0) {
                // In-app drag → MOVE to project root (empty area = root "")
                await handleMoveEntries(paths, "");
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
                  <span>{contentSearchResults.matches.length} match{contentSearchResults.matches.length !== 1 ? "es" : ""} in {groupByPath(contentSearchResults.matches).length} file{groupByPath(contentSearchResults.matches).length !== 1 ? "s" : ""}</span>
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

          {/* Floating batch action bar */}
          {selectedPaths.size > 0 && (
            <div className="file-tree-batch-bar">
              <div className="file-tree-batch-info">
                <span className="file-tree-batch-count">{selectedPaths.size}</span>
                <span>selected</span>
              </div>
              <div className="file-tree-batch-actions">
                <button
                  type="button"
                  className="file-tree-batch-btn select-all"
                  onClick={() => {
                    if (selectedPaths.size === flattenedVisibleNodes.length) {
                      clearSelection();
                    } else {
                      selectAllVisible();
                    }
                  }}
                  title={selectedPaths.size === flattenedVisibleNodes.length ? "Deselect all" : "Select all"}
                >
                  {selectedPaths.size === flattenedVisibleNodes.length ? "Deselect all" : "Select all"}
                </button>
                <button
                  type="button"
                  className="file-tree-batch-btn delete"
                  onClick={() => setConfirmBatchDelete(true)}
                  disabled={batchDeleting}
                  title="Delete selected files"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  <span>Delete ({selectedPaths.size})</span>
                </button>
                <button
                  type="button"
                  className="file-tree-batch-btn close"
                  onClick={clearSelection}
                  title="Clear selection"
                >
                  ✕
                </button>
              </div>
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
              {contextMenu.node.type === "directory" ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              ) : (
                getFileTypeIcon(contextMenu.node.name, 13)
              )} {contextMenu.node.name}
            </div>

            {/* Copy Relative Path */}
            <div
              className="context-menu-item"
              onClick={(e) => { e.stopPropagation(); handleCopyRelativePath(contextMenu.node.path); }}
              style={contextMenuItemStyle}
            >
              <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </span>
              <span>Copy Relative Path</span>
            </div>

            {/* Copy Absolute Path */}
            <div
              className="context-menu-item"
              onClick={(e) => { e.stopPropagation(); handleCopyAbsolutePath(contextMenu.node.path); }}
              style={contextMenuItemStyle}
            >
              <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
              </span>
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
              <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </span>
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
                <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
                </span>
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
                <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
                </span>
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
              <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
              </span>
              <span>Rename</span>
            </div>

            {/* Delete */}
            <div
              className="context-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setContextMenu(null);
                if (selectedPaths.size > 1 && selectedPaths.has(contextMenu.node.path)) {
                  setConfirmBatchDelete(true);
                } else {
                  setConfirmDelete(contextMenu.node.path);
                }
              }}
              style={{
                ...contextMenuItemStyle,
                color: "var(--error)",
              }}
            >
              <span style={{ width: "16px", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </span>
              <span>
                {selectedPaths.size > 1 && selectedPaths.has(contextMenu.node.path)
                  ? `Delete ${selectedPaths.size} items`
                  : "Delete"}
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Batch Delete Confirmation Modal ── */}
      {confirmBatchDelete && (
        <div className="file-confirm-modal-overlay" onClick={() => !batchDeleting && setConfirmBatchDelete(false)}>
          <div className="file-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-confirm-modal-title">
              Delete {selectedPaths.size} {selectedPaths.size === 1 ? "item" : "items"}?
            </div>
            <div className="file-confirm-modal-desc">
              Are you sure you want to permanently delete these items? This action cannot be undone.
            </div>
            <div className="file-confirm-modal-list">
              {Array.from(selectedPaths).slice(0, 50).map((p) => (
                <div key={p} className="file-confirm-item">
                  • {p}
                </div>
              ))}
              {selectedPaths.size > 50 && (
                <div className="file-confirm-item-more">
                  ...and {selectedPaths.size - 50} more items
                </div>
              )}
            </div>
            <div className="file-confirm-modal-actions">
              <button
                type="button"
                className="file-confirm-btn cancel"
                onClick={() => setConfirmBatchDelete(false)}
                disabled={batchDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="file-confirm-btn danger"
                onClick={handleBatchDelete}
                disabled={batchDeleting}
              >
                {batchDeleting ? "Deleting…" : `Delete ${selectedPaths.size} ${selectedPaths.size === 1 ? "item" : "items"}`}
              </button>
            </div>
          </div>
        </div>
      )}


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
