import { applyThemeFavicon } from "./themeFavicon";
import type { QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, ThemeToken } from "./plugins/types";
import { CORE_MATERIAL_DARK_THEME_ID, CORE_MATERIAL_DARK_TOKENS } from "./nativeDarkTheme";
import { CORE_MATERIAL_LIGHT_THEME_ID, CORE_MATERIAL_LIGHT_TOKENS } from "./nativeLightTheme";
import { resolvedThemeId } from "./themeReplacement";

export { CORE_MATERIAL_DARK_THEME_ID } from "./nativeDarkTheme";
export { CORE_MATERIAL_LIGHT_THEME_ID } from "./nativeLightTheme";

export interface ThemePreference {
  themeId: QualifiedContributionId;
  auto: boolean;
}

export interface ResolveThemePreferenceOptions {
  themes: readonly QualifiedThemeContribution[];
  themePairs: readonly QualifiedThemePairContribution[];
  preference: ThemePreference;
  prefersLight: boolean;
}

export interface ThemePreferenceResolution {
  selectedTheme: QualifiedThemeContribution | undefined;
  activeTheme: QualifiedThemeContribution | undefined;
  selectedThemePair: QualifiedThemePairContribution | undefined;
}

type NativeThemeChoice = Pick<QualifiedThemeContribution, "id" | "name" | "colorScheme" | "tokens"> & { description: string };

/** The app's own looks, offered in the Actions theme picker as Settings → Appearance offers them. */
export const NATIVE_THEME_CHOICES: readonly [NativeThemeChoice, NativeThemeChoice] = [
  { id: CORE_MATERIAL_DARK_THEME_ID, name: "Material Dark (native)", description: "The app's built-in dark palette.", colorScheme: "dark", tokens: CORE_MATERIAL_DARK_TOKENS },
  { id: CORE_MATERIAL_LIGHT_THEME_ID, name: "Material Light (native)", description: "The app's built-in light palette.", colorScheme: "light", tokens: CORE_MATERIAL_LIGHT_TOKENS },
];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = { themeId: CORE_MATERIAL_DARK_THEME_ID, auto: true };
export const THEME_STORAGE_KEY = "pi-web-app-theme";

const LEGACY_NATIVE_THEME_IDS: Partial<Record<QualifiedContributionId, QualifiedContributionId>> = {
  "core:pro": CORE_MATERIAL_DARK_THEME_ID,
  "core:pro-light": CORE_MATERIAL_LIGHT_THEME_ID,
};

export const THEME_TOKENS: ThemeToken[] = [
  "--pi-bg", "--pi-surface", "--pi-surface-hover", "--pi-terminal-bg", "--pi-terminal-text",
  "--pi-border", "--pi-border-muted", "--pi-text", "--pi-text-secondary", "--pi-text-bright",
  "--pi-muted", "--pi-dim", "--pi-accent", "--pi-accent-border", "--pi-on-accent", "--pi-selection-bg",
  "--pi-success", "--pi-success-border", "--pi-success-bg", "--pi-success-surface", "--pi-success-ring",
  "--pi-warning", "--pi-warning-border", "--pi-warning-surface", "--pi-danger", "--pi-purple",
  "--pi-purple-border", "--pi-purple-surface", "--pi-overlay", "--pi-shadow-soft", "--pi-shadow",
  "--pi-shadow-strong", "--pi-bg-overlay-soft", "--pi-bg-overlay", "--pi-success-bg-overlay",
  "--pi-terminal-selection", "--pi-surface-canvas", "--pi-surface-panel", "--pi-surface-card",
  "--pi-surface-raised", "--pi-surface-active", "--pi-font-ui", "--pi-font-display", "--pi-font-mono",
  "--pi-radius-xs", "--pi-radius-sm", "--pi-radius-md", "--pi-radius-lg", "--pi-radius-xl",
  "--pi-msg-user-bg", "--pi-msg-user-border", "--pi-msg-user-header-bg", "--pi-msg-assistant-bg",
  "--pi-msg-assistant-border", "--pi-msg-assistant-header-bg", "--pi-msg-system-bg", "--pi-msg-system-border",
  "--pi-msg-system-header-bg", "--pi-msg-system-rail",
];

type UnlistedThemeToken = Exclude<ThemeToken, (typeof THEME_TOKENS)[number]>;
type ThemeTokensExhaustive = [UnlistedThemeToken] extends [never] ? true : never;
const _themeTokensExhaustive: ThemeTokensExhaustive = true;
void _themeTokensExhaustive;

/**
 * The published contract derives omitted ladder stops from a theme's own legacy trio, and omitted
 * message colours from its own selection, accent, surface and purple tokens.
 */
const DERIVED_TOKENS: Partial<Record<ThemeToken, string>> = {
  "--pi-surface-canvas": "var(--pi-bg)",
  "--pi-surface-panel": "var(--pi-surface)",
  "--pi-surface-card": "color-mix(in srgb, var(--pi-surface) 92%, var(--pi-text))",
  "--pi-surface-raised": "color-mix(in srgb, var(--pi-surface) 84%, var(--pi-text))",
  "--pi-surface-active": "color-mix(in srgb, var(--pi-surface-hover) 82%, var(--pi-text))",
  "--pi-msg-user-bg": "var(--pi-selection-bg)",
  "--pi-msg-user-border": "var(--pi-accent-border)",
  "--pi-msg-user-header-bg": "color-mix(in srgb, var(--pi-accent-border) 39%, var(--pi-surface-hover))",
  "--pi-msg-assistant-bg": "var(--pi-surface)",
  "--pi-msg-assistant-border": "var(--pi-border)",
  "--pi-msg-assistant-header-bg": "var(--pi-surface)",
  "--pi-msg-system-bg": "color-mix(in srgb, var(--pi-purple-surface) 60%, var(--pi-bg))",
  "--pi-msg-system-border": "color-mix(in srgb, var(--pi-purple-border) 45%, var(--pi-border))",
  "--pi-msg-system-header-bg": "color-mix(in srgb, var(--pi-purple-surface) 60%, var(--pi-bg))",
  "--pi-msg-system-rail": "var(--pi-purple-border)",
};

