import { useCallback, useEffect, useRef, useState } from "react";
import {
  Columns2,
  Rows2,
  Plus,
  Minus,
  RotateCcw,
  FileText,
  FileDiff,
  RefreshCw,
  X,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { getStoredToken } from "../lib/api-client";
import { useLayoutStore } from "../stores/layout-store";
import { DiffBlock } from "./DiffBlock";

/** Wrapper around fetch that includes the auth token when available. */
async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> ?? {}) };
  if (token !== undefined) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(input, { ...init, headers });
}

/* ----------------------------- types ----------------------------- */

type FileStatusKind =
  | "modified" | "added" | "deleted" | "renamed" | "copied"
  | "untracked" | "ignored" | "conflicted" | "unknown";

interface GitFileStatus {
  path: string;
  staged: boolean;
  unstaged: boolean;
  kind: FileStatusKind;
  code: string;
  originalPath?: string;
}

interface GitStatus {
  isGitRepo: boolean;
  branch?: string;
  files: GitFileStatus[];
}

interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

interface GitBranch {
  name: string;
  current: boolean;
  remote: boolean;
}

type CacheEntry<T> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "loaded"; value: T };

interface CommitFileEntry {
  path: string;
  changeType: string;
}

interface GitWorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  current: boolean;
}

/* ----------------------------- component ----------------------------- */

interface Props {
  projectId: string;
}

