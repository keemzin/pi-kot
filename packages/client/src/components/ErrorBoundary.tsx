import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional — show a compact inline fallback instead of a full block. Good for sidebar panels. */
  compact?: boolean;
  /** Optional label for logging / identification. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * React error boundary that catches render errors in its subtree.
 *
 * Usage:
 *   <ErrorBoundary label="ChatView">
 *     <ChatView />
 *   </ErrorBoundary>
 *
 * Shows a fallback UI with the error name/message and a Retry button.
 * Set `compact` for sidebar/panel contexts where a full block is too loud.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}]`,
      error,
      info.componentStack,
    );
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error === null) {
      return this.props.children;
    }

    const { error } = this.state;
    const { compact } = this.props;

    if (compact) {
      return (
        <div
          style={{
            padding: "12px",
            margin: "8px",
            borderRadius: "6px",
            background: "var(--bg-glass, rgba(220,80,80,0.08))",
            border: "1px solid var(--accent-red, #e06c75)",
            fontSize: "12px",
            color: "var(--text-secondary, #999)",
            lineHeight: 1.4,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--accent-red, #e06c75)", marginBottom: 4 }}>
            ⚠️ {error.name ?? "Error"}
          </div>
          <div style={{ marginBottom: 8, wordBreak: "break-word" }}>{error.message}</div>
          <button
            onClick={this.handleRetry}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              borderRadius: "4px",
              border: "1px solid var(--border, #444)",
              background: "var(--bg-surface, #1e1e1e)",
              color: "var(--text-primary, #ddd)",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 24px",
          height: "100%",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            padding: "24px",
            borderRadius: "8px",
            background: "var(--bg-surface, #1e1e1e)",
            border: "1px solid var(--border, #444)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--accent-red, #e06c75)",
              marginBottom: 8,
            }}
          >
            Something went wrong
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary, #999)",
              marginBottom: 4,
              fontFamily: "monospace",
            }}
          >
            {error.name}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "var(--text-primary, #ddd)",
              marginBottom: 20,
              lineHeight: 1.5,
              wordBreak: "break-word",
            }}
          >
            {error.message}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={this.handleRetry}
              style={{
                padding: "6px 16px",
                fontSize: 12,
                borderRadius: "6px",
                border: "none",
                background: "var(--accent-primary, #569cd6)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
            <button
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              style={{
                padding: "6px 16px",
                fontSize: 12,
                borderRadius: "6px",
                border: "1px solid var(--border, #444)",
                background: "transparent",
                color: "var(--text-secondary, #999)",
                cursor: "pointer",
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
