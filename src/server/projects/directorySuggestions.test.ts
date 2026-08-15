import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listDirectorySuggestions } from "./directorySuggestions";

const temporaryRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-dirs-"));
  temporaryRoots.push(root);
  return root;
}

async function makeTree(root: string, relativeDirectories: string[]): Promise<void> {
  for (const relativeDirectory of relativeDirectories) {
    await mkdir(join(root, relativeDirectory), { recursive: true });
  }
}

function paths(suggestions: { path: string }[]): string[] {
  return suggestions.map((suggestion) => suggestion.path);
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("project directory suggestions", () => {
  it("lists only direct child directories when browsing a directory", async () => {
    const root = await tempRoot();
    await makeTree(root, ["alpha/nested", "beta"]);
    await writeFile(join(root, "notes.md"), "x");

    await expect(listDirectorySuggestions(`${root}/`)).resolves.toEqual([
      { path: `${join(root, "alpha")}/`, kind: "other" },
      { path: `${join(root, "beta")}/`, kind: "other" },
    ]);
  });

  it("still prefers same-directory prefix matches, closest match first", async () => {
    const root = await tempRoot();
    await makeTree(root, ["playria", "playground", "other"]);

    expect(paths(await listDirectorySuggestions(join(root, "play")))).toEqual([
      `${join(root, "playria")}/`,
      `${join(root, "playground")}/`,
    ]);
  });

  it("finds nested directories from a fragment typed against the parent", async () => {
    const root = await tempRoot();
    await makeTree(root, ["code/work/playria", "code/personal", "docs"]);

    expect(paths(await listDirectorySuggestions(join(root, "playria")))).toEqual([
      `${join(root, "code/work/playria")}/`,
    ]);
  });

  it("ranks an exact nested name above a shallow partial match", async () => {
    const root = await tempRoot();
    await makeTree(root, ["playria-old", "code/playria"]);

    expect(paths(await listDirectorySuggestions(join(root, "playria")))).toEqual([
      `${join(root, "code/playria")}/`,
      `${join(root, "playria-old")}/`,
    ]);
  });

  it("matches multi-segment queries against the nested relative path", async () => {
    const root = await tempRoot();
    await makeTree(root, ["code/work/playria", "code/work/other"]);

    expect(paths(await listDirectorySuggestions(join(root, "work/playria")))).toEqual([
      `${join(root, "code/work/playria")}/`,
    ]);
  });

  it("does not descend into dependency and VCS directories", async () => {
    const root = await tempRoot();
    await makeTree(root, ["node_modules/playria", ".git/playria", "src/playria"]);

    expect(paths(await listDirectorySuggestions(join(root, "playria")))).toEqual([
      `${join(root, "src/playria")}/`,
    ]);
  });

  it("returns no suggestions instead of failing for a missing parent directory", async () => {
    const root = await tempRoot();

    await expect(listDirectorySuggestions(join(root, "missing", "child"))).resolves.toEqual([]);
  });

  it("does not invent matches for segments that appear nowhere", async () => {
    const root = await tempRoot();
    await makeTree(root, ["code/work/playria"]);

    await expect(listDirectorySuggestions(join(root, "nope", "zzzz"))).resolves.toEqual([]);
  });

  it("ignores files with a matching name", async () => {
    const root = await tempRoot();
    await makeTree(root, ["playria"]);
    await writeFile(join(root, "playria.txt"), "x");

    expect(paths(await listDirectorySuggestions(join(root, "playria")))).toEqual([
      `${join(root, "playria")}/`,
    ]);
  });
});
