import { type FormEvent, useRef, useEffect, useState, useCallback, type ClipboardEvent } from "react";
import { useSessionStore } from "../stores/session-store";
import { usePreferencesStore } from "../stores/preferences-store";
import type { ImageContent } from "../lib/api-client";
import { fetchSessionExtensions, execCommand, execCommandStream, completeFiles } from "../lib/api-client";
import { ModelDropdown } from "./ModelDropdown";
import { getSessionModel, setSessionThinking } from "../lib/api-client";

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
  const sendFollowUp = useSessionStore((s) => s.sendFollowUp);
  const abort = useSessionStore((s) => s.abort);
  const reloadMessages = useSessionStore((s) => s.reloadMessages);
  const [slashSuggestions, setSlashSuggestions] = useState<SlashCommand[]>([]);
  const [extensionCommands, setExtensionCommands] = useState<SlashCommand[]>([]);
  const [compacting, setCompacting] = useState(false);
  const [thinkingLevel, setThinkingLevel] = useState<string | undefined>(undefined);
  const [availableLevels, setAvailableLevels] = useState<string[]>([]);
  const [compactMessage, setCompactMessage] = useState<string | null>(null);

  // ── Hold-to-followUp state (streaming only) ──
  const HOLD_DURATION = 600; // ms to hold before followUp triggers
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdRafRef = useRef<number | null>(null);
  const holdStartRef = useRef<number>(0);
  const [holdProgress, setHoldProgress] = useState(0); // 0–1
  const [holdReady, setHoldReady] = useState(false);   // ring fully filled

  // ── @-autocomplete state ──
  const project = useSessionStore((s) => {
    if (s.activeProjectId === undefined) return undefined;
    return s.projects.find((p) => p.id === s.activeProjectId);
  });
  const [acToken, setAcToken] = useState<{ start: number; end: number; query: string } | undefined>();
  const [acSuggestions, setAcSuggestions] = useState<string[]>([]);
  const [acSelectedIdx, setAcSelectedIdx] = useState(0);
  const acFetchSeqRef = useRef(0);

  // ── Bang mode (! / !!) ──
  const bangMode: "context" | "local" | undefined = (() => {
    if (isStreaming) return undefined;
    const text = textareaRef.current?.value ?? "";
    if (text.startsWith("!!")) return "local";
    if (text.startsWith("!")) return "context";
    return undefined;
  })();

  // Auto-clear inline message after 2.5s
  useEffect(() => {
    if (compactMessage === null) return;
    const id = setTimeout(() => setCompactMessage(null), 2500);
    return () => clearTimeout(id);
  }, [compactMessage]);

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
        try {
          await useSessionStore.getState().compactAndReload(sid);
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : String(err);
          if (msg.includes("nothing_to_compact")) {
            setCompactMessage("Nothing to compact");
            return;
          }
          throw err;
        }
      },
    },
    {
      name: "/compact with summary",
      description: "Compact and keep focus on specific areas",
      handler: async (sid: string) => {
        try {
          await useSessionStore.getState().compactAndReload(sid);
        } catch (err: unknown) {
          const msg =
            err instanceof Error ? err.message : String(err);
          if (msg.includes("nothing_to_compact")) {
            setCompactMessage("Nothing to compact");
            return;
          }
          throw err;
        }
      },
    },
    {
      name: "/reload",
      description: "Reload agent config and rebuild session tools",
      handler: async () => {
        const { reloadAgent } = await import("../lib/api-client");
        await reloadAgent();
      },
    },
    {
      name: "/abort",
      description: "Abort the current streaming response",
      handler: async () => {
        useSessionStore.getState().abort();
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
  const compressImages = usePreferencesStore((s) => s.compressImages);

  /**
   * Downscale an image to at most 2048px on the longest edge.
   * Converts to JPEG quality 0.85. Returns a Blob.
   * If the image is already smaller, returns the original File unchanged.
   */
  const compressImage = useCallback(
    (file: File): Promise<Blob> =>
      new Promise((resolve, reject) => {
        if (!compressImages) {
          resolve(file);
          return;
        }
        const img = new Image();
        img.onload = () => {
          const MAX_DIM = 2048;
          if (img.width <= MAX_DIM && img.height <= MAX_DIM) {
            URL.revokeObjectURL(img.src);
            resolve(file);
            return;
          }
          let { width, height } = img;
          if (width > height) {
            if (width > MAX_DIM) {
              height = Math.round((height * MAX_DIM) / width);
              width = MAX_DIM;
            }
          } else {
            if (height > MAX_DIM) {
              width = Math.round((width * MAX_DIM) / height);
              height = MAX_DIM;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          // Fill white background for PNG transparency
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          URL.revokeObjectURL(img.src);
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Canvas toBlob returned null"));
            },
            "image/jpeg",
            0.85,
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(img.src);
          reject(new Error("Failed to decode image for compression"));
        };
        img.src = URL.createObjectURL(file);
      }),
    [compressImages],
  );

  const fileToBase64 = (file: Blob): Promise<string> =>
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

  // ── @-autocomplete logic ──

  /** Find an @-token at the caret position, if any. */
  const findAcToken = (value: string, caret: number): { start: number; end: number; query: string } | undefined => {
    if (caret <= 0) return undefined;
    let i = caret - 1;
    while (i >= 0) {
      const ch = value[i];
      if (ch === undefined) break;
      if (/\s/.test(ch)) return undefined;
      if (ch === "@") {
        const prev = i === 0 ? " " : value[i - 1];
        if (prev === undefined || /\s/.test(prev)) {
          return { start: i, end: caret, query: value.slice(i + 1, caret) };
        }
        return undefined; // email@example.com
      }
      i -= 1;
    }
    return undefined;
  };

  // Debounced fetch of @-completion suggestions
  useEffect(() => {
    if (acToken === undefined || project === undefined) return undefined;
    const seq = acFetchSeqRef.current + 1;
    acFetchSeqRef.current = seq;
    const handle = window.setTimeout(() => {
      completeFiles(project.id, acToken.query, { limit: 20 })
        .then((r) => {
          if (acFetchSeqRef.current !== seq) return; // stale
          setAcSuggestions(r.paths);
          setAcSelectedIdx(0);
        })
        .catch(() => {
          if (acFetchSeqRef.current !== seq) return;
          setAcSuggestions([]);
        });
    }, 100);
    return () => window.clearTimeout(handle);
  }, [acToken, project]);

  /** Insert the highlighted suggestion in place of the partial token. */
  const acInsert = (path: string): void => {
    if (acToken === undefined) return;
    const el = textareaRef.current;
    if (el === null) return;
    const before = el.value.slice(0, acToken.start);
    const after = el.value.slice(acToken.end);
    const replacement = `@"${path}"`;
    const next = `${before}${replacement}${after}`;
    el.value = next;
    setAcToken(undefined);
    setAcSuggestions([]);
    // Move caret after the inserted path
    const newCaret = acToken.start + replacement.length;
    el.setSelectionRange(newCaret, newCaret);
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const acClose = (): void => {
    setAcToken(undefined);
    setAcSuggestions([]);
  };

  // ── Fetch thinking level when session changes ──
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    getSessionModel(sessionId)
      .then((res) => {
        if (cancelled) return;
        setThinkingLevel(res.thinkingLevel);
        setAvailableLevels(res.availableThinkingLevels);
      })
      .catch(() => {/* session not ready */});
    return () => { cancelled = true; };
  }, [sessionId]);

  // ── Cycle thinking level ──
  const cycleThinking = useCallback(async () => {
    if (!sessionId || availableLevels.length === 0) return;
    const cur = thinkingLevel || "off";
    const idx = availableLevels.indexOf(cur);
    const next = availableLevels[(idx + 1) % availableLevels.length];
    try {
      const res = await setSessionThinking(sessionId, next);
      setThinkingLevel(res.thinkingLevel);
      setAvailableLevels(res.availableThinkingLevels);
    } catch {
      // silently fail
    }
  }, [sessionId, thinkingLevel, availableLevels]);

  // ── Submit handler ──

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const el = textareaRef.current;
    if (el === null) return;
    const text = el.value.trim();
    if (text.length === 0 && images.length === 0) return;

    // Check if the input is a slash command
    if (text.startsWith("/") && !isStreaming) {
      const trimmed = text.trim().toLowerCase();
      const matched = allSlashCommands.find((cmd) => cmd.name.startsWith(trimmed));
      if (matched) {
        el.value = "";
        el.style.height = "auto";
        setSlashSuggestions([]);
        setImages([]);
        acClose();
        await matched.handler(sessionId);
        return;
      }
    }

    // ── Bash exec dispatch: !cmd / !!cmd (streaming) ──
    if (!isStreaming && /^!!?[^!]/.test(text)) {
      const excludeFromContext = text.startsWith("!!");
      const command = text.slice(excludeFromContext ? 2 : 1).trim();
      if (command.length === 0) {
        setCompactMessage("Empty bash command. Type something after the `!`.");
        return;
      }
      el.value = "";
      el.style.height = "auto";
      setSlashSuggestions([]);
      setImages([]);
      acClose();

      const { promise } = execCommandStream(sessionId, command, { excludeFromContext });
      try {
        await promise;
        await reloadMessages(sessionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setCompactMessage(`Command failed: ${msg}`);
      }
      return;
    }

    // ── Convert images to SDK ImageContent[] ──
    let imageContents: ImageContent[] | undefined;
    if (images.length > 0) {
      imageContents = await Promise.all(
        images.map(async ({ file }) => {
          const compressed = await compressImage(file);
          return {
            type: "image" as const,
            data: await fileToBase64(compressed),
            // If compression changed the file, mimeType is now JPEG
            mimeType: compressed === file ? file.type : "image/jpeg",
          };
        }),
      );
    }

    el.value = "";
    el.style.height = "auto";
    setSlashSuggestions([]);
    acClose();

    // Keep blob URLs alive for optimistic display
    setImages([]);

    if (isStreaming) {
      await sendSteer(text, imageContents);
    } else {
      await sendPrompt(text, imageContents);
    }
  };

  // ── Hold-to-followUp handlers (only active while streaming) ──
  const cancelHold = useCallback(() => {
    if (holdTimerRef.current !== null) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (holdRafRef.current !== null) {
      cancelAnimationFrame(holdRafRef.current);
      holdRafRef.current = null;
    }
    setHoldProgress(0);
    setHoldReady(false);
  }, []);

  const startHold = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isStreaming) return;
    // prevent the normal click/abort from firing immediately
    e.preventDefault();
    holdStartRef.current = performance.now();
    setHoldProgress(0);
    setHoldReady(false);

    // animate the progress ring
    const tick = () => {
      const elapsed = performance.now() - holdStartRef.current;
      const p = Math.min(elapsed / HOLD_DURATION, 1);
      setHoldProgress(p);
      if (p < 1) {
        holdRafRef.current = requestAnimationFrame(tick);
      } else {
        setHoldReady(true);
      }
    };
    holdRafRef.current = requestAnimationFrame(tick);

    holdTimerRef.current = setTimeout(() => {
      setHoldReady(true);
    }, HOLD_DURATION);
  }, [isStreaming]);

  const commitHold = useCallback(async (e: React.MouseEvent | React.TouchEvent) => {
    if (!isStreaming) return;
    e.preventDefault();
    const elapsed = performance.now() - holdStartRef.current;
    cancelHold();

    const el = textareaRef.current;
    const text = el?.value.trim() ?? "";
    if (!text) {
      // short tap → abort (stop)
      abort();
      return;
    }

    if (elapsed >= HOLD_DURATION) {
      // held long enough → followUp
      let imageContents: ImageContent[] | undefined;
      if (images.length > 0) {
        imageContents = await Promise.all(
          images.map(async ({ file }) => {
            const compressed = await compressImage(file);
            return {
              type: "image" as const,
              data: await fileToBase64(compressed),
              mimeType: compressed === file ? file.type : "image/jpeg",
            };
          }),
        );
      }
      el!.value = "";
      el!.style.height = "auto";
      setImages([]);
      await sendFollowUp(text, imageContents);
    } else {
      // short tap with text → steer
      let imageContents: ImageContent[] | undefined;
      if (images.length > 0) {
        imageContents = await Promise.all(
          images.map(async ({ file }) => {
            const compressed = await compressImage(file);
            return {
              type: "image" as const,
              data: await fileToBase64(compressed),
              mimeType: compressed === file ? file.type : "image/jpeg",
            };
          }),
        );
      }
      el!.value = "";
      el!.style.height = "auto";
      setImages([]);
      await sendSteer(text, imageContents);
    }
  }, [isStreaming, images, sendFollowUp, sendSteer, abort, cancelHold]);

  const onKeyDown = (e: React.KeyboardEvent) => {
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

    const text = el.value;

    // ── Detect slash commands ──
    if (text.startsWith("/")) {
      const trimmed = text.trim().toLowerCase();
      const matched = allSlashCommands.filter((cmd) => cmd.name.startsWith(trimmed));
      setSlashSuggestions(matched);
    } else {
      setSlashSuggestions([]);
    }

    // ── Detect @-autocomplete token ──
    const caret = el.selectionStart;
    if (caret !== undefined && !isStreaming) {
      const token = findAcToken(text, caret);
      setAcToken(token);
    } else {
      acClose();
    }
  }, [extensionCommands, allSlashCommands, isStreaming]);

  const handleSlashCommand = async (cmd: SlashCommand) => {
    const el = textareaRef.current;
    if (el === null) return;
    el.value = "";
    el.style.height = "auto";
    setSlashSuggestions([]);
    acClose();
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

      <div className="ti-container">
        {/* Inline status message */}
        {compactMessage !== null && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              padding: "2px 0 0",
              textAlign: "center",
            }}
          >
            {compactMessage}
          </div>
        )}
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

        {/* @-completion popover — anchored above the textarea */}
        {acToken !== undefined && acSuggestions.length > 0 && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: 0,
              zIndex: 10,
              marginBottom: 4,
              overflow: "hidden",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: "var(--bg-frosted)",
            }}
          >
            <div
              style={{
                maxHeight: "60vh",
                overflowY: "auto",
                padding: "4px 0",
              }}
            >
              {acSuggestions.map((path, i) => (
                <button
                  key={path}
                  onMouseDown={(ev) => {
                    ev.preventDefault();
                    acInsert(path);
                  }}
                  onMouseEnter={() => setAcSelectedIdx(i)}
                  style={{
                    display: "block",
                    width: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "6px 12px",
                    textAlign: "left",
                    fontFamily: "monospace",
                    fontSize: 12,
                    border: "none",
                    cursor: "pointer",
                    background: i === acSelectedIdx ? "var(--accent-bg, var(--bg-glass-active))" : "transparent",
                    color: i === acSelectedIdx ? "var(--text-primary)" : "var(--text-secondary)",
                  }}
                  title={path}
                >
                  {path}
                </button>
              ))}
            </div>
            <div
              style={{
                borderTop: "1px solid var(--border)",
                padding: "4px 12px",
                fontSize: 10,
                color: "var(--text-dim)",
              }}
            >
              ↑↓ navigate · Enter/Tab insert · Esc close
            </div>
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
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          onInput={handleInput}
          placeholder={
            compacting
              ? "Compacting…"
              : isStreaming
                ? "Steer the agent…"
                : "Send a message... (/compact, /abort, !cmd, @file)"
          }
          disabled={compacting}
          rows={1}
        />

        <div className="ti-toolbar">
          <div className="ti-toolbar-left">
            {/* Bang mode indicator */}
            {bangMode !== undefined && (
              <span
                style={{
                  fontSize: 10,
                  color: bangMode === "local" ? "var(--accent-text)" : "var(--text-secondary)",
                  padding: "0 6px",
                  fontFamily: "monospace",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  opacity: 0.7,
                }}
                title={
                  bangMode === "local"
                    ? "!! — bash runs locally, output stays out of LLM context"
                    : "! — bash runs, output feeds into next LLM turn"
                }
              >
                {bangMode === "local" ? "!! local" : "! context"}
              </span>
            )}

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
            {sessionId !== undefined && availableLevels.length > 0 && (
              <button
                type="button"
                className="ti-thinking-btn"
                onClick={cycleThinking}
                tabIndex={-1}
                title={`Thinking: ${thinkingLevel || "off"} — click to cycle`}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M12 2a10 10 0 1 0 10 10" />
                  <path d="M12 6v6l4 2" />
                </svg>
                <span className="ti-thinking-label">{thinkingLevel || "off"}</span>
              </button>
            )}
            {/* One button: send (idle) / stop+steer+hold-followUp (streaming) */}
            <button
              type={isStreaming ? "button" : "submit"}
              onClick={isStreaming ? undefined : undefined}
              onMouseDown={isStreaming ? startHold : undefined}
              onMouseUp={isStreaming ? commitHold : undefined}
              onMouseLeave={isStreaming ? cancelHold : undefined}
              onTouchStart={isStreaming ? startHold : undefined}
              onTouchEnd={isStreaming ? commitHold : undefined}
              onTouchCancel={isStreaming ? cancelHold : undefined}
              className={`ti-send-btn${isStreaming ? " ti-send-btn-stop" : ""}${isStreaming && activeToolName && holdProgress === 0 ? " pulsing" : ""}${holdReady ? " ti-send-btn-followup-ready" : ""}`}
              title={isStreaming ? (holdProgress > 0 ? "Release to follow-up" : "Tap to steer · Hold to follow-up") : "Send"}
              tabIndex={-1}
              disabled={compacting}
            >
              {/* Hold progress ring — only visible while streaming and holding */}
              {isStreaming && holdProgress > 0 && (
                <svg
                  className="ti-hold-ring"
                  viewBox="0 0 36 36"
                  style={{
                    position: "absolute",
                    top: 0, left: 0,
                    width: "100%", height: "100%",
                    transform: "rotate(-90deg)",
                    pointerEvents: "none",
                  }}
                >
                  <circle
                    cx="18" cy="18" r="15"
                    fill="none"
                    stroke={holdReady ? "var(--accent-text, #a78bfa)" : "var(--text-primary)"}
                    strokeWidth="2.5"
                    strokeDasharray={`${holdProgress * 94.25} 94.25`}
                    strokeLinecap="round"
                    style={{ transition: "stroke 0.15s" }}
                  />
                </svg>
              )}
              <span className="ti-send-icon">
                {isStreaming ? (
                  holdReady ? (
                    // followUp icon — clock/queue
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" />
                      <polyline points="12 7 12 12 15 15" />
                    </svg>
                  ) : (
                    // stop square
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                    </svg>
                  )
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                )}
              </span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
