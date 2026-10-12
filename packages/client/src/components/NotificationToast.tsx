import { useState, useEffect, useRef } from "react";
import { Info, AlertTriangle, AlertCircle, X } from "lucide-react";
import { useExtensionUIStore, type ExtensionUINotification } from "../stores/extension-ui-store";

export function NotificationToast() {
  const notifications = useExtensionUIStore((s) => s.notifications);
  const dismiss = useExtensionUIStore((s) => s.dismissNotification);

  const [liveNotification, setLiveNotification] = useState<ExtensionUINotification | null>(null);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latest = notifications[notifications.length - 1];

  useEffect(() => {
    if (latest && latest.id !== liveNotification?.id) {
      setLiveNotification(latest);
      setVisible(true);
    }
  }, [latest, liveNotification]);

  // Auto-dismiss countdown (5s)
  useEffect(() => {
    if (!liveNotification || !visible || paused) return;

    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, 5000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [liveNotification, visible, paused]);

  const handleDismiss = () => {
    if (!liveNotification) return;
    setVisible(false);
    setTimeout(() => {
      dismiss(liveNotification.id);
      setLiveNotification(null);
    }, 200);
  };

  if (!liveNotification) return null;

  const { type, message } = liveNotification;

  return (
    <div className="toast-float-container" aria-live="polite">
      <div
        className={`toast-card ${visible ? "toast-card-enter" : "toast-card-exit"} tone-${type}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        role="alert"
      >
        <header className="toast-card-header">
          <div className="toast-card-title-group">
            <div className={`toast-card-icon-wrap tone-${type}`}>
              {type === "warning" ? (
                <AlertTriangle size={15} />
              ) : type === "error" ? (
                <AlertCircle size={15} />
              ) : (
                <Info size={15} />
              )}
            </div>
            <span className="toast-card-title">
              {type === "warning" ? "Warning" : type === "error" ? "Error" : "Notification"}
            </span>
          </div>
          <button
            type="button"
            className="toast-card-close"
            onClick={handleDismiss}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </header>

        <div className="toast-card-body">
          <div className="toast-card-message">{message}</div>
        </div>

        {/* Animated countdown progress bar */}
        <div className={`toast-progress-bar tone-${type} ${paused ? "paused" : ""}`} />
      </div>
    </div>
  );
}
