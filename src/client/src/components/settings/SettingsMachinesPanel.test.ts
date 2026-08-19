import { describe, expect, it, vi } from "vitest";
import type { TemplateResult } from "lit";
import type { Machine } from "../../api";
import { SettingsMachinesPanel } from "./SettingsMachinesPanel";

function machine(id: string, overrides: Partial<Machine> = {}): Machine {
  return {
    id,
    name: id,
    kind: "remote",
    baseUrl: `https://${id}.example.test`,
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

type LitTemplate = TemplateResult & { _$litType$?: unknown; strings: readonly string[]; values: readonly unknown[] };

function templateParts(template: TemplateResult): { strings: readonly string[]; values: readonly unknown[] } {
  const lit = template as LitTemplate;
  return { strings: lit.strings, values: lit.values };
}

function flatten(template: TemplateResult): string {
  const chunks: string[] = [];
  visit(template);
  return chunks.join("");

  function visit(current: TemplateResult): void {
    const { strings, values } = templateParts(current);
    for (let index = 0; index < values.length; index += 1) {
      const staticChunk = strings[index];
      if (staticChunk !== undefined) chunks.push(staticChunk);
      visitValue(values[index]);
    }
    const finalChunk = strings[values.length];
    if (finalChunk !== undefined) chunks.push(finalChunk);
  }

  function visitValue(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visitValue(item);
      return;
    }
    if (value instanceof Object && "values" in value && typeof (value as { values(): Iterable<unknown> }).values === "function" && String((value as { _$litType$?: unknown })._$litType$ ?? "") !== "") {
      visit(value);
      return;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      chunks.push(String(value));
    } else if (value !== null && typeof value === "object" && "strings" in value && "values" in value) {
      visit(value as TemplateResult);
    }
  }
}

describe("settings-machines-panel", () => {
  it("renders machine names, kinds, and the add button", () => {
    const panel = new SettingsMachinesPanel();
    panel.machines = [machine("local", { kind: "local", name: "Local" }), machine("remote-a")];

    const text = flatten(panel.render());
    expect(text).toContain("Machines");
    expect(text).toContain("Local");
    expect(text).toContain("Remote");
    expect(text).toContain("remote-a");
    expect(text).toContain("Add machine");
    expect(text).not.toContain("No machines configured.");
  });

  it("shows an empty state when there are no machines", () => {
    const panel = new SettingsMachinesPanel();
    expect(flatten(panel.render())).toContain("No machines configured.");
  });

  it("offers rename on every card and remove only on remote cards", () => {
    const panel = new SettingsMachinesPanel();
    panel.machines = [machine("local", { kind: "local", name: "Local" }), machine("remote-a")];

    const text = flatten(panel.render());
    // Two cards, each with a Rename button.
    expect(text.split("Rename")).toHaveLength(3);
    // Only one Remove button (the remote card).
    expect(text.split("Remove")).toHaveLength(2);
  });

  it("still exposes health statuses to the template for card dots", () => {
    const panel = new SettingsMachinesPanel();
    panel.machines = [machine("online-box")];
    panel.machineStatuses = {
      "online-box": { status: "online", latencyMs: 12, checkedAt: "2026-08-18T00:00:00.000Z" },
    };

    const text = flatten(panel.render());
    expect(text).toContain("online-box");
    expect(text).toContain("Remote");
  });
});