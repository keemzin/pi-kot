export type Locale = "en" | "zh-CN";

export type TranslationParams = Record<string, string | number>;

export interface LocalePlugin {
  id: Locale;
  label: string;
  messages: Record<string, string>;
}
