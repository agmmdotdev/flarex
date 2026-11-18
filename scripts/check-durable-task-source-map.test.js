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
  inspectTriggerRunEngineSourceMapRepository,
} from "./check-durable-task-source-map.mjs";

const commit = "f10bc23785e569e5d917318cf2033aabdbe96a0b";
const sourceText = "export const retry = true;\n";
const sourceHash = createHash("sha256").update(sourceText).digest("hex");

describe("independent Trigger fork provenance", () => {
  const upstreamPath = "internal-packages/run-engine/src/start.ts";
  const license = "Apache License 2.0\n";

  /** @param {(root: string, map: ReturnType<typeof forkMap>, write: (file: string, text: string) => void) => void} [mutate] */
  function inspectFixture(mutate) {
    const root = mkdtempSync(path.join(tmpdir(), "flarex-trigger-fork-provenance-"));
    const sourceMap = forkMap();
    /** @param {string} file @param {string} text */
    function write(file, text) {
      const absolutePath = path.join(root, file);
      mkdirSync(path.dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, text);
    }
    try {
      write("third_party/trigger.dev/SOURCE.json", JSON.stringify({ commit }));
      write(`third_party/trigger.dev/upstream/${upstreamPath}`, sourceText);
      write("third_party/trigger.dev/upstream/LICENSE", license);
      write("packages/trigger-run-engine/licenses/Apache-2.0.txt", license);
      write("packages/trigger-run-engine/src/start.ts", [
        `// Adapted from Trigger.dev commit ${commit},`,
        `// upstream/${upstreamPath}. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.`,
        sourceText,
      ].join("\n"));
      write("packages/trigger-run-engine/src/port.ts", "export interface BorrowedPort {}\n");
      write("packages/trigger-run-engine/THIRD_PARTY_NOTICES.md",
        `Trigger.dev https://github.com/triggerdotdev/trigger.dev ${commit}\nApache License 2.0\nCopyright (c) 2023 Trigger.dev\nAdapted; see trigger-source-map.json.\n`);
      mutate?.(root, sourceMap, write);
      write("packages/trigger-run-engine/trigger-source-map.json", JSON.stringify(sourceMap));
      return inspectTriggerRunEngineSourceMapRepository(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  function forkMap() {
    return {
      format: "flarex.trigger-source-map", version: 1,
      repository: "https://github.com/triggerdotdev/trigger.dev", commit,
      sourceRoot: "../../third_party/trigger.dev/upstream",
      originalPaths: ["src/port.ts"],
      sources: [{ path: upstreamPath, sha256: sourceHash,
        ranges: [{ start: 1, end: 1, symbol: "retry" }],
        promotedPaths: ["src/start.ts"], adaptations: ["Inject borrowed persistence primitives"],
      }],
      licenses: [{ sourcePath: "LICENSE", path: "licenses/Apache-2.0.txt",
        sha256: createHash("sha256").update(license).digest("hex"),
      }],
    };
  }

  it("checks source bytes, mapped attribution and copied license independently of legacy maps", () => {
    expect(inspectFixture()).toEqual({ errors: [], entryCount: 1 });
  });

  it("rejects a changed pin, out-of-bounds range and upstream byte drift", () => {
    const report = inspectFixture((_root, map, write) => {
      map.commit = "0".repeat(40);
      map.sources[0].ranges[0].end = 900;
      write(`third_party/trigger.dev/upstream/${upstreamPath}`, "changed\n");
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("frozen Trigger source pin"),
      expect.stringContaining("frozen source file"),
      expect.stringContaining("in-bounds source ranges"),
    ]));
  });

  it("rejects unsafe paths without resolving them outside the source/package roots", () => {
    const report = inspectFixture((_root, map) => {
      map.sources[0].path = "internal-packages/../../outside.ts";
      map.licenses[0].path = "licenses/../../outside.txt";
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("normalized upstream source path"),
      expect.stringContaining("unsafe license path"),
    ]));
  });

  it("rejects missing coverage, erased attribution and changed license copies", () => {
    const report = inspectFixture((_root, map, write) => {
      map.originalPaths = [];
      write("packages/trigger-run-engine/src/start.ts", sourceText);
      write("packages/trigger-run-engine/licenses/Apache-2.0.txt", "different license");
    });
    expect(report.errors).toEqual(expect.arrayContaining([
      expect.stringContaining("mapped or explicitly Flarex-authored"),
      expect.stringContaining("pinned Trigger attribution header"),
      expect.stringContaining("license copy/hash"),
    ]));
  });
});

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

  it("validates the pinned repository map in admitted-package mode", () => {
    const report = inspectDurableTaskSourceMapRepository(process.cwd());
    expect(report).toEqual({
      errors: [],
      entryCount: 29,
      mode: "admitted-package",
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
