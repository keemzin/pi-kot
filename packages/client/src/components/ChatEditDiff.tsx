import { createContext, useContext, useState } from "react";
import { DiffBlock } from "./DiffBlock";

/**
 * Per-ChatView diff view-type preference. Each diff-rendering surface
 * has its own setting (TurnDiffPanel uses `pi.turnDiff.viewType`,
 * GitPanel uses `pi.gitPanel.viewType`); chat inline edit-tool diffs
 * use `pi.chat.viewType`. Toggling one panel doesn't affect the
 * others — different mental contexts often want different layouts.
 *
 * The hover-revealed toggle on each `<details>` summary updates the
 * chat-wide pref via Context, so one click flips every other chat
 * diff currently rendered without remounting.
 */
type ChatViewType = "unified" | "split";
const ChatDiffViewContext = createContext<{
  viewType: ChatViewType;
  setViewType: (next: ChatViewType) => void;
}>({
  viewType: "unified",
  setViewType: () => undefined,
});

const CHAT_VIEW_TYPE_KEY = "pi.chat.viewType";
function readChatViewType(): ChatViewType {
  try {
    return localStorage.getItem(CHAT_VIEW_TYPE_KEY) === "split" ? "split" : "unified";
  } catch {
    // Private-mode storage — pick the default view type.
    return "unified";
  }
}

/**
 * Wrapper for the inline edit-tool diff in chat. Reads the chat-wide
 * view-type pref via Context and renders a hover-revealed toggle on
 * the right side of the `<details>` summary so the user can flip
 * unified ↔ split without leaving the chat surface. Toggle is the
 * same Columns2/Rows2 icon pair the panels use, so muscle memory
 * carries.
 */
export function ChatEditDiff({
  diff,
  filename,
  adds,
  dels,
}: {
  diff: string;
  filename: string | undefined;
  adds: number;
  dels: number;
}) {
  const { viewType, setViewType } = useContext(ChatDiffViewContext);

  return (
    <details className="chat-edit-diff-wrap group overflow-hidden text-xs">
      <summary className="chat-edit-diff-summary flex cursor-pointer items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="chat-edit-diff-filename truncate font-mono">{filename ?? "diff"}</span>
          <span className="ml-1 inline-flex items-center gap-0.5 rounded bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 light:bg-emerald-100 light:text-emerald-700">
            +{adds}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded bg-red-950/50 px-1.5 py-0.5 text-[10px] font-medium text-red-400 light:bg-red-100 light:text-red-700">
            −{dels}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            onClick={(e) => {
              // The summary's default click toggles the <details>; stop
              // propagation so flipping the view doesn't also collapse
              // the diff the user just opened.
              e.preventDefault();
              e.stopPropagation();
              setViewType(viewType === "split" ? "unified" : "split");
            }}
            className="chat-edit-diff-toggle-btn rounded p-0.5"
            title={
              viewType === "split"
                ? "Switch chat diffs to unified view"
                : "Switch chat diffs to side-by-side view"
            }
          >
            {viewType === "split" ? (
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x={3} y={3} width={7} height={18} />
                <rect x={14} y={3} width={7} height={18} />
              </svg>
            ) : (
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <line x1={3} y1={12} x2={21} y2={12} />
                <line x1={12} y1={3} x2={12} y2={21} />
              </svg>
            )}
          </button>
        </span>
      </summary>
      <DiffBlock diff={diff} viewType={viewType} />
    </details>
  );
}

/**
 * Context provider for chat-wide diff view type. Place at the top of
 * ChatView so all ChatEditDiff components in the chat share the same
 * preference.
 */
export function ChatDiffViewProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [viewType, setViewType] = useState<ChatViewType>(readChatViewType);
  const setAndPersist = (next: ChatViewType): void => {
    setViewType(next);
    try {
      localStorage.setItem(CHAT_VIEW_TYPE_KEY, next);
    } catch {
      // ignore — choice still applies for this session
    }
  };

  return (
    <ChatDiffViewContext.Provider value={{ viewType, setViewType: setAndPersist }}>
      {children}
    </ChatDiffViewContext.Provider>
  );
}