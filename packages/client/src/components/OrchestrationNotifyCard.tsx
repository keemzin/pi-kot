import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  PowerOff,
  Bot,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { useSessionStore } from "../stores/session-store";
import { ChatMarkdown } from "./ChatMarkdown";

export interface OrchestrationEventData {
  stopReason?: string;
  errorMessage?: string;
  assistantText?: string | null;
  questionCount?: number;
  firstQuestionHeader?: string;
  firstQuestionText?: string;
  reason?: string;
  lastAgentStartAt?: string;
  wasLive?: boolean;
  [key: string]: unknown;
}

export interface OrchestrationDetails {
  source?: string;
  state?: string;
  eventType?: string;
  workerId?: string;
  inboxItemId?: string;
  pendingCount?: number;
  data?: OrchestrationEventData;
  [key: string]: unknown;
}

export interface CustomMessageProps {
  message: {
    id?: string;
    role: string;
    customType?: string;
    content?: unknown;
    details?: unknown;
    display?: boolean;
    [key: string]: unknown;
  };
}

interface ParsedError {
  statusCode?: number;
  code?: string;
  message: string;
  raw: string;
  hint?: string;
}

function parseErrorMessage(rawError?: string | null): ParsedError | null {
  if (!rawError || typeof rawError !== "string") return null;
  const trimmed = rawError.trim();
  if (!trimmed) return null;

  let statusCode: number | undefined;
  let code: string | undefined;
  let message = trimmed;

  // Pattern: "401: { ... }" or "500: { ... }"
  const httpMatch = trimmed.match(/^(\d{3}):\s*(\{.*\})$/s);
  if (httpMatch) {
    statusCode = parseInt(httpMatch[1], 10);
    try {
      const parsed = JSON.parse(httpMatch[2]) as Record<string, unknown>;
      code = (parsed.code as string) || (parsed.error as Record<string, unknown>)?.code as string;
      const parsedMsg = (parsed.message as string) || (parsed.error as Record<string, unknown>)?.message as string || (parsed.error as string);
      if (parsedMsg) message = String(parsedMsg);
    } catch {
      message = httpMatch[2];
    }
  } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      code = (parsed.code as string) || (parsed.error as Record<string, unknown>)?.code as string;
      const parsedMsg = (parsed.message as string) || (parsed.error as Record<string, unknown>)?.message as string || (parsed.error as string);
      if (parsedMsg) message = String(parsedMsg);
    } catch {
      // ignore
    }
  }

  let hint: string | undefined;
  if (statusCode === 401 || code === "INVALID_TOKEN" || code === "unauthorized") {
    hint = "The subagent worker was rejected by the LLM provider. Verify your API key and provider credentials.";
  } else if (statusCode === 429 || code === "rate_limit_exceeded") {
    hint = "Rate limit reached for this model/provider. Wait a moment or switch to an alternate provider.";
  } else if (statusCode && statusCode >= 500) {
    hint = "Remote provider experienced a server error. Try again shortly.";
  }

  return { statusCode, code, message, raw: trimmed, hint };
}

