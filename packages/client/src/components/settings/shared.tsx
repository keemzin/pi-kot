import { useEffect, useState } from "react";

/** Hook: auto-clears a "saved" flash after 2.5s. */
export function useSavedFlash(
  savedAt: number | undefined,
  clear: () => void,
): void {
  useEffect(() => {
    if (savedAt === undefined) return undefined;
    const id = window.setTimeout(clear, 2500);
    return () => window.clearTimeout(id);
  }, [savedAt, clear]);
}

/** Format an unknown error to a readable string. */
export function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Shared field wrapper with label and optional hint. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-field">
      <label className="settings-label">{label}</label>
      {hint !== undefined && <p className="settings-hint">{hint}</p>}
      {children}
    </div>
  );
}

/** Modern accessible toggle switch for settings */
export function SettingToggle({
  checked,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`settings-toggle ${checked ? "active" : ""}`}
    >
      <span className="settings-toggle-knob" />
    </button>
  );
}

/** Standardized Setting Item Row with label + description on left, control on right */
export function SettingRow({
  label,
  hint,
  children,
  alignTop = false,
  stacked = false,
  className = "",
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  alignTop?: boolean;
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div className={`settings-item-row ${alignTop ? "align-top" : ""} ${stacked ? "stacked" : ""} ${className}`.trim()}>
      <div className="settings-item-info">
        <div className="settings-item-label">{label}</div>
        {hint && <div className="settings-item-desc">{hint}</div>}
      </div>
      {children && <div className="settings-item-control">{children}</div>}
    </div>
  );
}

/** Structured glass section card for settings tabs */
export function SettingCard({
  icon,
  title,
  subtitle,
  badge,
  action,
  children,
  className = "",
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`settings-section-card ${className}`.trim()}>
      <div className="settings-section-header">
        <div className="settings-section-title-wrap">
          {icon && <div className="settings-section-icon">{icon}</div>}
          <div className="settings-section-text">
            <div className="settings-section-title">
              <span>{title}</span>
              {badge}
            </div>
            {subtitle && <div className="settings-section-subtitle">{subtitle}</div>}
          </div>
        </div>
        {action && <div className="settings-section-action">{action}</div>}
      </div>
      <div className="settings-section-content">{children}</div>
    </div>
  );
}

/** Subtle divider between rows inside a SettingCard */
export function SettingDivider() {
  return <div className="settings-item-divider" />;
}

/** Text input with save button. */
export function TextSetting({
  value,
  onSave,
  disabled,
}: {
  value: string;
  onSave: (v: string) => void | Promise<void>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const dirty = draft !== value;
  return (
    <div className="settings-field-row">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={disabled}
        className="settings-input"
      />
      <button
        onClick={() => void onSave(draft)}
        disabled={disabled || !dirty}
        className="settings-btn settings-btn-primary"
      >
        Save
      </button>
    </div>
  );
}