const qualifiedContributionIdPattern = /^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$/u;

export function resolvedThemePreferenceId(themeId: QualifiedContributionId, themes: readonly QualifiedThemeContribution[]): QualifiedContributionId {
  const nativeId = LEGACY_NATIVE_THEME_IDS[themeId] ?? themeId;
  return resolvedThemeId(nativeId, [...NATIVE_THEME_CHOICES, ...themes]);
}

export function selectableThemeContributions(themes: readonly QualifiedThemeContribution[]): QualifiedThemeContribution[] {
  return themes.filter((theme) => resolvedThemePreferenceId(theme.id, themes) === theme.id);
}

/** Only the core's own historical identifiers are migrated while reading storage. */
export function readStoredThemePreference(): ThemePreference | undefined {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    const preference = value === null ? undefined : parseThemePreference(value);
    if (preference === undefined) return undefined;
    const themeId = LEGACY_NATIVE_THEME_IDS[preference.themeId];
    if (themeId === undefined) return preference;
    const migrated = { ...preference, themeId };
    writeStoredThemePreference(migrated);
    return migrated;
  } catch {
    return undefined;
  }
}

export function writeStoredThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    return;
  }
}

function applyNativeTheme(theme: NativeThemeChoice): void {
  const root = document.documentElement;
  root.dataset["piWebTheme"] = theme.id;
  root.style.colorScheme = theme.colorScheme;
  for (const token of THEME_TOKENS) {
    const value = theme.tokens[token];
    if (value === undefined) root.style.removeProperty(token);
    else root.style.setProperty(token, value);
  }
  applyThemeFavicon(collectStringTokens(theme.tokens), document);
}

export function applyNativeMaterialDarkTheme(): void {
  applyNativeTheme(NATIVE_THEME_CHOICES[0]);
}

export function applyNativeMaterialLightTheme(): void {
  applyNativeTheme(NATIVE_THEME_CHOICES[1]);
}

export function isNativeThemeId(themeId: QualifiedContributionId): boolean {
  return themeId === CORE_MATERIAL_DARK_THEME_ID || themeId === CORE_MATERIAL_LIGHT_THEME_ID;
}

export function applyPiWebTheme(theme: QualifiedThemeContribution): void {
  const root = document.documentElement;
  root.dataset["piWebTheme"] = theme.id;
  root.style.colorScheme = theme.colorScheme;
  for (const token of THEME_TOKENS) {
    const value = theme.tokens[token];
    const applied = typeof value === "string" && value !== "" ? value : DERIVED_TOKENS[token];
    if (applied === undefined) root.style.removeProperty(token);
    else root.style.setProperty(token, applied);
  }
  applyThemeFavicon(collectStringTokens(theme.tokens), document, theme.icon);
}

function collectStringTokens(tokens: QualifiedThemeContribution["tokens"]): Record<string, string> {
  const collected: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    if (typeof value === "string") collected[name] = value;
  }
  return collected;
}

/** Unknown declarations retain the native fallback without rewriting the saved preference. */
export function resolveThemePreference(options: ResolveThemePreferenceOptions): ThemePreferenceResolution {
  const nativeLook: ThemePreferenceResolution = { selectedTheme: undefined, activeTheme: undefined, selectedThemePair: undefined };
  const themeId = resolvedThemePreferenceId(options.preference.themeId, options.themes);
  if (isNativeThemeId(themeId)) return nativeLook;
  const selectedTheme = options.themes.find((candidate) => candidate.id === themeId);
  if (selectedTheme === undefined) return nativeLook;
  const selectedThemePair = findThemePairForTheme(options.themePairs, selectedTheme.id);
  if (!options.preference.auto || selectedThemePair === undefined) return { selectedTheme, activeTheme: selectedTheme, selectedThemePair };
  const activeThemeId = resolvedThemePreferenceId(options.prefersLight ? selectedThemePair.light : selectedThemePair.dark, options.themes);
  const activeTheme = options.themes.find((candidate) => candidate.id === activeThemeId) ?? selectedTheme;
  return { selectedTheme, activeTheme, selectedThemePair };
}

export function findThemePairForTheme(themePairs: readonly QualifiedThemePairContribution[], themeId: QualifiedContributionId): QualifiedThemePairContribution | undefined {
  return themePairs.find((pair) => pair.light === themeId || pair.dark === themeId);
}

function parseThemePreference(value: string): ThemePreference | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isThemePreference(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isThemePreference(value: unknown): value is ThemePreference {
  if (!isUnknownRecord(value)) return false;
  return isQualifiedContributionId(value["themeId"]) && typeof value["auto"] === "boolean";
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isQualifiedContributionId(value: unknown): value is QualifiedContributionId {
  return typeof value === "string" && qualifiedContributionIdPattern.test(value);
}
