import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type Props = { text: string; chatStyleBreaks?: boolean };

/**
 * Regex matching a <proposed_plan>...</proposed_plan> block (non-greedy).
 * Captures the inner content in group 1.
 */
const PROPOSED_PLAN_RE = /<proposed_plan>([\s\S]*?)<\/proposed_plan>/gi;

const LIGHT_RE = /^light|clean|terracotta|sage$/i;

function ThemeAwareCode({ className, children, ...rest }: HTMLAttributes<HTMLElement>): ReactNode {
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

  const langMatch = /language-([\w-]+)/.exec(className ?? "");
  const code = String(children ?? "").replace(/\n$/, "");
  const isBlock = langMatch !== null || code.includes("\n");

  if (!isBlock) {
    return (
      <code className="inline-code" {...rest}>
        {children}
      </code>
    );
  }

  const language = langMatch?.[1] ?? "text";
  const prismTheme = isLight ? prismThemes.vsLight : prismThemes.vsDark;
  const codeBg = isLight ? "#f8fafc" : "#0d0d0d";

  return (
    <div className="code-block-wrap">
      <CodeCopyButton code={code} />
      <Highlight code={code} language={language} theme={prismTheme}>
        {({ style, tokens, getLineProps, getTokenProps }) => (
          <pre className="code-block" style={{ ...style, background: codeBg }}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line });
              return (
                <div key={i} {...lineProps}>
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
}

function CodeCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const flash = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const fallback = (text: string): void => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      flash();
    } catch {
      // Clipboard unavailable
    }
  };
  const onClick = () => {
    if (!code) return;
    const writeAsync = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (writeAsync !== undefined) {
      void writeAsync(code).then(flash).catch(() => fallback(code));
    } else {
      fallback(code);
    }
  };
  return (
    <button type="button" onClick={onClick} className="code-copy-btn" title="Copy code block" aria-label="Copy code block">
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

const components: Components = {
  h1: ({ children }) => <h1 className="md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="md-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="md-h4">{children}</h4>,

  p: ({ children }) => <p className="md-p">{children}</p>,
  ul: ({ children }) => <ul className="md-ul">{children}</ul>,
  ol: ({ children }) => <ol className="md-ol">{children}</ol>,
  li: ({ children }) => <li className="md-li">{children}</li>,

  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
  hr: () => <hr className="md-hr" />,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">
      {children}
    </a>
  ),

  img: ({ src, alt }) => (
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
  ),

  table: ({ children }) => (
    <div className="table-wrapper">
      <table className="md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="md-th">{children}</th>,
  td: ({ children }) => <td className="md-td">{children}</td>,

  strong: ({ children }) => <strong className="md-strong">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,

  code: ThemeAwareCode,
  pre: ({ children }) => <>{children}</>,
};

const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ["style", /.*/] as [string, ...unknown[]]],
    span: [...(defaultSchema.attributes?.span ?? []), ["style", /.*/] as [string, ...unknown[]]],
    strong: [...(defaultSchema.attributes?.strong ?? []), ["style", /.*/] as [string, ...unknown[]]],
    p: [...(defaultSchema.attributes?.p ?? []), ["style", /.*/] as [string, ...unknown[]]],
  },
  strip: [...(defaultSchema.strip || []), "iframe", "script", "object", "form", "style"],
} as any;

const htmlRehypePlugins: any[] = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  [rehypeKatex, { throwOnError: false, strict: false }],
];

/**
 * Styled card for <proposed_plan> blocks rendered by the pi-plan-mode extension.
 * Displays the inner plan content as markdown inside a bordered panel.
 */
function ProposedPlanCard({ content }: { content: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--accent-subtle, rgba(255,255,255,0.12))",
        borderRadius: "var(--radius-md, 10px)",
        padding: "16px 20px",
        margin: "16px 0",
        background: "var(--bg-glass-strong, rgba(255,255,255,0.04))",
      }}
    >
      <div style={{
        fontSize: "11px",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--text-dim, rgba(255,255,255,0.3))",
        marginBottom: "12px",
      }}>
        Proposed Plan
      </div>
      <ChatMarkdown text={content} />
    </div>
  );
}

/**
 * Split input text into an array of segments: either plain markdown strings
 * or ProposedPlanCard components (for <proposed_plan> blocks).
 */
function renderSegments(text: string): (string | ReactNode)[] {
  const segments: (string | ReactNode)[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  PROPOSED_PLAN_RE.lastIndex = 0;

  while ((match = PROPOSED_PLAN_RE.exec(text)) !== null) {
    // Push leading plain text before this match
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    // Push the card for the proposed plan block
    segments.push(<ProposedPlanCard key={match.index} content={match[1].trim()} />);
    lastIndex = match.index + match[0].length;
  }

  // Push any trailing plain text
  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : [text];
}

export function ChatMarkdown({ text, chatStyleBreaks }: Props) {
  const plugins = chatStyleBreaks ? [remarkGfm, remarkMath, remarkBreaks] : [remarkGfm, remarkMath];

  const segments = useMemo(() => renderSegments(text), [text]);

  // Fast path: no proposed_plan blocks — just render as plain markdown
  if (segments.length === 1 && typeof segments[0] === "string") {
    return (
      <div className="md-root text-sm break-words" style={{ overflowWrap: "anywhere" }}>
        <ReactMarkdown remarkPlugins={plugins} rehypePlugins={htmlRehypePlugins} components={components}>
          {text}
        </ReactMarkdown>
      </div>
    );
  }

  // Mixed: segments contain ProposedPlanCard components interspersed with markdown text
  return (
    <div className="md-root text-sm break-words" style={{ overflowWrap: "anywhere" }}>
      {segments.map((seg, i) =>
        typeof seg === "string" ? (
          <ReactMarkdown
            key={i}
            remarkPlugins={plugins}
            rehypePlugins={htmlRehypePlugins}
            components={components}
          >
            {seg}
          </ReactMarkdown>
        ) : (
          seg
        )
      )}
    </div>
  );
}
