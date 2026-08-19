import * as React from "react";
import { useEffect, useRef, useState } from "react";

/**
 * Animated 4×4 dot-matrix "thinking" indicator, ported from the Nuxt UI chat
 * template (`app/components/chat/Indicator.vue`). Cycles through four patterns —
 * snake, columns, diamond and a counting diagonal — at 120ms per step.
 */
const SIZE = 4;
const GAP = 2;
const TOTAL = SIZE * SIZE;

const PATTERNS = [
  // snake around the border
  [[0], [1], [2], [3], [7], [11], [15], [14], [13], [12], [8], [4], [5], [6], [10], [9]],
  // columns
  [
    [0, 4, 8, 12],
    [1, 5, 9, 13],
    [2, 6, 10, 14],
    [3, 7, 11, 15],
  ],
  // diamond ripple
  [
    [5, 6, 9, 10],
    [1, 4, 7, 8, 11, 14],
    [0, 3, 12, 15],
    [1, 4, 7, 8, 11, 14],
    [5, 6, 9, 10],
  ],
  // counting diagonal
  [
    [0],
    [1, 4],
    [2, 5, 8],
    [3, 6, 9, 12],
    [7, 10, 13],
    [11, 14],
    [15],
  ],
];

export function ThinkingIndicator({ className = "", style = {} }: { className?: string; style?: React.CSSProperties }) {
  const [active, setActive] = useState<Set<number>>(new Set());
  const stepRef = useRef({ pattern: 0, step: 0 });

  useEffect(() => {
    const nextStep = () => {
      const s = stepRef.current;
      const pattern = PATTERNS[s.pattern];
      if (!pattern) return;
      setActive(new Set(pattern[s.step]));
      s.step += 1;
      if (s.step >= pattern.length) {
        s.step = 0;
        s.pattern = (s.pattern + 1) % PATTERNS.length;
      }
    };

    nextStep();
    const id = window.setInterval(nextStep, 120);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden
      className={`thinking-indicator ${className}`}
      style={{
        display: "grid",
        flexShrink: 0,
        gridTemplateColumns: `repeat(${SIZE}, 1fr)`,
        gap: `${GAP}px`,
        ...style,
      }}
    >
      {Array.from({ length: TOTAL }, (_, i) => (
        <span
          key={i}
          style={{
            borderRadius: "2px",
            backgroundColor: "currentColor",
            transition: "opacity 0.1s ease-in-out",
            opacity: active.has(i) ? 1 : 0.2,
          }}
        />
      ))}
    </div>
  );
}
