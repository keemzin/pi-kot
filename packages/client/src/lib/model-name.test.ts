import { describe, it, expect } from "vitest";
import { formatModelDisplayName } from "./model-name";

describe("formatModelDisplayName", () => {
  it("handles undefined and empty string", () => {
    expect(formatModelDisplayName()).toBe("");
    expect(formatModelDisplayName("")).toBe("");
    expect(formatModelDisplayName("   ")).toBe("");
  });

  it("extracts basename and removes extension from Windows file paths", () => {
    const raw = "V:\\LLM\\BONSAI2\\BONSAI-DEMO\\MODELS\\BONSAI2-GGUF\\27B\\TERNARY-BONSAI-2-27B-PQ2_0.GGUF";
    expect(formatModelDisplayName(raw)).toBe("TERNARY-BONSAI-2-27B-PQ2_0");
  });

  it("extracts basename and removes extension from POSIX file paths", () => {
    const raw = "/home/user/models/llama-3.2-3b-instruct-q4_k_m.gguf";
    expect(formatModelDisplayName(raw)).toBe("llama-3.2-3b-instruct-q4_k_m");
  });

  it("extracts basename from nested paths with forward slashes", () => {
    const raw = "models/deepseek/deepseek-coder-6.7b.bin";
    expect(formatModelDisplayName(raw)).toBe("deepseek-coder-6.7b");
  });

  it("preserves standard single-slash model IDs like openrouter / huggingface", () => {
    expect(formatModelDisplayName("anthropic/claude-3-5-sonnet-20241022")).toBe(
      "anthropic/claude-3-5-sonnet-20241022",
    );
    expect(formatModelDisplayName("meta-llama/Llama-3.3-70B-Instruct")).toBe(
      "meta-llama/Llama-3.3-70B-Instruct",
    );
  });

  it("preserves plain model names without paths", () => {
    expect(formatModelDisplayName("gpt-4o")).toBe("gpt-4o");
    expect(formatModelDisplayName("qwen2.5-coder:32b")).toBe("qwen2.5-coder:32b");
  });
});
