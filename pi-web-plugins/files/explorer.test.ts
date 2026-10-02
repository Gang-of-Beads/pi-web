import { describe, expect, it, vi } from "vitest";
import type { FileContentResponse, FileTreeResponse } from "@gang-of-beads/pi-web/plugin-api";
import { FilesExplorer, selectedFileVerdict, type FilesExplorerIdentity, type FilesExplorerSnapshot } from "./explorer";

const identity: FilesExplorerIdentity = { machineId: "local", projectId: "p1", workspaceId: "w1" };

function tree(path = "", entries = ["src"]): FileTreeResponse {
  return {
    path,
    entries: entries.map((name) => ({ name, path: path === "" ? name : `${path}/${name}`, type: "file" as const })),
    scannedAt: "2026-09-06T00:00:00.000Z",
    truncated: false,
  };
}

function content(path: string): FileContentResponse {
  return { path, encoding: "utf8", size: 2, modifiedAt: "2026-09-06T00:00:00.000Z", content: "hi", truncated: false, binary: false };
}

interface Harness {
  explorer: FilesExplorer;
  listFiles: (path: string) => Promise<FileTreeResponse>;
  readFile: (path: string) => Promise<FileContentResponse>;
  written: (path: string | undefined) => void;
  changes: () => void;
  urlSelection: { value: string | undefined };
  setListFiles(impl: (path: string) => Promise<FileTreeResponse>): void;
  setReadFile(impl: (path: string) => Promise<FileContentResponse>): void;
}

function harness(initialUrlSelection?: string): Harness {
  const urlSelection = { value: initialUrlSelection };
  let listFilesImpl: (path: string) => Promise<FileTreeResponse> = (path) => Promise.resolve(tree(path));
  let readFileImpl: (path: string) => Promise<FileContentResponse> = (path) => Promise.resolve(content(path));
  const written = vi.fn<(path: string | undefined) => void>();
  const changes = vi.fn<() => void>();
  const explorer = new FilesExplorer({
    listFiles: (path) => listFilesImpl(path),
    readFile: (path) => readFileImpl(path),
    writeSelectionToUrl: (path) => { written(path); urlSelection.value = path; },
    readSelectionFromUrl: () => urlSelection.value,
    describeError: (error) => String(error),
    onChange: changes,
  });
  return { explorer, listFiles: (path) => listFilesImpl(path), readFile: (path) => readFileImpl(path), written, changes, urlSelection,
    setListFiles: (impl: (path: string) => Promise<FileTreeResponse>) => { listFilesImpl = impl; },
    setReadFile: (impl: (path: string) => Promise<FileContentResponse>) => { readFileImpl = impl; } };
}

describe("FilesExplorer", () => {
  it("loads the root tree on adopt and reports changes", async () => {
    const h = harness();
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    expect(h.explorer.state.stale).toBe(false);
    expect(h.explorer.state.treeFailed).toBeUndefined();
    expect(h.changes).toHaveBeenCalled();
  });

  it("restores a deep-linked selection when adopting", async () => {
    const h = harness("src/index.ts");
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.path).toBe("src/index.ts"); });
    expect(h.explorer.state.selectedFilePath).toBe("src/index.ts");
  });

  it("selecting a file writes the URL and loads the content", async () => {
    const h = harness();
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    h.explorer.selectFile("src/index.ts");
    expect(h.written).toHaveBeenCalledWith("src/index.ts");
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.path).toBe("src/index.ts"); });
  });

  it("a slow answer from a replaced selection never lands", async () => {
    const h = harness();
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    let releaseFirst: ((value: FileContentResponse) => void) | undefined;
    h.setReadFile((path) => path === "slow.md"
      ? new Promise<FileContentResponse>((resolve) => { releaseFirst = resolve; })
      : Promise.resolve(content(path)));
    h.explorer.selectFile("slow.md");
    h.explorer.selectFile("fast.md");
    releaseFirst?.(content("slow.md"));
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.path).toBe("fast.md"); });
    expect(h.explorer.state.selectedFileContent?.path).not.toBe("slow.md");
  });

  it("an older refresh answer never settles over a newer one", async () => {
    const h = harness();
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    let releaseOld: ((value: FileTreeResponse) => void) | undefined;
    h.setListFiles(() => new Promise<FileTreeResponse>((resolve) => { releaseOld = resolve; }));
    const older = h.explorer.refresh();
    h.setListFiles(() => Promise.resolve(tree("", ["src", "new.md"])));
    await h.explorer.refresh();
    expect(h.explorer.state.tree).toHaveLength(2);
    releaseOld?.(tree("", ["src"]));
    await older;
    expect(h.explorer.state.tree).toHaveLength(2);
    expect(h.explorer.state.stale).toBe(false);
  });

  it("expanding a directory loads its entries and collapsing drops them", async () => {
    const h = harness();
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    await h.explorer.expandDir("src");
    expect(h.explorer.state.expandedDirs["src"]).toHaveLength(1);
    await h.explorer.expandDir("src");
    expect(h.explorer.state.expandedDirs["src"]).toBeUndefined();
  });

  it("a failed tree read lands in treeFailed and refresh clears it", async () => {
    const h = harness();
    h.setListFiles(() => Promise.reject(new Error("Path not found")));
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.treeFailed).toBe("Error: Path not found"); });
    h.setListFiles((path) => Promise.resolve(tree(path)));
    await h.explorer.refresh();
    expect(h.explorer.state.treeFailed).toBeUndefined();
    expect(h.explorer.state.tree).toHaveLength(1);
  });

  it("markStale raises the flag and refresh clears it", async () => {
    const h = harness();
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    h.explorer.markStale();
    expect(h.explorer.state.stale).toBe(true);
    await h.explorer.refresh();
    expect(h.explorer.state.stale).toBe(false);
  });

  it("adopting a new identity resets the tree and re-restores from the URL", async () => {
    const h = harness("other.md");
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.tree).toHaveLength(1); });
    h.explorer.selectFile("src/index.ts");
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.path).toBe("src/index.ts"); });
    h.urlSelection.value = "other.md";
    h.explorer.adopt({ machineId: "remote", projectId: "p1", workspaceId: "w1" });
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.path).toBe("other.md"); });
    expect(h.explorer.state.tree).toHaveLength(1);
  });
});

