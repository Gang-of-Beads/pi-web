import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The command's description is its discovery surface.
 *
 * `/pi-web` grew `update` and `machines`, and the description kept listing the
 * old set - so the two subcommands that carry the multi-machine work were
 * invisible to anyone reading the command list, which is where people look
 * first. This asserts the description names every subcommand the parser
 * accepts, so adding one and forgetting to announce it fails here.
 */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions", "pi-web.ts"), "utf8");

function declaredSubcommands(): string[] {
  const block = /const subcommands = \[(.*?)\] as const;/s.exec(source)?.[1] ?? "";
  return [...block.matchAll(/"([a-z-]+)"/g)].map((match) => match[1] ?? "");
}

function commandDescription(): string {
  return /registerCommand\("pi-web", \{[^}]*?description: "([^"]+)"/s.exec(source)?.[1] ?? "";
}

describe("/pi-web command", () => {
  it("declares subcommands and a description", () => {
    expect(declaredSubcommands().length).toBeGreaterThan(5);
    expect(commandDescription()).not.toBe("");
  });

  it("announces every subcommand it accepts", () => {
    const description = commandDescription();
    // `help` and `uninstall` are deliberately unadvertised: one is implied by
    // every command surface, the other should not be one keystroke away in a
    // list someone is skimming.
    const unadvertised = new Set(["help", "uninstall"]);
    for (const subcommand of declaredSubcommands()) {
      if (unadvertised.has(subcommand)) continue;
      expect(description, `"${subcommand}" is accepted but not named in the description`).toContain(subcommand);
    }
  });

  it("states the scope flags, since --all is the one with hub semantics", () => {
    expect(commandDescription()).toContain("--all");
    expect(commandDescription()).toContain("--machine=");
  });
});

describe("/pi-web package layout", () => {
  it("keeps tests out of extensions/, which pi loads as extensions", () => {
    // pi discovers extensions by loading every .ts file in extensions/; a
    // test file placed there is loaded as an extension and fails on boot
    // ("Failed to load extension: Cannot read properties of undefined").
    const extensionsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "extensions");
    const files = readdirSync(extensionsDir);
    const offender = files.find((name) => name.endsWith(".test.ts") || name.endsWith(".spec.ts") || name.endsWith(".test.mjs"));
    expect(offender, `move ${offender ?? "it"} into src/extensions/; pi loads extensions/ as code`).toBeUndefined();
  });
});
