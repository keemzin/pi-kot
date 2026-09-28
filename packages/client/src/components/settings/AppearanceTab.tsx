import { useState, useEffect, useCallback, useRef } from "react";
import {
	getSavedTheme,
	getSavedAccent,
	applyTheme,
	themes,
	accents,
	THEME_MIGRATIONS,
	type ThemeMode,
} from "../../lib/theme";
import { getUiSettings, updateUiSettings } from "../../lib/api-client";
import { usePreferencesStore } from "../../stores/preferences-store";
import { SplitFlapText } from "../SplitFlapText";
import { useI18n } from "../../hooks/useI18n";
import { Palette, MessageSquare, Sliders, Sparkles, RotateCcw, MessageCircle } from "lucide-react";
import { SettingCard, SettingRow, SettingToggle, SettingDivider } from "./shared";

type UiSettings = {
	theme?: string;
	accent?: string;
	stickyUserHeader?: boolean;
	flyToTop?: boolean;
	showTokenUsage?: boolean;
	compressImages?: boolean;
	showThinking?: boolean;
	groupedToolDisplay?: boolean;
	trailDefaultView?: "full" | "justify";
	showTurnFiles?: boolean;
	swipeToOpenSidebar?: boolean;
	userBubbleColor?: string | null;
	userBubbleTextColor?: string | null;
	userBubbleBorderColor?: string | null;
	emptyFlapEnabled?: boolean;
	emptyFlapWords?: string[];
};

// ── Apply user bubble overrides to CSS :root ──
function applyBubbleOverrides(
	bg: string | null | undefined,
	text: string | null | undefined,
	border: string | null | undefined,
) {
	const root = document.documentElement;
	if (bg) root.style.setProperty("--user-bubble", bg);
	else root.style.removeProperty("--user-bubble");
	if (text) root.style.setProperty("--user-bubble-text", text);
	else root.style.removeProperty("--user-bubble-text");
	if (border) root.style.setProperty("--user-bubble-border", border);
	else root.style.removeProperty("--user-bubble-border");
}

// ── localStorage keys for bubble color fallback ──
const LS_BUBBLE_BG = "pi-kot/user-bubble-bg";
const LS_BUBBLE_TEXT = "pi-kot/user-bubble-text";
const LS_BUBBLE_BORDER = "pi-kot/user-bubble-border";

function loadLocalBubble(key: string): string | null {
	try {
		const v = localStorage.getItem(key);
		return v !== null ? v : null;
	} catch {
		return null;
	}
}

function saveLocalBubble(key: string, value: string | null | undefined): void {
	try {
		if (value) localStorage.setItem(key, value);
		else localStorage.removeItem(key);
	} catch {
		/* private mode */
	}
}

// ── Preset bubble colors ──
const BUBBLE_PRESETS = [
	{ name: "Accent", bg: null, text: null, border: null },
	{ name: "Blue", bg: "#1e40af", text: "#dbeafe", border: "#3b82f6" },
	{ name: "Violet", bg: "#5b21b6", text: "#ede9fe", border: "#8b5cf6" },
	{ name: "Emerald", bg: "#065f46", text: "#d1fae5", border: "#10b981" },
	{ name: "Amber", bg: "#92400e", text: "#fef3c7", border: "#f59e0b" },
	{ name: "Rose", bg: "#9f1239", text: "#ffe4e6", border: "#f43f5e" },
	{ name: "Teal", bg: "#115e59", text: "#ccfbf1", border: "#14b8a8" },
	{ name: "Orange", bg: "#9a3412", text: "#ffedd5", border: "#f97316" },
	{ name: "Slate", bg: "#334155", text: "#f1f5f9", border: "#64748b" },
	{
		name: "Custom",
		bg: "__custom__",
		text: "__custom__",
		border: "__custom__",
	},
];

