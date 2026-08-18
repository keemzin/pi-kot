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

type UiSettings = {
	theme?: string;
	accent?: string;
	stickyUserHeader?: boolean;
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
	emptyFlapSize?: number;
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
	const zFlapSize = usePreferencesStore((s) => s.emptyFlapSize);
	const zSetFlapEnabled = usePreferencesStore((s) => s.setEmptyFlapEnabled);
	const zSetFlapWords = usePreferencesStore((s) => s.setEmptyFlapWords);
	const zSetFlapSize = usePreferencesStore((s) => s.setEmptyFlapSize);

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
	const [flapSize, setFlapSize] = useState(zFlapSize);

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
	// Local-only preference (not part of the server UiSettings schema) — the
	// zustand store persists it to localStorage on its own.
	const toggleFlyToTop = (val: boolean) => {
		setFlyToTop(val);
		zSetFly(val);
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
					: ["PI-KOT 0.1.36", "PI-SDK 0.83.0"];
		setFlapWords(cleaned);
		setFlapWordsDraft(cleaned.join(", "));
		zSetFlapWords(cleaned);
		persist({ emptyFlapWords: cleaned });
	};

	const saveFlapSize = (val: number) => {
		const clamped = Math.min(64, Math.max(14, Math.round(Number(val) || 30)));
		setFlapSize(clamped);
		zSetFlapSize(clamped);
		persist({ emptyFlapSize: clamped });
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
			<p className="settings-hint">
				{serverSynced
					? "Preferences saved server-side (survives cache clears)."
					: "Server offline — saved locally only."}
			</p>

			{/* ── Theme ── */}
			<div className="settings-field">
				<label className="settings-label">Theme</label>
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					{themes.map((t) => (
						<button
							key={t.id}
							onClick={() => selectTheme(t.id as ThemeMode)}
							style={{
								padding: "6px 12px",
								borderRadius: "var(--radius-sm)",
								border: `1px solid ${theme === t.id ? "var(--accent)" : "var(--border)"}`,
								background:
									theme === t.id ? "var(--accent-subtle)" : "var(--bg-glass)",
								color:
									theme === t.id
										? "var(--accent-text)"
										: "var(--text-secondary)",
								fontSize: "12px",
								fontWeight: theme === t.id ? 600 : 400,
								cursor: "pointer",
								fontFamily: "inherit",
								transition: "all 0.15s",
							}}
							type="button"
						>
							{t.icon} {t.name}
						</button>
					))}
				</div>
			</div>

			{/* ── Accent ── */}
			<div className="settings-field">
				<label className="settings-label">Accent</label>
				<div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
					{accents.map((a) => (
						<button
							key={a.id}
							onClick={() => selectAccent(a.id)}
							title={a.name}
							style={{
								width: 28,
								height: 28,
								borderRadius: "50%",
								border:
									accent === a.id
										? `2px solid ${a.color}`
										: "2px solid var(--border)",
								background: a.color,
								cursor: "pointer",
								boxShadow:
									accent === a.id
										? `0 0 0 2px var(--bg-solid), 0 0 0 4px ${a.color}`
										: "none",
								transition: "all 0.15s",
							}}
							type="button"
						/>
					))}
				</div>
			</div>

			{/* ── User Bubble ── */}
			<div className="settings-field">
				<label className="settings-label">Your Message Bubble</label>
				<div
					style={{
						display: "flex",
						gap: "6px",
						flexWrap: "wrap",
						marginBottom: 8,
					}}
				>
					{BUBBLE_PRESETS.map((p, i) => (
						<button
							key={p.name}
							onClick={() => selectBubblePreset(i)}
							style={{
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "4px 10px",
								borderRadius: "var(--radius-sm)",
								border: `1px solid ${selectedPreset === i ? "var(--accent)" : "var(--border)"}`,
								background:
									selectedPreset === i
										? "var(--accent-subtle)"
										: "var(--bg-glass)",
								color:
									selectedPreset === i
										? "var(--accent-text)"
										: "var(--text-secondary)",
								fontSize: "11px",
								fontWeight: selectedPreset === i ? 600 : 400,
								cursor: "pointer",
								fontFamily: "inherit",
								transition: "all 0.15s",
							}}
							type="button"
						>
							{p.bg !== "__custom__" && p.bg !== null && (
								<span
									style={{
										width: 12,
										height: 12,
										borderRadius: 3,
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

				{selectedPreset === BUBBLE_PRESETS.length - 1 && (
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							gap: 8,
							padding: "8px 0",
						}}
					>
						{/* ── Live preview: mirrors .message-bubble.user exactly ── */}
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: 10,
								padding: 12,
								borderRadius: "var(--radius-sm)",
								background: "var(--bg-glass)",
								border: "1px solid var(--border)",
							}}
						>
							<span style={{ fontSize: 11, color: "var(--text-dim)" }}>
								Preview
							</span>
							<div className="message-row user" style={{ padding: 0 }}>
								<div className="message-bubble user">
									Your messages will look like this.
								</div>
							</div>
							<div className="message-row assistant" style={{ padding: 0 }}>
								<div
									className="message-bubble assistant"
									style={{ fontSize: 13, color: "var(--text-secondary)" }}
								>
									The assistant reply sits here for reference.
								</div>
							</div>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<label
								style={{ fontSize: 11, color: "var(--text-dim)", width: 60 }}
							>
								Background
							</label>
							<input
								type="color"
								value={bubbleBg ?? "#1e40af"}
								onChange={(e) => updateBubbleColor("bg", e.target.value)}
								style={{
									width: 32,
									height: 24,
									padding: 0,
									border: "1px solid var(--border)",
									borderRadius: 4,
									cursor: "pointer",
								}}
							/>
							<input
								type="text"
								value={bubbleBg ?? ""}
								onChange={(e) => updateBubbleColor("bg", e.target.value || "")}
								placeholder="accent default"
								style={{
									flex: 1,
									padding: "3px 6px",
									fontSize: 11,
									fontFamily: "var(--font-mono)",
									background: "var(--bg-glass)",
									border: "1px solid var(--border)",
									borderRadius: 4,
									color: "var(--text-primary)",
								}}
							/>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<label
								style={{ fontSize: 11, color: "var(--text-dim)", width: 60 }}
							>
								Text
							</label>
							<input
								type="color"
								value={bubbleText ?? "#ffffff"}
								onChange={(e) => updateBubbleColor("text", e.target.value)}
								style={{
									width: 32,
									height: 24,
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
								style={{
									flex: 1,
									padding: "3px 6px",
									fontSize: 11,
									fontFamily: "var(--font-mono)",
									background: "var(--bg-glass)",
									border: "1px solid var(--border)",
									borderRadius: 4,
									color: "var(--text-primary)",
								}}
							/>
						</div>
						<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<label
								style={{ fontSize: 11, color: "var(--text-dim)", width: 60 }}
							>
								Border
							</label>
							<input
								type="color"
								value={bubbleBorder ?? "#3b82f6"}
								onChange={(e) => updateBubbleColor("border", e.target.value)}
								style={{
									width: 32,
									height: 24,
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
								style={{
									flex: 1,
									padding: "3px 6px",
									fontSize: 11,
									fontFamily: "var(--font-mono)",
									background: "var(--bg-glass)",
									border: "1px solid var(--border)",
									borderRadius: 4,
									color: "var(--text-primary)",
								}}
							/>
						</div>
						<button
							onClick={resetBubble}
							style={{
								alignSelf: "flex-start",
								padding: "4px 10px",
								fontSize: 11,
								border: "1px solid var(--border)",
								borderRadius: "var(--radius-sm)",
								background: "var(--bg-glass)",
								color: "var(--text-secondary)",
								cursor: "pointer",
								fontFamily: "inherit",
							}}
							type="button"
						>
							Reset to accent default
						</button>
					</div>
				)}
			</div>

			{/* ── Toggles ── */}
			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={stickyUserHeader}
						onChange={(e) => toggleSticky(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Sticky user header
				</label>
			</div>

			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={flyToTop}
						onChange={(e) => toggleFlyToTop(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Fly to top
				</label>
				<div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
					Anchors your newest message near the top while it streams. Reply grows
					below and auto-scroll takes over once it fills the screen.
				</div>
			</div>

			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={showTokenUsage}
						onChange={(e) => toggleToken(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Show token usage
				</label>
			</div>

			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={showTurnFiles}
						onChange={(e) => toggleTurnFiles(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Show turn-written files
				</label>
				<p className="settings-hint" style={{ marginTop: 4 }}>
					File chips under each reply for files the agent wrote, with per-turn
					diff.
				</p>
			</div>

			<div className="settings-field">
				<label className="settings-label">Images</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={compressImages}
						onChange={(e) => toggleCompress(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Compress images
				</label>
			</div>

			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={showThinking}
						onChange={(e) => toggleThinking(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Show thinking blocks
				</label>
			</div>

			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={groupedToolDisplay}
						onChange={(e) => toggleGrouped(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Grouped tool trail
				</label>
				<p className="settings-hint" style={{ marginTop: 4 }}>
					One Trail card per turn; in-between agent text collapses into
					justification previews.
				</p>
				{/* Default resting view for finished trails */}
				<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
					{(["justify", "full"] as const).map((v) => (
						<button
							key={v}
							type="button"
							onClick={() => selectTrailView(v)}
							style={{
								padding: "4px 12px",
								borderRadius: "var(--radius-sm)",
								border: `1px solid ${trailView === v ? "var(--accent)" : "var(--border)"}`,
								background:
									trailView === v
										? "var(--accent-subtle)"
										: "var(--bg-glass)",
								color:
									trailView === v
										? "var(--accent-text)"
										: "var(--text-secondary)",
								fontSize: "11px",
								fontWeight: trailView === v ? 600 : 400,
								cursor: "pointer",
								fontFamily: "inherit",
								transition: "all 0.15s",
							}}
						>
							{v === "justify" ? "Auto" : "Expand All"}
						</button>
					))}
				</div>
				<p className="settings-hint" style={{ marginTop: 4 }}>
					Default view for tool trails. Applies to both active and finished runs.
				</p>
			</div>
			<div className="settings-field">
				<label className="settings-label">Chat</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={swipeToOpenSidebar}
						onChange={(e) => toggleSwipeSidebar(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Swipe left/right opens sidebar
				</label>
				<p className="settings-hint" style={{ marginTop: 4 }}>
					Touch screens: horizontal swipes open/collapse the sidebar. Turn off
					if scrolling triggers it.
				</p>
			</div>

			{/* ── Empty state — split-flap departure board ── */}
			<div className="settings-field">
				<label className="settings-label">Empty state</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						cursor: "pointer",
						userSelect: "none",
						fontSize: 13,
						color: "var(--text-secondary)",
					}}
				>
					<input
						type="checkbox"
						checked={flapEnabled}
						onChange={(e) => toggleFlapEnabled(e.target.checked)}
						style={{
							width: 16,
							height: 16,
							accentColor: "var(--accent)",
							cursor: "pointer",
						}}
					/>
					Animated split-flap welcome
				</label>
				<p className="settings-hint" style={{ marginTop: 4 }}>
					Airport-style departure board centered in an empty chat. Off → classic
					“send a message” welcome.
				</p>

				{flapEnabled && (
					<>
						<div style={{ marginTop: 10 }}>
							<label className="settings-label" style={{ fontSize: 12 }}>
								Phrases (comma-separated)
							</label>
							<input
								value={flapWordsDraft}
								onChange={(e) => setFlapWordsDraft(e.target.value)}
								onBlur={() => saveFlapWords(flapWordsDraft)}
								onKeyDown={(e) => {
									if (e.key === "Enter") saveFlapWords(flapWordsDraft);
								}}
								className="settings-input"
								placeholder="PI-KOT 0.1.36, PI-SDK 0.83.0"
							/>
							<p className="settings-hint" style={{ marginTop: 4 }}>
								Board flips between phrases. Enter or click away to apply (shown
								in caps on the board).
							</p>
						</div>

						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 10,
								marginTop: 10,
							}}
						>
							<input
								type="range"
								min={14}
								max={64}
								value={flapSize}
								onChange={(e) => {
									const v = Number(e.target.value);
									setFlapSize(v);
									zSetFlapSize(v);
								}}
								onPointerUp={() => saveFlapSize(flapSize)}
								onKeyUp={() => saveFlapSize(flapSize)}
								onBlur={() => saveFlapSize(flapSize)}
								style={{
									flex: 1,
									accentColor: "var(--accent)",
									cursor: "pointer",
								}}
							/>
							<span
								style={{
									fontSize: 12,
									color: "var(--text-secondary)",
									minWidth: 34,
									textAlign: "right",
								}}
							>
								{flapSize}px
							</span>
						</div>

						{/* Live preview */}
						<div
							style={{
								marginTop: 12,
								padding: "18px 12px",
								borderRadius: "var(--radius-md)",
								border: "1px solid var(--border)",
								background: "var(--bg-glass)",
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
								fontSize={Math.min(flapSize, 24)}
							/>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
