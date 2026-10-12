import React, { useEffect, useRef } from "react";
import {
  AlertTriangle,
  Trash2,
  AlertCircle,
  Info,
  CheckCircle2,
  HelpCircle,
  X,
} from "lucide-react";
import { useDialogStore } from "../stores/dialog-store";

export const GlobalConfirmDialog: React.FC = () => {
  const currentConfirm = useDialogStore((s) => s.currentConfirm);
  const currentAlert = useDialogStore((s) => s.currentAlert);
  const closeConfirm = useDialogStore((s) => s.closeConfirm);
  const closeAlert = useDialogStore((s) => s.closeAlert);

  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const alertBtnRef = useRef<HTMLButtonElement>(null);

  // Focus management and keyboard listener for Confirm
  useEffect(() => {
    if (!currentConfirm) return;

    // Focus default button: Cancel for destructive/danger, Confirm otherwise
    if (currentConfirm.tone === "danger") {
      cancelBtnRef.current?.focus();
    } else {
      confirmBtnRef.current?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeConfirm(false);
      } else if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
        // If the cancel button is actively focused, let Enter trigger Cancel
        if (document.activeElement === cancelBtnRef.current) {
          closeConfirm(false);
        } else {
          closeConfirm(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentConfirm, closeConfirm]);

  // Focus management and keyboard listener for Alert
  useEffect(() => {
    if (!currentAlert) return;

    alertBtnRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        closeAlert();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentAlert, closeAlert]);

  // If confirm dialog is active
  if (currentConfirm) {
    const {
      title,
      message,
      detail,
      confirmText = "Confirm",
      cancelText = "Cancel",
      tone = "default",
    } = currentConfirm;

    const isDanger = tone === "danger";
    const isWarning = tone === "warning";
    const isInfo = tone === "info";

    const defaultTitle = isDanger
      ? "Confirm Deletion"
      : isWarning
        ? "Warning"
        : isInfo
          ? "Information"
          : "Confirm Action";

    return (
      <div
        className="global-dialog-overlay"
        onClick={() => closeConfirm(false)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div
          className={`global-dialog-card tone-${tone}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="global-dialog-header">
            <div className="global-dialog-header-left">
              <div className={`global-dialog-icon-wrap tone-${tone}`}>
                {isDanger ? (
                  <Trash2 size={18} />
                ) : isWarning ? (
                  <AlertTriangle size={18} />
                ) : isInfo ? (
                  <Info size={18} />
                ) : (
                  <HelpCircle size={18} />
                )}
              </div>
              <h3 id="dialog-title" className="global-dialog-title">
                {title || defaultTitle}
              </h3>
            </div>
            <button
              type="button"
              className="global-dialog-close-btn"
              onClick={() => closeConfirm(false)}
              aria-label="Close"
              title="Cancel (Esc)"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div className="global-dialog-body">
            <p className="global-dialog-message">{message}</p>
            {detail && (
              <div className={`global-dialog-detail-box tone-${tone}`}>
                {isDanger && <AlertCircle size={14} className="detail-icon" />}
                {isWarning && <Info size={14} className="detail-icon" />}
                <span>{detail}</span>
              </div>
            )}
          </div>

          {/* Footer actions */}
          <div className="global-dialog-footer">
            <button
              ref={cancelBtnRef}
              type="button"
              className="global-dialog-btn cancel"
              onClick={() => closeConfirm(false)}
            >
              {cancelText}
            </button>
            <button
              ref={confirmBtnRef}
              type="button"
              className={`global-dialog-btn confirm tone-${tone}`}
              onClick={() => closeConfirm(true)}
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If alert dialog is active
  if (currentAlert) {
    const {
      title,
      message,
      detail,
      buttonText = "OK",
      tone = "info",
    } = currentAlert;

    const isError = tone === "error";
    const isWarning = tone === "warning";
    const isSuccess = tone === "success";

    const defaultTitle = isError
      ? "Error"
      : isWarning
        ? "Warning"
        : isSuccess
          ? "Success"
          : "Notice";

    return (
      <div
        className="global-dialog-overlay"
        onClick={closeAlert}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <div
          className={`global-dialog-card tone-${tone}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="global-dialog-header">
            <div className="global-dialog-header-left">
              <div className={`global-dialog-icon-wrap tone-${tone}`}>
                {isError ? (
                  <AlertCircle size={18} />
                ) : isWarning ? (
                  <AlertTriangle size={18} />
                ) : isSuccess ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <Info size={18} />
                )}
              </div>
              <h3 id="dialog-title" className="global-dialog-title">
                {title || defaultTitle}
              </h3>
            </div>
            <button
              type="button"
              className="global-dialog-close-btn"
              onClick={closeAlert}
              aria-label="Close"
              title="Close (Esc)"
            >
              <X size={15} />
            </button>
          </div>

          {/* Body */}
          <div className="global-dialog-body">
            <p className="global-dialog-message">{message}</p>
            {detail && (
              <div className={`global-dialog-detail-box tone-${tone}`}>
                <Info size={14} className="detail-icon" />
                <span>{detail}</span>
              </div>
            )}
          </div>

          {/* Footer action */}
          <div className="global-dialog-footer">
            <button
              ref={alertBtnRef}
              type="button"
              className={`global-dialog-btn confirm tone-${tone}`}
              onClick={closeAlert}
            >
              {buttonText}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
