import { describe, expect, it, vi } from "vitest";
import type { FileContentResponse, FileTreeResponse } from "@gang-of-beads/pi-web/plugin-api";
import { FilesExplorer, type FilesExplorerIdentity } from "./explorer";

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
