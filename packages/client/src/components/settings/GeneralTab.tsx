import { useState, useEffect } from "react";
import { Info, Globe, Terminal, RotateCcw, RefreshCw } from "lucide-react";
import { getVersions, checkSdkUpdate } from "../../lib/api-client";
import { SettingCard, SettingRow, SettingDivider, errorMsg } from "./shared";
import { useI18n } from "../../hooks/useI18n";
import type { Locale } from "../../lib/i18n/types";

export function GeneralTab() {
  const { t, locale, setLocale, supportedLocales } = useI18n();
  const [versions, setVersions] = useState<{ serverVersion: string; sdkVersion: string } | undefined>(undefined);
  const [checkResult, setCheckResult] = useState<{
    latestSdkVersion: string;
    updateAvailable: boolean;
    error?: string;
  } | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersions()
      .then(setVersions)
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setCheckResult(undefined);
    try {
      const res = await checkSdkUpdate();
      setCheckResult({
        latestSdkVersion: res.latestSdkVersion,
        updateAvailable: res.updateAvailable,
      });
    } catch (err) {
      setCheckResult({ latestSdkVersion: "?", updateAvailable: false, error: errorMsg(err) });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings-fields">
      {/* Card 1: About */}
      <SettingCard
        icon={<Info size={15} />}
        title={t("settings.general.about")}
        subtitle={t("settings.general.aboutDesc")}
      >
        <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
          pi-kot is a local-first web UI and bridge client for the pi coding agent. It embeds the @earendil-works/pi-coding-agent SDK and exposes capabilities via REST, SSE, and WebSockets.
        </div>
      </SettingCard>

      {/* Card 2: Language */}
      <SettingCard
        icon={<Globe size={15} />}
        title={t("settings.language")}
        subtitle="Select the interface language for pi-kot"
      >
        <SettingRow
          label={t("settings.language")}
          hint="UI labels, prompts, and dialog buttons"
        >
          <select
            className="settings-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {supportedLocales.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </SettingCard>

      {/* Card 3: Versions & Diagnostics */}
      <SettingCard
        icon={<Terminal size={15} />}
        title={t("settings.general.versions")}
        subtitle="Installed server build and agent runtime SDK versions"
        action={
          <button
            type="button"
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="settings-btn settings-btn-xs"
          >
            <RefreshCw size={11} className={checking ? "animate-spin" : ""} />
            <span>
              {checking
                ? t("settings.general.checking")
                : checkResult !== undefined
                  ? t("settings.general.checkAgain")
                  : t("settings.general.checkForUpdates")}
            </span>
          </button>
        }
      >
        <SettingRow
          label={t("settings.general.server")}
          hint="Fastify bridge server version"
        >
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, fontSize: 12 }}>
            {versions?.serverVersion ?? "…"}
          </span>
        </SettingRow>

        <SettingDivider />

        <SettingRow
          label={t("settings.general.sdk")}
          hint="@earendil-works/pi-coding-agent version"
        >
          <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, fontSize: 12 }}>
            {versions?.sdkVersion ?? "…"}
          </span>
        </SettingRow>

        {checkResult !== undefined && (
          <>
            <SettingDivider />
            <SettingRow
              label={t("settings.general.latestSdk")}
              hint={checkResult.error !== undefined ? "Check error" : checkResult.updateAvailable ? "A newer SDK is published on npm" : "You are on the latest SDK"}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600, fontSize: 12 }}>
                  {checkResult.error !== undefined ? (
                    <span style={{ color: "var(--danger, #e74c3c)" }}>{t("settings.general.checkFailed")}</span>
                  ) : (
                    checkResult.latestSdkVersion
                  )}
                </span>
                {checkResult.error === undefined && checkResult.updateAvailable && (
                  <span className="settings-badge" style={{ background: "var(--accent-subtle)", color: "var(--accent-text)", border: "1px solid var(--accent)" }}>
                    {t("settings.general.updateAvailable")}
                  </span>
                )}
                {checkResult.error === undefined && !checkResult.updateAvailable && (
                  <span className="settings-badge settings-badge-on">
                    {t("settings.general.upToDate")}
                  </span>
                )}
              </div>
            </SettingRow>
          </>
        )}
      </SettingCard>

      {/* Card 4: Quick Actions */}
      <SettingCard
        icon={<RotateCcw size={15} />}
        title="App Session"
        subtitle="Manage current browser window session"
      >
        <SettingRow
          label={t("settings.general.reloadPage")}
          hint="Refreshes the client and reconnects to active SSE streams"
        >
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="settings-btn"
          >
            <RotateCcw size={12} />
            <span>{t("settings.general.reloadPage")}</span>
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

