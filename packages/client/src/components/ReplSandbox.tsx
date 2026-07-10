import { useState, useCallback, useRef, useEffect } from "react";
import { executeInSandbox, type SandboxLog } from "../lib/sandbox";

interface Props {
  code: string;
  title?: string;
  /** Server-side execution output (shown initially) */
  serverOutput?: string;
  /** Whether the tool call is still running */
  isRunning?: boolean;
  /** Whether the tool call errored */
  isError?: boolean;
}

/**
 * REPL display component for `javascript_repl` tool calls.
 *
 * Shows:
 *  1. Title + code (collapsible)
 *  2. Server-side output (if available)
 *  3. "Run in Browser" button that executes the code in a sandboxed iframe
 *  4. Client-side sandbox output (console logs, return values, errors)
 */
export function ReplSandbox({ code, title, serverOutput, isRunning, isError }: Props) {
  const [codeOpen, setCodeOpen] = useState(false);
  const [sandboxResult, setSandboxResult] = useState<{
    logs: SandboxLog[];
    error?: { message: string; stack: string };
    returnValue?: unknown;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const execIdRef = useRef(0);

  const handleRun = useCallback(async () => {
    const id = ++execIdRef.current;
    setRunning(true);
    setSandboxResult(null);
    setSandboxError(null);

    try {
      const result = await executeInSandbox(code);
      // Only update if this is still the latest execution
      if (id !== execIdRef.current) return;

      if (result.success) {
        setSandboxResult({
          logs: result.logs || [],
          returnValue: result.returnValue,
        });
      } else {
        setSandboxResult({
          logs: result.logs || [],
          error: result.error,
        });
      }
    } catch (err) {
      if (id !== execIdRef.current) return;
      setSandboxError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      if (id === execIdRef.current) {
        setRunning(false);
      }
    }
  }, [code]);

  return (
    <div className="repl-sandbox">
      {/* Header */}
      <div className="repl-sandbox-header">
        <span className="repl-sandbox-icon">{isRunning ? "⏳" : isError ? "✖" : "▶"}</span>
        <span className="repl-sandbox-title">{title || "JavaScript REPL"}</span>
      </div>

      {/* Code section (collapsible) */}
      <div className="repl-sandbox-code">
        <button
          type="button"
          className="repl-sandbox-toggle"
          onClick={() => setCodeOpen((o) => !o)}
          aria-expanded={codeOpen}
        >
          {codeOpen ? "▾" : "▸"} Code
        </button>
        {codeOpen && (
          <pre className="repl-sandbox-code-block">
            <code>{code}</code>
          </pre>
        )}
      </div>

      {/* Server-side output */}
      {serverOutput && (
        <div className={`repl-sandbox-output ${isError ? "error" : ""}`}>
          <div className="repl-sandbox-output-label">Server</div>
          <pre className="repl-sandbox-output-text">{serverOutput}</pre>
        </div>
      )}

      {/* Run in Browser button */}
      <button
        type="button"
        className="repl-sandbox-run-btn"
        onClick={handleRun}
        disabled={running}
      >
        {running ? "⏳ Running…" : isError ? "🔄 Retry in Browser" : "▶ Run in Browser"}
      </button>

      {/* Client sandbox output */}
      {sandboxResult && (
        <div className="repl-sandbox-output">
          <div className="repl-sandbox-output-label">
            Browser Sandbox {sandboxResult.error ? "(error)" : ""}
          </div>
          {sandboxResult.logs.length > 0 && (
            <div className="repl-sandbox-console">
              {sandboxResult.logs.map((log, i) => (
                <div
                  key={i}
                  className={`repl-sandbox-console-line ${log.method === "error" ? "error" : log.method === "warn" ? "warn" : ""}`}
                >
                  <span className="repl-sandbox-console-method">{log.method}</span>
                  <span className="repl-sandbox-console-text">{log.text}</span>
                </div>
              ))}
            </div>
          )}
          {sandboxResult.returnValue !== undefined && !sandboxResult.error && (
            <div className="repl-sandbox-return">
              <span className="repl-sandbox-console-method">→</span>
              <pre className="repl-sandbox-return-value">
                {typeof sandboxResult.returnValue === "object"
                  ? JSON.stringify(sandboxResult.returnValue, null, 2)
                  : String(sandboxResult.returnValue)}
              </pre>
            </div>
          )}
          {sandboxResult.error && (
            <pre className="repl-sandbox-error-block">
              <strong>Error:</strong> {sandboxResult.error.message}
              {"\n"}
              {sandboxResult.error.stack}
            </pre>
          )}
        </div>
      )}
      {sandboxError && (
        <pre className="repl-sandbox-error-block">
          <strong>Sandbox Error:</strong> {sandboxError}
        </pre>
      )}
    </div>
  );
}
