import React from "react";

/**
 * Shape passed to custom tool renderers.
 * Derived from the SDK's ToolCall + ToolResultMessage pairing.
 */
export interface ToolCallPart {
  type: "tool-call";
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  state: "input-available" | "running" | "success" | "error";
  output?: string;
  errorText?: string;
  details?: unknown;
}

export interface ToolRendererProps {
  part: ToolCallPart;
  messageId: string;
}

export type ToolRenderer = React.FC<ToolRendererProps>;

class ToolRegistry {
  private renderers = new Map<string, ToolRenderer>();

  register(toolName: string, renderer: ToolRenderer) {
    this.renderers.set(toolName, renderer);
  }

  get(toolName: string): ToolRenderer | undefined {
    return this.renderers.get(toolName);
  }

  has(toolName: string): boolean {
    return this.renderers.has(toolName);
  }
}

export const toolRegistry = new ToolRegistry();
