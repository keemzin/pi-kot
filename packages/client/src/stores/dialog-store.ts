import { create } from "zustand";

export interface ConfirmDialogOptions {
  title?: string;
  message: string;
  detail?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "danger" | "warning" | "info" | "default";
}

export interface AlertDialogOptions {
  title?: string;
  message: string;
  detail?: string;
  buttonText?: string;
  tone?: "error" | "warning" | "info" | "success";
}

interface ActiveConfirm extends ConfirmDialogOptions {
  resolve: (value: boolean) => void;
}

interface ActiveAlert extends AlertDialogOptions {
  resolve: () => void;
}

interface DialogState {
  currentConfirm: ActiveConfirm | null;
  currentAlert: ActiveAlert | null;
  showConfirm: (options: ConfirmDialogOptions) => Promise<boolean>;
  showAlert: (options: AlertDialogOptions) => Promise<void>;
  closeConfirm: (result: boolean) => void;
  closeAlert: () => void;
}

export const useDialogStore = create<DialogState>((set, get) => ({
  currentConfirm: null,
  currentAlert: null,

  showConfirm: (options) => {
    return new Promise<boolean>((resolve) => {
      // If another dialog was open, resolve it false
      const prev = get().currentConfirm;
      if (prev) prev.resolve(false);

      set({
        currentConfirm: {
          ...options,
          resolve,
        },
      });
    });
  },

  showAlert: (options) => {
    return new Promise<void>((resolve) => {
      const prev = get().currentAlert;
      if (prev) prev.resolve();

      set({
        currentAlert: {
          ...options,
          resolve,
        },
      });
    });
  },

  closeConfirm: (result) => {
    const active = get().currentConfirm;
    if (active) {
      active.resolve(result);
      set({ currentConfirm: null });
    }
  },

  closeAlert: () => {
    const active = get().currentAlert;
    if (active) {
      active.resolve();
      set({ currentAlert: null });
    }
  },
}));

/**
 * Universal async confirm dialog.
 * Replaces browser native `window.confirm()` with a modern themed UI modal.
 *
 * Example:
 * ```ts
 * const ok = await confirmDialog({
 *   title: "Archive Session",
 *   message: `Archive "${title}"?`,
 *   confirmText: "Archive",
 *   tone: "warning",
 * });
 * if (ok) { ... }
 * ```
 */
export function confirmDialog(options: ConfirmDialogOptions | string): Promise<boolean> {
  const opts = typeof options === "string" ? { message: options } : options;
  return useDialogStore.getState().showConfirm(opts);
}

/**
 * Universal async alert dialog.
 * Replaces browser native `window.alert()` with a modern themed UI modal.
 */
export function alertDialog(options: AlertDialogOptions | string): Promise<void> {
  const opts = typeof options === "string" ? { message: options } : options;
  return useDialogStore.getState().showAlert(opts);
}
