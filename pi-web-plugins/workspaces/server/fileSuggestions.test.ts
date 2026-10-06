import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listFileSuggestions, listPathSuggestions, type FileSuggestionDependencies } from "./fileSuggestions";

const temporaryRoots: string[] = [];

async function tempWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-web-files-"));
  temporaryRoots.push(root);
  return root;
}

async function trySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path, "dir");
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "EPERM") || isNodeErrorWithCode(error, "EACCES")) return false;
    throw error;
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("file suggestions", () => {
  it("uses tracked git files for tracked-scope suggestions", async () => {
    const calls: { file: string; args: string[] }[] = [];
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        calls.push({ file, args });
        if (file === "git" && args.join(" ") === "ls-files -z") return Promise.resolve({ stdout: "src/app.ts\0README.md\0" });
        return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
      },
    };

    await expect(listFileSuggestions("/repo", "", { scope: "tracked" }, deps)).resolves.toEqual([
      { path: "src/", kind: "tracked" },
      { path: "README.md", kind: "tracked" },
      { path: "src/app.ts", kind: "tracked" },
    ]);
    expect(calls).toEqual([{ file: "git", args: ["ls-files", "-z"] }]);
  });

  it("asks ripgrep for hidden and ignored files in all-file scope", async () => {
    const calls: { file: string; args: string[] }[] = [];
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        calls.push({ file, args });
        if (file === "git") return Promise.reject(new Error("not a git repository"));
        return Promise.resolve({ stdout: "node_modules/pkg/index.js\nsrc/app.ts\n" });
      },
    };

    await expect(listFileSuggestions("/repo", "pkg", { scope: "all" }, deps)).resolves.toEqual([
      { path: "node_modules/pkg/", kind: "other" },
      { path: "node_modules/pkg/index.js", kind: "other" },
    ]);
    expect(calls).toEqual([
      { file: "git", args: ["ls-files", "-z"] },
      { file: "git", args: ["ls-files", "--others", "--exclude-standard", "-z"] },
      { file: "rg", args: ["--files", "--hidden", "--no-ignore", "--glob", "!.git", "--glob", "!.git/**"] },
    ]);
  });

  it("waits for both git probes before falling back in all-file scope", async () => {
    let releaseUntracked: (() => void) | undefined;
    let resolved = false;
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        if (file === "git" && args.join(" ") === "ls-files -z") return Promise.reject(new Error("not a git repository"));
        if (file === "git" && args.join(" ") === "ls-files --others --exclude-standard -z") {
          return new Promise<{ stdout: string }>((resolve) => {
            releaseUntracked = () => {
              resolve({ stdout: "" });
            };
          });
        }
        if (file === "rg") return Promise.resolve({ stdout: "sdk.md\n" });
        return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
      },
    };

    const suggestions = listFileSuggestions("/repo", "sdk", { scope: "all" }, deps).then((value) => {
      resolved = true;
      return value;
    });
    await Promise.resolve();

    expect(resolved).toBe(false);
    expect(releaseUntracked).toBeDefined();

    releaseUntracked?.();
    await expect(suggestions).resolves.toEqual([{ path: "sdk.md", kind: "other" }]);
  });

  it("keeps git untracked files in all-file scope when the broad scan misses them", async () => {
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        if (file === "git" && args.join(" ") === "ls-files -z") return Promise.resolve({ stdout: "src/app.ts\0" });
        if (file === "git" && args.join(" ") === "ls-files --others --exclude-standard -z") return Promise.resolve({ stdout: "MD PRojects here.md\0" });
        if (file === "rg") return Promise.resolve({ stdout: "src/app.ts\n" });
        return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
      },
    };

    await expect(listFileSuggestions("/repo", "MD PRojects", { scope: "all" }, deps)).resolves.toEqual([
      { path: "MD PRojects here.md", kind: "untracked" },
    ]);
  });

  it("ranks basename matches before deeper incidental path matches", async () => {
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        if (file === "git" && args.join(" ") === "ls-files -z") return Promise.resolve({ stdout: "klingit-go/cli/cmd/dev/main.go\0MD PRojects here.md\0" });
        if (file === "git" && args.join(" ") === "ls-files --others --exclude-standard -z") return Promise.resolve({ stdout: "" });
        if (file === "rg") return Promise.resolve({ stdout: "" });
        return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
      },
    };

    const suggestions = await listFileSuggestions("/repo", "MD", { scope: "all" }, deps);

    expect(suggestions[0]).toEqual({ path: "MD PRojects here.md", kind: "tracked" });
  });

  it("ranks file suggestions case-insensitively", async () => {
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        if (file === "git" && args.join(" ") === "ls-files -z") return Promise.resolve({ stdout: "klingit-go/cli/cmd/dev/main.go\0MD PRojects here.md\0" });
        return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
      },
    };

    const suggestions = await listFileSuggestions("/repo", "MD", { scope: "tracked" }, deps);

    expect(suggestions[0]).toEqual({ path: "MD PRojects here.md", kind: "tracked" });
  });

  it("preserves git filenames without trimming whitespace", async () => {
    const deps: FileSuggestionDependencies = {
      execFile: (file, args) => {
        if (file === "git" && args.join(" ") === "ls-files -z") return Promise.resolve({ stdout: " leading.md\0" });
        return Promise.reject(new Error(`unexpected command: ${file} ${args.join(" ")}`));
      },
    };

    await expect(listFileSuggestions("/repo", " leading", { scope: "tracked" }, deps)).resolves.toEqual([
      { path: " leading.md", kind: "tracked" },
    ]);
  });

  it("falls back to a bounded filesystem scan without non-git directory exclusions when git and rg are unavailable", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "README.md"), "hello");
    await writeFile(join(root, "src", "app.ts"), "export {};\n");
    await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = {};\n");

    const deps: FileSuggestionDependencies = {
      execFile: (file) => Promise.reject(Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" })),
    };

    await expect(listFileSuggestions(root, "", { scope: "all" }, deps)).resolves.toEqual([
      { path: "node_modules/", kind: "other" },
      { path: "node_modules/pkg/", kind: "other" },
      { path: "src/", kind: "other" },
      { path: "node_modules/pkg/index.js", kind: "other" },
      { path: "README.md", kind: "other" },
      { path: "src/app.ts", kind: "other" },
    ]);
  });

  it("uses allowed roots for absolute-ish file suggestion queries", async () => {
    const root = await tempWorkspace();
    const workspace = join(root, "workspace");
    const external = join(root, "external-docs");
    await mkdir(workspace);
    await mkdir(external);
    await writeFile(join(external, "sdk.md"), "external sdk\n");

    await expect(listFileSuggestions(workspace, join(external, "s"), { pathAccess: { allowedPaths: [external] } })).resolves.toEqual([
      { path: join(external, "sdk.md"), kind: "other" },
    ]);
  });

  it("skips absolute-ish suggestions that would escape an allowed root through symlinks", async () => {
    const root = await tempWorkspace();
    const workspace = join(root, "workspace");
    const external = join(root, "external-docs");
    const secret = join(root, "secret");
    await mkdir(workspace);
    await mkdir(external);
    await mkdir(secret);
    await writeFile(join(external, "sdk.md"), "external sdk\n");
    await writeFile(join(secret, "token.txt"), "secret\n");
    if (!await trySymlink(secret, join(external, "escape"))) return;

    await expect(listPathSuggestions(workspace, `${external}/`, { allowedPaths: [external] })).resolves.toEqual([
      { path: join(external, "sdk.md"), kind: "other" },
    ]);
  });

  it("keeps tilde-prefixed allowed-root suggestions in their tilde form", async () => {
    const workspace = await tempWorkspace();
    const homeEntry = await mkdtemp(join(homedir(), ".pi-web-files-"));
    temporaryRoots.push(homeEntry);
    const expectedPath = `~/${basename(homeEntry)}/`;

    await expect(listFileSuggestions(workspace, `~/${basename(homeEntry)}`, { pathAccess: { allowedPaths: ["~/"] } })).resolves.toEqual([
      { path: expectedPath, kind: "other" },
    ]);
  });

  it("keeps normal file suggestions workspace-local even when allowed roots are configured", async () => {
    const root = await tempWorkspace();
    const workspace = join(root, "workspace");
    const external = join(root, "external-docs");
    await mkdir(workspace);
    await mkdir(external);
    await writeFile(join(external, "sdk.md"), "external sdk\n");

    const deps: FileSuggestionDependencies = {
      execFile: (file) => Promise.reject(Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" })),
    };

    await expect(listFileSuggestions(workspace, "sdk", { scope: "all", pathAccess: { allowedPaths: [external] } }, deps)).resolves.toEqual([]);
  });

  it("keeps relative path suggestions workspace-local and skips symlink escapes", async () => {
    const root = await tempWorkspace();
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    await mkdir(workspace);
    await mkdir(outside);
    await writeFile(join(workspace, "local.md"), "local\n");
    await writeFile(join(outside, "outside.txt"), "outside\n");

    await expect(listPathSuggestions(workspace, "../out")).resolves.toEqual([]);
    if (!await trySymlink(outside, join(workspace, "link"))) return;
    await expect(listPathSuggestions(workspace, "link/")).resolves.toEqual([]);
    await expect(listPathSuggestions(workspace, "")).resolves.toEqual([{ path: "local.md", kind: "other" }]);
  });

  it("orders path suggestions by prefix, directories first", async () => {
    const root = await tempWorkspace();
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "server.md"), "server\n");

    await expect(listPathSuggestions(root, "s")).resolves.toEqual([
      { path: "scripts/", kind: "other" },
      { path: "src/", kind: "other" },
      { path: "server.md", kind: "other" },
    ]);
  });

  it("suggests configured allowed roots without reading parent directories", async () => {
    const root = await tempWorkspace();
    const workspace = join(root, "workspace");
    const external = join(root, "external-docs");
    await mkdir(workspace);
    await mkdir(external);

    await expect(listPathSuggestions(workspace, external.slice(0, -4), { allowedPaths: [external] })).resolves.toEqual([
      { path: `${external}/`, kind: "other" },
    ]);
  });
});
