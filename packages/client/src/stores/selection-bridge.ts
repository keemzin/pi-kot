/**
 * Selection-bridge store — "Send selection to chat".
 *
 * Lives between the file viewer and the chat input. The file editor
 * reports the user's current selection range; when they hit "Send
 * selection to chat" the editor writes a request here. ChatInput
 * watches for a pending request, inserts the `@path#L<start>-<end>`
 * marker at the caret, then consumes it.
 *
 * Holding it in a store (rather than an event) means the bridge is
 * oblivious to which file is open vs. which panel is focused — the
 * editor records source coordinates, the input does the insertion.
 */

import { create } from "zustand";

export interface SendSelectionRequest {
  /** Absolute / workspace-relative path of the file the selection came from. */
  path: string;
  /** 1-based inclusive start line. */
  startLine: number;
  /** 1-based inclusive end line. */
  endLine: number;
}

interface SelectionBridgeState {
  pendingSend: (SendSelectionRequest & { nonce: number }) | undefined;
  /** Ask the chat input to add the selected lines as `@path#L..-..`. */
  sendSelection: (req: SendSelectionRequest) => void;
  /** Remove the request once the input has acted on it. */
  consumeSend: () => void;
}

export const useSelectionBridge = create<SelectionBridgeState>((set) => ({
  pendingSend: undefined,
  sendSelection: (req) =>
    set((s) => ({ pendingSend: { ...req, nonce: (s.pendingSend?.nonce ?? 0) + 1 } })),
  consumeSend: () => set({ pendingSend: undefined }),
}));