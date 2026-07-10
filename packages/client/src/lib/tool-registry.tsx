import React from "react";
import type { ToolCallPart } from "./normalize";

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
