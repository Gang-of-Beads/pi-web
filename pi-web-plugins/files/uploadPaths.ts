export function workspaceUploadPath(destinationFolder: string, fileName: string): string {
  const folder = normalizeWorkspaceUploadPath(destinationFolder, "upload destination", { allowEmpty: true });
  const name = normalizeWorkspaceUploadPath(fileName, "upload file name", { allowEmpty: false });
  return folder === "" ? name : `${folder}/${name}`;
}

function normalizeWorkspaceUploadPath(value: string, label: string, options: { allowEmpty: boolean }): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    if (options.allowEmpty) return "";
    throw new Error(`${label} must not be empty`);
  }
  if (isAbsoluteLike(trimmed)) throw new Error(`${label} must be workspace-relative`);
  const parts = trimmed.split(/[\\/]+/u).filter((part) => part !== "" && part !== ".");
  if (parts.length === 0) {
    if (options.allowEmpty) return "";
    throw new Error(`${label} must not be empty`);
  }
  if (parts.some((part) => part === "..")) throw new Error(`${label} must not contain path traversal`);
  return parts.join("/");
}

function isAbsoluteLike(value: string): boolean {
  const withForwardSlashes = value.replace(/\\/g, "/");
  return withForwardSlashes.startsWith("/") || /^[A-Za-z]:\//u.test(withForwardSlashes);
}
