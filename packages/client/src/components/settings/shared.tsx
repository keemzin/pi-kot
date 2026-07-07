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
