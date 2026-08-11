// @ts-check
import { describe, expect, it } from "vitest";
import {
  analyzeManagedSchemaBoundary,
  collectManagedSchemaSourceFiles,
} from "../../../scripts/check-managed-schema-boundary.mjs";

const sourcePath = "packages/managed-schema/src/Compatibility.ts";

describe("managed schema package boundary", () => {
  it("accepts the exact private package and inward-only imports", () => {
    expect(analyzeManagedSchemaBoundary(validManifest(), [{
      relativePath: sourcePath,
      text: `
        import type { SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
        import type { ScopeId } from "flarex-protocol/storage-authority";
        import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
        import { encodeCanonicalJson } from "flarex-protocol/json";
        import { copyBytes } from "@flarex/utils/bytes";
        import { Effect } from "effect";
        export type { Model } from "./Model";
      `,
    }]).errors).toEqual([]);
  });

  it("rejects extra exports, dependencies, and reverse package imports", () => {
    const manifest = {
      ...validManifest(),
      exports: {
        ".": "./src/index.ts",
        "./candidate-document": "./src/CandidateDocument.ts",
        "./compatibility": "./src/Compatibility.ts",
      },
      dependencies: {
        "flarex-protocol": "workspace:*",
        "@flarex/persistence-postgres": "workspace:*",
      },
    };
    const report = analyzeManagedSchemaBoundary(manifest, [{
      relativePath: sourcePath,
      text: `
        import { db } from "@flarex/persistence-postgres";
        import { invoke } from "@flarex/standard-application-invocation/v1";
      `,
    }]);
    expect(report.errors).toEqual([
      "Managed schema package exports must be exactly: ./candidate-document, ./compatibility, ./planning.",
      "Managed schema package exports entry ./planning must be ./src/Planning.ts.",
      "Managed schema package runtime dependencies must be exactly: @flarex/utils, effect, flarex-protocol.",
      "Managed schema package runtime dependencies entry @flarex/utils must be workspace:*.",
      "Managed schema package runtime dependencies entry effect must be catalog:.",
      `${sourcePath}:2 imports forbidden module "@flarex/persistence-postgres".`,
      `${sourcePath}:3 imports forbidden module "@flarex/standard-application-invocation/v1".`,
    ]);
  });

  it("rejects source escapes and non-literal module references", () => {
    const report = analyzeManagedSchemaBoundary(validManifest(), [{
      relativePath: sourcePath,
      text: `
        import { sql } from "../../persistence-postgres/src/schema";
        const target = "flarex-protocol/schema-manifest";
        void import(target);
        const fs = require("node:fs");
      `,
    }]);
    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "../../persistence-postgres/src/schema".`,
      `${sourcePath}:4 uses a non-literal module reference.`,
      `${sourcePath}:5 imports forbidden module "node:fs".`,
    ]);
  });

  it("rejects protocol value imports and re-exports", () => {
    const report = analyzeManagedSchemaBoundary(validManifest(), [{
      relativePath: sourcePath,
      text: `
        import { decodeSchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
        export type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
        import "flarex-protocol/schema-manifest";
        void import("flarex-protocol/schema-manifest");
        void require("flarex-protocol/validator-json");
        import schema = require("flarex-protocol/schema-manifest");
        import type Validator = require("flarex-protocol/validator-json");
      `,
    }]);
    expect(report.errors).toEqual([
      `${sourcePath}:2 value-imports protocol owner "flarex-protocol/schema-manifest".`,
      `${sourcePath}:3 re-exports protocol owner "flarex-protocol/validator-json".`,
      `${sourcePath}:4 value-imports protocol owner "flarex-protocol/schema-manifest".`,
      `${sourcePath}:5 value-imports protocol owner "flarex-protocol/schema-manifest".`,
      `${sourcePath}:6 value-imports protocol owner "flarex-protocol/validator-json".`,
      `${sourcePath}:7 value-imports protocol owner "flarex-protocol/schema-manifest".`,
    ]);
  });

  it("rejects type-only, JSDoc, and reference dependency escapes", () => {
    const report = analyzeManagedSchemaBoundary(validManifest(), [{
      relativePath: sourcePath,
      text: `
        /// <reference types="@flarex/persistence-postgres" />
        export type Db = import("@flarex/persistence-postgres").Db;
        /** @import { Runtime } from "@flarex/standard-application-invocation/v1" */
        export const value = undefined;
      `,
    }]);
    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "@flarex/persistence-postgres".`,
      `${sourcePath}:3 imports forbidden module "@flarex/persistence-postgres".`,
      `${sourcePath}:4 imports forbidden module "@flarex/standard-application-invocation/v1".`,
    ]);
  });

  it("rejects symbolic links and unsupported production files", () => {
    const root = "packages/managed-schema/src";
    const report = collectManagedSchemaSourceFiles(root, {
      readDirectory() {
        return ["linked.ts", "notes.md"];
      },
      readStats(file) {
        if (file === root) return entryStats({ directory: true });
        if (file.endsWith("linked.ts")) return entryStats({ symbolicLink: true });
        return entryStats({ file: true });
      },
    });
    expect(report).toEqual({
      errors: [
        `Managed schema source tree must not contain symbolic link ${root}/linked.ts.`,
        `Managed schema source tree contains unsupported entry ${root}/notes.md.`,
      ],
      files: [],
    });
  });
});

/** @returns {Readonly<Record<string, unknown>>} */
function validManifest() {
  return {
    name: "@flarex/managed-schema",
    exports: {
      "./candidate-document": "./src/CandidateDocument.ts",
      "./compatibility": "./src/Compatibility.ts",
      "./planning": "./src/Planning.ts",
    },
    dependencies: {
      "@flarex/utils": "workspace:*",
      effect: "catalog:",
      "flarex-protocol": "workspace:*",
    },
    devDependencies: {
      typescript: "catalog:",
      vitest: "catalog:",
    },
  };
}

/**
 * @param {{ directory?: boolean; file?: boolean; symbolicLink?: boolean }} flags
 */
function entryStats(flags) {
  return {
    isDirectory: () => flags.directory === true,
    isFile: () => flags.file === true,
    isSymbolicLink: () => flags.symbolicLink === true,
  };
}
