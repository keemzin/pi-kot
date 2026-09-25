import { enLocale } from "./messages/en";
import { zhCNLocale } from "./messages/zh-CN";
import type { Locale, LocalePlugin } from "./types";

const localePlugins = new Map<string, LocalePlugin>();

export function registerLocale(plugin: LocalePlugin): void {
  if (!plugin.id.trim()) throw new Error("Locale id must not be empty");
  if (localePlugins.has(plugin.id)) throw new Error(`Locale already registered: ${plugin.id}`);
  localePlugins.set(plugin.id, plugin);
}

export function getLocalePlugin(id: string): LocalePlugin | undefined {
  return localePlugins.get(id);
}

export function getSupportedLocales(): string[] {
  return [...localePlugins.keys()];
}

export function resolveBrowserLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  }
  return "en";
}

registerLocale(enLocale);
registerLocale(zhCNLocale);
