import { useCallback, useEffect, useRef, useState } from "react";

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

  const fetchStatus = useCallback(async () => {
    setStatusError(undefined);
    try {
      const qs = new URLSearchParams({ projectId });
      const res = await fetch(`/api/v1/git/status?${qs}`);
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
      fetch(`/api/v1/git/log?${qs}`)
        .then((r) => r.json() as Promise<{ commits: GitLogEntry[] }>)
        .then((d) => setLog(d.commits))
        .catch(() => setLog([]));
    }
  }, [showLog, projectId]);

  // Lazy-load branches
  useEffect(() => {
    if (showBranches) {
      const qs = new URLSearchParams({ projectId });
      fetch(`/api/v1/git/branches?${qs}`)
        .then((r) => r.json() as Promise<{ branches: GitBranch[] }>)
        .then((d) => setBranches(d.branches))
        .catch(() => setBranches([]));
    }
  }, [showBranches, projectId]);

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
      const res = await fetch(`/api/v1/git/diff/file?${qs}`);
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
      const res = await fetch("/api/v1/git/stage", {
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
      const res = await fetch("/api/v1/git/unstage", {
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
        const res = await fetch("/api/v1/git/revert", {
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
      const res = await fetch("/api/v1/git/commit", {
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
        const r = await fetch(`/api/v1/git/log?${qs}`);
        const d = await r.json() as { commits: GitLogEntry[] };
        setLog(d.commits);
      }
    } catch (err) { setOpError(err instanceof Error ? err.message : "commit failed"); }
    finally { setBusy(false); }
  };

  const doPush = async () => {
    setBusy(true); setOpError(undefined); setOpResult(undefined);
    try {
      const res = await fetch("/api/v1/git/push", {
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
      const res = await fetch("/api/v1/git/pull", {
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
      const res = await fetch("/api/v1/git/fetch", {
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
      const res = await fetch("/api/v1/git/checkout", {
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
      const res = await fetch(`/api/v1/git/branches?${qs}`);
      const d = await res.json() as { branches: GitBranch[] };
      setBranches(d.branches);
    } catch { /* ignore */ }
  };

  /* ----------------------------- git init ----------------------------- */

  if (status?.isGitRepo === false) {
    const handleInit = async () => {
      setBusy(true); setOpError(undefined);
      try {
        const res = await fetch("/api/v1/git/init", {
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
    <div style={{ fontSize: "12px", color: "var(--text-secondary)", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header: branch + refresh */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "8px 12px", borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-primary)" }}>
          {status?.branch ? (
            <><span style={{ color: "var(--text-dim)" }}>⎇</span> {status.branch}</>
          ) : "—"}
        </span>
        <button onClick={fetchStatus} title="Refresh" style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", fontSize: "14px", padding: "2px 5px" }} type="button">↻</button>
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
      <div style={{ flex: 1, overflowY: "auto" }}>
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
              width: "100%", resize: "none", fontSize: "12px",
              background: "var(--bg-glass)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", padding: "6px 8px",
              color: "var(--text-primary)", outline: "none",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "6px" }}>
            <span style={{ fontSize: "10px", color: "var(--text-dim)" }}>{stagedFiles.length} staged</span>
            <button
              onClick={commit}
              disabled={busy || stagedFiles.length === 0 || !commitMessage.trim()}
              style={{
                ...s, padding: "4px 12px",
                background: stagedFiles.length > 0 && commitMessage.trim() ? "var(--accent-bg)" : "transparent",
                color: stagedFiles.length > 0 && commitMessage.trim() ? "var(--accent-text)" : "var(--text-dim)",
                opacity: busy ? 0.5 : 1,
              }}
              type="button"
            >
              Commit
            </button>
          </div>
        </div>

        {/* ── Push / Pull / Fetch ── */}
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 12px" }}>
          <div style={{ display: "flex", gap: "4px" }}>
            <button onClick={doFetch} disabled={busy} style={{ ...s, flex: 1, textAlign: "center" }} type="button">Fetch</button>
            <button onClick={doPull} disabled={busy} style={{ ...s, flex: 1, textAlign: "center" }} type="button">Pull</button>
            <button onClick={doPush} disabled={busy} style={{ ...s, flex: 1, textAlign: "center" }} type="button">Push</button>
          </div>
        </div>

        {/* ── Log ── */}
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowLog((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", fontSize: "11px", fontWeight: 600, color: "var(--text-dim)",
              background: "none", border: "none", cursor: "pointer", textAlign: "left",
            }}
            type="button"
          >
            <span>Log</span>
            <span>{showLog ? "−" : "+"}</span>
          </button>
          {showLog && (
            <div style={{ padding: "0 12px 8px" }}>
              {log === undefined ? (
                <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>Loading…</div>
              ) : log.length === 0 ? (
                <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>No commits yet.</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {log.map((c) => (
                    <li key={c.hash} style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: "11px" }}>
                      <div style={{ display: "flex", gap: "6px", alignItems: "baseline" }}>
                        <code style={{ fontSize: "10px", color: "var(--text-dim)", fontFamily: "monospace" }}>
                          {c.hash.slice(0, 7)}
                        </code>
                        <span style={{ color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.message}
                        </span>
                      </div>
                      <div style={{ fontSize: "9px", color: "var(--text-dim)", marginTop: "1px" }}>
                        {c.author} · {new Date(c.date).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── Branches ── */}
        <div style={{ borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => setShowBranches((v) => !v)}
            style={{
              width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", fontSize: "11px", fontWeight: 600, color: "var(--text-dim)",
              background: "none", border: "none", cursor: "pointer", textAlign: "left",
            }}
            type="button"
          >
            <span>Branches</span>
            <span>{showBranches ? "−" : "+"}</span>
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
}

function FileGroup(props: FileGroupProps) {
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 12px", borderBottom: "1px solid var(--border)",
        background: "var(--accent-subtle)",
      }}>
        <span style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {props.label}
        </span>
        <button
          onClick={props.onGroupAction}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "10px", color: "var(--text-dim)" }}
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
              <div style={{
                display: "flex", alignItems: "center", gap: "4px",
                padding: "4px 12px", fontSize: "11px",
              }}>
                {/* Badge */}
                <span style={{
                  width: "18px", flexShrink: 0, textAlign: "center",
                  fontSize: "10px", fontFamily: "monospace",
                  color: kindColor(f.kind),
                }}>
                  {kindBadge(f.kind)}
                </span>
                {/* File name */}
                <button
                  onClick={() => props.onClickFile(f)}
                  style={{
                    flex: 1, background: "none", border: "none",
                    color: "var(--text-secondary)", cursor: "pointer",
                    fontSize: "11px", fontFamily: "monospace",
                    textAlign: "left", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", padding: "1px 4px", borderRadius: "var(--radius-sm)",
                  }}
                  type="button"
                >
                  {f.path}
                </button>
                {/* Revert */}
                {props.onRevert && (
                  <button
                    onClick={() => props.onRevert!(f)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      fontSize: "10px", padding: "1px 4px",
                      color: props.pendingRevert === f.path ? "var(--error)" : "var(--text-dim)",
                    }}
                    title="Revert (discard changes)"
                    type="button"
                  >
                    {props.pendingRevert === f.path ? "Confirm?" : "↩"}
                  </button>
                )}
                {/* Action */}
                <button
                  onClick={() => props.onFileAction(f)}
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    fontSize: "10px", padding: "1px 4px",
                    color: "var(--text-dim)", opacity: 0.7,
                  }}
                  type="button"
                >
                  {props.fileActionLabel}
                </button>
              </div>
              {/* Inline diff */}
              {diffState !== undefined && (
                <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg-glass)", padding: "4px 12px" }}>
                  {diffState === "loading" ? (
                    <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>Loading diff…</div>
                  ) : diffState === "error" ? (
                    <div style={{ fontSize: "10px", color: "var(--error)" }}>Failed to load diff.</div>
                  ) : diffState.length === 0 ? (
                    <div style={{ fontSize: "10px", color: "var(--text-dim)", fontStyle: "italic" }}>(no diff)</div>
                  ) : (
                    <DiffView diff={diffState} maxLines={20} />
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

/* ─── DiffView — colored unified-diff renderer ─── */

interface DiffViewProps {
  diff: string;
  maxLines?: number;
}

function DiffView({ diff, maxLines = 20 }: DiffViewProps) {
  const lines = diff.split("\n");
  const showLines = lines.slice(0, maxLines);
  const truncated = lines.length > maxLines;

  return (
    <div style={{ fontSize: "10px", overflow: "auto", lineHeight: 1.5, fontFamily: "monospace", whiteSpace: "pre", maxHeight: "320px" }}>
      {showLines.map((line, i) => {
        const prefix = line.charAt(0);
        let bg: string | undefined;
        let color: string | undefined;
        let leftBorder: string | undefined;

        if (prefix === "+") {
          bg = "rgba(152,195,121,0.12)";
          color = "#b8d4a0";
          leftBorder = "2px solid rgba(152,195,121,0.5)";
        } else if (prefix === "-") {
          bg = "rgba(248,113,113,0.12)";
          color = "#f0a0a0";
          leftBorder = "2px solid rgba(248,113,113,0.5)";
        } else if (line.startsWith("@@")) {
          bg = "rgba(139,169,219,0.08)";
          color = "var(--accent-text)";
        }

        return (
          <div
            key={i}
            style={{
              background: bg ?? "transparent",
              color: color ?? "var(--text-secondary)",
              borderLeft: leftBorder ?? "2px solid transparent",
              padding: "0 8px",
              minHeight: "14px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {line || "\u00A0"}
          </div>
        );
      })}
      {truncated && (
        <div style={{ padding: "2px 8px", fontSize: "9px", color: "var(--text-dim)", fontStyle: "italic" }}>
          … (truncated)
        </div>
      )}
    </div>
  );
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
