import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isRecord } from "../../../shared/unknownValues.js";

/**
 * Which loaded extension made a `ctx.ui` call (extension-keys-in-go-to.md, section 2).
 *
 * pi hands every extension the same `ctx.ui`, so a call names no author. The call stack does: pi
 * loads extensions through jiti, which keeps each file's path in its frames, helper files and timer
 * callbacks included (measured 2026-10-07). The innermost frame inside a loaded extension is the
 * author; frames in pi's own packages are passed over, since PI WEB ships pi inside the very
 * package its own extension loads from. The caller drops its own frame before asking.
 *
 * An extension's extent is pi's own record of where it came from (`sourceInfo`): an installed
 * package is its install directory; an entry of an extensions folder (`~/.pi/agent/extensions`,
 * `<project>/.pi/extensions`, whose `baseDir` pi records as the folder's parent) is that file, or
 * that folder entry's directory. Nothing is searched
 * upward: a package.json above the folder (a home directory's, measured 2026-10-07) would make
 * one extension own every file under it.
 *
 * The key the author's page is reached by carries the name its package gives itself for PI WEB,
 * `piWeb.title` in its package.json (owner, 2026-10-07: "显示的名字可以由插件自己定义"), else the
 * package's name, else the extension file's.
 */
export interface ExtensionOrigin {
  /** Stable for the extension's package, opaque to the browser. */
  readonly id: string;
  readonly title: string;
  /** The declared surface the extension backs: a plugin fronts it, so it brings no key of its own. */
  readonly surface?: string;
}

/** A loaded extension as the runtime lists it. */
export interface LoadedExtensionFile {
  readonly path: string;
  readonly resolvedPath?: string;
  /** pi's record of where it came from: `origin` "package" or "top-level", `scope` "user", "project" or "temporary". */
  readonly sourceInfo?: { readonly origin?: string; readonly scope?: string; readonly baseDir?: string };
  readonly tools: readonly string[];
}

export interface DeclaredSurface {
  readonly surface: string;
  readonly tools: readonly string[];
}

/** The file reads attribution needs; injected so the decision runs without a disk. */
export interface OriginFiles {
  realpath(path: string): string;
  /** The parsed JSON at `path`, or undefined when there is none or it does not parse. */
  readJson(path: string): unknown;
}

/** The extensions folders pi reads: each entry in one is an extension of its own. */
const FOLDER_SCOPES: ReadonlySet<string> = new Set(["user", "project"]);
const EXTENSIONS_FOLDER = "extensions";
const PI_OWN_PACKAGES = `${sep}node_modules${sep}@earendil-works${sep}`;

interface ExtensionPackage {
  readonly root: string;
  readonly id: string;
  readonly title: string;
}

export class ExtensionOrigins {
  private readonly packages = new Map<string, ExtensionPackage>();
  private readonly realpaths = new Map<string, string>();

  constructor(private readonly files: OriginFiles = nodeOriginFiles) {}

  originOf(stack: string | undefined, extensions: readonly LoadedExtensionFile[], surfaces: readonly DeclaredSurface[]): ExtensionOrigin | undefined {
    if (stack === undefined) return undefined;
    const candidates = extensions.map((extension) => ({ extension, owner: this.packageOf(extension) }));
    for (const file of stackFiles(stack)) {
      const real = this.real(file);
      if (real.includes(PI_OWN_PACKAGES)) continue;
      const owners = candidates.filter(({ owner }) => real === owner.root || real.startsWith(`${owner.root}${sep}`));
      const owner = owners.sort((left, right) => right.owner.root.length - left.owner.root.length)[0]?.owner;
      if (owner === undefined) continue;
      const tools = candidates.filter((candidate) => candidate.owner.root === owner.root).flatMap((candidate) => candidate.extension.tools);
      const surface = surfaces.find((declared) => declared.tools.some((tool) => tools.includes(tool)))?.surface;
      return { id: owner.id, title: owner.title, ...(surface === undefined ? {} : { surface }) };
    }
    return undefined;
  }

  private packageOf(extension: LoadedExtensionFile): ExtensionPackage {
    const known = this.packages.get(extension.path);
    if (known !== undefined) return known;
    const found = this.extentOf(extension);
    this.packages.set(extension.path, found);
    return found;
  }

  private extentOf(extension: LoadedExtensionFile): ExtensionPackage {
    const file = this.real(extension.resolvedPath ?? extension.path);
    const base = extension.sourceInfo?.baseDir;
    if (base === undefined) return { root: file, id: shortId(file), title: fileTitle(file) };
    const inFolder = extension.sourceInfo?.origin !== "package" && FOLDER_SCOPES.has(extension.sourceInfo?.scope ?? "");
    if (!inFolder) return this.directoryExtent(this.real(base), file);
    const steps = relative(base, extension.path).split(sep);
    const inExtensions = steps[0] === EXTENSIONS_FOLDER;
    const entry = inExtensions ? steps.slice(1) : steps;
    const name = entry[0];
    if (name === undefined || name === ".." || entry.length < 2) return { root: file, id: shortId(file), title: fileTitle(file) };
    return this.directoryExtent(this.real(join(base, ...(inExtensions ? [EXTENSIONS_FOLDER] : []), name)), file);
  }

  private directoryExtent(directory: string, file: string): ExtensionPackage {
    const manifest = this.files.readJson(join(directory, "package.json"));
    const title = isRecord(manifest) ? manifestTitle(manifest) : undefined;
    return { root: directory, id: shortId(directory), title: title ?? (basename(directory) || fileTitle(file)) };
  }

  private real(path: string): string {
    const known = this.realpaths.get(path);
    if (known !== undefined) return known;
    const resolved = realOrSelf(this.files, path);
    this.realpaths.set(path, resolved);
    return resolved;
  }
}

/** A path a stack names may be gone or unreadable; it then stands for itself. */
function realOrSelf(files: OriginFiles, path: string): string {
  try {
    return files.realpath(path);
  } catch {
    return path;
  }
}

/** The files a V8 stack names, innermost first. */
export function stackFiles(stack: string): string[] {
  return stack.split("\n").flatMap((line) => {
    const file = frameFile(line.trim());
    return file === undefined ? [] : [file];
  });
}

function frameFile(line: string): string | undefined {
  if (!line.startsWith("at ")) return undefined;
  const open = line.lastIndexOf("(");
  const location = line.endsWith(")") && open !== -1 ? line.slice(open + 1, -1) : line.slice(3);
  const file = /^(.*?):\d+:\d+$/.exec(location)?.[1];
  if (file === undefined) return undefined;
  const path = file.startsWith("file://") ? fileURLToPath(file) : file;
  return isAbsolute(path) ? path : undefined;
}

function manifestTitle(manifest: Record<string, unknown>): string | undefined {
  const piWeb = manifest["piWeb"];
  const declared = isRecord(piWeb) ? piWeb["title"] : undefined;
  if (typeof declared === "string" && declared.trim() !== "") return declared.trim();
  const name = manifest["name"];
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

function fileTitle(file: string): string {
  const stem = basename(file, extname(file));
  return stem === "index" ? basename(dirname(file)) : stem;
}

function shortId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 12);
}

const nodeOriginFiles: OriginFiles = {
  realpath: (path) => realpathSync(path),
  readJson: (path) => {
    if (!existsSync(path)) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return parsed;
    } catch {
      return undefined;
    }
  },
};
