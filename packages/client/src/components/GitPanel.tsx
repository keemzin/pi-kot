import { useCallback, useEffect, useRef, useState } from "react";
import { Columns2, Rows2 } from "lucide-react";
import { getStoredToken } from "../lib/api-client";
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

  const toggleDiff = async (file: GitFileStatus, staged: boolean) => {
    const key = `${file.path}|${staged ? "staged" : "unstaged"}`;
    if (openDiffs[key] !== undefined) {
      setOpenDiffs((s) => { const n = { ...s }; delete n[key]; return n; });
      return;
    }
    setOpenDiffs((s) => ({ ...s, [key]: "loading" }));
    try {
      const qs = new URLSearchParams({ projectId, path: file.path });
      if (staged) qs.set("staged", "1");
      const res = await authFetch(`/api/v1/git/diff/file?${qs}`);
      if (!res.ok) throw new Error("diff failed");
      const data = (await res.json()) as { diff: string };
      setOpenDiffs((s) => ({ ...s, [key]: data.diff }));
    } catch {
      setOpenDiffs((s) => ({ ...s, [key]: "error" }));
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

  const toggleCommitDiff = useCallback(async (hash: string, path: string) => {
    const key = `${hash}|${path}`;
    const cached = commitDiffs[key];

    // Toggle: if open, close it
    if (cached !== undefined && cached.state === "loaded") {
      setCommitDiffs((s) => {
        const n = { ...s };
        delete n[key];
        return n;
      });
      return;
    }

    setCommitDiffs((s) => ({ ...s, [key]: { state: "loading" } }));
    try {
      const qs = new URLSearchParams({ projectId, hash, path });
      const res = await authFetch(`/api/v1/git/commit/diff?${qs}`);
      if (!res.ok) throw new Error("commit diff fetch failed");
      const data = (await res.json()) as { diff: string };
      setCommitDiffs((s) => ({
        ...s,
        [key]: { state: "loaded", value: data.diff },
      }));
    } catch (err) {
      setCommitDiffs((s) => ({
        ...s,
        [key]: { state: "error", message: err instanceof Error ? err.message : "unknown error" },
      }));
    }
  }, [projectId, commitDiffs]);

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
        padding: "8px 12px", borderBottom: "1px solid var(--border)",
        background: "var(--bg-glass)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontWeight: 500, color: "var(--text-primary)", fontSize: "13px" }}>
          <span style={{ fontWeight: 700 }}>
            {status?.branch ? (
              <><span style={{ color: "var(--accent-text)" }}>⎇</span> {status.branch}</>
            ) : "—"}
          </span>
          {status && status.files.length > 0 && (
            <span style={{ borderRadius: "var(--radius-sm)", background: "var(--bg-glass)", padding: "2px 6px", fontSize: "10px", color: "var(--text-dim)" }}>
              {status.files.length}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <button
            onClick={toggleGitViewType}
            style={{ background: "none", border: "none", borderRadius: "var(--radius-sm)", padding: "4px", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            title={gitViewType === "split" ? "Switch to unified view" : "Switch to side-by-side view"}
            type="button"
          >
            {gitViewType === "split" ? <Rows2 size={13} /> : <Columns2 size={13} />}
          </button>
          <button
            onClick={fetchStatus}
            title="Refresh"
            style={{ background: "none", border: "none", borderRadius: "var(--radius-sm)", padding: "4px", color: "var(--text-dim)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            type="button"
          >
            ↻
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

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
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
            onClickFile={(f) => toggleDiff(f, true)}
            openDiffs={openDiffs}
            staged
            viewType={gitViewType}
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
            onClickFile={(f) => toggleDiff(f, false)}
            onRevert={(f) => handleRevert(f.path)}
            pendingRevert={pendingRevert}
            openDiffs={openDiffs}
            staged={false}
            viewType={gitViewType}
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
            onClickFile={(f) => toggleDiff(f, false)}
            openDiffs={openDiffs}
            staged={false}
            viewType={gitViewType}
          />
        )}

        {status?.files.length === 0 && (
          <div style={{ padding: "16px", textAlign: "center", color: "var(--text-dim)", fontSize: "11px" }}>
            Working tree clean.
          </div>
        )}

        {/* ── Commit section ── */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px" }}>
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message…"
            rows={3}
            style={{
              width: "100%", resize: "none", fontSize: "13px",
              background: "var(--bg-glass)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "8px 10px",
              color: "var(--text-primary)", outline: "none", fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
            <span style={{ fontSize: "12px", color: "var(--text-dim)" }}>{stagedFiles.length} staged</span>
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

        {/* ── Push / Pull / Fetch ── */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px" }}>
          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={doFetch} disabled={busy} className="git-action-btn git-remote-btn" type="button">Fetch</button>
            <button onClick={doPull} disabled={busy} className="git-action-btn git-remote-btn" type="button">Pull</button>
            <button onClick={doPush} disabled={busy} className="git-action-btn git-remote-btn" type="button">Push</button>
          </div>
        </div>
      </div>

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
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
                                const diffEntry = commitDiffs[diffKey];
                                return (
                                  <li key={f.path} style={{ borderTop: "1px solid var(--border)" }}>
                                    {/* File row */}
                                    <div
                                      onClick={() => toggleCommitDiff(c.hash, f.path)}
                                      style={{
                                        display: "flex", alignItems: "center", gap: "4px",
                                        padding: "3px 4px", cursor: "pointer",
                                        fontSize: "10px", fontFamily: "monospace",
                                        background: diffEntry !== undefined && diffEntry.state === "loaded"
                                          ? "var(--accent-subtle)" : "transparent",
                                      }}
                                    >
                                      <span style={{
                                        width: "14px", flexShrink: 0, textAlign: "center",
                                        fontWeight: 700, fontSize: "10px",
                                        color: commitKindColor(f.changeType),
                                      }}>
                                        {commitKindBadge(f.changeType)}
                                      </span>
                                      <span style={{
                                        flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                                        whiteSpace: "nowrap", color: "var(--text-primary)",
                                      }}>
                                        {f.path}
                                      </span>
                                      <span style={{ fontSize: "8px", color: "var(--text-dim)" }}>
                                        {diffEntry !== undefined && diffEntry.state === "loaded" ? "▾" : "▸"}
                                      </span>
                                    </div>
                                    {/* Inline diff */}
                                    {diffEntry !== undefined && diffEntry.state === "loaded" && (
                                      <div style={{
                                        borderTop: "1px solid var(--border)",
                                        background: "var(--bg-glass)",
                                        padding: "4px 8px",
                                        overflow: "hidden",
                                      }}>
                                        <DiffBlock diff={diffEntry.value} viewType={gitViewType} />
                                      </div>
                                    )}
                                    {diffEntry !== undefined && diffEntry.state === "loading" && (
                                      <div style={{
                                        fontSize: "9px", color: "var(--text-dim)",
                                        fontStyle: "italic", padding: "2px 8px",
                                      }}>
                                        Loading diff…
                                      </div>
                                    )}
                                    {diffEntry !== undefined && diffEntry.state === "error" && (
                                      <div style={{
                                        fontSize: "9px", color: "var(--error)",
                                        padding: "2px 8px",
                                      }}>
                                        {diffEntry.message}
                                      </div>
                                    )}
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
                            padding: "1px 4px", opacity: 0.7,
                          }}
                          type="button"
                        >
                          {copied ? "✓" : "📋"}
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
  openDiffs: Record<string, string | "loading" | "error">;
  staged: boolean;
  onRevert?: (f: GitFileStatus) => void;
  pendingRevert?: string;
  viewType?: "unified" | "split";
}

function FileGroup(props: FileGroupProps) {
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 14px", borderBottom: "1px solid var(--border)",
        background: "var(--accent-subtle)",
      }}>
        <span style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-secondary)" }}>
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
          const key = `${f.path}|${props.staged ? "staged" : "unstaged"}`;
          const diffState = props.openDiffs[key];
          return (
            <li key={f.path} style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="git-file-row">
                {/* Badge */}
                <span style={{
                  width: "20px", flexShrink: 0, textAlign: "center",
                  fontSize: "12px", fontFamily: "monospace", fontWeight: 700,
                  color: kindColor(f.kind),
                }}>
                  {kindBadge(f.kind)}
                </span>
                {/* File name */}
                <button
                  onClick={() => props.onClickFile(f)}
                  style={{
                    flex: 1, background: "none", border: "none",
                    color: "var(--text-primary)", cursor: "pointer",
                    fontSize: "12px", fontFamily: "monospace",
                    textAlign: "left", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", padding: "2px 4px", borderRadius: "var(--radius-sm)",
                  }}
                  type="button"
                >
                  {f.path}
                </button>
                {/* Revert */}
                {props.onRevert && (
                  <button
                    onClick={() => props.onRevert!(f)}
                    className={`git-action-btn git-revert-btn${props.pendingRevert === f.path ? " pending" : ""}`}
                    title="Revert (discard changes)"
                    type="button"
                  >
                    {props.pendingRevert === f.path ? "Confirm?" : "↩"}
                  </button>
                )}
                {/* Action */}
                <button
                  onClick={() => props.onFileAction(f)}
                  className="git-action-btn git-file-action-btn"
                  type="button"
                >
                  {props.fileActionLabel}
                </button>
              </div>
              {/* Inline diff */}
              {diffState !== undefined && (
                <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-glass)", padding: "4px 12px", overflow: "hidden" }}>
                  {diffState === "loading" ? (
                    <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>Loading diff…</div>
                  ) : diffState === "error" ? (
                    <div style={{ fontSize: "10px", color: "var(--error)" }}>Failed to load diff.</div>
                  ) : diffState.length === 0 ? (
                    <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>(no diff)</div>
                  ) : (
                    <DiffBlock diff={diffState} viewType={props.viewType} />
                  )}
                </div>
              )}
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
    case "modified": return "var(--accent-text)";
    case "added": return "#98c379";
    case "deleted": return "var(--error)";
    case "untracked": return "var(--text-dim)";
    case "conflicted": return "var(--error)";
    default: return "var(--text-dim)";
  }
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
