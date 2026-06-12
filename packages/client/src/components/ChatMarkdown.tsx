/**
 * Markdown renderer for chat messages.
 *
 * Ported from pi-forge/packages/client/src/components/ChatMarkdown.tsx
 * Uses prism-react-renderer for syntax-highlighted code blocks.
 */
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSavedTheme, themes } from "../lib/theme";

/**
 * Copy button in the top-right corner of each code block.
 */
function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = (): void => {
    if (code.length === 0) return;
    const flash = (): void => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    };
    const writeAsync = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (writeAsync !== undefined) {
      void writeAsync(code).then(flash).catch(fallback);
      return;
    }
    fallback();
    function fallback(): void {
      try {
        const ta = document.createElement("textarea");
        ta.value = code;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flash();
      } catch {
        // No clipboard available
      }
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="code-copy-btn"
      style={{
        position: "absolute", right: 4, top: 4,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        minWidth: 28, minHeight: 28,
        borderRadius: "var(--radius-sm)",
        background: "var(--bg-glass)",
        border: "1px solid var(--border)",
        color: copied ? "var(--success)" : "var(--text-dim)",
        cursor: "pointer",
        fontSize: 12,
        opacity: 0,
        transition: "opacity 0.15s",
      }}
      title="Copy code block"
      aria-label="Copy code block"
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

interface Props {
  text: string;
}

/**
 * Detect if the current theme is light or dark.
 */
function isLightTheme(): boolean {
  const themeId = getSavedTheme();
  const theme = themes.find((t) => t.id === themeId);
  return theme !== undefined && !theme.dark;
}

/**
 * Code renderer: renders inline code as a styled span, fenced code
 * blocks with prism-react-renderer syntax highlighting.
 */
const CodeRenderer: Exclude<Components["code"], undefined> = ({
  className,
  children,
  ...rest
}) => {
  const light = isLightTheme();

  const langMatch = /language-([\w-]+)/.exec(className ?? "");
  const code = String(children ?? "").replace(/\n$/, "");
  const isBlock = langMatch !== null || code.includes("\n");

  if (!isBlock) {
    return (
      <code
        style={{
          background: "var(--bg-glass)",
          borderRadius: "var(--radius-xs)",
          padding: "1px 5px",
          fontFamily: "'SF Mono','Menlo','Monaco',monospace",
          fontSize: "0.9em",
          color: "var(--text-primary)",
          whiteSpace: "nowrap",
        }}
        {...rest}
      >
        {children}
      </code>
    );
  }

  const language = langMatch?.[1] ?? "text";
  const prismTheme = light ? prismThemes.vsLight : prismThemes.vsDark;
  const codeBg = light ? "#f5f5f5" : "var(--bg-elevated)";

  return (
    <div style={{ position: "relative", margin: "8px 0" }} className="code-group">
      <CodeCopyButton code={code} />
      <Highlight code={code} language={language} theme={prismTheme}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre
            style={{
              ...style,
              background: codeBg,
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              padding: "10px 12px",
              overflowX: "auto",
              fontFamily: "'SF Mono','Menlo','Monaco',monospace",
              fontSize: "12px",
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} {...lineProps} style={{ ...lineProps.style, display: "block" }}>
                  {line.map((token, key) => {
                    const tokenProps = getTokenProps({ token });
                    return <span key={key} {...tokenProps} />;
                  })}
                </div>
              );
            })}
          </pre>
        )}
      </Highlight>
    </div>
  );
};



const components: Components = {
  h1: ({ children }) => (
    <h1 style={{ margin: "16px 0 6px", fontSize: "1rem", fontWeight: 600 }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ margin: "14px 0 5px", fontSize: "0.9rem", fontWeight: 600 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ margin: "12px 0 4px", fontSize: "0.85rem", fontWeight: 600 }}>
      {children}
    </h3>
  ),

  p: ({ children }) => (
    <p style={{ margin: "8px 0", lineHeight: 1.5 }}>{children}</p>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "6px 0", paddingLeft: 20, listStyle: "disc" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "6px 0", paddingLeft: 20, listStyle: "decimal" }}>{children}</ol>
  ),
  li: ({ children }) => <li style={{ lineHeight: 1.5 }}>{children}</li>,

  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "10px 0",
        borderLeft: "3px solid var(--border)",
        paddingLeft: 12,
        color: "var(--text-secondary)",
      }}
    >
      {children}
    </blockquote>
  ),

  table: ({ children }) => (
    <div style={{ margin: "8px 0", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: "0.8rem", minWidth: "100%" }}>
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th
      style={{
        border: "1px solid var(--border)",
        padding: "4px 8px",
        textAlign: "left",
        fontWeight: 600,
        background: "var(--bg-glass)",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ border: "1px solid var(--border)", padding: "4px 8px", verticalAlign: "top" }}>
      {children}
    </td>
  ),

  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "var(--accent)", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),

  hr: () => <hr style={{ margin: "12px 0", border: "none", borderTop: "1px solid var(--border)" }} />,

  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: "italic" }}>{children}</em>,

  code: CodeRenderer,
  // Unwrap react-markdown's bare <pre> — CodeRenderer owns the <pre>
  pre: ({ children }) => <>{children}</>,
};

export function ChatMarkdown({ text }: Props) {
  return (
    <div style={{ wordBreak: "break-word", overflowWrap: "anywhere", fontSize: "0.875rem" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
