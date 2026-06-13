/**
 * Shared response schemas used across multiple route files.
 */

export const errorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
} as const;