export function AppearanceTab() {
	const { t } = useI18n();
	const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
	const [accent, setAccent] = useState(() => getSavedAccent());
	const [serverSynced, setServerSynced] = useState(false);

	// ── Toggle state — init from zustand (which reads localStorage) ──
	const zSticky = usePreferencesStore((s) => s.stickyUserHeader);
	const zToken = usePreferencesStore((s) => s.showTokenUsage);
	const zCompress = usePreferencesStore((s) => s.compressImages);
	const zThinking = usePreferencesStore((s) => s.showThinking);
	const zGrouped = usePreferencesStore((s) => s.groupedToolDisplay);
	const zTrailView = usePreferencesStore((s) => s.trailDefaultView);
	const zTurnFiles = usePreferencesStore((s) => s.showTurnFiles);
	const zSwipeSidebar = usePreferencesStore((s) => s.swipeToOpenSidebar);
	const zSetSticky = usePreferencesStore((s) => s.setStickyUserHeader);
	const zFly = usePreferencesStore((s) => s.flyToTop);
	const zSetFly = usePreferencesStore((s) => s.setFlyToTop);
	const zSetToken = usePreferencesStore((s) => s.setShowTokenUsage);
	const zSetCompress = usePreferencesStore((s) => s.setCompressImages);
	const zSetThinking = usePreferencesStore((s) => s.setShowThinking);
	const zSetGrouped = usePreferencesStore((s) => s.setGroupedToolDisplay);
	const zSetTrailView = usePreferencesStore((s) => s.setTrailDefaultView);
	const zSetTurnFiles = usePreferencesStore((s) => s.setShowTurnFiles);
	const zSetSwipeSidebar = usePreferencesStore((s) => s.setSwipeToOpenSidebar);
	const zFlapEnabled = usePreferencesStore((s) => s.emptyFlapEnabled);
	const zFlapWords = usePreferencesStore((s) => s.emptyFlapWords);
	const zSetFlapEnabled = usePreferencesStore((s) => s.setEmptyFlapEnabled);
	const zSetFlapWords = usePreferencesStore((s) => s.setEmptyFlapWords);

	const [stickyUserHeader, setStickyUserHeader] = useState(zSticky);
	const [flyToTop, setFlyToTop] = useState(zFly);
	const [showTokenUsage, setShowTokenUsage] = useState(zToken);
	const [compressImages, setCompressImages] = useState(zCompress);
	const [showThinking, setShowThinking] = useState(zThinking);
	const [groupedToolDisplay, setGroupedToolDisplay] = useState(zGrouped);
	const [trailView, setTrailView] = useState<"full" | "justify">(zTrailView);
	const [showTurnFiles, setShowTurnFiles] = useState(zTurnFiles);
	const [swipeToOpenSidebar, setSwipeToOpenSidebar] = useState(zSwipeSidebar);
	const [flapEnabled, setFlapEnabled] = useState(zFlapEnabled);
	const [flapWords, setFlapWords] = useState(zFlapWords);
	const [flapWordsDraft, setFlapWordsDraft] = useState(zFlapWords.join(", "));

	// ── User bubble (use ref to avoid stale closure in updateBubbleColor) ──
	const [bubbleBg, setBubbleBg] = useState<string | null>(() =>
		loadLocalBubble(LS_BUBBLE_BG),
	);
	const [bubbleText, setBubbleText] = useState<string | null>(() =>
		loadLocalBubble(LS_BUBBLE_TEXT),
	);
	const [bubbleBorder, setBubbleBorder] = useState<string | null>(() =>
		loadLocalBubble(LS_BUBBLE_BORDER),
	);
	const [selectedPreset, setSelectedPreset] = useState(0);
	const bubbleRef = useRef({
		bg: null as string | null,
		text: null as string | null,
		border: null as string | null,
	});
	const syncBubbleRef = () => {
		bubbleRef.current = {
			bg: bubbleBg,
			text: bubbleText,
			border: bubbleBorder,
		};
	};

	// ── Load server settings on mount ──
	useEffect(() => {
		let cancelled = false;
		getUiSettings()
			.then((server: UiSettings) => {
				if (cancelled) return;
				setServerSynced(true);

				// Theme + accent (save both together)
				const rawTheme = server.theme;
				// Handle old theme names from server
				const migratedTheme =
					rawTheme && THEME_MIGRATIONS[rawTheme]
						? THEME_MIGRATIONS[rawTheme]
						: rawTheme;
				const t =
					migratedTheme && themes.some((t) => t.id === migratedTheme)
						? (migratedTheme as ThemeMode)
						: getSavedTheme();
				const a =
					server.accent && accents.some((a) => a.id === server.accent)
						? server.accent
						: getSavedAccent();
				setTheme(t);
				setAccent(a);
				applyTheme(t, a);

				// Also persist theme+accent to server if they don't exist yet
				if (!server.theme || !server.accent) {
					persist({ theme: t, accent: a });
				}

				// Toggles — update local state AND zustand
				if (typeof server.stickyUserHeader === "boolean") {
					setStickyUserHeader(server.stickyUserHeader);
					zSetSticky(server.stickyUserHeader);
				}
				if (typeof server.flyToTop === "boolean") {
					setFlyToTop(server.flyToTop);
					zSetFly(server.flyToTop);
				}
				if (typeof server.showTokenUsage === "boolean") {
					setShowTokenUsage(server.showTokenUsage);
					zSetToken(server.showTokenUsage);
				}
				if (typeof server.compressImages === "boolean") {
					setCompressImages(server.compressImages);
					zSetCompress(server.compressImages);
				}
				if (typeof server.showThinking === "boolean") {
					setShowThinking(server.showThinking);
					zSetThinking(server.showThinking);
				}
				if (typeof server.groupedToolDisplay === "boolean") {
					setGroupedToolDisplay(server.groupedToolDisplay);
					zSetGrouped(server.groupedToolDisplay);
				}
				if (
					server.trailDefaultView === "full" ||
					server.trailDefaultView === "justify"
				) {
					setTrailView(server.trailDefaultView);
					zSetTrailView(server.trailDefaultView);
				}
				if (typeof server.showTurnFiles === "boolean") {
					setShowTurnFiles(server.showTurnFiles);
					zSetTurnFiles(server.showTurnFiles);
				}
				if (typeof server.swipeToOpenSidebar === "boolean") {
					setSwipeToOpenSidebar(server.swipeToOpenSidebar);
					zSetSwipeSidebar(server.swipeToOpenSidebar);
				}
				if (typeof server.emptyFlapEnabled === "boolean") {
					setFlapEnabled(server.emptyFlapEnabled);
					zSetFlapEnabled(server.emptyFlapEnabled);
				}
				if (Array.isArray(server.emptyFlapWords)) {
					setFlapWords(server.emptyFlapWords);
					setFlapWordsDraft(server.emptyFlapWords.join(", "));
					zSetFlapWords(server.emptyFlapWords);
				}

				// Bubble overrides — use server value, or fallback to localStorage, or null
				const bg =
					server.userBubbleColor !== undefined
						? server.userBubbleColor
						: loadLocalBubble(LS_BUBBLE_BG);
				const text =
					server.userBubbleTextColor !== undefined
						? server.userBubbleTextColor
						: loadLocalBubble(LS_BUBBLE_TEXT);
				const border =
					server.userBubbleBorderColor !== undefined
						? server.userBubbleBorderColor
						: loadLocalBubble(LS_BUBBLE_BORDER);
				setBubbleBg(bg);
				setBubbleText(text);
				setBubbleBorder(border);
				applyBubbleOverrides(bg, text, border);

				// Sync server values to localStorage for future fallback
				saveLocalBubble(LS_BUBBLE_BG, bg);
				saveLocalBubble(LS_BUBBLE_TEXT, text);
				saveLocalBubble(LS_BUBBLE_BORDER, border);

				const matchIdx = BUBBLE_PRESETS.findIndex(
					(p) => p.bg === bg && p.text === text && p.border === border,
				);
				setSelectedPreset(matchIdx >= 0 ? matchIdx : BUBBLE_PRESETS.length - 1);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	// Sync ref whenever state changes
	useEffect(() => {
		syncBubbleRef();
	});

	const persist = useCallback((patch: UiSettings) => {
		updateUiSettings(patch).catch(() => {});
	}, []);

	const selectTheme = (t: ThemeMode) => {
		setTheme(t);
		applyTheme(t, accent);
		// Save theme + accent together so both are persisted
		persist({ theme: t, accent });
	};

	const selectAccent = (id: string) => {
		setAccent(id);
		applyTheme(theme, id);
		persist({ accent: id, theme });
	};

	// ── Toggle handlers ──
	const toggleSticky = (val: boolean) => {
		setStickyUserHeader(val);
		zSetSticky(val);
		persist({ stickyUserHeader: val });
	};
	const toggleFlyToTop = (val: boolean) => {
		setFlyToTop(val);
		zSetFly(val);
		persist({ flyToTop: val });
	};
	const toggleToken = (val: boolean) => {
		setShowTokenUsage(val);
		zSetToken(val);
		persist({ showTokenUsage: val });
	};
	const toggleCompress = (val: boolean) => {
		setCompressImages(val);
		zSetCompress(val);
		persist({ compressImages: val });
	};
	const toggleThinking = (val: boolean) => {
		setShowThinking(val);
		zSetThinking(val);
		persist({ showThinking: val });
	};
	const toggleGrouped = (val: boolean) => {
		setGroupedToolDisplay(val);
		zSetGrouped(val);
		persist({ groupedToolDisplay: val });
	};

	const selectTrailView = (view: "full" | "justify") => {
		setTrailView(view);
		zSetTrailView(view);
		persist({ trailDefaultView: view });
	};
	const toggleTurnFiles = (val: boolean) => {
		setShowTurnFiles(val);
		zSetTurnFiles(val);
		persist({ showTurnFiles: val });
	};
	const toggleSwipeSidebar = (val: boolean) => {
		setSwipeToOpenSidebar(val);
		zSetSwipeSidebar(val);
		persist({ swipeToOpenSidebar: val });
	};

	// ── Split-flap empty state ──
	const toggleFlapEnabled = (val: boolean) => {
		setFlapEnabled(val);
		zSetFlapEnabled(val);
		persist({ emptyFlapEnabled: val });
	};

	const saveFlapWords = (raw: string) => {
		const words = raw
			.split(",")
			.map((w) => w.trim())
			.filter((w) => w.length > 0)
			.slice(0, 8)
			.map((w) => w.slice(0, 32));
		const cleaned =
			words.length > 0
				? words
				: flapWords.length > 0
					? flapWords
					: ["PI-KOT 0.1.40", "PI-SDK 0.87.1"];
		setFlapWords(cleaned);
		setFlapWordsDraft(cleaned.join(", "));
		zSetFlapWords(cleaned);
		persist({ emptyFlapWords: cleaned });
	};

	const selectBubblePreset = (idx: number) => {
		const p = BUBBLE_PRESETS[idx];
		setSelectedPreset(idx);
		if (p.bg === "__custom__") return;
		setBubbleBg(p.bg);
		setBubbleText(p.text);
		setBubbleBorder(p.border);
		applyBubbleOverrides(p.bg, p.text, p.border);
		saveLocalBubble(LS_BUBBLE_BG, p.bg);
		saveLocalBubble(LS_BUBBLE_TEXT, p.text);
		saveLocalBubble(LS_BUBBLE_BORDER, p.border);
		persist({
			userBubbleColor: p.bg,
			userBubbleTextColor: p.text,
			userBubbleBorderColor: p.border,
		});
	};

	const updateBubbleColor = (
		field: "bg" | "text" | "border",
		value: string,
	) => {
		// Use ref to avoid stale closure — ref is always current
		const cur = bubbleRef.current;
		const bg = field === "bg" ? value : cur.bg;
		const text = field === "text" ? value : cur.text;
		const border = field === "border" ? value : cur.border;
		if (field === "bg") setBubbleBg(value);
		if (field === "text") setBubbleText(value);
		if (field === "border") setBubbleBorder(value);
		setSelectedPreset(BUBBLE_PRESETS.length - 1);
		applyBubbleOverrides(bg, text, border);
		saveLocalBubble(LS_BUBBLE_BG, bg);
		saveLocalBubble(LS_BUBBLE_TEXT, text);
		saveLocalBubble(LS_BUBBLE_BORDER, border);
		persist({
			userBubbleColor: bg,
			userBubbleTextColor: text,
			userBubbleBorderColor: border,
		});
	};

	const resetBubble = () => {
		setBubbleBg(null);
		setBubbleText(null);
		setBubbleBorder(null);
		setSelectedPreset(0);
		applyBubbleOverrides(null, null, null);
		saveLocalBubble(LS_BUBBLE_BG, null);
		saveLocalBubble(LS_BUBBLE_TEXT, null);
		saveLocalBubble(LS_BUBBLE_BORDER, null);
		persist({
			userBubbleColor: null,
			userBubbleTextColor: null,
			userBubbleBorderColor: null,
		});
	};

	return (
		<div className="settings-fields">
			{/* Server sync status banner */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					padding: "8px 12px",
					borderRadius: "var(--radius-sm)",
					background: "var(--bg-glass)",
					border: "1px solid var(--border)",
					fontSize: 12,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span
						style={{
							width: 8,
							height: 8,
							borderRadius: "50%",
							background: serverSynced
								? "var(--success, #34d399)"
								: "var(--warning, #fbbf24)",
						}}
					/>
					<span style={{ color: "var(--text-secondary)" }}>
						{serverSynced
							? t("settings.appearance.preferencesSaved")
							: t("settings.appearance.preferencesLocal")}
					</span>
				</div>
			</div>

			{/* Card 1: Theme & Palette */}
			<SettingCard
				icon={<Palette size={15} />}
				title={`${t("settings.appearance.theme")} & ${t("settings.appearance.accent")}`}
				subtitle="Customize theme modes and system accent highlights"
			>
				<div className="settings-item-row stacked">
					<div className="settings-item-info">
						<div className="settings-item-label">{t("settings.appearance.theme")}</div>
						<div className="settings-item-desc">
							Select dark, light, or warm editor color palettes
						</div>
					</div>
					<div className="settings-theme-grid">
						{themes.map((th) => (
							<button
								key={th.id}
								type="button"
								className={`settings-theme-card ${theme === th.id ? "active" : ""}`}
								onClick={() => selectTheme(th.id as ThemeMode)}
							>
								<span className="settings-theme-icon">{th.icon}</span>
								<span>{th.name}</span>
							</button>
						))}
					</div>
				</div>

				<SettingDivider />

				<div className="settings-item-row stacked">
					<div className="settings-item-info">
						<div className="settings-item-label">{t("settings.appearance.accent")}</div>
						<div className="settings-item-desc">
							Focus rings, active tabs, buttons, and highlighted indicators
						</div>
					</div>
					<div className="settings-accents-row">
						{accents.map((a) => (
							<button
								key={a.id}
								type="button"
								onClick={() => selectAccent(a.id)}
								title={a.name}
								className={`settings-accent-dot ${accent === a.id ? "active" : ""}`}
								style={{ backgroundColor: a.color }}
							/>
						))}
					</div>
				</div>
			</SettingCard>

			{/* Card 2: Message Bubble Style */}
			<SettingCard
				icon={<MessageSquare size={15} />}
				title={t("settings.appearance.yourMessageBubble")}
				subtitle="Customize the color scheme and appearance of your user prompts"
				action={
					selectedPreset !== 0 ? (
						<button
							type="button"
							onClick={resetBubble}
							className="settings-btn settings-btn-xs"
							title={t("settings.appearance.resetDefaults")}
						>
							<RotateCcw size={11} />
							<span>{t("settings.appearance.resetDefaults")}</span>
						</button>
					) : undefined
				}
			>
				{/* Presets */}
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					{BUBBLE_PRESETS.map((p, i) => (
						<button
							key={p.name}
							type="button"
							onClick={() => selectBubblePreset(i)}
							className={`providers-filter-tab ${selectedPreset === i ? "active" : ""}`}
							style={{
								display: "inline-flex",
								alignItems: "center",
								gap: 6,
								border: `1px solid ${selectedPreset === i ? "var(--accent)" : "var(--border)"}`,
							}}
						>
							{p.bg !== "__custom__" && p.bg !== null && (
								<span
									style={{
										width: 10,
										height: 10,
										borderRadius: 2,
										background: p.bg,
										border: `1px solid ${p.border ?? "transparent"}`,
										flexShrink: 0,
									}}
								/>
							)}
							{p.name}
						</button>
					))}
				</div>

				{/* Live Preview & Custom Editor */}
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 12,
						padding: 12,
						borderRadius: "var(--radius-sm)",
						background: "var(--bg-glass-strong)",
						border: "1px solid var(--border)",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
						}}
					>
						<span
							style={{
								fontSize: 11,
								fontWeight: 600,
								color: "var(--text-dim)",
								textTransform: "uppercase",
								letterSpacing: "0.05em",
							}}
						>
							{t("settings.appearance.preview")}
						</span>
					</div>

					<div className="message-row user" style={{ padding: 0 }}>
						<div className="message-bubble user">
							{t("settings.appearance.previewUser")}
						</div>
					</div>
					<div className="message-row assistant" style={{ padding: 0 }}>
						<div
							className="message-bubble assistant"
							style={{ fontSize: 13, color: "var(--text-secondary)" }}
						>
							{t("settings.appearance.previewAssistant")}
						</div>
					</div>

					{selectedPreset === BUBBLE_PRESETS.length - 1 && (
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
								gap: 10,
								marginTop: 6,
								paddingTop: 10,
								borderTop: "1px solid var(--border)",
							}}
						>
							{/* Background color */}
							<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
								<label
									style={{
										fontSize: 11,
										color: "var(--text-secondary)",
										fontWeight: 500,
									}}
								>
									{t("settings.appearance.background")}
								</label>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<input
										type="color"
										value={bubbleBg ?? "#1e40af"}
										onChange={(e) => updateBubbleColor("bg", e.target.value)}
										style={{
											width: 28,
											height: 28,
											padding: 0,
											border: "1px solid var(--border)",
											borderRadius: 4,
											cursor: "pointer",
										}}
									/>
									<input
										type="text"
										value={bubbleBg ?? ""}
										onChange={(e) =>
											updateBubbleColor("bg", e.target.value || "")
										}
										placeholder="accent default"
										className="settings-input"
										style={{
											fontSize: 11,
											padding: "4px 8px",
											fontFamily: "var(--font-mono)",
										}}
									/>
								</div>
							</div>

							{/* Text color */}
							<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
								<label
									style={{
										fontSize: 11,
										color: "var(--text-secondary)",
										fontWeight: 500,
									}}
								>
									{t("settings.appearance.text")}
								</label>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<input
										type="color"
										value={bubbleText ?? "#ffffff"}
										onChange={(e) => updateBubbleColor("text", e.target.value)}
										style={{
											width: 28,
											height: 28,
											padding: 0,
											border: "1px solid var(--border)",
											borderRadius: 4,
											cursor: "pointer",
										}}
									/>
									<input
										type="text"
										value={bubbleText ?? ""}
										onChange={(e) =>
											updateBubbleColor("text", e.target.value || "")
										}
										placeholder="accent default"
										className="settings-input"
										style={{
											fontSize: 11,
											padding: "4px 8px",
											fontFamily: "var(--font-mono)",
										}}
									/>
								</div>
							</div>

							{/* Border color */}
							<div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
								<label
									style={{
										fontSize: 11,
										color: "var(--text-secondary)",
										fontWeight: 500,
									}}
								>
									{t("settings.appearance.border")}
								</label>
								<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
									<input
										type="color"
										value={bubbleBorder ?? "#3b82f6"}
										onChange={(e) =>
											updateBubbleColor("border", e.target.value)
										}
										style={{
											width: 28,
											height: 28,
											padding: 0,
											border: "1px solid var(--border)",
											borderRadius: 4,
											cursor: "pointer",
										}}
									/>
									<input
										type="text"
										value={bubbleBorder ?? ""}
										onChange={(e) =>
											updateBubbleColor("border", e.target.value || "")
										}
										placeholder="accent default"
										className="settings-input"
										style={{
											fontSize: 11,
											padding: "4px 8px",
											fontFamily: "var(--font-mono)",
										}}
									/>
								</div>
							</div>
						</div>
					)}
				</div>
			</SettingCard>

			{/* Card 3: Chat & Stream Experience */}
			<SettingCard
				icon={<MessageCircle size={15} />}
				title={t("settings.appearance.chat")}
				subtitle="Layout behavior, streaming flow, and execution trail visibility"
			>
				<SettingRow
					label={t("settings.appearance.stickyUserHeader")}
					hint="Pins your prompt header to the top when scrolling through long replies"
				>
					<SettingToggle
						checked={stickyUserHeader}
						onChange={toggleSticky}
						ariaLabel={t("settings.appearance.stickyUserHeader")}
					/>
				</SettingRow>

				<SettingDivider />

				<SettingRow
					label={t("settings.appearance.flyToTop")}
					hint={t("settings.appearance.flyToTopDesc")}
				>
					<SettingToggle
						checked={flyToTop}
						onChange={toggleFlyToTop}
						ariaLabel={t("settings.appearance.flyToTop")}
					/>
				</SettingRow>

				<SettingDivider />

				<SettingRow
					label={t("settings.appearance.showTokenUsage")}
					hint="Show input and output token consumption chips on each turn"
				>
					<SettingToggle
						checked={showTokenUsage}
						onChange={toggleToken}
						ariaLabel={t("settings.appearance.showTokenUsage")}
					/>
				</SettingRow>

				<SettingDivider />

				<SettingRow
					label={t("settings.appearance.showTurnFiles")}
					hint={t("settings.appearance.showTurnFilesDesc")}
				>
					<SettingToggle
						checked={showTurnFiles}
						onChange={toggleTurnFiles}
						ariaLabel={t("settings.appearance.showTurnFiles")}
					/>
				</SettingRow>

				<SettingDivider />

				<SettingRow
					label={t("settings.appearance.showThinking")}
					hint="Render reasoning and thinking blocks emitted by compatible models"
				>
					<SettingToggle
						checked={showThinking}
						onChange={toggleThinking}
						ariaLabel={t("settings.appearance.showThinking")}
					/>
				</SettingRow>

				<SettingDivider />

				<SettingRow
					label={t("settings.appearance.groupedToolDisplay")}
					hint={t("settings.appearance.groupedToolDisplayDesc")}
					alignTop={groupedToolDisplay}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-end",
							gap: 8,
						}}
					>
						<SettingToggle
							checked={groupedToolDisplay}
							onChange={toggleGrouped}
							ariaLabel={t("settings.appearance.groupedToolDisplay")}
						/>
						{groupedToolDisplay && (
							<div className="settings-segmented">
								{(["justify", "full"] as const).map((v) => (
									<button
										key={v}
										type="button"
										className={`settings-segmented-btn ${trailView === v ? "active" : ""}`}
										onClick={() => selectTrailView(v)}
										title={t("settings.appearance.trailHint")}
									>
										{v === "justify"
											? t("settings.appearance.trailAuto")
											: t("settings.appearance.trailExpandAll")}
									</button>
								))}
							</div>
						)}
					</div>
				</SettingRow>
			</SettingCard>

			{/* Card 4: Gestures & Media */}
			<SettingCard
				icon={<Sliders size={15} />}
				title="Touch & Media"
				subtitle="Gestures for touchscreen navigation and media optimization"
			>
				<SettingRow
					label={t("settings.appearance.compressImages")}
					hint="Automatically downscale high-resolution images to conserve context tokens"
				>
					<SettingToggle
						checked={compressImages}
						onChange={toggleCompress}
						ariaLabel={t("settings.appearance.compressImages")}
					/>
				</SettingRow>

				<SettingDivider />

				<SettingRow
					label={t("settings.appearance.swipeSidebar")}
					hint={t("settings.appearance.swipeSidebarHint")}
				>
					<SettingToggle
						checked={swipeToOpenSidebar}
						onChange={toggleSwipeSidebar}
						ariaLabel={t("settings.appearance.swipeSidebar")}
					/>
				</SettingRow>
			</SettingCard>

			{/* Card 5: Empty State Welcome */}
			<SettingCard
				icon={<Sparkles size={15} />}
				title={t("settings.appearance.emptyState")}
				subtitle="Interactive greeting board for newly created chat sessions"
			>
				<SettingRow
					label={t("settings.appearance.splitFlap")}
					hint={t("settings.appearance.splitFlapHint")}
				>
					<SettingToggle
						checked={flapEnabled}
						onChange={toggleFlapEnabled}
						ariaLabel={t("settings.appearance.splitFlap")}
					/>
				</SettingRow>

				{flapEnabled && (
					<>
						<SettingDivider />
						<div className="settings-item-row stacked">
							<div className="settings-item-info">
								<div className="settings-item-label">
									{t("settings.appearance.splitFlapPhrases")}
								</div>
								<div className="settings-item-desc">
									{t("settings.appearance.splitFlapPhrasesHint")}
								</div>
							</div>
							<input
								value={flapWordsDraft}
								onChange={(e) => setFlapWordsDraft(e.target.value)}
								onBlur={() => saveFlapWords(flapWordsDraft)}
								onKeyDown={(e) => {
									if (e.key === "Enter") saveFlapWords(flapWordsDraft);
								}}
								className="settings-input"
								placeholder="PI-KOT 0.1.40, PI-SDK 0.87.1"
							/>
						</div>

						{/* Live departure board preview */}
						<div
							style={{
								marginTop: 4,
								padding: "16px 12px",
								borderRadius: "var(--radius-md)",
								border: "1px solid var(--border)",
								background: "var(--bg-glass-strong)",
								display: "flex",
								justifyContent: "center",
								overflow: "hidden",
								maxWidth: "100%",
							}}
						>
							<SplitFlapText
								words={flapWords}
								flipDuration={0.12}
								stagger={0.05}
								cycleDelay={2600}
								flipsPerChar={7}
								gap={4}
								tileRadius={6}
								fontSize={14}
							/>
						</div>
					</>
				)}
			</SettingCard>
		</div>
	);
}
