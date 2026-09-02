/**
 * Whether anything is behind a plugin-backed surface.
 *
 * The interface used to infer this from data: the Goals tab rendered
 * unconditionally and the server listed the workspace's `.pi/goals` directory,
 * so a plugin nobody installed looked exactly like an installed one with no
 * goals yet. Both showed an empty panel and neither said why.
 *
 * The runtime knows the answer. `ResourceLoader.getExtensions()` reports the
 * extensions that loaded and the ones that failed, and this turns that into the
 * three states a surface can honestly be in.
 *
 * The question is deliberately "does anything register these tools" rather than
 * "is package X installed": a fork, a rename or a local copy all provide the
 * surface just as well, and this repository runs a fork of the goal plugin.
 */
export type PluginPresence =
  | { state: "absent" }
  | { state: "failed"; errors: string[] }
  | { state: "present" };

/** The shape this needs from the runtime's extension loader. */
export interface LoadedExtensionsView {
  extensions: readonly { path: string; tools: readonly string[] }[];
  errors: readonly { path: string; error: string }[];
}

export function pluginPresence(loaded: LoadedExtensionsView, providingTools: readonly string[]): PluginPresence {
  const provided = loaded.extensions.some((extension) => extension.tools.some((tool) => providingTools.includes(tool)));
  if (provided) return { state: "present" };
  // A load failure is reported before absence: an extension that threw is not
  // the same as one nobody installed, and calling it absent would hide a broken
  // install behind a tidy empty state.
  if (loaded.errors.length > 0) return { state: "failed", errors: loaded.errors.map((entry) => entry.error) };
  return { state: "absent" };
}

/** The part of the runtime's loader this reads. */
export interface ExtensionListSource {
  getExtensions?: () => {
    extensions: readonly { path: string; tools?: ReadonlyMap<string, unknown> }[];
    errors: readonly { path: string; error: string }[];
  };
}

/**
 * Read the runtime's extension list into the shape the decision wants.
 *
 * Returns undefined when the runtime cannot answer, which callers must treat as
 * unknown rather than absent: reporting "not installed" on no evidence is the
 * exact fault this replaces.
 */
export function loadedExtensionsView(source: ExtensionListSource): LoadedExtensionsView | undefined {
  const read = source.getExtensions;
  if (read === undefined) return undefined;
  const listed = read.call(source);
  return {
    extensions: listed.extensions.map((extension) => ({
      path: extension.path,
      tools: extension.tools === undefined ? [] : [...extension.tools.keys()],
    })),
    errors: [...listed.errors],
  };
}
