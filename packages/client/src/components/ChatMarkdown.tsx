import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getSavedTheme, themes } from "../lib/theme";

type Props = { text: string };

function isLightTheme(): boolean {
  const t = themes.find((x) => x.id === getSavedTheme());
  return t !== undefined && !t.dark;
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
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="md-link">{children}</a>,
  strong: ({ children }) => <strong>{children}</strong>,
  em: ({ children }) => <em>{children}</em>,

  table: ({ children }) => (
    <div className="table-wrapper">
      <table className="md-table">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="md-th">{children}</th>,
  td: ({ children }) => <td className="md-td">{children}</td>,

  code: ({ className, children, ...rest }) => {
    const light = isLightTheme();
    const langMatch = /language-([\w-]+)/.exec(className ?? "");
    const code = String(children ?? "").replace(/\n$/, "");
    const isBlock = langMatch !== null || code.includes("\n");
    if (!isBlock) {
      return <code className="inline-code" {...rest}>{children}</code>;
    }
    const language = langMatch?.[1] ?? "text";
    const langClass = `language-${language}`;
    const codeBg = light ? "#f5f5f5" : "var(--bg-elevated)";

    return (
      <div className="code-block-wrap">
        <pre
          className={`code-block ${langClass}`}
          style={{ background: codeBg }}
        >
          {code.split("\n").map((line, i) => (
            <div key={i} className="code-line">{line || " "}</div>
          ))}
        </pre>
      </div>
    );
  },
  pre: ({ children }) => <>{children}</>,
};

export function ChatMarkdown({ text }: Props) {
  return (
    <div className="markdown-content text-sm break-words" style={{ overflowWrap: "break-word" }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
