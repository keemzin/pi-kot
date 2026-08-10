import { useEffect, useRef } from "react";

/**
 * Horizontal swipe detection for touch devices.
 *
 * Guards against the classic "swipe during a scroll" misfire:
 *  - A `touchmove` handler vetoes the gesture as soon as vertical
 *    travel exceeds `SCROLL_VETO_Y` — scrolling the chat/terminal/
 *    file tree never counts as a swipe, no matter how much horizontal
 *    drift the finger accumulates along the way.
 *  - The final displacement must also be clearly horizontal
 *    (`|x| > HORIZONTAL_DOMINANCE * |y|`), not just "x wins by 1px".
 *
 * Listeners are only attached while `enabled` is true, so the feature
 * can be switched off entirely from settings.
 */
export function useTouchSwipe(opts: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  enabled?: boolean;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const vetoed = useRef(false);
  const threshold = opts.threshold || 60;
  const enabled = opts.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      vetoed.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStart.current) return;
      const dy = e.touches[0].clientY - touchStart.current.y;
      if (Math.abs(dy) > SCROLL_VETO_Y) vetoed.current = true;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return;
      const xDiff = touchStart.current.x - e.changedTouches[0].clientX;
      const yDiff = touchStart.current.y - e.changedTouches[0].clientY;

      // The user scrolled vertically during the touch — not a swipe.
      if (!vetoed.current) {
        const clearlyHorizontal =
          Math.abs(xDiff) > Math.abs(yDiff) * HORIZONTAL_DOMINANCE;
        if (clearlyHorizontal && Math.abs(xDiff) > threshold) {
          if (xDiff > 0 && opts.onSwipeLeft) {
            opts.onSwipeLeft();
          } else if (xDiff < 0 && opts.onSwipeRight) {
            opts.onSwipeRight();
          }
        }
      }
      touchStart.current = null;
      vetoed.current = false;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [opts.onSwipeLeft, opts.onSwipeRight, threshold, enabled]);
}

/** Vertical travel (px) before the gesture is classified as a scroll. */
const SCROLL_VETO_Y = 16;
/** Required horizontal:vertical dominance ratio at release. */
const HORIZONTAL_DOMINANCE = 1.5;
