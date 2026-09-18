import { mkdtempSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const repoRoot = process.cwd();
// Every declaration the package smoke compares, so refreshing a baseline
// cannot leave half of it behind - which is how the release smoke failed on a
// file this script never touched.
const declarations = [
  "plugin-api.d.ts",
  "server-plugin-api.d.ts",
  "shared/activeAgentProfile.d.ts",
  "shared/apiTypes.d.ts",
  "shared/capabilities.d.ts",
  "shared/machineStatus.d.ts",
  "shared/piWebStatusParsing.d.ts",
  "shared/pluginApiTypes.d.ts",
  "shared/thinkingLevels.d.ts",
];

const configPath = join(repoRoot, "tsconfig.plugin-api.json");
const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic(diagnostic) { throw new Error(String(diagnostic.messageText)); },
});
if (config === undefined) throw new Error(`Unable to parse ${configPath}`);

const outDir = mkdtempSync(join(tmpdir(), "pi-web-baseline-"));
const program = ts.createProgram({ rootNames: config.fileNames, options: { ...config.options, outDir } });
const emitResult = program.emit();
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics];
if (diagnostics.length > 0) throw new Error(ts.formatDiagnostics(diagnostics, { getCurrentDirectory: () => repoRoot, getCanonicalFileName: (f) => f, getNewLine: () => "\n" }));

for (const declaration of declarations) {
  cpSync(join(outDir, declaration), join(repoRoot, "test-fixtures", "plugin-api-baseline", declaration));
  console.log("refreshed", declaration);
}
