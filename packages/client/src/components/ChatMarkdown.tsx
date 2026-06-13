import { useEffect, useState, type HTMLAttributes, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { Highlight, themes as prismThemes } from "prism-react-renderer";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type Props = { text: string; chatStyleBreaks?: boolean };

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
  const onClick = () => {
    if (!code) return;
    const flash = () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    };
    navigator.clipboard?.writeText?.(code)?.then(flash)?.catch(() => {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      flash();
    });
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

  table: ({ children }) => (
    <div className="table-wrapper">
      <table className="md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="md-th">{children}</th>,
  td: ({ children }) => <td className="md-td">{children}</td>,

  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,

  code: ThemeAwareCode,
  pre: ({ children }) => <>{children}</>,
};

export function ChatMarkdown({ text, chatStyleBreaks }: Props) {
  const plugins = chatStyleBreaks ? [remarkGfm, remarkMath, remarkBreaks] : [remarkGfm, remarkMath];
  return (
    <div className="md-root text-sm break-words" style={{ overflowWrap: "anywhere" }}>
      <ReactMarkdown remarkPlugins={plugins} rehypePlugins={[rehypeKatex]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
