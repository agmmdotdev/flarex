// @ts-check
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeThirdPartyNotice,
  analyzeDurableTaskSourceMap,
  hasValidTriggerAttributionHeader,
  inspectDurableTaskSourceMapRepository,
} from "./check-durable-task-source-map.mjs";

const commit = "f10bc23785e569e5d917318cf2033aabdbe96a0b";
const sourceText = "export const retry = true;\n";
const sourceHash = createHash("sha256").update(sourceText).digest("hex");

function validInput() {
  return {
    sourceMetadata: { commit },
    sourceMap: {
      schemaVersion: "flarex.trigger-source-reuse.v1",
      upstreamCommit: commit,
      capability: "run-attempt-lifecycle-v1",
      targetPackage: "@flarex/durable-task",
      entries: [{
        upstreamCommit: commit,
        upstreamPath: "upstream/example.ts",
        upstreamSha256: sourceHash,
        selectedSymbols: ["retry"],
        targetPackage: "@flarex/durable-task",
        targetPath: "src/runAttempt/Policy.ts",
        reuseClass: "S",
        semanticChanges: ["inject deterministic jitter"],
        authorityReason: "randomness belongs to the caller",
        retainedTests: ["upstream/example.test.ts"],
        addedFlarexTests: ["deterministic retry vector"],
        licenseNotice: "apache-2.0",
      }],
    },
    /** @param {string} relativePath */
    readUpstreamFile(relativePath) {
      if (relativePath === "upstream/example.ts") return sourceText;
      if (relativePath === "upstream/example.test.ts") return "test";
      return undefined;
    },
  };
}

describe("durable task source map checker", () => {
  it("accepts a closed pre-admission source map", () => {
    expect(analyzeDurableTaskSourceMap(validInput())).toEqual({
      errors: [],
      entryCount: 1,
    });
  });

  it("rejects source drift, unsafe paths, duplicate symbol claims, and invalid discard targets", () => {
    const input = validInput();
    const first = input.sourceMap.entries[0];
    first.upstreamSha256 = "0".repeat(64);
    first.retainedTests = ["upstream/../outside.test.ts"];
    input.sourceMap.entries.push({
      ...first,
      reuseClass: "D",
      targetPackage: "@flarex/durable-task",
      targetPath: "src/discarded.ts",
    });

    expect(analyzeDurableTaskSourceMap(input).errors).toEqual(expect.arrayContaining([
      "source map entries[0].upstreamSha256 does not match the frozen source file.",
      "source map entries[0].retainedTests[0] must be a normalized upstream path.",
      "source map entries[1] discarded entries must use the discarded target namespace.",
      "source map entries[1] duplicates the symbol claim from entries[0].",
    ]));
  });

  it("validates the pinned repository map in pre-admission mode", () => {
    const report = inspectDurableTaskSourceMapRepository(process.cwd());
    expect(report).toEqual({
      errors: [],
      entryCount: 29,
      mode: "pre-admission",
    });
  });

  it("binds a leading attribution header to one path or the exact multi-source marker", () => {
    const single = `// Adapted from Trigger.dev commit ${commit},\n// upstream/example.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.\n`;
    const multiple = `// Adapted from Trigger.dev commit ${commit},\n// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.\n`;

    expect(hasValidTriggerAttributionHeader(single, commit, ["upstream/example.ts"])).toBe(true);
    expect(hasValidTriggerAttributionHeader(single, commit, ["upstream/other.ts"])).toBe(false);
    expect(hasValidTriggerAttributionHeader(multiple, commit, ["upstream/example.ts", "upstream/other.ts"])).toBe(true);
  });

  it("requires the complete package-local third-party notice contract", () => {
    const notice = `
      Trigger.dev
      https://github.com/triggerdotdev/trigger.dev
      ${commit}
      Apache License 2.0
      MIT
      Copyright (c) 2023 Trigger.dev
      Flarex adapted the admitted source.
      See trigger-source-map.json.
    `;
    expect(analyzeThirdPartyNotice(notice, commit)).toEqual([]);
    expect(analyzeThirdPartyNotice(`Trigger.dev ${commit}`, commit)).toContain(
      "packages/durable-task/THIRD_PARTY_NOTICES.md must include its upstream repository.",
    );
  });

  it("switches to fail-closed admitted-package provenance validation", () => {
    const root = createAdmittedRepositoryFixture();
    const targetPath = path.join(root, "packages/durable-task/src/runAttempt/Policy.ts");
    const noticePath = path.join(root, "packages/durable-task/THIRD_PARTY_NOTICES.md");
    try {
      expect(inspectDurableTaskSourceMapRepository(root)).toEqual({
        errors: [],
        entryCount: 1,
        mode: "admitted-package",
      });

      writeFileSync(targetPath, `// Adapted from Trigger.dev commit ${commit},\n// upstream/wrong.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.\n`);
      expect(inspectDurableTaskSourceMapRepository(root).errors).toContain(
        "admitted target src/runAttempt/Policy.ts lacks its exact mapped Trigger.dev attribution header.",
      );

      writeFileSync(noticePath, `Trigger.dev ${commit}\n`);
      expect(inspectDurableTaskSourceMapRepository(root).errors).toContain(
        "packages/durable-task/THIRD_PARTY_NOTICES.md must include its upstream repository.",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function createAdmittedRepositoryFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "flarex-durable-task-admitted-"));
  const input = validInput();
  const targetText = `// Adapted from Trigger.dev commit ${commit},\n// upstream/example.ts. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.\nexport const retry = true;\n`;
  const activeMap = structuredClone(input.sourceMap);
  Object.assign(activeMap.entries[0], {
    targetSha256: createHash("sha256").update(targetText).digest("hex"),
    transformationRevision: "mechanical-v1",
    changeReceipt: "policy-compatibility-v1",
  });

  write("roadmaps/durable-task-engine/preflight/source-map.run-attempt-v1.json", JSON.stringify(input.sourceMap));
  write("third_party/trigger.dev/SOURCE.json", JSON.stringify(input.sourceMetadata));
  write("third_party/trigger.dev/upstream/example.ts", sourceText);
  write("third_party/trigger.dev/upstream/example.test.ts", "test");
  write("third_party/trigger.dev/upstream/LICENSE", "Apache License 2.0\n");
  write("third_party/trigger.dev/upstream/packages/core/LICENSE", "MIT License\nCopyright (c) 2023 Trigger.dev\n");
  write("packages/durable-task/trigger-source-map.json", JSON.stringify(activeMap));
  write("packages/durable-task/package.json", JSON.stringify({
    files: ["src", "THIRD_PARTY_NOTICES.md", "trigger-source-map.json", "licenses"],
  }));
  write("packages/durable-task/src/runAttempt/Policy.ts", targetText);
  write("packages/durable-task/src/runAttempt/v1.ts", "export {};\n");
  write("packages/durable-task/THIRD_PARTY_NOTICES.md", `
Trigger.dev
https://github.com/triggerdotdev/trigger.dev
${commit}
Apache License 2.0
MIT
Copyright (c) 2023 Trigger.dev
Flarex adapted the admitted source.
See trigger-source-map.json.
`);
  write("packages/durable-task/licenses/trigger-apache-2.0.txt", "Apache License 2.0\n");
  write("packages/durable-task/licenses/trigger-core-mit.txt", "MIT License\nCopyright (c) 2023 Trigger.dev\n");
  return root;

  /** @param {string} relativePath @param {string} contents */
  function write(relativePath, contents) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents);
  }
}
