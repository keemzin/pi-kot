import { describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingBlock } from "./ThinkingBlock.js";
import { usePreferencesStore } from "../stores/preferences-store.js";

describe("ThinkingBlock", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ showThinking: true });
  });
  it("renders collapsed thinking block with brain icon, label, and word count badge", () => {
    const text = "Let me search the codebase for relevant handlers.";
    const html = renderToStaticMarkup(
      React.createElement(ThinkingBlock, { text, showThinking: true })
    );

    expect(html).toContain("thinking-block");
    expect(html).toContain("collapsed");
    expect(html).toContain("thinking-header");
    expect(html).toContain("thinking-icon");
    expect(html).toContain("thinking-label");
    expect(html).toContain("thinking-badge");
    expect(html).toContain("8 words");
    // Body is not open by default
    expect(html).not.toContain("thinking-body");
  });

  it("renders expanded thinking block with body and copy button when initialOpen is true", () => {
    const text = "The user wants to find the victim testimony record.";
    const html = renderToStaticMarkup(
      React.createElement(ThinkingBlock, { text, initialOpen: true, showThinking: true })
    );

    expect(html).toContain("thinking-block");
    expect(html).toContain("open");
    expect(html).toContain("thinking-body");
    expect(html).toContain("thinking-text");
    expect(html).toContain(text);
    expect(html).toContain("thinking-copy-btn");
    expect(html).toContain("Copy");
  });

  it("supports in-trail styling modifier class", () => {
    const text = "Thinking inside the timeline...";
    const html = renderToStaticMarkup(
      React.createElement(ThinkingBlock, { text, className: "in-trail", showThinking: true })
    );

    expect(html).toContain("in-trail");
  });

  it("returns null when text is empty or only whitespace", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkingBlock, { text: "   " })
    );

    expect(html).toBe("");
  });

  it("returns null when showThinking is disabled in preferences", () => {
    usePreferencesStore.setState({ showThinking: false });
    const html = renderToStaticMarkup(
      React.createElement(ThinkingBlock, { text: "Some reasoning text" })
    );

    expect(html).toBe("");
  });
});
