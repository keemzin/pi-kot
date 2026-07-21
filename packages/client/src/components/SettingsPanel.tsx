/**
 * Settings Panel — modal overlay with config tabs.
 *
 * Shell component that renders tab navigation and delegates content
 * to individual tab components in ./settings/.
 */
import { useState, useEffect, useMemo } from "react";
import { SlidePanel } from "./SlidePanel";
import { AppearanceTab } from "./settings/AppearanceTab";
import { ProvidersTab } from "./settings/ProvidersTab";
import { AgentTab } from "./settings/AgentTab";
import { GeneralTab } from "./settings/GeneralTab";
import { PackagesTab } from "./PackagesTab";
import { SkillsTab } from "./SkillsTab";
import { TunnelTab } from "./TunnelTab";
import { useSessionStore } from "../stores/session-store";

type Tab = "appearance" | "providers" | "agent" | "general" | "packages" | "skills" | "tunnel";

interface Props {
  onClose: () => void;
  initialTab?: Tab;
}

export function SettingsPanel({ onClose, initialTab }: Props) {
  const visibleTabs: Tab[] = ["appearance", "providers", "agent", "general", "packages", "skills", "tunnel"];

  const [tab, setTab] = useState<Tab>(initialTab ?? "appearance");
  const [error, setError] = useState<string | undefined>(undefined);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600);

  // Derive active project path for package scope
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const projects = useSessionStore((s) => s.projects);
  const projectPath = useMemo(() => {
    if (activeProjectId === undefined) return undefined;
    return projects.find((p) => p.id === activeProjectId)?.path;
  }, [activeProjectId, projects]);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 600);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab("appearance");
  }, [tab]);

  useEffect(() => {
    if (initialTab !== undefined && visibleTabs.includes(initialTab)) {
      setTab(initialTab);
    } else if (initialTab === undefined || !visibleTabs.includes(initialTab)) {
      setTab("appearance");
    }
  }, [initialTab]);

  return (
    <SlidePanel
      open
      onClose={onClose}
      header={
        <header className="settings-header">
          <div className="settings-tabs" style={{
            display: "flex",
            gap: 2,
            overflowX: isMobile ? "auto" : undefined,
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
            msOverflowStyle: "none",
            scrollbarWidth: "none",
          }}>
            {visibleTabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`settings-tab ${tab === t ? "settings-tab-active" : ""}`}
              >
                {t === "appearance"
                  ? "Appearance"
                  : t === "providers"
                    ? "Providers"
                    : t === "agent"
                      ? "Agent"
                      : t === "packages"
                        ? "Packages 📦"
                        : t === "skills"
                          ? "Skills"
                          : t === "tunnel"
                        ? "Tunnel 🚇"
                        : "General"}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            className="settings-close"
            title="Close (Esc)"
            style={{ flexShrink: 0 }}
          >
            ✕
          </button>
        </header>
      }
      style={{
        width: isMobile ? "100vw" : 720,
        maxWidth: "100vw",
        height: isMobile ? "100dvh" : "85vh",
        maxHeight: isMobile ? "100dvh" : undefined,
        borderRadius: isMobile ? 0 : undefined,
      }}
    >
      {error !== undefined && (
        <div className="settings-error">
          {error}
        </div>
      )}

      {tab === "appearance" && <AppearanceTab />}
      {tab === "providers" && <ProvidersTab onError={setError} />}
      {tab === "agent" && <AgentTab onError={setError} />}
      {tab === "packages" && <PackagesTab onError={setError} projectPath={projectPath} />}
      {tab === "skills" && <SkillsTab onError={setError} />}
      {tab === "tunnel" && <TunnelTab />}
      {tab === "general" && <GeneralTab />}
    </SlidePanel>
  );
}
