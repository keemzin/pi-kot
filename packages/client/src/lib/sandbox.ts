/**
 * Sandboxed iframe infrastructure for running JavaScript in the browser.
 *
 * Creates an iframe with `sandbox="allow-scripts"`, injects a tiny runtime
 * that captures console output and communicates results via postMessage.
 *
 * Two modes:
 *  - REPL: execute raw JS, return console output + return value
 *  - Display: load HTML/SVG content for interactive preview (artifacts)
 */

export interface SandboxLog {
  method: "log" | "warn" | "error" | "info" | "debug";
  text: string;
}

export interface SandboxResult {
  success: boolean;
  logs: SandboxLog[];
  returnValue?: unknown;
  error?: { message: string; stack: string };
}

// SRCDOC for the sandbox iframe — a minimal JS runtime that captures
// console output and responds to postMessage execute commands.
const SANDBOX_SRCDOC = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
(function() {
  var logs = [];
  var orig = {};
  ['log','warn','error','info','debug'].forEach(function(m) {
    orig[m] = console[m];
    console[m] = function() {
      var args = Array.prototype.slice.call(arguments);
      var text = args.map(function(a) {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'object') try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
        return String(a);
      }).join(' ');
      logs.push({ method: m, text: text });
      orig[m].apply(console, args);
    };
  });

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'execute-code') {
      var respond = function(result) {
        try {
          e.source.postMessage(result, '*');
        } catch(_) {}
      };
      try {
        var returnValue = (0, eval)(e.data.code);
        var result = {
          type: 'execution-result',
          id: e.data.id,
          success: true,
          logs: logs.slice(),
          returnValue: returnValue
        };
        logs.length = 0;
        respond(result);
      } catch(err) {
        respond({
          type: 'execution-result',
          id: e.data.id,
          success: false,
          logs: logs.slice(),
          error: { message: err.message, stack: err.stack }
        });
        logs.length = 0;
      }
    }
  });

  window.parent.postMessage({ type: 'sandbox-ready' }, '*');
})();
<\/script>
</body>
</html>`;

// Shared message event ID counter
let msgIdCounter = 0;

/**
 * Create a sandboxed iframe and execute JavaScript code in it.
 * Returns a promise that resolves with the execution result.
 */
export function executeInSandbox(code: string, timeoutMs = 30_000): Promise<SandboxResult> {
  return new Promise((resolve, reject) => {
    const id = `sb-${Date.now()}-${++msgIdCounter}`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none"; // hidden for REPL execution
    iframe.srcdoc = SANDBOX_SRCDOC;

    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener("message", handler);
        iframe.remove();
        resolve({ success: false, logs: [], error: { message: "Execution timeout", stack: "" } });
      }
    }, timeoutMs);

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "sandbox-ready" && e.source === iframe.contentWindow) {
        // Sandbox is ready — send the code
        iframe.contentWindow?.postMessage({ type: "execute-code", id, code }, "*");
        return;
      }

      if (e.data?.type === "execution-result" && e.data?.id === id) {
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("message", handler);
        iframe.remove();
        resolve({
          success: e.data.success,
          logs: e.data.logs || [],
          returnValue: e.data.returnValue,
          error: e.data.error,
        });
      }
    };

    window.addEventListener("message", handler);

    // Wait for iframe to load then it'll send sandbox-ready
    document.body.appendChild(iframe);
  });
}

/**
 * Create a sandboxed iframe that displays HTML content (for artifacts).
 * Returns a ref-like cleanup function.
 *
 * @param container - the DOM element to mount the iframe into
 * @param html - the full HTML content to render
 * @param sandboxAttr - which sandbox attributes to allow (default: allow-scripts)
 * @returns cleanup function to remove the iframe
 */
export function displayInSandbox(
  container: HTMLElement,
  html: string,
  sandboxAttr = "allow-scripts allow-modals",
): () => void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", sandboxAttr);
  iframe.style.cssText = "width:100%;height:100%;border:none;border-radius:6px;background:white;";
  // For display mode, set height to content
  iframe.srcdoc = html;
  // Clear container and append
  container.innerHTML = "";
  container.appendChild(iframe);

  return () => {
    iframe.remove();
  };
}
