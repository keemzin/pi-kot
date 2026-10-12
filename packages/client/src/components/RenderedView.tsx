import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { normalizeDisplayMath, normalizeInlineLatexMath } from "../lib/markdown.js";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  AlertCircle,
  AlertOctagon,
  ChevronRight,
} from "lucide-react";

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

function extractText(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    if (props && "children" in props) return extractText(props.children);
  }
  return String(node ?? "");
}

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript", typescript: "typescript",
  tsx: "tsx",
  js: "javascript", javascript: "javascript",
  jsx: "jsx",
  json: "json",
  css: "css",
  html: "markup", markup: "markup",
  md: "markdown", markdown: "markdown",
  py: "python", python: "python",
  rs: "rust", rust: "rust",
  go: "go",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash",
  yaml: "yaml", yml: "yaml",
  toml: "toml",
  sql: "sql",
  cpp: "cpp", c: "cpp", h: "cpp", hpp: "cpp",
  java: "java",
  xml: "markup", svg: "markup",
  kt: "kotlin", kotlin: "kotlin",
  dart: "dart",
  rb: "ruby", ruby: "ruby",
  php: "php",
  r: "r",
  scala: "scala",
  swift: "swift",
  text: "text", txt: "text", plain: "text",
};

function CodeBlock({
  code,
  language,
  style: customStyle,
}: {
  code: string;
  language: string;
  style?: CSSProperties;
}) {
  const isLight = useIsLight();
  const langKey = language.toLowerCase();
  const lang = EXT_TO_LANG[langKey] ?? (langKey || "text");
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
            ...customStyle,
          }}
        >
          <code>
            {tokens.map((line, i) => {
              const { key: _lk, ...lineRest } = getLineProps({ line, key: i });
              return (
                <div key={i} {...lineRest}>
                  <span
                    style={{
                      display: "inline-block",
                      width: `${Math.max(2, String(tokens.length).length)}ch`,
                      textAlign: "right",
                      marginRight: "12px",
                      userSelect: "none",
                      opacity: 0.35,
                      fontSize: "11px",
                    }}
                  >
                    {i + 1}
                  </span>
                  {line.map((token, idx) => {
                    const { key: _tk, ...tokenRest } = getTokenProps({ token, key: idx });
                    return <span key={idx} {...tokenRest} />;
                  })}
                </div>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );
}

const ALERT_CONFIG: Record<
  string,
  {
    title: string;
    icon: typeof Info;
    className: string;
  }
> = {
  NOTE: {
    title: "Note",
    icon: Info,
    className: "markdown-alert-note",
  },
  TIP: {
    title: "Tip",
    icon: Lightbulb,
    className: "markdown-alert-tip",
  },
  IMPORTANT: {
    title: "Important",
    icon: AlertCircle,
    className: "markdown-alert-important",
  },
  WARNING: {
    title: "Warning",
    icon: AlertTriangle,
    className: "markdown-alert-warning",
  },
  CAUTION: {
    title: "Caution",
    icon: AlertOctagon,
    className: "markdown-alert-caution",
  },
};

const ALERT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|[ \t]+)?/i;

export function parseAlert(children: ReactNode): { type: string; children: ReactNode[] } | null {
  const childList = Children.toArray(children);
  let firstElemIdx = -1;
  for (let i = 0; i < childList.length; i++) {
    const c = childList[i];
    if (typeof c === "string" && c.trim() === "") continue;
    firstElemIdx = i;
    break;
  }
  if (firstElemIdx === -1) return null;

  const firstElem = childList[firstElemIdx];
  if (!isValidElement<{ children?: ReactNode }>(firstElem)) return null;

  const pChildren = Children.toArray(firstElem.props.children);
  if (pChildren.length === 0) return null;

  const firstChild = pChildren[0];
  if (typeof firstChild !== "string") return null;

  const match = ALERT_RE.exec(firstChild);
  if (!match) return null;

  const alertType = match[1].toUpperCase();
  const restOfFirstString = firstChild.slice(match[0].length);

  const updatedPChildren =
    restOfFirstString.length > 0
      ? [restOfFirstString, ...pChildren.slice(1)]
      : pChildren.slice(1);

  let newFirstElem: ReactNode = null;
  if (updatedPChildren.length > 0) {
    newFirstElem = cloneElement(firstElem, { ...firstElem.props }, ...updatedPChildren);
  }

  const remainingChildren = childList.slice(firstElemIdx + 1);
  const alertBody = newFirstElem ? [newFirstElem, ...remainingChildren] : remainingChildren;

  return {
    type: alertType,
    children: alertBody,
  };
}

export function AlertCard({ type, children }: { type: string; children: ReactNode }) {
  const cfg = ALERT_CONFIG[type] ?? ALERT_CONFIG.NOTE;
  const Icon = cfg.icon;

  return (
    <div className={`markdown-alert ${cfg.className}`}>
      <div className="markdown-alert-title">
        <Icon size={14} style={{ flexShrink: 0 }} />
        <span>{cfg.title}</span>
      </div>
      <div className="markdown-alert-content">{children}</div>
    </div>
  );
}

export function MarkdownSummary({
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLElement> & { node?: unknown }) {
  return (
    <summary className="md-summary" {...props}>
      <ChevronRight size={14} className="md-details-chevron" />
      <span>{children}</span>
    </summary>
  );
}

export function MarkdownDetails({
  children,
  node: _node,
  ...props
}: HTMLAttributes<HTMLDetailsElement> & { node?: unknown }) {
  const childArray = Children.toArray(children);
  const summaryChild = childArray.find(
    (c) =>
      isValidElement(c) &&
      (c.type === MarkdownSummary || (c.type as any)?.name === "MarkdownSummary" || c.type === "summary")
  );
  const otherChildren = childArray.filter((c) => c !== summaryChild);

  return (
    <details className="md-details" {...props}>
      {summaryChild}
      <div className="md-details-body">{otherChildren}</div>
    </details>
  );
}

function isMarkdown(fileName: string): boolean {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext === "md" || ext === "mdx" || ext === "markdown";
}

export function RenderedView({ content, fileName }: Props) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  const normalizedContent = useMemo(() => {
    if (!isMarkdown(fileName)) return content;
    return normalizeInlineLatexMath(normalizeDisplayMath(content));
  }, [content, fileName]);

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
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, [rehypeKatex, { throwOnError: false, strict: false }]]}
          components={{
            details: MarkdownDetails,
            summary: MarkdownSummary,
            pre({ children }) {
              if (isValidElement(children)) {
                const childProps = children.props as { className?: string; children?: unknown };
                const match = /language-([\w-]+)/.exec(childProps.className ?? "");
                const raw = extractText(childProps.children);
                const codeStr = raw.replace(/\n$/, "");
                const lang = match ? match[1] : "text";
                return <CodeBlock code={codeStr} language={lang} style={{ margin: "14px 0" }} />;
              }
              return <pre>{children}</pre>;
            },
            code({ className, children, node: _node, ...props }) {
              const match = /language-([\w-]+)/.exec(className ?? "");
              const codeStr = extractText(children).replace(/\n$/, "");
              if (match || codeStr.includes("\n")) {
                return (
                  <CodeBlock
                    code={codeStr}
                    language={match ? match[1] : "text"}
                    style={{ margin: "14px 0" }}
                  />
                );
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
            img({ src, alt }) {
              return (
                <img
                  src={src}
                  alt={alt ?? ""}
                  style={{
                    maxWidth: "100%",
                    height: "auto",
                    borderRadius: 4,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                  }}
                />
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
              const alert = parseAlert(children);
              if (alert) {
                return <AlertCard type={alert.type}>{alert.children}</AlertCard>;
              }
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
          {normalizedContent}
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