export function GitPanel({ projectId }: Props) {
  const [status, setStatus] = useState<GitStatus | undefined>(undefined);
  const [statusError, setStatusError] = useState<string | undefined>();
  const [branchBusy, setBranchBusy] = useState<string | undefined>();
  const [log, setLog] = useState<GitLogEntry[] | undefined>();
  const [branches, setBranches] = useState<GitBranch[] | undefined>();
  const [showLog, setShowLog] = useState(false);
  const [showBranches, setShowBranches] = useState(false);
  const [showWorktrees, setShowWorktrees] = useState(false);
  const [worktrees, setWorktrees] = useState<GitWorktreeEntry[] | undefined>();
  const [worktreeBusy, setWorktreeBusy] = useState<string | undefined>();
  const [expandedCommits, setExpandedCommits] = useState<Set<string>>(new Set());
  const [commitFilesCache, setCommitFilesCache] = useState<Record<string, CacheEntry<CommitFileEntry[]>>>({});
  const [commitDiffs, setCommitDiffs] = useState<Record<string, CacheEntry<string>>>({});
  const [copiedPath, setCopiedPath] = useState<string | undefined>();
  const [commitMessage, setCommitMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [opError, setOpError] = useState<string | undefined>();
  const [opResult, setOpResult] = useState<string | undefined>();

  // Per-file diff cache
  const [openDiffs, setOpenDiffs] = useState<Record<string, string | "loading" | "error">>({});
  const [diffStats, setDiffStats] = useState<Record<string, { additions: number; deletions: number }>>({});
  const [loadingDiffPath, setLoadingDiffPath] = useState<string | undefined>();
  const openFileViewer = useLayoutStore((s) => s.openFileViewer);
  const openDiffViewer = useLayoutStore((s) => s.openDiffViewer);
  const viewerActivePath = useLayoutStore((s) => s.viewerActivePath);
  // Revert confirm state (click-twice)
  const [pendingRevert, setPendingRevert] = useState<string | undefined>();
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clearPendingRevert = () => {
    if (revertTimerRef.current !== undefined) clearTimeout(revertTimerRef.current);
    setPendingRevert(undefined);
  };

  // Revert confirm timeout
  useEffect(() => {
    return () => {
      if (revertTimerRef.current !== undefined) clearTimeout(revertTimerRef.current);
    };
  }, []);

  // Diff view type (unified / split) — persisted to localStorage
  type GitViewType = "unified" | "split";
  const GIT_VIEW_KEY = "pi-kot.gitPanel.viewType";
  const readGitViewType = (): GitViewType => {
    try {
      return localStorage.getItem(GIT_VIEW_KEY) === "split" ? "split" : "unified";
    } catch { return "unified"; }
  };
  const [gitViewType, setGitViewType] = useState<GitViewType>(readGitViewType);
  const toggleGitViewType = () => {
    const next = gitViewType === "split" ? "unified" : "split";
    setGitViewType(next);
    try { localStorage.setItem(GIT_VIEW_KEY, next); } catch { /* ignore */ }
  };

  const fetchStatus = useCallback(async () => {
    setStatusError(undefined);
    try {
      const qs = new URLSearchParams({ projectId });
      const res = await authFetch(`/api/v1/git/status?${qs}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? "status failed");
      }
      const data = (await res.json()) as GitStatus;
      setStatus(data);

      // Prune stale diffs
      const liveFiles = new Set(data.files.map((f) => f.path));
      setOpenDiffs((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [key, val] of Object.entries(prev)) {
          const path = key.split("|")[0] ?? "";
          if (liveFiles.has(path)) next[key] = val;
          else changed = true;
        }
        return changed ? next : prev;
      });

      // Fetch diffs to calculate per-file stats (+/-)
      Promise.all([
        authFetch(`/api/v1/git/diff?${qs}`).then((r) => r.ok ? (r.json() as Promise<{ diff: string }>) : { diff: "" }),
        authFetch(`/api/v1/git/diff/staged?${qs}`).then((r) => r.ok ? (r.json() as Promise<{ diff: string }>) : { diff: "" }),
      ]).then(([uData, sData]) => {
        const uStats = parseDiffStats(uData.diff);
        const sStats = parseDiffStats(sData.diff);
        const merged: Record<string, { additions: number; deletions: number }> = { ...uStats };
        for (const [k, v] of Object.entries(sStats)) {
          if (merged[k]) {
            merged[k].additions += v.additions;
            merged[k].deletions += v.deletions;
          } else {
            merged[k] = { ...v };
          }
        }
        setDiffStats(merged);
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "fetch failed";
      setStatusError(msg);
      setStatus(undefined);
    }
  }, [projectId]);

  // Initial load
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Live refresh: when the agent completes a file-modifying tool, the
  // store bumps `fileChangeTick`, so re-fetch git status.
  const fileChangeTick = useLayoutStore((s) => s.fileChangeTick);
  useEffect(() => {
    if (fileChangeTick === 0) return;
    const t = setTimeout(() => void fetchStatus(), 400);
    return () => clearTimeout(t);
  }, [fileChangeTick, fetchStatus]);

  // Lazy-load log
  useEffect(() => {
    if (showLog) {
      const qs = new URLSearchParams({ projectId, limit: "30" });
      authFetch(`/api/v1/git/log?${qs}`)
        .then((r) => r.json() as Promise<{ commits: GitLogEntry[] }>)
        .then((d) => setLog(d.commits))
        .catch(() => setLog([]));
    }
  }, [showLog, projectId]);

  // Lazy-load branches
  useEffect(() => {
    if (showBranches) {
      const qs = new URLSearchParams({ projectId });
      authFetch(`/api/v1/git/branches?${qs}`)
        .then((r) => r.json() as Promise<{ branches: GitBranch[] }>)
        .then((d) => setBranches(d.branches))
        .catch(() => setBranches([]));
    }
  }, [showBranches, projectId]);

  // Lazy-load worktrees
  useEffect(() => {
    if (showWorktrees) {
      const qs = new URLSearchParams({ projectId });
      authFetch(`/api/v1/git/worktrees?${qs}`)
        .then((r) => r.json() as Promise<{ worktrees: GitWorktreeEntry[] }>)
        .then((d) => setWorktrees(d.worktrees))
        .catch(() => setWorktrees([]));
    }
  }, [showWorktrees, projectId]);

  const openFileDiff = async (file: GitFileStatus, staged: boolean) => {
    const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
    const diffKey = `${file.path}|${staged ? "staged" : "unstaged"}`;
    setLoadingDiffPath(diffKey);
    try {
      const qs = new URLSearchParams({ projectId, path: file.path });
      if (staged) qs.set("staged", "1");
      const res = await authFetch(`/api/v1/git/diff/file?${qs}`);
      if (!res.ok) throw new Error("diff failed");
      const data = (await res.json()) as { diff: string };
      openDiffViewer({
        path: file.path,
        name: fileName,
        diff: data.diff,
        staged,
        originalPath: file.path,
        diffTitle: `${fileName} (${staged ? "Staged" : "Working Tree"})`,
      });
    } catch {
      setOpError("Failed to load diff for " + file.path);
    } finally {
      setLoadingDiffPath(undefined);
    }
  };

  const stage = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy(true); setOpError(undefined);
    try {
      const res = await authFetch("/api/v1/git/stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, paths }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { message?: string }).message ?? "stage failed");
      await fetchStatus();
    } catch (err) { setOpError(err instanceof Error ? err.message : "stage failed"); }
    finally { setBusy(false); }
  };

  const unstage = async (paths: string[]) => {
    if (paths.length === 0) return;
    setBusy(true); setOpError(undefined);
    try {
      const res = await authFetch("/api/v1/git/unstage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, paths }),
      });
      if (!res.ok) throw new Error("unstage failed");
      await fetchStatus();
    } catch (err) { setOpError(err instanceof Error ? err.message : "unstage failed"); }
    finally { setBusy(false); }
  };

  const handleRevert = async (path: string) => {
    if (pendingRevert === path) {
      clearPendingRevert();
      setBusy(true); setOpError(undefined);
      try {
        const res = await authFetch("/api/v1/git/revert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, paths: [path] }),
        });
        if (!res.ok) throw new Error("revert failed");
        setOpResult(`Reverted ${path}`);
        await fetchStatus();
      } catch (err) { setOpError(err instanceof Error ? err.message : "revert failed"); }
      finally { setBusy(false); }
    } else {
      clearPendingRevert();
      setPendingRevert(path);
      revertTimerRef.current = setTimeout(() => setPendingRevert(undefined), 3000);
    }
  };

  const commit = async () => {
    const msg = commitMessage.trim();
    if (!msg) return;
    setBusy(true); setOpError(undefined); setOpResult(undefined);
    try {
      const res = await authFetch("/api/v1/git/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message: msg }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? "commit failed");
      const data = (await res.json()) as { hash: string };
      setCommitMessage("");
      setOpResult(`Committed ${data.hash.slice(0, 7)}`);
      await fetchStatus();
      if (showLog) {
        const qs = new URLSearchParams({ projectId, limit: "30" });
        const r = await authFetch(`/api/v1/git/log?${qs}`);
        const d = await r.json() as { commits: GitLogEntry[] };
        setLog(d.commits);
      }
    } catch (err) { setOpError(err instanceof Error ? err.message : "commit failed"); }
    finally { setBusy(false); }
  };

  const doPush = async () => {
    setBusy(true); setOpError(undefined); setOpResult(undefined);
    try {
      const res = await authFetch("/api/v1/git/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("push failed");
      const data = (await res.json()) as { output: string };
      setOpResult(data.output.trim().split("\n").pop() ?? "Pushed");
    } catch (err) { setOpError(err instanceof Error ? err.message : "push failed"); }
    finally { setBusy(false); }
  };

  const doPull = async () => {
    setBusy(true); setOpError(undefined); setOpResult(undefined);
    try {
      const res = await authFetch("/api/v1/git/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("pull failed");
      const data = (await res.json()) as { output: string };
      setOpResult(data.output.trim().split("\n").pop() ?? "Pulled");
      await fetchStatus();
    } catch (err) { setOpError(err instanceof Error ? err.message : "pull failed"); }
    finally { setBusy(false); }
  };

  const doFetch = async () => {
    setBusy(true); setOpError(undefined); setOpResult(undefined);
    try {
      const res = await authFetch("/api/v1/git/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { output: string };
      setOpResult(data.output.trim().split("\n").pop() ?? "Fetched");
    } catch (err) { setOpError(err instanceof Error ? err.message : "fetch failed"); }
    finally { setBusy(false); }
  };

  const checkout = async (branch: string) => {
    setBranchBusy(branch); setOpError(undefined);
    try {
      const res = await authFetch("/api/v1/git/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, branch }),
      });
      if (!res.ok) throw new Error("checkout failed");
      await Promise.all([fetchStatus(), reloadBranches()]);
    } catch (err) { setOpError(err instanceof Error ? err.message : "checkout failed"); }
    finally { setBranchBusy(undefined); }
  };

  const reloadBranches = async () => {
    const qs = new URLSearchParams({ projectId });
    try {
      const res = await authFetch(`/api/v1/git/branches?${qs}`);
      const d = await res.json() as { branches: GitBranch[] };
      setBranches(d.branches);
    } catch { /* ignore */ }
  };

  const reloadWorktrees = async () => {
    const qs = new URLSearchParams({ projectId });
    try {
      const res = await authFetch(`/api/v1/git/worktrees?${qs}`);
      const d = await res.json() as { worktrees: GitWorktreeEntry[] };
      setWorktrees(d.worktrees);
    } catch { /* ignore */ }
  };

  const handleTryCommit = async (hash: string) => {
    setWorktreeBusy(hash);
    setOpError(undefined);
    setOpResult(undefined);
    try {
      const res = await authFetch("/api/v1/git/worktree/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, commitHash: hash }),
      });
      if (!res.ok) throw new Error("worktree creation failed");
      const data = (await res.json()) as { path: string };
      setOpResult(`Worktree created at ${data.path}`);
      if (showWorktrees) await reloadWorktrees();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "worktree creation failed");
    } finally {
      setWorktreeBusy(undefined);
    }
  };

  const handleRemoveWorktree = async (path: string) => {
    setWorktreeBusy(path);
    setOpError(undefined);
    setOpResult(undefined);
    try {
      const res = await authFetch("/api/v1/git/worktree/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, worktreePath: path }),
      });
      if (!res.ok) throw new Error("worktree removal failed");
      setOpResult(`Removed worktree at ${path}`);
      await reloadWorktrees();
    } catch (err) {
      setOpError(err instanceof Error ? err.message : "worktree removal failed");
    } finally {
      setWorktreeBusy(undefined);
    }
  };

  /* ---------- commit file & diff loaders ---------- */

  const loadCommitFiles = useCallback(async (hash: string) => {
    const key = hash;
    const cached = commitFilesCache[key];
    if (cached !== undefined && cached.state === "loaded") return;

    setCommitFilesCache((s) => ({ ...s, [key]: { state: "loading" } }));
    try {
      const qs = new URLSearchParams({ projectId, hash });
      const res = await authFetch(`/api/v1/git/commit/files?${qs}`);
      if (!res.ok) throw new Error("commit files fetch failed");
      const data = (await res.json()) as { files: CommitFileEntry[] };
      setCommitFilesCache((s) => ({
        ...s,
        [key]: { state: "loaded", value: data.files },
      }));
    } catch (err) {
      setCommitFilesCache((s) => ({
        ...s,
        [key]: { state: "error", message: err instanceof Error ? err.message : "unknown error" },
      }));
    }
  }, [projectId, commitFilesCache]);

  const openCommitDiff = useCallback(
    async (hash: string, path: string) => {
      const diffKey = `${hash}|${path}`;
      const fileName = path.split(/[\\/]/).pop() ?? path;
      setLoadingDiffPath(diffKey);
      try {
        const qs = new URLSearchParams({ projectId, hash, path });
        const res = await authFetch(`/api/v1/git/commit/diff?${qs}`);
        if (!res.ok) throw new Error("commit diff fetch failed");
        const data = (await res.json()) as { diff: string };
        openDiffViewer({
          path,
          name: fileName,
          diff: data.diff,
          commitHash: hash,
          originalPath: path,
          diffTitle: `${fileName} (${hash.slice(0, 7)})`,
        });
      } catch {
        setOpError("Failed to load commit diff for " + path);
      } finally {
        setLoadingDiffPath(undefined);
      }
    },
    [projectId, openDiffViewer],
  );

  const toggleCommitExpanded = useCallback((hash: string) => {
    setExpandedCommits((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
    // Lazy-load files when expanding
    loadCommitFiles(hash);
  }, [loadCommitFiles]);

  /* ----------------------------- git init ----------------------------- */

  if (status?.isGitRepo === false) {
    const handleInit = async () => {
      setBusy(true); setOpError(undefined);
      try {
        const res = await authFetch("/api/v1/git/init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });
        if (!res.ok) throw new Error("init failed");
        await fetchStatus();
      } catch (err) { setOpError(err instanceof Error ? err.message : "init failed"); }
      finally { setBusy(false); }
    };
    return (
      <div style={{ padding: "24px 16px", textAlign: "center" }}>
        <p style={{ fontSize: "12px", color: "var(--text-dim)", marginBottom: "12px" }}>
          This project isn't a git repository.
        </p>
        <button
          onClick={handleInit}
          disabled={busy}
          style={{
            padding: "6px 14px", fontSize: "12px", fontWeight: 600,
            background: "var(--accent-bg)", color: "var(--accent-text)",
            border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Initializing…" : "Initialize git repo"}
        </button>
        {opError && (
          <p style={{ fontSize: "10px", color: "var(--error)", marginTop: "8px" }}>{opError}</p>
        )}
      </div>
    );
  }

  const stagedFiles = status?.files.filter((f) => f.staged) ?? [];
  const unstagedFiles = status?.files.filter((f) => f.unstaged && !f.staged) ?? [];
  const trackedUnstaged = status?.files.filter((f) => f.unstaged) ?? [];
  const untrackedFiles = status?.files.filter((f) => f.kind === "untracked") ?? [];

  const s = {
    padding: "4px 10px", fontSize: "10px", fontWeight: 600,
    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
    cursor: "pointer", background: "transparent", color: "var(--text-secondary)",
  };

  return (
    <div style={{ fontSize: "13px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header: branch + badge + view toggle + refresh */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 12px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-glass)",
        height: "36px", minHeight: "36px", boxSizing: "border-box", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500, color: "var(--text-primary)", fontSize: "13px" }}>
          <span style={{ fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "5px" }}>
            {status?.branch ? (
              <>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent-text)", flexShrink: 0 }}>
                  <line x1="6" y1="3" x2="6" y2="15"/>
                  <circle cx="18" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <path d="M18 9a9 9 0 0 1-9 9"/>
                </svg>
                <span>{status.branch}</span>
              </>
            ) : "—"}
          </span>
          {status && status.files.length > 0 && (
            <span style={{ borderRadius: "var(--radius-sm)", background: "var(--bg-glass)", padding: "2px 6px", fontSize: "10px", color: "var(--text-dim)" }}>
              {status.files.length}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
          <button
            onClick={toggleGitViewType}
            className="fe-toolbar-btn"
            title={gitViewType === "split" ? "Switch to unified view" : "Switch to side-by-side view"}
            type="button"
          >
            {gitViewType === "split" ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </button>
          <button
            onClick={fetchStatus}
            title="Refresh"
            className="fe-toolbar-btn"
            type="button"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={busy ? { animation: "spin 1s linear infinite" } : undefined}>
              <polyline points="23 4 23 10 17 10"/>
              <polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Error/success banners */}
      {(statusError || opError) && (
        <div style={{ padding: "4px 12px", fontSize: "10px", color: "var(--error)", background: "rgba(248,113,113,0.08)", borderBottom: "1px solid var(--border)" }}>
          {opError ?? statusError}
        </div>
      )}
      {opResult && (
        <div style={{ padding: "4px 12px", fontSize: "10px", color: "var(--accent-text)", background: "rgba(152,195,121,0.08)", borderBottom: "1px solid var(--border)" }}>
          {opResult}
        </div>
      )}

      {/* Scrollable content — file groups only (Log/Worktrees/Branches in bottom panel) */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
        {status === undefined && (
          <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "11px" }}>Loading git status…</div>
        )}

        {/* ── Staged files ── */}
        {stagedFiles.length > 0 && (
          <FileGroup
            label={`Staged (${stagedFiles.length})`}
            files={stagedFiles}
            onFileAction={(f) => unstage([f.path])}
            fileActionLabel="Unstage"
            groupActionLabel="Unstage all"
            onGroupAction={() => unstage(stagedFiles.map((f) => f.path))}
            onClickFile={(f) => openFileDiff(f, true)}
            staged
            diffStats={diffStats}
            activeDiffPath={viewerActivePath}
            loadingDiffPath={loadingDiffPath}
            onOpenFile={openFileViewer}
          />
        )}

        {/* ── Unstaged changes ── */}
        {trackedUnstaged.length > 0 && (
          <FileGroup
            label={`Changes (${trackedUnstaged.length})`}
            files={trackedUnstaged}
            onFileAction={(f) => stage([f.path])}
            fileActionLabel="Stage"
            groupActionLabel="Stage all"
            onGroupAction={() => stage(trackedUnstaged.map((f) => f.path))}
            onClickFile={(f) => openFileDiff(f, false)}
            onRevert={(f) => handleRevert(f.path)}
            pendingRevert={pendingRevert}
            staged={false}
            diffStats={diffStats}
            activeDiffPath={viewerActivePath}
            loadingDiffPath={loadingDiffPath}
            onOpenFile={openFileViewer}
          />
        )}

        {/* ── Untracked files ── */}
        {untrackedFiles.length > 0 && (
          <FileGroup
            label={`Untracked (${untrackedFiles.length})`}
            files={untrackedFiles}
            onFileAction={(f) => stage([f.path])}
            fileActionLabel="Stage"
            groupActionLabel="Stage all"
            onGroupAction={() => stage(untrackedFiles.map((f) => f.path))}
            onClickFile={(f) => openFileDiff(f, false)}
            staged={false}
            diffStats={diffStats}
            activeDiffPath={viewerActivePath}
            loadingDiffPath={loadingDiffPath}
            onOpenFile={openFileViewer}
          />
        )}

        {status?.files.length === 0 && (
          <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "11px" }}>
            Working tree clean.
          </div>
        )}

      </div>

      {/* ── Bottom: Log / Worktrees / Branches ── */}
      <div style={{ flexShrink: 0, overflowY: "auto", maxHeight: "40%", borderTop: "1px solid var(--border)", background: "var(--bg-subtle)" }}>

      {/* ── Log ── */}
      <div style={{ borderTop: "1px solid var(--border)" }}>
        <button
          onClick={() => setShowLog((v) => !v)}
          className="git-section-toggle"
          type="button"
        >
          <span>Log</span>
          <span className={`git-section-chevron${showLog ? " open" : ""}`}>▾</span>
        </button>
        {showLog && (
          <div style={{ padding: "0 12px 8px" }}>
            {log === undefined ? (
              <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>Loading…</div>
            ) : log.length === 0 ? (
              <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>No commits yet.</div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: "180px", overflowY: "auto" }}>
                {log.map((c) => {
                  const busy = worktreeBusy === c.hash;
                  const expanded = expandedCommits.has(c.hash);
                  const filesEntry = commitFilesCache[c.hash];

                  return (
                    <li key={c.hash} style={{ borderBottom: "1px solid var(--border)", fontSize: "11px" }}>
                      {/* Commit row — click to expand */}
                      <div
                        onClick={() => toggleCommitExpanded(c.hash)}
                        style={{
                          display: "flex", gap: "6px", alignItems: "baseline",
                          padding: "4px 0", cursor: "pointer",
                        }}
                      >
                        <span style={{ fontSize: "8px", color: "var(--text-dim)", width: "10px", flexShrink: 0 }}>
                          {expanded ? "▾" : "▸"}
                        </span>
                        <code style={{ fontSize: "10px", color: "var(--text-dim)", fontFamily: "monospace" }}>
                          {c.hash.slice(0, 7)}
                        </code>
                        <span style={{
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          flex: 1,
                        }}>
                          {c.message}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleTryCommit(c.hash); }}
                          disabled={busy}
                          title="Try this commit in a linked worktree"
                          className="git-try-btn"
                          type="button"
                        >
                          {busy ? "…" : "Try →"}
                        </button>
                      </div>
                      <div style={{ fontSize: "9px", color: "var(--text-dim)", paddingLeft: "16px", marginBottom: expanded ? 4 : 0 }}>
                        {c.author} · {new Date(c.date).toLocaleString()}
                      </div>

                      {/* Expanded: files + diffs */}
                      {expanded && (
                        <div style={{ padding: "0 0 4px 16px" }}>
                          {filesEntry === undefined || filesEntry.state === "loading" ? (
                            <div style={{ fontSize: "9px", color: "var(--text-dim)", fontStyle: "italic" }}>
                              Loading files…
                            </div>
                          ) : filesEntry.state === "error" ? (
                            <div style={{ fontSize: "9px", color: "var(--error)" }}>
                              {filesEntry.message}
                            </div>
                          ) : filesEntry.value.length === 0 ? (
                            <div style={{ fontSize: "9px", color: "var(--text-dim)", fontStyle: "italic" }}>
                              (no files)
                            </div>
                          ) : (
                            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                              {filesEntry.value.map((f) => {
                                const diffKey = `${c.hash}|${f.path}`;
                                const isCommitDiffActive = viewerActivePath === `git-diff://${c.hash}/${f.path}`;
                                const isLoadingThis = loadingDiffPath === diffKey;
                                return (
                                  <li key={f.path} style={{ borderTop: "1px solid var(--border)" }}>
                                    {/* File row */}
                                    <div
                                      onClick={() => openCommitDiff(c.hash, f.path)}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px",
                                        padding: "4px 8px",
                                        cursor: "pointer",
                                        fontSize: "10.5px",
                                        fontFamily: "var(--font-mono, monospace)",
                                        background: isCommitDiffActive ? "var(--accent-subtle)" : "transparent",
                                        borderLeft: isCommitDiffActive ? "2px solid var(--accent)" : "2px solid transparent",
                                        transition: "background 0.15s ease",
                                      }}
                                      title={`View diff in editor: ${f.path}`}
                                    >
                                      <span
                                        style={{
                                          width: "14px",
                                          flexShrink: 0,
                                          textAlign: "center",
                                          fontWeight: 700,
                                          fontSize: "10px",
                                          color: commitKindColor(f.changeType),
                                        }}
                                      >
                                        {commitKindBadge(f.changeType)}
                                      </span>
                                      <span
                                        style={{
                                          flex: 1,
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                          color: isCommitDiffActive ? "var(--text-primary)" : "var(--text-secondary)",
                                          fontWeight: isCommitDiffActive ? 600 : 400,
                                        }}
                                      >
                                        {f.path}
                                      </span>
                                      {isLoadingThis ? (
                                        <RefreshCw size={10} style={{ animation: "spin 1s linear infinite", color: "var(--text-dim)", flexShrink: 0 }} />
                                      ) : (
                                        <FileDiff size={11} style={{ color: isCommitDiffActive ? "var(--accent)" : "var(--text-dim)", opacity: isCommitDiffActive ? 1 : 0.6, flexShrink: 0 }} />
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Worktrees ── */}
      <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowWorktrees((v) => !v)}
            className="git-section-toggle"
            type="button"
          >
            <span>Worktrees</span>
            <span className={`git-section-chevron${showWorktrees ? " open" : ""}`}>▾</span>
          </button>
          {showWorktrees && (
            <div style={{ padding: "0 12px 8px" }}>
              {worktrees === undefined ? (
                <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>Loading…</div>
              ) : worktrees.length === 0 ? (
                <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>No worktrees.</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {worktrees.filter((w) => !w.current).map((w) => {
                    const busy = worktreeBusy === w.path;
                    const copied = copiedPath === w.path;
                    return (
                      <li key={w.path} style={{
                        display: "flex", alignItems: "center", gap: "4px",
                        padding: "3px 4px", borderRadius: "var(--radius-sm)",
                        fontSize: "10px", fontFamily: "monospace",
                        color: "var(--text-secondary)",
                      }}>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {w.path}
                        </span>
                        {w.head && (
                          <span style={{ fontSize: "9px", color: "var(--text-dim)" }}>
                            {w.head.slice(0, 7)}
                          </span>
                        )}
                        <button
                          onClick={() => {
                            copyToClipboard(w.path);
                            setCopiedPath(w.path);
                            setTimeout(() => setCopiedPath(undefined), 1500);
                          }}
                          title="Copy path"
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: "10px", color: copied ? "var(--accent-text)" : "var(--text-dim)",
                            padding: "2px 4px", opacity: 0.8, display: "inline-flex", alignItems: "center",
                          }}
                          type="button"
                        >
                          {copied ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                          )}
                        </button>
                        <button
                          onClick={() => handleRemoveWorktree(w.path)}
                          disabled={busy}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: "10px", color: "var(--error)", padding: "1px 4px",
                            opacity: busy ? 0.4 : 0.7,
                          }}
                          type="button"
                        >
                          {busy ? "…" : "✕"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

      {/* ── Branches ── */}
      <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowBranches((v) => !v)}
            className="git-section-toggle"
            type="button"
          >
            <span>Branches</span>
            <span className={`git-section-chevron${showBranches ? " open" : ""}`}>▾</span>
          </button>
          {showBranches && (
            <div style={{ padding: "0 12px 8px" }}>
              {branches === undefined ? (
                <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>Loading…</div>
              ) : branches.length === 0 ? (
                <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>No branches.</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {branches.map((b) => {
                    const busy = branchBusy === b.name;
                    return (
                      <li key={b.name} style={{
                        display: "flex", alignItems: "center", gap: "4px",
                        padding: "3px 4px", borderRadius: "var(--radius-sm)",
                        fontSize: "11px", fontFamily: "monospace",
                        color: b.current ? "var(--accent-text)" : "var(--text-secondary)",
                      }}>
                        <span style={{ width: "12px", flexShrink: 0 }}>
                          {b.current ? "✓" : ""}
                        </span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {b.name}
                        </span>
                        {b.remote && (
                          <span style={{ fontSize: "9px", color: "var(--text-dim)" }}>remote</span>
                        )}
                        {!b.current && !b.remote && (
                          <div style={{ display: "flex", gap: "2px" }}>
                            <button
                              onClick={() => checkout(b.name)}
                              disabled={busy}
                              style={{
                                background: "none", border: "none", cursor: "pointer",
                                fontSize: "10px", color: "var(--text-dim)", padding: "1px 4px",
                                opacity: busy ? 0.4 : 0.7,
                              }}
                              type="button"
                            >
                              checkout
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Fixed footer: Commit + Push/Pull ── */}
      <div style={{ flexShrink: 0, borderTop: "1px solid var(--border)", background: "var(--bg-solid)" }}>
        <div style={{ padding: "10px 12px 8px" }}>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message…"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
            }}
            style={{
              width: "100%", resize: "none", fontSize: "12px",
              background: "var(--bg-glass)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "8px 10px",
              color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
              lineHeight: 1.5,
              transition: "border-color 0.12s ease",
            }}
            onFocus={(e) => { e.target.style.borderColor = "var(--border-bright)"; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
            <span style={{ fontSize: "11px", color: "var(--text-dim)" }}>
              {stagedFiles.length > 0
                ? <span style={{ color: "var(--accent-text)" }}>{stagedFiles.length} staged</span>
                : <span>0 staged</span>
              }
              <span style={{ opacity: 0.5, marginLeft: "4px", fontSize: "10px" }}>⌘↵ to commit</span>
            </span>
            <button
              onClick={commit}
              disabled={busy || stagedFiles.length === 0 || !commitMessage.trim()}
              className={`git-action-btn git-commit-btn ${stagedFiles.length > 0 && commitMessage.trim() ? "ready" : "disabled"}`}
              type="button"
            >
              Commit
            </button>
          </div>
        </div>
        {/* Fetch / Pull / Push — button group */}
        <div style={{ padding: "0 12px 10px" }}>
          <div className="git-remote-group">
            <button onClick={doFetch} disabled={busy} className="git-remote-group-btn" type="button" title="Fetch from remote">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              Fetch
            </button>
            <button onClick={doPull} disabled={busy} className="git-remote-group-btn" type="button" title="Pull from remote">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
              </svg>
              Pull
            </button>
            <button onClick={doPush} disabled={busy} className="git-remote-group-btn" type="button" title="Push to remote">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
              Push
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- sub-components ----------------------------- */

interface FileGroupProps {
  label: string;
  files: GitFileStatus[];
  onFileAction: (f: GitFileStatus) => void;
  fileActionLabel: string;
  groupActionLabel: string;
  onGroupAction: () => void;
  onClickFile: (f: GitFileStatus) => void;
  staged: boolean;
  onRevert?: (f: GitFileStatus) => void;
  pendingRevert?: string;
  diffStats?: Record<string, { additions: number; deletions: number }>;
  onOpenFile?: (path: string, name: string) => void;
  activeDiffPath?: string;
  loadingDiffPath?: string;
}

function FileGroup(props: FileGroupProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--accent-subtle)",
        }}
      >
        <span
          style={{
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--text-secondary)",
          }}
        >
          {props.label}
        </span>
        <button
          onClick={props.onGroupAction}
          className="git-action-btn git-group-action-btn"
          type="button"
        >
          {props.groupActionLabel}
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {props.files.map((f) => {
          const { fileName, dirPath } = splitPath(f.path);
          const stats = getStatsForFile(f, props.staged, props.diffStats);
          const diffVirtualPath = `git-diff://${props.staged ? "staged" : "unstaged"}/${f.path}`;
          const isFileActive = props.activeDiffPath === diffVirtualPath;
          const isLoadingThis = props.loadingDiffPath === `${f.path}|${props.staged ? "staged" : "unstaged"}`;

          return (
            <li key={f.path} style={{ borderBottom: "1px solid var(--border)" }}>
              <div
                className={`git-file-row${isFileActive ? " active" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 12px",
                  background: isFileActive ? "var(--accent-subtle)" : undefined,
                  borderLeft: isFileActive ? "3px solid var(--accent)" : "3px solid transparent",
                  transition: "background 0.15s ease",
                }}
              >
                {/* Badge */}
                <span
                  style={{
                    width: "18px",
                    height: "18px",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "var(--radius-xs, 3px)",
                    fontSize: "10px",
                    fontFamily: "monospace",
                    fontWeight: 700,
                    flexShrink: 0,
                    color: kindColor(f.kind),
                    background: kindBg(f.kind),
                  }}
                  title={f.kind}
                >
                  {kindBadge(f.kind)}
                </span>

                {/* File info (click to open diff in editor) */}
                <div
                  onClick={() => props.onClickFile(f)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: "1px",
                    cursor: "pointer",
                    padding: "2px 0",
                  }}
                  role="button"
                  tabIndex={0}
                  title={`View diff in editor: ${f.path}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onClickFile(f);
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    <span
                      style={{
                        fontWeight: isFileActive ? 700 : 600,
                        fontSize: "12px",
                        color: isFileActive ? "var(--accent-text)" : "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fileName}
                    </span>
                    {/* Diff stats (+/-) */}
                    {stats && (stats.additions > 0 || stats.deletions > 0) && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "3px",
                          fontSize: "10px",
                          fontFamily: "monospace",
                          flexShrink: 0,
                        }}
                      >
                        {stats.additions > 0 && (
                          <span style={{ color: "var(--accent-text, #4ade80)" }}>
                            +{stats.additions}
                          </span>
                        )}
                        {stats.deletions > 0 && (
                          <span style={{ color: "var(--error, #f87171)" }}>
                            -{stats.deletions}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {dirPath && (
                    <span
                      style={{
                        fontSize: "10px",
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "monospace",
                      }}
                      title={f.path}
                    >
                      {dirPath}
                    </span>
                  )}
                </div>

                {/* Hover icon actions */}
                <div className={`git-file-actions${props.pendingRevert === f.path ? " has-pending" : ""}`}>
                  {/* Open working file in Editor button */}
                  {props.onOpenFile && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onOpenFile!(f.path, fileName);
                      }}
                      className="git-icon-btn"
                      title="Open working file in editor"
                      type="button"
                    >
                      <FileText size={12} />
                    </button>
                  )}

                  {/* Revert / Discard button */}
                  {props.onRevert && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        props.onRevert!(f);
                      }}
                      className={`git-icon-btn danger${props.pendingRevert === f.path ? " pending" : ""}`}
                      title="Discard changes"
                      style={
                        props.pendingRevert === f.path
                          ? {
                              width: "auto",
                              padding: "2px 6px",
                              fontSize: "10px",
                              color: "var(--error)",
                              fontWeight: 600,
                              background: "rgba(248, 113, 113, 0.15)",
                              borderColor: "rgba(248, 113, 113, 0.3)",
                            }
                          : undefined
                      }
                      type="button"
                    >
                      {props.pendingRevert === f.path ? "Confirm?" : <RotateCcw size={12} />}
                    </button>
                  )}

                  {/* Stage / Unstage icon button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onFileAction(f);
                    }}
                    className="git-icon-btn"
                    title={props.staged ? "Unstage file" : "Stage file"}
                    type="button"
                  >
                    {props.staged ? <Minus size={13} /> : <Plus size={13} />}
                  </button>

                  {/* Open Diff in Editor button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onClickFile(f);
                    }}
                    className="git-icon-btn"
                    title="Open diff in editor"
                    type="button"
                  >
                    {isLoadingThis ? (
                      <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
                    ) : (
                      <FileDiff size={13} style={{ color: isFileActive ? "var(--accent)" : undefined }} />
                    )}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Copy `text` to clipboard. Works on HTTPS and HTTP (both desktop +
 * mobile) by trying the async Clipboard API first and falling back
 * to the legacy `execCommand('copy')` via a temp textarea. On mobile
 * the textarea approach is the most reliable since the async API is
 * restricted to secure contexts on some browsers.
 */
function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText !== undefined) {
    navigator.clipboard.writeText(text).catch(() => {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    // Still failed — at least the path is visible in the UI
  }
  document.body.removeChild(ta);
}


function kindBadge(kind: FileStatusKind): string {
  switch (kind) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "copied": return "C";
    case "untracked": return "?";
    case "ignored": return "!";
    case "conflicted": return "U";
    default: return "·";
  }
}

function kindColor(kind: FileStatusKind): string {
  switch (kind) {
    case "modified": return "var(--accent-text, #e5c07b)";
    case "added": return "#98c379";
    case "deleted": return "var(--error, #e06c75)";
    case "untracked": return "#61afef";
    case "conflicted": return "var(--error, #e06c75)";
    default: return "var(--text-dim)";
  }
}

function kindBg(kind: FileStatusKind): string {
  switch (kind) {
    case "modified": return "var(--accent-subtle, rgba(229, 192, 123, 0.12))";
    case "added": return "rgba(152, 195, 121, 0.12)";
    case "deleted": return "rgba(248, 113, 113, 0.12)";
    case "untracked": return "rgba(97, 175, 239, 0.12)";
    case "conflicted": return "rgba(224, 108, 117, 0.15)";
    default: return "transparent";
  }
}

function splitPath(fullPath: string): { fileName: string; dirPath: string } {
  const lastSlash = fullPath.lastIndexOf("/");
  if (lastSlash === -1) {
    return { fileName: fullPath, dirPath: "" };
  }
  return {
    fileName: fullPath.slice(lastSlash + 1),
    dirPath: fullPath.slice(0, lastSlash),
  };
}

function parseDiffStats(diffText: string): Record<string, { additions: number; deletions: number }> {
  const stats: Record<string, { additions: number; deletions: number }> = {};
  if (!diffText) return stats;
  let currentFile: string | undefined;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const parts = line.split(" ");
      const bPath = parts[parts.length - 1]?.replace(/^b\//, "");
      currentFile = bPath;
      if (currentFile && !stats[currentFile]) {
        stats[currentFile] = { additions: 0, deletions: 0 };
      }
    } else if (currentFile && !line.startsWith("+++") && !line.startsWith("---")) {
      if (line.startsWith("+")) {
        stats[currentFile].additions++;
      } else if (line.startsWith("-")) {
        stats[currentFile].deletions++;
      }
    }
  }
  return stats;
}

function getStatsForFile(
  f: GitFileStatus,
  staged: boolean,
  statsMap?: Record<string, { additions: number; deletions: number }>,
  openDiffs?: Record<string, string | "loading" | "error">,
): { additions: number; deletions: number } | undefined {
  if (statsMap && statsMap[f.path]) return statsMap[f.path];
  if (openDiffs) {
    const key = `${f.path}|${staged ? "staged" : "unstaged"}`;
    const diff = openDiffs[key];
    if (typeof diff === "string" && diff.length > 0) {
      let additions = 0;
      let deletions = 0;
      for (const line of diff.split("\n")) {
        if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
        if (line.startsWith("+")) additions++;
        else if (line.startsWith("-")) deletions++;
      }
      return { additions, deletions };
    }
  }
  return undefined;
}

/* ─── Commit file helpers (same visual style) ─── */

function commitKindBadge(changeType: string): string {
  switch (changeType) {
    case "A": return "A";
    case "M": return "M";
    case "D": return "D";
    case "R": return "R";
    case "C": return "C";
    default: return "·";
  }
}

function commitKindColor(changeType: string): string {
  switch (changeType) {
    case "M": return "var(--accent-text)";
    case "A": return "#98c379";
    case "D": return "var(--error)";
    default: return "var(--text-dim)";
  }
}