/**
 * A read refreshed the tree and left the viewer on the content it first loaded, so a file the
 * agent rewrote stayed old on screen beside a new tree (Files and Git stay fresh, state-diagram D5).
 */
describe("the open file follows the tree", () => {
  const at = (modifiedAt: string) => ({ ...content("notes.md"), modifiedAt });
  const entry = (filePath: string, modifiedAt?: string) => ({ name: filePath.split("/").at(-1) ?? filePath, path: filePath, type: "file" as const, ...(modifiedAt === undefined ? {} : { modifiedAt }) });
  const snapshot = (patch: Partial<FilesExplorerSnapshot>): FilesExplorerSnapshot => ({
    tree: [], treeFailed: undefined, stale: false, expandedDirs: {}, selectedFilePath: undefined, selectedFileContent: undefined, selectedFileLoadError: undefined, ...patch,
  });
  const cases: { name: string; snapshot: FilesExplorerSnapshot; verdict: string }[] = [
    { name: "nothing open", snapshot: snapshot({ tree: [entry("notes.md", "t2")] }), verdict: "unknown" },
    { name: "open but not loaded yet", snapshot: snapshot({ tree: [entry("notes.md", "t2")], selectedFilePath: "notes.md" }), verdict: "unknown" },
    { name: "same modifiedAt", snapshot: snapshot({ tree: [entry("notes.md", "t1")], selectedFilePath: "notes.md", selectedFileContent: at("t1") }), verdict: "unchanged" },
    { name: "a newer modifiedAt", snapshot: snapshot({ tree: [entry("notes.md", "t2")], selectedFilePath: "notes.md", selectedFileContent: at("t1") }), verdict: "changed" },
    { name: "gone from a held folder", snapshot: snapshot({ tree: [entry("other.md", "t1")], selectedFilePath: "notes.md", selectedFileContent: at("t1") }), verdict: "changed" },
    { name: "in an expanded folder, newer", snapshot: snapshot({ expandedDirs: { "docs/a": [entry("docs/a/notes.md", "t2")] }, selectedFilePath: "docs/a/notes.md", selectedFileContent: at("t1") }), verdict: "changed" },
    { name: "in a folder the read does not hold", snapshot: snapshot({ tree: [entry("docs")], selectedFilePath: "docs/notes.md", selectedFileContent: at("t1") }), verdict: "unknown" },
    { name: "an entry without modifiedAt", snapshot: snapshot({ tree: [entry("notes.md")], selectedFilePath: "notes.md", selectedFileContent: at("t1") }), verdict: "unknown" },
  ];

  it.each(cases)("$name -> $verdict", ({ snapshot: given, verdict }) => {
    expect(selectedFileVerdict(given)).toBe(verdict);
  });

  it("re-reads the open file when a read finds it changed, keeping the old content until the new arrives", async () => {
    const h = harness("notes.md");
    let modifiedAt = "2026-10-02T10:00:00.000Z";
    let body = "old";
    h.setListFiles((listed) => Promise.resolve({ ...tree(listed), entries: [{ name: "notes.md", path: "notes.md", type: "file", modifiedAt }] }));
    let release: (() => void) | undefined;
    h.setReadFile((read) => new Promise((resolve) => {
      const answer = { ...content(read), modifiedAt, content: body };
      if (body === "old") resolve(answer);
      else release = () => { resolve(answer); };
    }));
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.content).toBe("old"); });

    modifiedAt = "2026-10-02T10:00:09.000Z";
    body = "new";
    await h.explorer.refresh();
    const whileReading = h.explorer.state.selectedFileContent?.content;
    release?.();
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent?.content).toBe("new"); });

    expect(whileReading).toBe("old");
  });

  it("does not re-read an open file the read found unchanged", async () => {
    const h = harness("notes.md");
    h.setListFiles((listed) => Promise.resolve({ ...tree(listed), entries: [{ name: "notes.md", path: "notes.md", type: "file", modifiedAt: "2026-09-06T00:00:00.000Z" }] }));
    const reads = vi.fn<(read: string) => Promise<FileContentResponse>>((read) => Promise.resolve(content(read)));
    h.setReadFile(reads);
    h.explorer.adopt(identity);
    await vi.waitFor(() => { expect(h.explorer.state.selectedFileContent).toBeDefined(); });
    const afterOpen = reads.mock.calls.length;

    await h.explorer.refresh();
    await h.explorer.refresh();

    expect(reads.mock.calls.length - afterOpen).toBe(0);
  });
});

