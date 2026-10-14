import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Folder,
  ChevronRight,
  Plus,
  ArrowLeft,
  Eye,
  EyeOff,
  GitBranch,
  Globe,
  Home,
  Check,
  X,
  FolderPlus,
  Loader2,
} from "lucide-react";
import {
  fetchHomeDir,
  listDir,
  createProjectAPI,
  cloneRepo,
  createFsDir,
} from "../lib/api-client";
import type { FsEntry, CloneRepoRequest } from "../lib/api-client";
import { useSessionStore } from "../stores/session-store";

interface AddProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Resolve ~/ prefix to the actual home directory path. */
function resolveTilde(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith("~/")) return homeDir + path.slice(1);
  return path;
}

/** Get the directory portion of a display path (e.g. "~/foo/bar" → "~/foo/"). */
function getBrowseDir(displayPath: string): string {
  if (displayPath.endsWith("/")) return displayPath;
  const i = displayPath.lastIndexOf("/");
  return i >= 0 ? displayPath.slice(0, i + 1) : displayPath;
}

/** Get the trailing segment after the last /. */
function getLeaf(displayPath: string): string {
  if (displayPath.endsWith("/")) return "";
  const i = displayPath.lastIndexOf("/");
  return i >= 0 ? displayPath.slice(i + 1) : displayPath;
}

/**
 * Extract a human-readable repo name from a git clone URL.
 * Examples:
 *   https://github.com/user/repo.git      → repo
 *   https://github.com/user/repo           → repo
 *   git@github.com:user/my-repo.git        → my-repo
 *   https://gitlab.com/group/subgroup/proj → proj
 */
function deriveNameFromUrl(url: string): string {
  try {
    // Strip trailing .git
    const cleaned = url.replace(/\.git$/, "");
    // Handle both https:// and git@ ssh-style URLs
    const lastSegment = cleaned.split("/").filter(Boolean).pop() || "";
    // For ssh-style (git@host:path), the path may be colon-separated
    const afterColon = lastSegment.split(":").filter(Boolean).pop() || "";
    return afterColon || lastSegment;
  } catch {
    return "";
  }
}

