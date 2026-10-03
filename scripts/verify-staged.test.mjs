import { describe, expect, it } from "vitest";
import {
  createValidationPlan,
  createValidationSteps,
  parseNullDelimitedPaths,
} from "./verify-staged.mjs";

describe("staged validation planning", () => {
  it("parses NUL-delimited Git paths without breaking spaces", () => {
    expect(parseNullDelimitedPaths(Buffer.from("src/one.ts\0src/path with spaces/two.ts\0"))).toEqual([
      "src/one.ts",
      "src/path with spaces/two.ts",
    ]);
  });

  it("scopes ESLint to staged source files", () => {
    const plan = createValidationPlan([
      "src/client/src/components/ChatView.ts",
      "src/client/src/components/ChatView.test.ts",
      "README.md",
    ], { pathExists: () => true });

    expect(plan).toEqual({
      paths: [
        "README.md",
        "src/client/src/components/ChatView.test.ts",
        "src/client/src/components/ChatView.ts",
      ],
      lint: {
        mode: "scoped",
        files: [
          "src/client/src/components/ChatView.test.ts",
          "src/client/src/components/ChatView.ts",
        ],
      },
    });
  });

  it("does not lint deleted files or declaration entrypoints", () => {
    expect(createValidationPlan(["src/shared/deleted.ts"], { pathExists: () => false }).lint).toEqual({ mode: "skip", files: [] });
    expect(createValidationPlan(["plugin-api.d.ts", "server-plugin-api.d.ts"], { pathExists: () => true }).lint).toEqual({ mode: "skip", files: [] });
  });

  it("lints everything when the lint or TypeScript configuration changes", () => {
    expect(createValidationPlan(["eslint.config.js"], { pathExists: () => true }).lint).toEqual({ mode: "full", files: [] });
    expect(createValidationPlan(["vitest.config.ts"], { pathExists: () => true }).lint).toEqual({ mode: "scoped", files: ["vitest.config.ts"] });
    expect(createValidationPlan(["tsconfig.json"], { pathExists: () => true }).lint).toEqual({ mode: "full", files: [] });
  });

  it("always includes cached typechecking and Knip before scoped checks, and runs no tests", () => {
    const plan = createValidationPlan(["./src/path with spaces/example.ts"], { pathExists: () => true });

    expect(createValidationSteps(plan).map((step) => step.args)).toEqual([
      ["run", "typecheck:cached"],
      ["run", "knip"],
      ["exec", "--", "eslint", "--", "src/path with spaces/example.ts"],
    ]);
  });
});
