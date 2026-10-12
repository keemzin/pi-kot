import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RenderedView } from "./RenderedView.js";

describe("RenderedView", () => {
  it("renders unlabelled fenced code blocks as multi-line code blocks, not inline code", () => {
    const markdown = `# Architecture

\`\`\`
/workspace
├── index.html
└── css/
\`\`\`
`;
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "PLAN.md" }));

    // Must be inside a <pre> element with line numbers
    expect(html).toContain("<pre");
    expect(html).toContain("/workspace");
    expect(html).toContain("├── index.html");
    expect(html).toContain("└── css/");

    // Line number span should be present
    expect(html).toContain(">1</span>");
    expect(html).toContain(">2</span>");
    expect(html).toContain(">3</span>");
  });

  it("renders inline code as inline code chips", () => {
    const markdown = "Run `python3 -m http.server 8000` then open";
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "PLAN.md" }));

    expect(html).toContain("<code");
    expect(html).not.toContain("<pre");
    expect(html).toContain("python3 -m http.server 8000");
  });

  it("renders labelled code blocks with the correct language", () => {
    const markdown = `\`\`\`typescript
const greeting: string = "hello";
\`\`\``;
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "example.md" }));

    expect(html).toContain("<pre");
    expect(html).toContain("const");
    expect(html).toContain("greeting");
  });

  it("renders non-markdown files as full syntax-highlighted code blocks", () => {
    const code = "console.log('hello');";
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: code, fileName: "script.js" }));

    expect(html).toContain("<pre");
    expect(html).toContain("console");
    expect(html).toContain("log");
  });

  it("renders GitHub alerts with styled alert boxes and stripped markers", () => {
    const markdown = `
> [!NOTE]
> General informational note.

> [!WARNING]
> Be careful when editing files.

> [!TIP]
> Use \`write\` to create files, \`edit\` for precise changes.
`;
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "notes.md" }));

    // Alerts are rendered as alert cards, not plain blockquotes with raw [!TAG]
    expect(html).toContain("markdown-alert-note");
    expect(html).toContain("markdown-alert-warning");
    expect(html).toContain("markdown-alert-tip");

    // Titles
    expect(html).toContain("<span>Note</span>");
    expect(html).toContain("<span>Warning</span>");
    expect(html).toContain("<span>Tip</span>");

    // Inner content is preserved, marker is removed
    expect(html).toContain("General informational note.");
    expect(html).toContain("Be careful when editing files.");
    expect(html).toContain(">write</code>");
    expect(html).toContain(">edit</code>");
    expect(html).not.toContain("[!NOTE]");
    expect(html).not.toContain("[!WARNING]");
    expect(html).not.toContain("[!TIP]");
  });

  it("preserves standard blockquotes without alert markers", () => {
    const markdown = "> 💡 **Tip:** Markdown was created by John Gruber in 2004.";
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "notes.md" }));

    expect(html).toContain("<blockquote");
    expect(html).not.toContain("markdown-alert");
    expect(html).toContain("Markdown was created by John Gruber in 2004.");
  });

  it("renders styled collapsible details and summary elements with chevron", () => {
    const markdown = `
<details>
<summary>Click to expand</summary>

This is a **collapsible section** — hidden until you click the summary!

</details>
`;
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "notes.md" }));

    expect(html).toContain('<details class="md-details"');
    expect(html).toContain('<summary class="md-summary"');
    expect(html).toContain("md-details-chevron");
    expect(html).toContain("Click to expand");
    expect(html).toContain('<div class="md-details-body"');
    expect(html).toContain("collapsible section");
  });

  it("renders LaTeX math using KaTeX instead of raw text", () => {
    const markdown = `## Math

$$ E = mc^2 $$

Here is inline math $x^2 + y^2 = z^2$.
`;
    const html = renderToStaticMarkup(React.createElement(RenderedView, { content: markdown, fileName: "math.md" }));

    // Must be rendered by KaTeX
    expect(html).toContain("katex");
    expect(html).toContain("katex-display");
    expect(html).toContain("katex-html");

    // Must not remain as raw unrendered delimiter text
    expect(html).not.toContain("$$ E = mc^2 $$");
  });
});
