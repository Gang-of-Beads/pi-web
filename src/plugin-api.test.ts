import { describe, expectTypeOf, it } from "vitest";
import type {
  ListContext,
  ListItemContext,
  PluginActivationContext,
  PluginActivationResult,
  PluginContributions,
  PluginLifecycleEvent,
  PluginPanelSession,
  QualifiedContributionId,
  Workspace,
  WorkspaceHost,
  WorkspaceProviderCapabilities,
  WorkspaceProviderMetadata,
  WorkspaceRemovalPresentation,
} from "@gang-of-beads/pi-web/plugin-api";

type IfEqual<Left, Right, Then, Else = never> =
  (<Value>(value: Value) => Value extends Left ? 1 : 2) extends
  (<Value>(value: Value) => Value extends Right ? 1 : 2) ? Then : Else;

type ReadonlyKeys<Value> = {
  [Key in keyof Value]-?: IfEqual<
    { [Property in Key]: Value[Property] },
    { -readonly [Property in Key]: Value[Property] },
    never,
    Key
  >;
}[keyof Value];

type WritableKeys<Value> = Exclude<keyof Value, ReadonlyKeys<Value>>;

describe("public browser plugin API", () => {
  it("keeps host-owned activation and workspace snapshots readonly", () => {
    expectTypeOf<ReadonlyKeys<PluginActivationContext>>().toEqualTypeOf<keyof PluginActivationContext>();
    expectTypeOf<ReadonlyKeys<Workspace>>().toEqualTypeOf<keyof Workspace>();
    expectTypeOf<ReadonlyKeys<WorkspaceProviderMetadata>>().toEqualTypeOf<keyof WorkspaceProviderMetadata>();
    expectTypeOf<ReadonlyKeys<WorkspaceProviderCapabilities>>().toEqualTypeOf<keyof WorkspaceProviderCapabilities>();
    expectTypeOf<ReadonlyKeys<WorkspaceRemovalPresentation>>().toEqualTypeOf<keyof WorkspaceRemovalPresentation>();
    expectTypeOf<ReadonlyKeys<ListItemContext>>().toEqualTypeOf<keyof ListItemContext>();
    expectTypeOf<ReadonlyKeys<ListContext>>().toEqualTypeOf<keyof ListContext>();
    expectTypeOf<ReadonlyKeys<PluginPanelSession>>().toEqualTypeOf<keyof PluginPanelSession>();
    expectTypeOf<keyof PluginPanelSession>().toEqualTypeOf<"id" | "cwd" | "path" | "runCommand">();
    expectTypeOf<undefined>().toExtend<PluginPanelSession["runCommand"]>();
    expectTypeOf<Extract<PluginLifecycleEvent, { kind: "page-shown" | "page-hidden" }>>().toEqualTypeOf<
      | { kind: "page-shown"; pageId: QualifiedContributionId; machineId: string }
      | { kind: "page-hidden"; pageId: QualifiedContributionId; machineId: string }
    >();
    expectTypeOf<WorkspaceHost["shown"]>().toEqualTypeOf<(() => boolean) | undefined>();
  });

  it("keeps the removal precondition internal and contribution results writable", () => {
    expectTypeOf<keyof WorkspaceRemovalPresentation>().toEqualTypeOf<"actionLabel" | "confirmation">();
    expectTypeOf<WritableKeys<PluginActivationResult>>().toEqualTypeOf<keyof PluginActivationResult>();
    expectTypeOf<WritableKeys<PluginContributions>>().toEqualTypeOf<keyof PluginContributions>();
  });
});
