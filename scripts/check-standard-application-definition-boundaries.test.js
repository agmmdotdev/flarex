// @ts-check
import { describe, expect, it } from "vitest";
import {
  analyzeStandardApplicationDefinitionBoundary,
  collectProductionSourceFiles,
} from "./check-standard-application-definition-boundaries.mjs";

const sourcePath = "packages/standard-application-definition/src/v1.ts";

describe("Standard Application definition boundary checker", () => {
  it("accepts the exact manifest and production import boundary", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { Result } from "effect";
          import type { CanonicalDeclarativeProgramV1 } from "@flarex/declarative-program/v1";
          export { materializeDeclarativeV2ArtifactsV1 } from "@flarex/declarative-materializer/v1";
          export { localHelper } from "./localHelper";
          void import("effect");
        `,
      }],
    );

    expect(report.errors).toEqual([]);
  });

  it("rejects a root or additional package export", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      {
        ...validManifest(),
        exports: {
          ".": "./src/index.ts",
          "./v1": "./src/v1.ts",
        },
      },
      [],
    );

    expect(report.errors).toEqual([
      "Standard Application definition package must expose exactly ./v1 -> ./src/v1.ts and no package root.",
    ]);
  });

  it("rejects missing, unexpected, optional, and peer runtime dependencies", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      {
        ...validManifest(),
        dependencies: {
          "@flarex/declarative-program": "workspace:*",
          "@flarex/analysis": "workspace:*",
          "effect": "^4.0.0",
        },
        optionalDependencies: {
          "miniflare": "catalog:",
        },
        peerDependencies: {
          "flarex-backend": "workspace:*",
        },
      },
      [],
    );

    expect(report.errors).toEqual([
      "Standard Application definition runtime dependencies must be exactly: @flarex/declarative-materializer, @flarex/declarative-program, effect.",
      "Standard Application definition dependency @flarex/declarative-materializer must use workspace:*.",
      "Standard Application definition dependency effect must use catalog:.",
      "Standard Application definition package must not declare optionalDependencies.",
      "Standard Application definition package must not declare peerDependencies.",
    ]);
  });

  it("rejects forbidden static and type-only production imports", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { analyze } from "@flarex/analysis";
          import type { RuntimePersistence } from "@flarex/persistence-postgres/runtime";
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "@flarex/analysis".`,
      `${sourcePath}:3 imports forbidden module "@flarex/persistence-postgres/runtime".`,
    ]);
  });

  it("rejects relative imports that escape the package source root", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { analyze } from "../../analysis/src/index";
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "../../analysis/src/index".`,
    ]);
  });

  it("rejects Windows and mixed-separator relative import escapes", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { analyze } from "..\\\\..\\\\analysis\\\\src\\\\index";
          import { execute } from "../..\\\\executor/src/index";
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "..\\\\..\\\\analysis\\\\src\\\\index".`,
      `${sourcePath}:3 imports forbidden module "../..\\\\executor/src/index".`,
    ]);
  });

  it("rejects TypeScript, JSDoc, and reference-directive type dependencies", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          /// <reference types="@flarex/analysis" />
          /// <reference path="../../executor/src/index.ts" />
          export type Analysis = import("@flarex/analysis").Analysis;
          /** @type {import("@flarex/persistence-postgres").RuntimePersistence} */
          export const persistence = undefined;
          /** @import { Runtime } from "@flarex/function-runtime" */
          export const runtime = undefined;
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:3 imports forbidden module "../../executor/src/index.ts".`,
      `${sourcePath}:2 imports forbidden module "@flarex/analysis".`,
      `${sourcePath}:4 imports forbidden module "@flarex/analysis".`,
      `${sourcePath}:5 imports forbidden module "@flarex/persistence-postgres".`,
      `${sourcePath}:7 imports forbidden module "@flarex/function-runtime".`,
    ]);
  });

  it("rejects direct CommonJS loads and resolution references", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath.replace(".ts", ".cjs"),
        text: `
          const fs = require("node:fs");
          const packageName = "@flarex/executor";
          const executor = require(packageName);
          const backend = module.require("@flarex/backend");
          const runtimeName = "@flarex/function-runtime";
          const runtime = module.require(runtimeName);
          const persistencePath = require.resolve("@flarex/persistence-postgres");
          const protocolName = "@flarex/protocol";
          const protocolPath = require.resolve(protocolName);
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath.replace(".ts", ".cjs")}:2 imports forbidden module "node:fs".`,
      `${sourcePath.replace(".ts", ".cjs")}:4 uses a non-literal require.`,
      `${sourcePath.replace(".ts", ".cjs")}:5 imports forbidden module "@flarex/backend".`,
      `${sourcePath.replace(".ts", ".cjs")}:7 uses a non-literal require.`,
      `${sourcePath.replace(".ts", ".cjs")}:8 imports forbidden module "@flarex/persistence-postgres".`,
      `${sourcePath.replace(".ts", ".cjs")}:10 uses a non-literal require.resolve.`,
    ]);
  });

  it("rejects forbidden literal and non-literal dynamic imports", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          void import("node:fs");
          const packageName = "@flarex/executor";
          void import(packageName);
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "node:fs".`,
      `${sourcePath}:4 uses a non-literal dynamic import.`,
    ]);
  });
});

describe("Standard Application definition source discovery", () => {
  it("rejects a symbolic-link source root", () => {
    const root = "packages/standard-application-definition/src";
    const report = collectProductionSourceFiles(root, {
      readDirectory() {
        throw new Error("must not read a symbolic-link root");
      },
      readStats() {
        return entryStats({ symbolicLink: true });
      },
    });

    expect(report).toEqual({
      errors: [
        `Standard Application definition source root must not be a symbolic link: ${root}.`,
      ],
      files: [],
    });
  });

  it("rejects symbolic links and unsupported source entries", () => {
    const root = "packages/standard-application-definition/src";
    const report = collectProductionSourceFiles(root, {
      readDirectory() {
        return ["linked.ts", "notes.json", "socket"];
      },
      readStats(file) {
        if (file === root) {
          return entryStats({ directory: true });
        }
        if (file.endsWith("linked.ts")) {
          return entryStats({ symbolicLink: true });
        }
        if (file.endsWith("notes.json")) {
          return entryStats({ file: true });
        }
        return entryStats({});
      },
    });

    expect(report).toEqual({
      errors: [
        `Standard Application definition source tree must not contain symbolic link ${root}/linked.ts.`,
        `Standard Application definition source tree contains unsupported source file ${root}/notes.json.`,
        `Standard Application definition source tree contains unsupported entry ${root}/socket.`,
      ],
      files: [],
    });
  });
});

/** @returns {Readonly<Record<string, unknown>>} */
function validManifest() {
  return {
    name: "@flarex/standard-application-definition",
    exports: {
      "./v1": "./src/v1.ts",
    },
    dependencies: {
      "@flarex/declarative-materializer": "workspace:*",
      "@flarex/declarative-program": "workspace:*",
      "effect": "catalog:",
    },
  };
}

/**
 * @param {{
 *   directory?: boolean;
 *   file?: boolean;
 *   symbolicLink?: boolean;
 * }} flags
 */
function entryStats(flags) {
  return {
    isDirectory: () => flags.directory === true,
    isFile: () => flags.file === true,
    isSymbolicLink: () => flags.symbolicLink === true,
  };
}