export function AddProjectDialog({ open, onClose }: AddProjectDialogProps) {
  const [homeDir, setHomeDir] = useState("");
  const [path, setPath] = useState("~/");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [hoverIdx, setHoverIdx] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [cloneMode, setCloneMode] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloneToCustomPath, setCloneToCustomPath] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const cloneInputRef = useRef<HTMLInputElement>(null);
  const newFolderInputRef = useRef<HTMLInputElement>(null);
  const projects = useSessionStore((s) => s.projects);
  const loadProjects = useSessionStore((s) => s.loadProjects);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);

  // ---- existing projects set for already-added detection ----
  const existingPathSet = useMemo(() => {
    return new Set(
      projects
        .map((p) => (p.path ? p.path.replace(/\/+$/, "") : ""))
        .filter(Boolean),
    );
  }, [projects]);

  // ---- reset on open ----
  useEffect(() => {
    if (!open) return;
    let dead = false;
    setPath("~/");
    setCloneUrl("");
    setCloneMode(false);
    setShowHidden(false);
    setHoverIdx(0);
    setError(undefined);
    setAdding(false);
    setCloning(false);
    setCreatingFolder(false);
    setNewFolderName("");
    setIsCreatingFolder(false);

    fetchHomeDir()
      .then((h) => {
        if (!dead) {
          setHomeDir(h);
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      })
      .catch(() => {
        if (!dead) {
          setHomeDir("/");
          requestAnimationFrame(() => inputRef.current?.focus());
        }
      });

    return () => {
      dead = true;
    };
  }, [open]);

  // ---- auto focus input when mode changes ----
  useEffect(() => {
    if (!open) return;
    if (cloneMode) {
      requestAnimationFrame(() => cloneInputRef.current?.focus());
    } else {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [cloneMode, open]);

  // ---- global Escape dismiss ----
  useEffect(() => {
    if (!open) return;
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !creatingFolder) {
        onClose();
      }
    };
    document.addEventListener("keydown", handleGlobalKey);
    return () => document.removeEventListener("keydown", handleGlobalKey);
  }, [open, creatingFolder, onClose]);

  // ---- resolved directory to browse ----
  const browseDir = useMemo(
    () => (homeDir ? resolveTilde(getBrowseDir(path), homeDir) : ""),
    [path, homeDir],
  );

  // ---- load directory entries ----
  useEffect(() => {
    if (!open || !browseDir) {
      setEntries([]);
      return;
    }
    let dead = false;
    setLoading(true);
    setError(undefined);

    listDir(browseDir)
      .then((list) => {
        if (!dead) setEntries(list);
      })
      .catch((err) => {
        if (!dead) {
          setEntries([]);
          setError(err instanceof Error ? err.message : "Failed to load directory");
        }
      })
      .finally(() => {
        if (!dead) setLoading(false);
      });

    return () => {
      dead = true;
    };
  }, [open, browseDir]);

  // ---- filtered entries ----
  const leafFilter = getLeaf(path);
  const filtered = useMemo(() => {
    const lower = leafFilter.toLowerCase();
    const showAll = showHidden || leafFilter.startsWith(".");
    return entries.filter(
      (e) =>
        e.isDirectory &&
        (showAll || !e.name.startsWith(".")) &&
        e.name.toLowerCase().startsWith(lower),
    );
  }, [entries, leafFilter, showHidden]);

  useEffect(() => {
    setHoverIdx(0);
  }, [filtered.length]);

  const hasParent = path !== "~/" && path !== "/";
  const absolutePath = useMemo(
    () => (homeDir ? resolveTilde(path.replace(/\/+$/, ""), homeDir) : ""),
    [path, homeDir],
  );

  const isCurrentAdded = useMemo(() => {
    if (!absolutePath) return false;
    return existingPathSet.has(absolutePath.replace(/\/+$/, ""));
  }, [absolutePath, existingPathSet]);

  // ---- breadcrumbs for currently browsed directory ----
  const breadcrumbs = useMemo(() => {
    const browsePart = getBrowseDir(path);
    if (!browsePart) return [];

    if (browsePart.startsWith("~/") || browsePart === "~") {
      const items: Array<{ label: string; targetPath: string; isLast: boolean }> = [
        { label: "~", targetPath: "~/", isLast: browsePart === "~" || browsePart === "~/" },
      ];
      const remainder = browsePart.replace(/^~\/?/, "").replace(/\/+$/, "");
      if (remainder) {
        const segments = remainder.split("/").filter(Boolean);
        let accumulated = "~";
        for (let i = 0; i < segments.length; i++) {
          accumulated += "/" + segments[i];
          items.push({
            label: segments[i],
            targetPath: accumulated + "/",
            isLast: i === segments.length - 1,
          });
        }
      }
      return items;
    }

    if (browsePart.startsWith("/")) {
      const items: Array<{ label: string; targetPath: string; isLast: boolean }> = [
        { label: "/", targetPath: "/", isLast: browsePart === "/" },
      ];
      const segments = browsePart.split("/").filter(Boolean);
      let accumulated = "";
      for (let i = 0; i < segments.length; i++) {
        accumulated += "/" + segments[i];
        items.push({
          label: segments[i],
          targetPath: accumulated + "/",
          isLast: i === segments.length - 1,
        });
      }
      return items;
    }

    return [{ label: browsePart, targetPath: browsePart, isLast: true }];
  }, [path]);

  // ---- navigation ----
  const enterDir = useCallback(
    (entryPath: string) => {
      const rel = entryPath.startsWith(homeDir)
        ? "~" + entryPath.slice(homeDir.length)
        : entryPath;
      setPath(rel + "/");
    },
    [homeDir],
  );

  const goUp = useCallback(() => {
    const dir = getBrowseDir(path.replace(/\/+$/, ""));
    const trimmed = dir.replace(/\/+$/, "");
    if (trimmed === "~" || trimmed === "") {
      const parentOfHome = homeDir ? homeDir.split("/").slice(0, -1).join("/") || "/" : "/";
      const rel = parentOfHome === "/" ? "/" : "~" + parentOfHome.slice(homeDir.lastIndexOf("/"));
      setPath(rel.endsWith("/") ? rel : rel + "/");
      return;
    }
    const i = trimmed.lastIndexOf("/");
    const parent = i >= 0 ? trimmed.slice(0, i + 1) : "/";
    setPath(parent);
  }, [path, homeDir]);

  // ---- folder creation ----
  const startCreateFolder = useCallback(() => {
    setCreatingFolder(true);
    setNewFolderName("");
    setError(undefined);
    requestAnimationFrame(() => {
      newFolderInputRef.current?.focus();
    });
  }, []);

  const cancelCreateFolder = useCallback(() => {
    setCreatingFolder(false);
    setNewFolderName("");
    inputRef.current?.focus();
  }, []);

  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || !browseDir || isCreatingFolder) return;
    setIsCreatingFolder(true);
    setError(undefined);
    try {
      const res = await createFsDir(browseDir, trimmed);
      setCreatingFolder(false);
      setNewFolderName("");
      const updatedList = await listDir(browseDir);
      setEntries(updatedList);
      enterDir(res.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create folder");
    } finally {
      setIsCreatingFolder(false);
    }
  }, [newFolderName, browseDir, isCreatingFolder, enterDir]);

  // ---- quick-add project from entry ----
  const quickAdd = useCallback(
    async (entryPath: string) => {
      try {
        const name = entryPath.split("/").filter(Boolean).pop() || "unnamed";
        const newProj = await createProjectAPI(name, entryPath);
        await loadProjects();
        if (newProj?.id) {
          setActiveProject(newProj.id);
        } else {
          const state = useSessionStore.getState();
          const last = state.projects[state.projects.length - 1];
          if (last) setActiveProject(last.id);
        }
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add project");
      }
    },
    [loadProjects, setActiveProject, onClose],
  );

  // ---- add current path ----
  const addCurrent = useCallback(async () => {
    if (!absolutePath || adding || isCurrentAdded) return;
    setAdding(true);
    setError(undefined);
    try {
      const name = absolutePath.split("/").filter(Boolean).pop() || "unnamed";
      const newProj = await createProjectAPI(name, absolutePath);
      await loadProjects();
      if (newProj?.id) {
        setActiveProject(newProj.id);
      } else {
        const state = useSessionStore.getState();
        const last = state.projects[state.projects.length - 1];
        if (last) setActiveProject(last.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add project");
    } finally {
      setAdding(false);
    }
  }, [absolutePath, adding, isCurrentAdded, loadProjects, setActiveProject, onClose]);

  // ---- clone ----
  const handleClone = useCallback(() => {
    if (!cloneUrl.trim() || !absolutePath || cloning) return;
    setCloning(true);
    setError(undefined);

    // Derive folder/project name from the clone URL, not from the browse path
    const folderName = deriveNameFromUrl(cloneUrl.trim()) || "repo";
    const payload: CloneRepoRequest = {
      url: cloneUrl.trim(),
      folderName,
      projectName: folderName,
    };
    // When custom-path toggle is on, clone into the browsed dir as a subfolder
    if (cloneToCustomPath) {
      payload.targetPath = absolutePath.replace(/\/+$/, "") + "/" + folderName;
    }
    let createdProjectId: string | undefined;
    cloneRepo(
      payload,
      (event) => {
        switch (event.type) {
          case "project_created":
            createdProjectId = event.id;
            break;
          case "done":
            loadProjects().then(() => {
              if (createdProjectId) {
                setActiveProject(createdProjectId);
              } else {
                const state = useSessionStore.getState();
                const last = state.projects[state.projects.length - 1];
                if (last) setActiveProject(last.id);
              }
              onClose();
            });
            setCloning(false);
            break;
          case "error":
            setError(event.message);
            setCloning(false);
            break;
        }
      },
      (err) => {
        setError(err.message);
        setCloning(false);
      },
    );
  }, [cloneUrl, absolutePath, cloneToCustomPath, cloning, loadProjects, setActiveProject, onClose]);

  // ---- keyboard ----
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const input = inputRef.current;
      const isCursorAtStart =
        input != null && input.selectionStart === 0 && input.selectionEnd === 0;
      const isCursorAtEnd =
        input != null &&
        input.selectionStart === path.length &&
        input.selectionEnd === path.length;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHoverIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHoverIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (filtered.length > 0 && hoverIdx >= 0 && hoverIdx < filtered.length) {
          e.preventDefault();
          const entry = filtered[hoverIdx];
          if (leafFilter && !entry.name.startsWith(leafFilter)) {
            setPath(getBrowseDir(path) + entry.name + "/");
          } else {
            enterDir(entry.path);
          }
        }
      } else if (e.key === "ArrowRight") {
        if (isCursorAtEnd && filtered.length > 0 && hoverIdx >= 0 && hoverIdx < filtered.length) {
          e.preventDefault();
          enterDir(filtered[hoverIdx].path);
        }
      } else if (e.key === "ArrowLeft") {
        if (isCursorAtStart && hasParent) {
          e.preventDefault();
          goUp();
        }
      } else if (e.key === "Backspace" && !path) {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, hoverIdx, leafFilter, path, enterDir, goUp, hasParent, onClose],
  );

  if (!open) return null;

  return (
    <div className="quick-pick-overlay" role="dialog" aria-modal="true">
      <div
        className="quick-pick-palette add-project-settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="quick-pick-header settings-header">
          <div className="quick-pick-title-group">
            <span className="quick-pick-title">Add / Open Project</span>
            <span className="quick-pick-shortcut-badge">⌘O</span>
          </div>
          <button className="settings-close" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="add-project-dialog-body">
          {/* Mode toggle */}
          <div className="add-project-dialog-bar">
            <button
              className={"add-project-dialog-tab" + (cloneMode ? "" : " active")}
              onClick={() => setCloneMode(false)}
            >
              <Folder size={14} />
              Browse
            </button>
            <button
              className={"add-project-dialog-tab" + (cloneMode ? " active" : "")}
              onClick={() => setCloneMode(true)}
            >
              <GitBranch size={14} />
              Clone
            </button>
          </div>

          {/* Clone URL */}
          {cloneMode && (
            <div className="add-project-dialog-clone-row">
              <Globe size={14} className="add-project-dialog-icon" />
              <input
                ref={cloneInputRef}
                type="text"
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                placeholder="https://github.com/user/repo.git"
                className="add-project-dialog-input"
                style={{ paddingLeft: "30px" }}
                spellCheck={false}
              />
            </div>
          )}

          {/* Clone destination toggle */}
          {cloneMode && (
            <div className="add-project-dialog-clone-dest">
              <label className="add-project-dialog-toggle">
                <input
                  type="checkbox"
                  checked={cloneToCustomPath}
                  onChange={(e) => setCloneToCustomPath(e.target.checked)}
                />
                <span className="add-project-dialog-toggle-track">
                  <span className="add-project-dialog-toggle-knob" />
                </span>
                <span className="add-project-dialog-toggle-label">
                  {cloneToCustomPath ? "Clone to custom path" : "Clone to workspace"}
                </span>
              </label>
            </div>
          )}

          {/* Path with Add/Clone button */}
          <div className="add-project-dialog-path-row">
            <Folder size={14} className="add-project-dialog-icon" />
            <input
              ref={inputRef}
              type="text"
              value={path}
              onChange={(e) => {
                const val = e.target.value;
                const trimmed = val.trim();
                if (
                  /^(https?:\/\/|git@).*\.git$/i.test(trimmed) ||
                  /^(https?:\/\/(github|gitlab|bitbucket)\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/i.test(trimmed)
                ) {
                  setCloneMode(true);
                  setCloneUrl(trimmed);
                  return;
                }
                setPath(val.replace(/\\/g, "/"));
              }}
              onKeyDown={onKeyDown}
              placeholder="Type path or paste Git repo URL…"
              className="add-project-dialog-input"
              spellCheck={false}
            />
            <button
              className={
                "add-project-dialog-btn" +
                (!cloneMode && isCurrentAdded ? " already-added" : "")
              }
              disabled={
                cloneMode
                  ? !cloneUrl.trim() || !absolutePath || cloning
                  : !absolutePath || adding || isCurrentAdded
              }
              onClick={cloneMode ? handleClone : addCurrent}
            >
              {cloneMode ? (
                cloning ? "Cloning…" : "Clone & Add"
              ) : adding ? (
                "Adding…"
              ) : isCurrentAdded ? (
                <>
                  <Check size={12} />
                  <span>Added</span>
                </>
              ) : (
                "Add"
              )}
            </button>
          </div>

          {/* Toolbar */}
          <div className="add-project-dialog-tools">
            <button
              className="add-project-dialog-tool"
              onClick={() => setPath("~/")}
              disabled={path === "~/"}
              title="Home directory (~)"
            >
              <Home size={13} />
            </button>
            <button
              className="add-project-dialog-tool"
              onClick={goUp}
              disabled={!hasParent}
              title="Go up (..)"
            >
              <ArrowLeft size={13} />
              <span>..</span>
            </button>
            <button
              className={"add-project-dialog-tool" + (creatingFolder ? " active" : "")}
              onClick={creatingFolder ? cancelCreateFolder : startCreateFolder}
              title={creatingFolder ? "Cancel new folder" : "Create new folder"}
            >
              <FolderPlus size={13} />
              <span>New folder</span>
            </button>
            <button
              className="add-project-dialog-tool"
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? "Hide hidden files" : "Show hidden files"}
            >
              {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
              <span>{showHidden ? "Hide" : "Hidden"}</span>
            </button>
            <div className="add-project-dialog-breadcrumbs" title={absolutePath}>
              {breadcrumbs.map((crumb, idx) => (
                <span key={crumb.targetPath} className="add-project-breadcrumb-item">
                  {idx > 0 && <span className="add-project-breadcrumb-sep">/</span>}
                  <button
                    type="button"
                    className={"add-project-breadcrumb-btn" + (crumb.isLast ? " active" : "")}
                    onClick={() => setPath(crumb.targetPath)}
                    disabled={crumb.isLast}
                  >
                    {crumb.label}
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && <div className="add-project-dialog-error">{error}</div>}

          {/* Directory list */}
          <div className="add-project-dialog-list">
            {creatingFolder && (
              <div className="add-project-dialog-new-folder-row">
                <FolderPlus size={14} className="add-project-dialog-entry-folder" />
                <input
                  ref={newFolderInputRef}
                  type="text"
                  className="add-project-dialog-new-folder-input"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreateFolder();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelCreateFolder();
                    }
                  }}
                  placeholder="Folder name…"
                  disabled={isCreatingFolder}
                  autoFocus
                />
                <div className="add-project-dialog-new-folder-actions">
                  <button
                    type="button"
                    className="add-project-dialog-new-folder-btn confirm"
                    onClick={handleCreateFolder}
                    disabled={!newFolderName.trim() || isCreatingFolder}
                    title="Create folder (Enter)"
                  >
                    {isCreatingFolder ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <Check size={12} />
                    )}
                  </button>
                  <button
                    type="button"
                    className="add-project-dialog-new-folder-btn cancel"
                    onClick={cancelCreateFolder}
                    disabled={isCreatingFolder}
                    title="Cancel (Esc)"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
            {loading ? (
              <div className="add-project-dialog-empty">Loading…</div>
            ) : filtered.length === 0 && !creatingFolder ? (
              <div className="add-project-dialog-empty">
                {leafFilter ? "No matching directories" : "Empty directory"}
              </div>
            ) : (
              filtered.map((entry, i) => {
                const hl = i === hoverIdx;
                const isAdded = existingPathSet.has(entry.path.replace(/\/+$/, ""));
                return (
                  <div
                    key={entry.path}
                    className={"add-project-dialog-entry" + (hl ? " highlighted" : "")}
                    onMouseEnter={() => setHoverIdx(i)}
                    onClick={() => enterDir(entry.path)}
                  >
                    <ChevronRight size={14} className="add-project-dialog-entry-arrow" />
                    <Folder size={14} className="add-project-dialog-entry-folder" />
                    <span className="add-project-dialog-entry-name">{entry.name}</span>
                    {entry.isGitRepo && (
                      <span className="add-project-dialog-git-badge" title="Git repository">
                        <GitBranch size={10} />
                        <span>git</span>
                      </span>
                    )}
                    {isAdded ? (
                      <span
                        className="add-project-dialog-entry-added-pill"
                        title="Already added as project"
                      >
                        <Check size={11} />
                        <span>Added</span>
                      </span>
                    ) : (
                      <button
                        className="add-project-dialog-entry-add"
                        onClick={(e) => {
                          e.stopPropagation();
                          quickAdd(entry.path);
                        }}
                        title="Add as project"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="add-project-dialog-footer">
          ↑↓ Navigate · Enter / Tab / → browse · ← .. · + quick-add
        </div>
      </div>
    </div>
  );
}

