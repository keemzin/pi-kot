/**
 * NotificationToast — card overlay for extension command results
 * (`extension_ui_notify` SSE events). Renders a centered card
 * matching the settings-panel style, with frosted glass, blur,
 * border, and the sheetIn animation.
 *
 * Only the most recent notification is shown at a time.
 * Auto-dismisses after 15 seconds or on click/dismiss button.
 */

import { useState, useEffect } from "react";
import { useExtensionUIStore } from "../stores/extension-ui-store";

export function NotificationToast() {
  const notifications = useExtensionUIStore((s) => s.notifications);
  const dismiss = useExtensionUIStore((s) => s.dismissNotification);

  // Track the "live" notification: the most recent one that has been
  // acknowledged (viewed). We re-render whenever a new notification
  // arrives, showing the latest one.
  const [liveId, setLiveId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [type, setType] = useState<"info" | "warning" | "error">("info");
  const [visible, setVisible] = useState(false);

  // Pick the latest notification
  const latest = notifications[notifications.length - 1];

  useEffect(() => {
    if (latest && latest.id !== liveId) {
      setLiveId(latest.id);
      setMessage(latest.message);
      setType(latest.type);
      setVisible(true);
      // Auto-dismiss after 15s
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(() => dismiss(latest.id), 300); // wait for outro
      }, 15000);
      return () => clearTimeout(timer);
    }
  }, [latest, liveId, dismiss]);

  const handleDismiss = () => {
    if (!liveId) return;
    setVisible(false);
    // Wait for the CSS animation to finish before removing from store
    setTimeout(() => {
      dismiss(liveId);
      setLiveId(null);
    }, 250);
  };

  if (!liveId || !message) return null;

  return (
    <div className="toast-overlay" onClick={handleDismiss}>
      <div
        className={`toast-card ${visible ? "toast-card-enter" : "toast-card-exit"}`}
        onClick={(e) => e.stopPropagation()}
        role="alert"
      >
        <header className="toast-card-header">
          <span className="toast-card-title">
            {type === "info" && "ℹ️"}
            {type === "warning" && "⚠️"}
            {type === "error" && "❌"}
            <span style={{ marginLeft: 6 }}>
              {type === "info" && "Context Mode"}
              {type === "warning" && "Warning"}
              {type === "error" && "Error"}
            </span>
          </span>
          <button
            className="toast-card-close"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </header>
        <div className="toast-card-body">
          <pre className="toast-card-content">{message}</pre>
        </div>
      </div>
    </div>
  );
}
