export type ShellSlot = "bar" | "panel" | "hidden";

export type ShellLayout = "desktopExpanded" | "desktopCollapsed" | "mobile";

export interface AppFeatureSpec {
  readonly id: string;
  readonly slots: Readonly<Record<ShellLayout, ShellSlot>>;
  readonly rationale: string;
}

/**
 * The one table that decides where each shell feature lives on each layout.
 *
 * The bar is the single resident row (menu toggle, session name, working
 * indicator). The panel is the single collapsible surface (quick access,
 * machines, tool views, actions, settings). A feature that used to exist in
 * several places must claim exactly one slot per layout here; the renderers
 * read this table and the contract test enumerates every feature × layout so
 * a feature can never silently disappear from one platform.
 */
export const APP_FEATURE_SPECS: readonly AppFeatureSpec[] = [
  {
    id: "panelToggle",
    slots: { desktopExpanded: "bar", desktopCollapsed: "bar", mobile: "bar" },
    rationale: "The resident row always carries the panel toggle; on desktop it collapses the side panel, on mobile it opens the drawer.",
  },
  {
    id: "sessionSwitch",
    slots: { desktopExpanded: "bar", desktopCollapsed: "bar", mobile: "bar" },
    rationale: "The session name is the one high-frequency control worth a resident slot; tapping it opens the quick switcher, whose keyboard path (mod+P) triggers the same modal.",
  },
  {
    id: "workingIndicator",
    slots: { desktopExpanded: "bar", desktopCollapsed: "bar", mobile: "bar" },
    rationale: "Is anything working is the other always-read fact; the bottom status bar keeps the numeric readouts.",
  },
  {
    id: "identity",
    slots: { desktopExpanded: "panel", desktopCollapsed: "panel", mobile: "panel" },
    rationale: "Machine/project/workspace identity is read when navigating, not while reading a conversation; the panel context switcher owns it and the truncated breadcrumb chips are gone.",
  },
  {
    id: "sessionRename",
    slots: { desktopExpanded: "panel", desktopCollapsed: "panel", mobile: "panel" },
    rationale: "Rename is low-frequency; it lives in the session row menu instead of spending resident bar width on an inline edit.",
  },
  {
    id: "toolViews",
    slots: { desktopExpanded: "panel", desktopCollapsed: "panel", mobile: "panel" },
    rationale: "Workspace tool views have exactly one entry, the panel; the mobile tool sheet and the 761-1180px triple entrance are retired.",
  },
  {
    id: "actions",
    slots: { desktopExpanded: "panel", desktopCollapsed: "panel", mobile: "panel" },
    rationale: "The actions palette stays reachable from the panel footer; the keyboard path is unchanged.",
  },
  {
    id: "settings",
    slots: { desktopExpanded: "panel", desktopCollapsed: "panel", mobile: "panel" },
    rationale: "Settings must be reachable on every layout from the panel footer; the phone previously had a single buried path.",
  },
  {
    id: "appRefresh",
    slots: { desktopExpanded: "panel", desktopCollapsed: "panel", mobile: "panel" },
    rationale: "The PWA reload control sits in the panel footer next to settings; the pull-to-refresh gesture is unchanged.",
  },
] as const;

const SPEC_BY_ID: ReadonlyMap<string, AppFeatureSpec> = new Map(APP_FEATURE_SPECS.map((spec) => [spec.id, spec] as const));

const LAYOUT_BY_KEY: ReadonlyMap<string, ShellLayout> = new Map([
  ["desktopExpanded", "desktopExpanded"],
  ["desktopCollapsed", "desktopCollapsed"],
  ["mobile", "mobile"],
]);

export function featureSlot(featureId: string, layout: ShellLayout): ShellSlot | undefined {
  return SPEC_BY_ID.get(featureId)?.slots[layout];
}

export function isShellLayout(value: unknown): value is ShellLayout {
  return typeof value === "string" && LAYOUT_BY_KEY.has(value);
}

export function shellFeatureIds(): readonly string[] {
  return APP_FEATURE_SPECS.map((spec) => spec.id);
}
