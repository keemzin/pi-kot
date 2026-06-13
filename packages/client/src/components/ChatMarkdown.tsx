import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = { text: string };

function CodeBlock({ language, code }: { language: string; code: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
  };

  return (
    <div className="code-block-wrap">
      <div className="code-block-header">
        <span className="code-block-lang">{language}</span>
        <button type="button" className="code-copy-btn" onClick={handleCopy}>
          <span className="code-copy-label">Copy</span>
        </button>
      </div>
      <pre className="code-block">
        {code.split("\n").map((line, i) => (
          <div key={i} className="code-line">{line || " "}</div>
        ))}
      </pre>
    </div>
  );
}

const components: Components = {
  code: ({ className, children, ...rest }) => {
    const langMatch = /language-([\w-]+)/.exec(className ?? "");
    const code = String(children ?? "").replace(/\n$/, "");
    const isBlock = langMatch !== null || code.includes("\n");
    if (!isBlock) {
      return <code className="inline-code" {...rest}>{children}</code>;
    }
    const language = langMatch?.[1] ?? "text";
    return <CodeBlock language={language} code={code} />;
  },
  pre: ({ children }) => <>{children}</>,

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
