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
  X,
} from "lucide-react";
import {
  fetchHomeDir,
  listDir,
  createProjectAPI,
  cloneRepo,
} from "../lib/api-client";
import type { FsEntry } from "../lib/api-client";
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
  const [cloning, setCloning] = useState(false);
  const [adding, setAdding] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const loadProjects = useSessionStore((s) => s.loadProjects);
  const setActiveProject = useSessionStore((s) => s.setActiveProject);

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

  // ---- quick-add project from entry ----
  const quickAdd = useCallback(
    async (entryPath: string) => {
      try {
        const name = entryPath.split("/").filter(Boolean).pop() || "unnamed";
        await createProjectAPI(name, entryPath);
        await loadProjects();
        const state = useSessionStore.getState();
        const last = state.projects[state.projects.length - 1];
        if (last) setActiveProject(last.id);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add project");
      }
    },
    [loadProjects, setActiveProject, onClose],
  );

  // ---- add current path ----
  const addCurrent = useCallback(async () => {
    if (!absolutePath || adding) return;
    setAdding(true);
    setError(undefined);
    try {
      const name = absolutePath.split("/").filter(Boolean).pop() || "unnamed";
      await createProjectAPI(name, absolutePath);
      await loadProjects();
      const state = useSessionStore.getState();
      const last = state.projects[state.projects.length - 1];
      if (last) setActiveProject(last.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add project");
    } finally {
      setAdding(false);
    }
  }, [absolutePath, adding, loadProjects, setActiveProject, onClose]);

  // ---- clone ----
  const handleClone = useCallback(() => {
    if (!cloneUrl.trim() || !absolutePath || cloning) return;
    setCloning(true);
    setError(undefined);

    const folderName = absolutePath.split("/").filter(Boolean).pop() || "repo";
    cloneRepo(
      {
        url: cloneUrl.trim(),
        folderName,
        projectName: folderName,
      },
      (event) => {
        switch (event.type) {
          case "done":
            loadProjects().then(() => {
              const state = useSessionStore.getState();
              const last = state.projects[state.projects.length - 1];
              if (last) setActiveProject(last.id);
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
  }, [cloneUrl, absolutePath, cloning, loadProjects, setActiveProject, onClose]);

  // ---- keyboard ----
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHoverIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHoverIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered.length > 0 && hoverIdx >= 0) {
          const entry = filtered[hoverIdx];
          if (leafFilter && !entry.name.startsWith(leafFilter)) {
            setPath(getBrowseDir(path) + entry.name + "/");
          } else {
            enterDir(entry.path);
          }
        }
      } else if (e.key === "Backspace" && !path) {
        e.preventDefault();
        onClose();
      }
    },
    [filtered, hoverIdx, leafFilter, path, enterDir, onClose],
  );

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-panel add-project-settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="settings-header">
          <span
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "var(--accent-text)",
            }}
          >
            Add Project
          </span>
          <button className="settings-close" onClick={onClose} title="Close">
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

          {/* Path with Add button */}
          <div className="add-project-dialog-path-row">
            <Folder size={14} className="add-project-dialog-icon" />
            <input
              ref={inputRef}
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value.replace(/\\/g, "/"))}
              onKeyDown={onKeyDown}
              placeholder="~/"
              className="add-project-dialog-input"
              spellCheck={false}
            />
            <button
              className="add-project-dialog-btn"
              disabled={
                cloneMode
                  ? !cloneUrl.trim() || !absolutePath || cloning
                  : !absolutePath || adding
              }
              onClick={cloneMode ? handleClone : addCurrent}
            >
              {cloneMode
                ? cloning
                  ? "Cloning…"
                  : "Clone & Add"
                : adding
                  ? "Adding…"
                  : "Add"}
            </button>
          </div>

          {/* Toolbar */}
          <div className="add-project-dialog-tools">
            <button
              className="add-project-dialog-tool"
              onClick={goUp}
              disabled={!hasParent}
              title="Go up"
            >
              <ArrowLeft size={14} />
              <span>..</span>
            </button>
            <button
              className="add-project-dialog-tool"
              onClick={() => setShowHidden((v) => !v)}
              title={showHidden ? "Hide hidden files" : "Show hidden files"}
            >
              {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
              <span>{showHidden ? "Hide hidden" : "Show hidden"}</span>
            </button>
            <span className="add-project-dialog-path-display">
              {absolutePath}
            </span>
          </div>

          {/* Error */}
          {error && <div className="add-project-dialog-error">{error}</div>}

          {/* Directory list */}
          <div className="add-project-dialog-list">
            {loading ? (
              <div className="add-project-dialog-empty">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="add-project-dialog-empty">
                {leafFilter ? "No matching directories" : "Empty directory"}
              </div>
            ) : (
              filtered.map((entry, i) => {
                const hl = i === hoverIdx;
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
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="add-project-dialog-footer">
          ↑↓ Navigate · Enter browse · + quick-add
        </div>
      </div>
    </div>
  );
}
