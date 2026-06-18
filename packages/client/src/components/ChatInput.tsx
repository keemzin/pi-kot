import { type FormEvent, useRef, useEffect, useState, useCallback } from "react";
import { useSessionStore } from "../stores/session-store";
import { useContextData, ContextPill, ContextInspectModal } from "./ContextBar";
import { compactSession } from "../lib/api-client";

interface Props {
  sessionId: string;
  showOrch?: boolean;
  setShowOrch?: (v: boolean) => void;
  onInspectContext?: (data: any) => void;
  onOpenMCP?: () => void;
}

/**
 * Slash commands for the chat input. Matching pi-forge's pattern:
 * `/compact` triggers manual compaction.
 */
const SLASH_COMMANDS = [
  {
    name: "/compact",
    description: "Manually compact the session context",
    handler: async (sessionId: string) => {
      await compactSession(sessionId);
    },
  },
  {
    name: "/compact with summary",
    description: "Compact and keep focus on specific areas",
    handler: async (sessionId: string) => {
      await compactSession(sessionId);
    },
  },
];

export function ChatInput({ sessionId, showOrch, setShowOrch, onInspectContext, onOpenMCP }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const abort = useSessionStore((s) => s.abort);
  const contextData = useContextData(sessionId);

  const [slashSuggestions, setSlashSuggestions] = useState<typeof SLASH_COMMANDS>([]);
  const [compacting, setCompacting] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (el !== null) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (el === null) return;
    const text = el.value.trim();
    if (text.length === 0) return;
    el.value = "";
    el.style.height = "auto";
    setSlashSuggestions([]);
    sendPrompt(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;

    // Detect slash commands
    const text = el.value;
    if (text.startsWith("/")) {
      const trimmed = text.trim().toLowerCase();
      const matched = SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(trimmed));
      setSlashSuggestions(matched);
    } else {
      setSlashSuggestions([]);
    }
  }, []);

  const handleSlashCommand = async (cmd: (typeof SLASH_COMMANDS)[number]) => {
    const el = textareaRef.current;
    if (el === null) return;
    el.value = "";
    el.style.height = "auto";
    setSlashSuggestions([]);
    setCompacting(true);
    try {
      await cmd.handler(sessionId);
    } catch (err) {
      console.error("Slash command failed:", err);
    } finally {
      setCompacting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="ti-area">
      <div className="ti-container">
        {/* Slash command suggestions */}
        {slashSuggestions.length > 0 && (
          <div className="ti-slash-suggestions">
            {slashSuggestions.map((cmd) => (
              <button
                key={cmd.name}
                type="button"
                className="ti-slash-item"
                onClick={() => handleSlashCommand(cmd)}
                disabled={compacting}
              >
                <span className="ti-slash-name">{cmd.name}</span>
                <span className="ti-slash-desc">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="ti-input"
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder={compacting ? "Compacting…" : "Send a message... (/compact, /abort)"}
          disabled={isStreaming || compacting}
          rows={1}
        />

        <div className="ti-toolbar">
          <div className="ti-toolbar-left">
            <button
              type="button"
              className="ti-toolbar-btn"
              onClick={() => setShowOrch?.(!showOrch)}
              title="Subagent"
              tabIndex={-1}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" style={{ fill: showOrch ? "currentColor" : "none" }} />
              </svg>
            </button>

            <button
              type="button"
              className="ti-toolbar-btn"
              onClick={onOpenMCP}
              title="MCP Settings"
              tabIndex={-1}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </button>

            <ContextPill
              data={contextData}
              onInspect={(d) => onInspectContext?.(d)}
            />
          </div>

          <div className="ti-toolbar-right">
            {isStreaming ? (
              <button type="button" onClick={abort} className="ti-abort-btn" title="Abort" tabIndex={-1}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            ) : (
              <button type="submit" className="ti-send-btn" title="Send" tabIndex={-1} disabled={compacting}>
                <span className="ti-send-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
