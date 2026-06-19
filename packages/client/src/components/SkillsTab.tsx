/**
 * Skills Tab — list all discovered pi agent skills with enable/disable
 * toggles, diagnostics display, and search filtering.
 */
import { useEffect, useState, useMemo } from "react";
import {
  listSkills,
  setSkillEnabled,
} from "../lib/api-client";
import type { SkillSummary, SkillDiagnostic, SkillsListResponse } from "../lib/api-client/types";

interface Props {
  onError: (msg: string | undefined) => void;
}

export function SkillsTab({ onError }: Props) {
  const [data, setData] = useState<SkillsListResponse | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  const refresh = async () => {
    onError(undefined);
    try {
      const result = await listSkills();
      setData(result);
    } catch (err) {
      onError(`Failed to load skills: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async (skill: SkillSummary, nextEnabled: boolean) => {
    setBusy(true);
    try {
      await setSkillEnabled(skill.name, nextEnabled);
      await refresh();
    } catch (err) {
      onError(`Toggle failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // ── Filtering ───────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.skills;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s: SkillSummary) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.filePath.toLowerCase().includes(q),
      );
    }
    if (sourceFilter !== "all") {
      list = list.filter((s: SkillSummary) => s.source === sourceFilter);
    }
    return list;
  }, [data, search, sourceFilter]);

  // ── Source counts for filter button labels ──────────────────────────

  const sourceCounts = useMemo(() => {
    if (!data) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const s of data.skills) {
      counts[s.source] = (counts[s.source] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const hasDiagnostics =
    data && data.diagnostics && data.diagnostics.length > 0;

  if (data === undefined) {
    return <p className="settings-hint">Loading skills…</p>;
  }

  return (
    <div>
      <p className="settings-hint">
        Skills are self-contained capability packages loaded from{" "}
        <code className="font-mono">~/.pi/agent/skills/</code> and project skill
        directories. Toggle individual skills on or off.
      </p>

      {/* ── Diagnostics banner ──────────────────────────────────────── */}
      {hasDiagnostics && (
        <div style={{ marginBottom: 12 }}>
          {data!.diagnostics.map((d: SkillDiagnostic, i: number) => (
            <DiagnosticBanner key={i} diagnostic={d} />
          ))}
        </div>
      )}

      {/* ── Toolbar: search + filters ───────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills…"
          className="settings-input"
          style={{ flex: 1, minWidth: 140 }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "global", "project", "extension"] as const).map((f) => {
            const count =
              f === "all" ? data.skills.length : (sourceCounts[f] ?? 0);
            return (
              <button
                key={f}
                onClick={() => setSourceFilter(f)}
                className={`settings-tab ${sourceFilter === f ? "settings-tab-active" : ""}`}
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 4,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {f === "all"
                  ? `All (${count})`
                  : `${f} (${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Skills list ────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <p className="settings-hint" style={{ marginTop: 16 }}>
          {search
            ? `No skills match "${search}"`
            : "No skills found."}
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map((skill) => (
          <SkillCard
            key={skill.name}
            skill={skill}
            onToggle={(next) => void handleToggle(skill, next)}
            disabled={busy}
          />
        ))}
      </div>
    </div>
  );
}

// ── Skill Card ─────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onToggle,
  disabled,
}: {
  skill: SkillSummary;
  onToggle: (enabled: boolean) => void;
  disabled: boolean;
}) {
  const sourceLabel =
    skill.source === "extension"
      ? `Extension: ${skill.extensionPath ?? "unknown"}`
      : skill.source === "project"
        ? "Project skill"
        : "Global skill";

  const sourceBadgeClass =
    skill.source === "extension"
      ? "settings-badge settings-badge-off"
      : skill.source === "project"
        ? "settings-badge"
        : "settings-badge settings-badge-on";

  return (
    <div
      className="settings-card"
      style={{
        opacity: skill.effective ? 1 : 0.55,
        transition: "opacity 0.15s",
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        {/* Toggle switch */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            cursor: disabled ? "not-allowed" : "pointer",
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <input
            type="checkbox"
            checked={skill.effective}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
            style={{
              width: 15,
              height: 15,
              accentColor: "var(--accent-text)",
              cursor: "inherit",
            }}
          />
        </label>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {skill.name}
            </span>
            <span className={sourceBadgeClass}>{skill.source}</span>
            {skill.disableModelInvocation && (
              <span
                className="settings-badge settings-badge-off"
                title="Hidden from system prompt; use /skill:name to invoke"
              >
                manual only
              </span>
            )}
            {skill.projectOverride !== undefined && (
              <span
                className={
                  skill.projectOverride === "enabled"
                    ? "settings-badge settings-badge-on"
                    : "settings-badge settings-badge-off"
                }
                title="Per-project override active"
                style={{ fontSize: 10 }}
              >
                {skill.projectOverride === "enabled"
                  ? "project: on"
                  : "project: off"}
              </span>
            )}
          </div>

          <p
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              margin: "2px 0 0",
              lineHeight: 1.4,
            }}
          >
            {skill.description}
          </p>

          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              marginTop: 4,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span title={skill.filePath}>
              {skill.filePath.length > 60
                ? "…" + skill.filePath.slice(-57)
                : skill.filePath}
            </span>
            <span>·</span>
            <span>{sourceLabel}</span>
            {!skill.effective && (
              <>
                <span>·</span>
                <span style={{ color: "var(--danger, #e74c3c)" }}>disabled</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Diagnostic Banner ──────────────────────────────────────────────────

function DiagnosticBanner({ diagnostic }: { diagnostic: SkillDiagnostic }) {
  const isError = diagnostic.type === "error";
  const isCollision = diagnostic.type === "collision";

  const bg = isError
    ? "rgba(231, 76, 60, 0.08)"
    : isCollision
      ? "rgba(243, 156, 18, 0.08)"
      : "rgba(243, 156, 18, 0.05)";
  const border = isError
    ? "1px solid rgba(231, 76, 60, 0.3)"
    : isCollision
      ? "1px solid rgba(243, 156, 18, 0.3)"
      : "1px solid rgba(243, 156, 18, 0.2)";
  const label = isError ? "Error" : isCollision ? "Collision" : "Warning";

  return (
    <div
      style={{
        padding: "8px 10px",
        borderRadius: 6,
        background: bg,
        border,
        marginBottom: 6,
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <strong style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </strong>
      : {diagnostic.message}
      {diagnostic.path && (
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
          {diagnostic.path}
        </div>
      )}
      {diagnostic.collision && (
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
          Winner: {diagnostic.collision.winnerPath}
          <br />
          Loser: {diagnostic.collision.loserPath}
        </div>
      )}
    </div>
  );
}
