import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  diagnosticTouchesChangedLines,
  normalizeRepositoryPath,
  OXLINT_SOURCE_ROOTS,
  parseChangedLines,
  readArguments,
  selectChangedLineDiagnostics,
} from "./check-oxlint-diff.mjs";

describe("parseChangedLines", () => {
  it("records every new-side line in zero-context hunks", () => {
    const lines = parseChangedLines(
      "@@ -2,2 +2,3 @@\n-old\n+first\n+second\n+third\n@@ -12 +13 @@\n-old\n+new\n",
    );
    expect([...lines]).toEqual([2, 3, 4, 13]);
  });

  it("does not invent a line for deletion-only hunks", () => {
    expect([...parseChangedLines("@@ -4,2 +4,0 @@\n-old\n-old\n")]).toEqual([]);
  });
});

describe("diagnosticTouchesChangedLines", () => {
  it("matches a diagnostic whose label starts on a changed line", () => {
    const diagnostic = {
      labels: [{ span: { line: 2, column: 1, offset: 6, length: 5 } }],
    };
    expect(diagnosticTouchesChangedLines(diagnostic, new Set([2]), "first\nsecond\n")).toBe(
      true,
    );
  });

  it("matches a multiline label that crosses a changed line", () => {
    const diagnostic = {
      labels: [{ span: { line: 1, column: 1, offset: 0, length: 12 } }],
    };
    expect(diagnosticTouchesChangedLines(diagnostic, new Set([2]), "first\nsecond\n")).toBe(
      true,
    );
  });

  it("ignores a located diagnostic outside the changed lines", () => {
    const diagnostic = {
      labels: [{ span: { line: 1, column: 1, offset: 0, length: 5 } }],
    };
    expect(diagnosticTouchesChangedLines(diagnostic, new Set([2]), "first\nsecond\n")).toBe(
      false,
    );
  });

  it("conservatively owns a file-level diagnostic", () => {
    expect(diagnosticTouchesChangedLines({ labels: [] }, new Set([2]), "first\nsecond\n")).toBe(
      true,
    );
  });
});

describe("selectChangedLineDiagnostics", () => {
  it("normalizes Windows paths before joining diagnostics to diffs", () => {
    const diagnostic = {
      code: "test(rule)",
      message: "test",
      filename: "packages\\executor\\src\\example.ts",
      labels: [{ span: { line: 2, column: 1, offset: 6, length: 5 } }],
    };
    expect(
      selectChangedLineDiagnostics(
        [diagnostic],
        new Map([["packages/executor/src/example.ts", new Set([2])]]),
        new Map([["packages/executor/src/example.ts", "first\nsecond\n"]]),
      ),
    ).toEqual([diagnostic]);
  });

  it("does not attach diagnostics from another changed file", () => {
    const diagnostic = {
      code: "test(rule)",
      message: "test",
      filename: "packages/executor/src/other.ts",
      labels: [{ span: { line: 2, column: 1, offset: 6, length: 5 } }],
    };
    expect(
      selectChangedLineDiagnostics(
        [diagnostic],
        new Map([["packages/executor/src/example.ts", new Set([2])]]),
        new Map([["packages/executor/src/example.ts", "first\nsecond\n"]]),
      ),
    ).toEqual([]);
  });
});

describe("normalizeRepositoryPath", () => {
  it("uses repository-style separators", () => {
    expect(normalizeRepositoryPath("packages\\executor/src\\example.ts")).toBe(
      "packages/executor/src/example.ts",
    );
  });
});

describe("configured source roots", () => {
  it("keeps the core, audit, and diff commands in agreement", () => {
    const workspacePackage = /** @type {{ scripts: Record<string, string> }} */ (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
    );

    for (const scriptName of ["lint:core", "lint:audit"]) {
      const configuredRoots = workspacePackage.scripts[scriptName]
        .split(/\s+/u)
        .filter((argument) => argument.startsWith("packages/"));
      expect(configuredRoots).toEqual(OXLINT_SOURCE_ROOTS);
    }
  });
});

describe("readArguments", () => {
  it("selects the live worktree by default", () => {
    expect(readArguments([])).toEqual({ help: false, base: undefined, staged: false });
  });

  it("selects the index snapshot for pre-commit checks", () => {
    expect(readArguments(["--staged"])).toEqual({
      help: false,
      base: undefined,
      staged: true,
    });
  });

  it("selects a committed branch comparison", () => {
    expect(readArguments(["--base", "origin/main"])).toEqual({
      help: false,
      base: "origin/main",
      staged: false,
    });
  });

  it("rejects conflicting snapshot modes", () => {
    expect(() => readArguments(["--staged", "--base", "main"])).toThrow(
      "Usage: pnpm lint:diff [--staged | --base <git-ref>]",
    );
  });
});
