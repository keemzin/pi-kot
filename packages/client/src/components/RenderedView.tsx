import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Highlight, themes as prismThemes } from "prism-react-renderer";

interface Props {
  content: string;
  fileName: string;
}

const LIGHT_RE = /^light|clean|terracotta|sage$/i;

function useIsLight(): boolean {
  const [isLight, setIsLight] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      const theme = document.documentElement.getAttribute("data-theme");
      if (theme && LIGHT_RE.test(theme)) return true;
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    const read = () => {
      const theme = root.getAttribute("data-theme");
      setIsLight(!!(theme && LIGHT_RE.test(theme)));
    };
    read();
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handler = () => read();
    mq?.addEventListener?.("change", handler);
    const obs = new MutationObserver(handler);
    root && obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq?.removeEventListener?.("change", handler);
      obs.disconnect();
    };
  }, []);

  return isLight;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  json: "json", css: "css", html: "markup", md: "markdown",
  py: "python", rs: "rust", go: "go", sh: "bash", bash: "bash",
  yaml: "yaml", yml: "yaml", toml: "toml", sql: "sql",
  cpp: "cpp", c: "cpp", h: "cpp", hpp: "cpp",
  java: "java", xml: "markup", svg: "markup",
  kt: "kotlin", dart: "dart", rb: "ruby", php: "php",
  r: "r", scala: "scala", swift: "swift",
};

function CodeBlock({ code, language }: { code: string; language: string }) {
  const isLight = useIsLight();
  const lang = EXT_TO_LANG[language] ?? "bash";
  const prismTheme = isLight ? prismThemes.vsLight : prismThemes.vsDark;
  return (
    <Highlight
      theme={prismTheme}
      code={code.trimEnd()}
      language={lang}
    >
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={className}
          style={{
            ...style,
            margin: 0,
            padding: "12px 14px",
            fontSize: "12px",
            lineHeight: 1.6,
            overflowX: "auto",
            borderRadius: "6px",
            background: "var(--bg-glass-strong)",
          }}
        >
          <code>
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line, key: i })}>
                <span
                  style={{
                    display: "inline-block",
                    width: "2ch",
                    textAlign: "right",
                    marginRight: "12px",
                    userSelect: "none",
                    opacity: 0.35,
                    fontSize: "11px",
                  }}
                >
                  {i + 1}
                </span>
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token, key })} />
                ))}
              </div>
            ))}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

function isMarkdown(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || ext === "mdx";
}

export function RenderedView({ content, fileName }: Props) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (isMarkdown(fileName)) {
    return (
      <div
        className="markdown-preview"
        style={{
          padding: "16px 20px",
          fontSize: "14px",
          lineHeight: 1.7,
          color: "var(--text-primary)",
          overflowY: "auto",
          height: "100%",
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw]}
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className ?? "");
              const codeStr = String(children).replace(/\n$/, "");
              if (match) {
                return <CodeBlock code={codeStr} language={match[1]} />;
              }
              return (
                <code
                  style={{
                    background: "var(--bg-glass-strong)",
                    padding: "2px 5px",
                    borderRadius: "3px",
                    fontSize: "0.9em",
                    color: "var(--accent-text)",
                  }}
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre({ children }) {
              return <>{children}</>;
            },
            a({ href, children }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent-text)" }}
                >
                  {children}
                </a>
              );
            },
            table({ children }) {
              return (
                <div className="table-wrapper">
                  <table className="md-table">
                    {children}
                  </table>
                </div>
              );
            },
            th({ children }) {
              return <th className="md-th">{children}</th>;
            },
            td({ children }) {
              return <td className="md-td">{children}</td>;
            },
            blockquote({ children }) {
              return (
                <blockquote
                  style={{
                    borderLeft: "3px solid var(--accent-bg)",
                    margin: "12px 0",
                    padding: "4px 14px",
                    background: "var(--bg-glass)",
                    color: "var(--text-secondary)",
                  }}
                >
                  {children}
                </blockquote>
              );
            },
            h1({ children }) {
              return (
                <h1
                  style={{
                    fontSize: "20px",
                    fontWeight: 700,
                    margin: "20px 0 10px",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: "6px",
                  }}
                >
                  {children}
                </h1>
              );
            },
            h2({ children }) {
              return (
                <h2
                  style={{
                    fontSize: "17px",
                    fontWeight: 600,
                    margin: "18px 0 8px",
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border)",
                    paddingBottom: "4px",
                  }}
                >
                  {children}
                </h2>
              );
            },
            h3({ children }) {
              return (
                <h3
                  style={{
                    fontSize: "15px",
                    fontWeight: 600,
                    margin: "14px 0 6px",
                    color: "var(--text-primary)",
                  }}
                >
                  {children}
                </h3>
              );
            },
            hr() {
              return (
                <hr
                  style={{
                    border: "none",
                    borderTop: "1px solid var(--border)",
                    margin: "16px 0",
                  }}
                />
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // For non-markdown files: syntax-highlighted code block
  return (
    <div
      style={{
        padding: "16px 0",
        fontSize: "13px",
        overflowY: "auto",
        height: "100%",
      }}
    >
      <CodeBlock code={content} language={ext} />
    </div>
  );
}