export const OrchestrationNotifyCard: React.FC<CustomMessageProps> = ({ message }) => {
  const [copiedId, setCopiedId] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const details = (message.details as OrchestrationDetails) ?? {};
  const data = details.data ?? {};
  const workerId = details.workerId ?? "";
  const shortWorkerId = workerId.length > 8 ? workerId.slice(0, 8) : workerId;
  const state = details.state ?? "";
  const eventType = details.eventType ?? "";

  const stopReason = data.stopReason ?? "";
  const errorMessage = data.errorMessage ?? "";
  const assistantText = data.assistantText ?? "";
  const questionHeader = data.firstQuestionHeader ?? "";
  const questionText = data.firstQuestionText ?? "";

  const parsedError = parseErrorMessage(errorMessage);

  const isError =
    state === "failed" ||
    stopReason === "error" ||
    Boolean(errorMessage) ||
    Boolean(parsedError);
  const isQuestion = state === "awaiting_question" || eventType === "worker.ask_user";
  const isSuccess = state === "ended" && !isError;
  const isDeleted = state === "deleted" || eventType === "worker.deleted";

  const variantClass = isError
    ? "error"
    : isQuestion
      ? "question"
      : isSuccess
        ? "success"
        : "info";

  const handleCopyWorkerId = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!workerId) return;
    void navigator.clipboard.writeText(workerId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleCopyJson = (e: React.MouseEvent) => {
    e.stopPropagation();
    const payload = details || message;
    void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleSwitchSession = () => {
    if (workerId) {
      void setActiveSession(workerId);
    }
  };

  return (
    <div className={`orch-notify-card ${variantClass}`}>
      {/* Header */}
      <div className="orch-notify-header">
        <div className="orch-notify-title-group">
          <div className="orch-notify-icon-wrap">
            {isError ? (
              <AlertTriangle size={15} className="orch-icon-error" />
            ) : isQuestion ? (
              <HelpCircle size={15} className="orch-icon-question" />
            ) : isSuccess ? (
              <CheckCircle2 size={15} className="orch-icon-success" />
            ) : isDeleted ? (
              <PowerOff size={15} className="orch-icon-dim" />
            ) : (
              <Bot size={15} className="orch-icon-accent" />
            )}
          </div>
          <span className="orch-notify-title">
            {isError
              ? "Subagent Failed"
              : isQuestion
                ? "Subagent Needs Input"
                : isSuccess
                  ? "Subagent Finished"
                  : isDeleted
                    ? "Subagent Terminated"
                    : "Subagent Notification"}
          </span>

          {workerId && (
            <button
              type="button"
              className="orch-notify-worker-badge"
              onClick={handleCopyWorkerId}
              title={`Worker ID: ${workerId} (click to copy)`}
            >
              <Bot size={11} style={{ opacity: 0.7 }} />
              <span>worker-{shortWorkerId}</span>
              {copiedId ? <Check size={10} style={{ color: "#98c379" }} /> : <Copy size={10} />}
            </button>
          )}
        </div>

        <div className="orch-notify-status-pill">
          {isError ? (
            parsedError?.statusCode ? (
              <span>● {parsedError.statusCode} Auth Error</span>
            ) : (
              <span>● {stopReason || "Error"}</span>
            )
          ) : isQuestion ? (
            <span>● Question</span>
          ) : isSuccess ? (
            <span>● Success</span>
          ) : (
            <span>● {state || "Reported"}</span>
          )}
        </div>
      </div>

      {/* Body: Error Box */}
      {isError && (
        <div className="orch-notify-error-box">
          <div className="orch-notify-error-title">
            <ShieldAlert size={14} />
            <span>
              {parsedError?.statusCode
                ? `${parsedError.statusCode} Unauthorized${parsedError.code ? ` — ${parsedError.code}` : ""}`
                : parsedError?.code
                  ? `Error: ${parsedError.code}`
                  : "Worker Process Error"}
            </span>
          </div>

          <div className="orch-notify-error-msg">
            {parsedError?.message || errorMessage || "The subagent encountered an unrecoverable error."}
          </div>

          {parsedError?.hint && (
            <div className="orch-notify-error-hint">
              💡 {parsedError.hint}
            </div>
          )}
        </div>
      )}

      {/* Body: Question Content */}
      {isQuestion && (
        <div className="orch-notify-question-box">
          {questionHeader && (
            <div className="orch-notify-question-header">{questionHeader}</div>
          )}
          {questionText && (
            <div className="orch-notify-question-body">{questionText}</div>
          )}
        </div>
      )}

      {/* Body: Assistant text / Summary */}
      {assistantText && (
        <div className="orch-notify-assistant-box">
          <div className="orch-notify-box-label">Output summary:</div>
          <ChatMarkdown text={assistantText} />
        </div>
      )}

      {/* If neither error, question, nor assistantText, show clean message fallback */}
      {!isError && !isQuestion && !assistantText && typeof message.content === "string" && (
        <div className="orch-notify-message-text">
          <ChatMarkdown text={message.content} />
        </div>
      )}

      {/* Footer Actions */}
      <div className="orch-notify-actions">
        {workerId && (
          <button
            type="button"
            className="orch-notify-btn primary"
            onClick={handleSwitchSession}
            title="Inspect worker conversation and tool execution history"
          >
            <ExternalLink size={12} />
            <span>Inspect Worker Session</span>
          </button>
        )}

        <button
          type="button"
          className="orch-notify-btn"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <span>{showDetails ? "Hide Payload" : "View Technical Details"}</span>
        </button>
      </div>

      {/* Collapsible Details */}
      {showDetails && (
        <div className="orch-notify-details">
          <div className="orch-notify-details-header">
            <span>Payload Data</span>
            <button
              type="button"
              className="orch-notify-copy-btn"
              onClick={handleCopyJson}
            >
              {copiedJson ? <Check size={11} style={{ color: "#98c379" }} /> : <Copy size={11} />}
              <span>{copiedJson ? "Copied" : "Copy JSON"}</span>
            </button>
          </div>
          <pre className="orch-notify-details-pre">
            {JSON.stringify(details || message, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export const GenericCustomMessageCard: React.FC<CustomMessageProps> = ({ message }) => {
  const [showDetails, setShowDetails] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  const customType = message.customType || "Custom Notification";
  const content = message.content;
  const details = message.details;

  const handleCopyJson = () => {
    void navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  return (
    <div className="generic-custom-card">
      <div className="generic-custom-header">
        <span className="generic-custom-badge">{customType}</span>
      </div>

      {typeof content === "string" && (
        <div className="generic-custom-content">
          <ChatMarkdown text={content} />
        </div>
      )}

      {details != null && (
        <div className="generic-custom-details-wrap">
          <button
            type="button"
            className="generic-custom-toggle-btn"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>{showDetails ? "Hide Details" : "Details"}</span>
          </button>

          {showDetails && (
            <div className="generic-custom-pre-wrap">
              <div className="generic-custom-pre-bar">
                <span>Payload</span>
                <button
                  type="button"
                  className="generic-custom-copy-btn"
                  onClick={handleCopyJson}
                >
                  {copiedJson ? <Check size={11} /> : <Copy size={11} />}
                  <span>{copiedJson ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <pre className="generic-custom-pre">
                {JSON.stringify(details, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const CustomMessageCard: React.FC<CustomMessageProps> = ({ message }) => {
  if (message.customType === "orchestration-notify") {
    return <OrchestrationNotifyCard message={message} />;
  }
  return <GenericCustomMessageCard message={message} />;
};
