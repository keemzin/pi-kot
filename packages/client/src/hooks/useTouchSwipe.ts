import { useEffect, useRef } from "react";

export function useTouchSwipe(opts: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
}) {
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const threshold = opts.threshold || 50;

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      touchStart.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStart.current) return;
      const xDiff = touchStart.current.x - e.changedTouches[0].clientX;
      const yDiff = touchStart.current.y - e.changedTouches[0].clientY;

      if (Math.abs(xDiff) > Math.abs(yDiff) && Math.abs(xDiff) > threshold) {
        if (xDiff > 0 && opts.onSwipeLeft) {
          opts.onSwipeLeft();
        } else if (xDiff < 0 && opts.onSwipeRight) {
          opts.onSwipeRight();
        }
      }
      touchStart.current = null;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [opts.onSwipeLeft, opts.onSwipeRight, threshold]);
}
