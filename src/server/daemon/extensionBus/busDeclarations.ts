import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { busChannelOwner, parseBusDeclarations, type BusChannelDeclaration } from "../../../shared/extensionBusChannels.js";
import { isRecord } from "../../../shared/unknownValues.js";

/**
 * The bus channels the extensions loaded into a session declare (docs/design/extension-bus.md).
 *
 * Read from the package each loaded extension came from, not from an installed-package list: the
 * question is what this session's extensions asked to have carried, and a project-local extension,
 * a fork or a copy declares for itself as well as an installed package does. An extension with no
 * file of its own (an inline or built-in one) has no package and declares nothing.
 */
/** A declared channel with the PI WEB plugins its own package declares, which are the ones an `own` channel is for. */
export interface DeclaredBusChannel extends BusChannelDeclaration {
  readonly ownPlugins: readonly string[];
}

export interface BusDeclarations {
  readonly channels: ReadonlyMap<string, DeclaredBusChannel>;
  /** A package whose block could not be read, or that declared a channel another package declared first. */
  readonly problems: readonly string[];
}

const MAX_PARENTS = 6;

/** The nearest `package.json` at or above a path, a few levels up at most: an extension sits near its package's root. */
function packageJsonAbove(path: string): { file: string; content: string } | undefined {
  if (!isAbsolute(path)) return undefined;
  let directory = dirname(path);
  for (let level = 0; level < MAX_PARENTS; level += 1) {
    const file = join(directory, "package.json");
    try {
      return { file, content: readFileSync(file, "utf8") };
    } catch {
      const parent = dirname(directory);
      if (parent === directory) return undefined;
      directory = parent;
    }
  }
  return undefined;
}

function declarationsOf(content: string): DeclaredBusChannel[] {
  const parsed: unknown = JSON.parse(content);
  const piWeb = isRecord(parsed) ? parsed["piWeb"] : undefined;
  const plugins: unknown = isRecord(piWeb) ? piWeb["plugins"] : undefined;
  const ownPlugins = Array.isArray(plugins) ? plugins.flatMap((plugin: unknown) => (isRecord(plugin) && typeof plugin["id"] === "string" ? [plugin["id"]] : [])) : [];
  return parseBusDeclarations(isRecord(piWeb) ? piWeb["bus"] : undefined).map((declaration) => ({ ...declaration, ownPlugins }));
}

/** What a channel claims: its owner, or the channel itself under `piweb`, which every package shares one name at a time. */
function claimOf(channel: string): string {
  const owner = busChannelOwner(channel);
  return owner === "piweb" ? channel : owner;
}

export function busDeclarationsOf(extensionPaths: readonly string[]): BusDeclarations {
  const channels = new Map<string, DeclaredBusChannel>();
  const owners = new Map<string, string>();
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const path of extensionPaths) {
    const found = packageJsonAbove(path);
    if (found === undefined || seen.has(found.file)) continue;
    seen.add(found.file);
    try {
      for (const declaration of declarationsOf(found.content)) {
        const claim = claimOf(declaration.channel);
        const holder = owners.get(claim) ?? found.file;
        if (holder !== found.file) {
          problems.push(`${found.file} declares ${declaration.channel}, but ${holder} already owns "${claim}"; it is not carried.`);
          continue;
        }
        owners.set(claim, holder);
        channels.set(declaration.channel, declaration);
      }
    } catch (error) {
      problems.push(`${found.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { channels, problems };
}
