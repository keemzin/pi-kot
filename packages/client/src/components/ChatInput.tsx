import { type FormEvent, useRef, useEffect, useState, useCallback, type ClipboardEvent } from "react";
import { useSessionStore } from "../stores/session-store";
import type { ImageContent } from "../lib/api-client";
import { fetchSessionExtensions } from "../lib/api-client";
import { ModelDropdown } from "./ModelDropdown";

interface Props {
  sessionId: string;
  showOrch?: boolean;
  setShowOrch?: (v: boolean) => void;
  selectedModel?: string;
  onModelSelect?: (modelId: string, provider: string) => void;
  onModelError?: (error: string) => void;
}

/**
 * Slash command descriptor for the chat input.
 */
interface SlashCommand {
  name: string;
  description: string;
  handler: (sessionId: string) => Promise<void>;
  /** Whether this is an extension command that needs the invokeExtensionCommand API */
  isExtension?: boolean;
}

export function ChatInput({ sessionId, showOrch, setShowOrch, selectedModel, onModelSelect, onModelError }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isStreaming = useSessionStore((s) => s.streamState.isStreaming);
  const activeToolName = useSessionStore((s) => s.streamState.activeToolName);
  const sendPrompt = useSessionStore((s) => s.sendPrompt);
  const sendSteer = useSessionStore((s) => s.sendSteer);
  const abort = useSessionStore((s) => s.abort);
  const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
  const [extensionCommands, setExtensionCommands] = useState<SlashCommand[]>([]);
  const [compacting, setCompacting] = useState(false);

  // Fetch extension commands from the session's ExtensionRunner
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    fetchSessionExtensions(sessionId)
      .then((info) => {
        if (cancelled) return;
        const cmds: SlashCommand[] = info.commands.map((cmd) => ({
          name: "/" + cmd.invocationName,
          description: cmd.description || "Extension command",
          handler: async (sid: string) => {
            const { invokeExtensionCommand } = await import("../lib/api-client");
            await invokeExtensionCommand(sid, cmd.invocationName);
          },
          isExtension: true,
        }));
        setExtensionCommands(cmds);
      })
      .catch(() => {
        // session may not be live yet — that's fine
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Build the full slash command list from builtins + extension commands
  const builtinCommands: SlashCommand[] = [
    {
      name: "/compact",
      description: "Manually compact the session context",
      handler: async (sid: string) => {
        await useSessionStore.getState().compactAndReload(sid);
      },
    },
    {
      name: "/compact with summary",
      description: "Compact and keep focus on specific areas",
      handler: async (sid: string) => {
        await useSessionStore.getState().compactAndReload(sid);
      },
    },
  ];
  const allSlashCommands = [...builtinCommands, ...extensionCommands];

  // ── Image attachments ──
  const [images, setImages] = useState<{ file: File; dataUrl: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_IMAGES = 5;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
  const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip the data:image/...;base64, prefix
        const comma = result.indexOf(",");
        resolve(comma !== -1 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const addImageFiles = (files: FileList | File[]) => {
    const next = [...images];
    for (const f of files) {
      if (!ACCEPTED_IMAGE_TYPES.includes(f.type)) continue;
      if (f.size > MAX_IMAGE_BYTES) continue;
      if (next.length >= MAX_IMAGES) break;
      const dataUrl = URL.createObjectURL(f);
      next.push({ file: f, dataUrl });
    }
    setImages(next);
  };

  const removeImage = (idx: number) => {
    const removed = images[idx];
    if (removed !== undefined) {
      URL.revokeObjectURL(removed.dataUrl);
    }
    setImages((cur) => cur.filter((_, i) => i !== idx));
  };

  const handleFilePicker = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addImageFiles(e.target.files);
    e.target.value = "";
  };

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      addImageFiles(imageFiles);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files) addImageFiles(e.dataTransfer.files);
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (el !== null) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (el === null) return;
    const text = el.value.trim();
    if (text.length === 0 && images.length === 0) return;

    // Check if the input is a slash command — route through the command
    // handler instead of sendPrompt. Otherwise the SDK executes the command
    // silently and the GUI never sees the result.
    if (text.startsWith("/") && !isStreaming) {
      const trimmed = text.trim().toLowerCase();
      const matched = allSlashCommands.find((cmd) => cmd.name.startsWith(trimmed));
      if (matched) {
        el.value = "";
        el.style.height = "auto";
        setSlashSuggestions([]);
        setImages([]);
        await matched.handler(sessionId);
        return;
      }
    }

    // Convert images to SDK ImageContent[]
    let imageContents: ImageContent[] | undefined;
    if (images.length > 0) {
      imageContents = await Promise.all(
        images.map(async ({ file }) => ({
          type: "image" as const,
          data: await fileToBase64(file),
          mimeType: file.type,
        })),
      );
    }

    el.value = "";
    el.style.height = "auto";
    setSlashSuggestions([]);

    // Keep blob URLs alive for optimistic display; they get cleaned up
    // when ChatInput unmounts (existing useEffect). Clear state so the
    // preview thumbnails disappear but the optimistic message still works.
    setImages([]);

    if (isStreaming) {
      await sendSteer(text, imageContents);
    } else {
      await sendPrompt(text, imageContents);
    }
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

    // Detect slash commands — match against both builtin and extension commands
    const text = el.value;
    if (text.startsWith("/")) {
      const trimmed = text.trim().toLowerCase();
      const matched = allSlashCommands.filter((cmd) => cmd.name.startsWith(trimmed));
      setSlashSuggestions(matched);
    } else {
      setSlashSuggestions([]);
    }
  }, [extensionCommands, allSlashCommands]);

  const handleSlashCommand = async (cmd: SlashCommand) => {
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
    <form onSubmit={handleSubmit} onDragOver={handleDragOver} onDrop={handleDrop} className="ti-area">
      {isStreaming && (
        <div className="ti-steer-badge">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <span>Your message will redirect the agent after its current tool calls</span>
        </div>
      )}
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

        {/* Image preview thumbnails */}
        {images.length > 0 && (
          <div className="ti-image-preview-row">
            {images.map((img, i) => (
              <div key={i} className="ti-image-preview-item">
                <img src={img.dataUrl} alt={`Attachment ${i + 1}`} className="ti-image-thumb" />
                <button
                  type="button"
                  className="ti-image-remove"
                  onClick={() => removeImage(i)}
                  aria-label="Remove image"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="ti-input"
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onInput={handleInput}
          placeholder={
            compacting
              ? "Compacting…"
              : isStreaming
                ? "Steer the agent…"
                : "Send a message... (/compact, /abort)"
          }
          disabled={compacting}
          rows={1}
        />

        <div className="ti-toolbar">
          <div className="ti-toolbar-left">
            {/* Image attach button */}
            <button
              type="button"
              className="ti-toolbar-btn"
              onClick={handleFilePicker}
              title="Attach image"
              tabIndex={-1}
              disabled={images.length >= MAX_IMAGES}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

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

            {/* MCP moved to header bar */}
          </div>

          <div className="ti-toolbar-right">
            {onModelSelect !== undefined && (
              <ModelDropdown
                sessionId={sessionId}
                selected={selectedModel ?? ""}
                onSelect={onModelSelect}
                onError={onModelError ?? (() => {})}
                compact
              />
            )}
            {isStreaming ? (
              <>
                <button type="button" onClick={abort} className="ti-abort-btn" title="Abort" tabIndex={-1}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                </button>
                <button type="submit" className="ti-send-btn ti-steer-send" title="Send (steer)" tabIndex={-1} disabled={compacting}>
                  <span className="ti-send-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5" />
                      <polyline points="5 12 12 5 19 12" />
                    </svg>
                  </span>
                </button>
              </>
            ) : (
              <button type="submit" className={`ti-send-btn${isStreaming && activeToolName ? " pulsing" : ""}`} title="Send" tabIndex={-1} disabled={compacting}>
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
