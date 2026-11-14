import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

/** The complete owned runtime edit set for this experiment, never a checkout reset. */
export const runtimeSourcePaths = Object.freeze([
  "packages/utils/src/bytes.ts",
  "packages/flarex-protocol/src/document-value.ts",
  "packages/persistence-postgres/src/core/query.ts",
]);

export function readRuntimeSources(root, revision) {
  assert(typeof revision === "string" && revision.length > 0);
  let resolved;
  try {
    resolved = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
      { cwd: root, encoding: "utf8", windowsHide: true }).trim();
  } catch (cause) { throw new Error("Invalid --runtime-source-revision", { cause }); }
  const files = runtimeSourcePaths.map(path => {
    const contents = execFileSync("git", ["show", `${resolved}:${path}`], { cwd: root, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { path, sha256: createHash("sha256").update(contents).digest("hex"), contents: contents.toString("utf8") };
  });
  return { revision: resolved, files };
}
