// @ts-check
import { describe, expect, it } from "vitest";
import {
  analyzeApplicationDefinitionBoundary,
  analyzeApplicationInvocationBoundary,
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
          import { applicationScalarValidatorJson } from "@flarex/application-schema-definition/validator-json";
          import { Result } from "effect";
          import { applicationSchemaDefinition } from "@flarex/application-schema-definition/application-schema";
          import type { CanonicalDeclarativeProgramV1 } from "@flarex/declarative-program/v1";
          import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
          export { materializeDeclarativeV2ArtifactsV1 } from "@flarex/declarative-materializer/v1";
          export { localHelper } from "./localHelper";
          void import("effect");
        `,
      }, {
        relativePath:
          "packages/standard-application-definition/src/relationDefinition/Preparation.ts",
        text: `
          import { Result } from "effect";
          import { declaration } from "flarex-protocol/internal/relation-declaration-v1";
          import { localHelper } from "./Model.js";
        `,
      }, {
        relativePath:
          "packages/standard-application-definition/src/taskDefinition/Schema.ts",
        text: `
          import { makePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
          import { copyBytes } from "@flarex/utils/bytes";
          import { encodeCanonicalJson } from "flarex-protocol/json";
          import { ValidatorJsonV1 } from "flarex-protocol/validator-json";
          import type { RunAttemptPolicyV1 } from "@flarex/durable-task/internal/run-attempt-v1";
          import { TaskComputeProfileRefV1Schema } from "@flarex/durable-task/internal/run-attempt-v1";
        `,
      }, {
        relativePath:
          "packages/standard-application-definition/src/taskAuthoringV1.ts",
        text: `
          import { Result } from "effect";
          import { localHelper } from "./authoringV1.js";
        `,
      }, {
        relativePath:
          "packages/standard-application-definition/src/applicationSource.ts",
        text: `
          import { policy } from "@flarex/analysis/internal/application-analysis-module-path-policy";
          import { snapshotApplicationSchemaDefinition } from "@flarex/application-schema-definition/application-schema";
          import { copyBytes } from "@flarex/utils/bytes";
          import { compareUtf16Strings } from "@flarex/utils/strings";
          import { source } from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
        `,
      }, {
        relativePath:
          "packages/standard-application-definition/src/applicationTaskBinding/Canonical.ts",
        text: `
          import { isCanonicalCalendarDate } from "@flarex/time/calendar-date";
          import { copyBytes } from "@flarex/utils/bytes";
          import { isNonArrayRecord } from "@flarex/utils/records";
          import { receipt } from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
          import { encodeCanonicalJson } from "flarex-protocol/json";
        `,
      }],
    );

    expect(report.errors).toEqual([]);
  });

  it("confines private imports and durable-task symbols to the task subtree", () => {
    const privatePath =
      "packages/standard-application-definition/src/taskDefinition/Schema.ts";
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { copyBytes } from "@flarex/utils/bytes";
          import { makePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
        `,
      }, {
        relativePath: privatePath,
        text: `
          import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
          import * as DurableTask from "@flarex/durable-task/internal/run-attempt-v1";
          void import("@flarex/durable-task/internal/run-attempt-v1");
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "@flarex/utils/bytes".`,
      `${sourcePath}:3 imports forbidden module "@flarex/analysis/internal/private-sha256-v1".`,
      `${privatePath}:2 imports forbidden durable-task symbols from "@flarex/durable-task/internal/run-attempt-v1".`,
      `${privatePath}:3 imports forbidden durable-task symbols from "@flarex/durable-task/internal/run-attempt-v1".`,
      `${privatePath}:4 imports forbidden durable-task symbols from "@flarex/durable-task/internal/run-attempt-v1".`,
    ]);
  });

  it("keeps Task authoring independent from declarative program owners", () => {
    const privatePath =
      "packages/standard-application-definition/src/taskAuthoringV1.ts";
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: privatePath,
        text: `
          import { materialize } from "@flarex/declarative-materializer/v1";
          import type { CanonicalDeclarativeProgramV1 } from "@flarex/declarative-program/v1";
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${privatePath}:2 imports forbidden module "@flarex/declarative-materializer/v1".`,
      `${privatePath}:3 imports forbidden module "@flarex/declarative-program/v1".`,
    ]);
  });

  it("confines the relation declaration dependency to its private owner subtree", () => {
    const relationPath =
      "packages/standard-application-definition/src/relationDefinition/Preparation.ts";
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { declaration } from "flarex-protocol/internal/relation-declaration-v1";
        `,
      }, {
        relativePath: relationPath,
        text: `
          import { analyze } from "@flarex/analysis";
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "flarex-protocol/internal/relation-declaration-v1".`,
      `${relationPath}:2 imports forbidden module "@flarex/analysis".`,
    ]);
  });

  it("rejects local re-exports of admitted durable-task bindings", () => {
    const privatePath =
      "packages/standard-application-definition/src/taskDefinition/Schema.ts";
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: privatePath,
        text: `
          import { RunAttemptPolicyV1Schema as Leaked } from "@flarex/durable-task/internal/run-attempt-v1";
          export { Leaked };
          export default Leaked;
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${privatePath}:3 re-exports an admitted durable-task binding.`,
      `${privatePath}:4 re-exports an admitted durable-task binding.`,
    ]);
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
      "Standard Application definition package must expose exactly ./v1, ./application-source, and its four declared private owner subpaths with no package root.",
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
      "Standard Application definition runtime dependencies must be exactly: @flarex/analysis, @flarex/application-schema-definition, @flarex/declarative-materializer, @flarex/declarative-program, @flarex/durable-task, @flarex/time, @flarex/utils, effect, flarex-protocol.",
      "Standard Application definition dependency @flarex/application-schema-definition must use workspace:*.",
      "Standard Application definition dependency @flarex/declarative-materializer must use workspace:*.",
      "Standard Application definition dependency @flarex/durable-task must use workspace:*.",
      "Standard Application definition dependency @flarex/time must use workspace:*.",
      "Standard Application definition dependency @flarex/utils must use workspace:*.",
      "Standard Application definition dependency effect must use catalog:.",
      "Standard Application definition dependency flarex-protocol must use workspace:*.",
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

  it("rejects runtime validator-json authority in the shipped definition tree", () => {
    const report = analyzeStandardApplicationDefinitionBoundary(
      validManifest(),
      [{
        relativePath: sourcePath,
        text: `
          import { ValidatorJsonV1 } from "flarex-protocol/validator-json";
          void import("flarex-protocol/validator-json");
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${sourcePath}:2 imports forbidden module "flarex-protocol/validator-json".`,
      `${sourcePath}:3 imports forbidden module "flarex-protocol/validator-json".`,
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

describe("Application definition boundary checker", () => {
  const cleanSourcePath =
    "packages/application-definition/src/Preparation.ts";

  it("accepts the clean root and its exact pure preparation imports", () => {
    const report = analyzeApplicationDefinitionBoundary(
      validApplicationDefinitionManifest(),
      [{
        relativePath: cleanSourcePath,
        text: `
          import { Result } from "effect";
          import { compareUtf16Strings } from "@flarex/utils/strings";
          import type { Program } from "@flarex/declarative-program/v1";
          import { materialize } from "@flarex/declarative-materializer/v1";
          import { standardV1 } from "@flarex/standard-application-definition/v1";
          import { local } from "./Authoring.js";
          void import("effect");
        `,
      }],
    );

    expect(report.errors).toEqual([]);
  });

  it("rejects trust-boundary imports, escapes, and indirect loads", () => {
    const report = analyzeApplicationDefinitionBoundary(
      validApplicationDefinitionManifest(),
      [{
        relativePath: cleanSourcePath,
        text: `
          /// <reference types="@flarex/backend" />
          import type { Runtime } from "@flarex/executor";
          import { persistence } from "../../persistence-postgres/src/index";
          /** @type {import("@flarex/system-test").Simulation} */
          export const simulation = undefined;
          const packageName = "@flarex/analysis";
          void import(packageName);
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${cleanSourcePath}:2 imports forbidden module "@flarex/backend".`,
      `${cleanSourcePath}:3 imports forbidden module "@flarex/executor".`,
      `${cleanSourcePath}:4 imports forbidden module "../../persistence-postgres/src/index".`,
      `${cleanSourcePath}:5 imports forbidden module "@flarex/system-test".`,
      `${cleanSourcePath}:8 uses a non-literal dynamic import.`,
    ]);
  });
});

describe("Application invocation boundary checker", () => {
  const invocationSourcePath =
    "packages/application-invocation/src/Query.ts";

  it("accepts only clean facade and exact owner imports", () => {
    const report = analyzeApplicationInvocationBoundary(
      validApplicationInvocationManifest(),
      [{
        relativePath: invocationSourcePath,
        text: `
          import type { FunctionReference } from "@flarex/application-definition";
          import { inspectFunctionReference } from "@flarex/application-definition/internal/function-reference";
          import { invokeApplicationQuery } from "@flarex/standard-application-invocation/internal/application-query-system";
          import { Effect } from "effect";
          import type { ExecutionIdentity } from "flarex-protocol/auth";
          import { validateValidatorValueV1 } from "flarex-protocol/validator-engine";
          import { jsonToFlarexValueV1 } from "flarex-protocol/value";
          import { local } from "./local.js";
        `,
      }],
    );

    expect(report.errors).toEqual([]);
  });

  it("rejects legacy root, persistence, and test imports", () => {
    const report = analyzeApplicationInvocationBoundary(
      validApplicationInvocationManifest(),
      [{
        relativePath: invocationSourcePath,
        text: `
          import { invoke } from "@flarex/standard-application-invocation/v1";
          import { persistence } from "@flarex/persistence-postgres";
          import type { Simulation } from "@flarex/system-test";
          import { escaped } from "../../executor/src/index";
        `,
      }],
    );

    expect(report.errors).toEqual([
      `${invocationSourcePath}:2 imports forbidden module "@flarex/standard-application-invocation/v1".`,
      `${invocationSourcePath}:3 imports forbidden module "@flarex/persistence-postgres".`,
      `${invocationSourcePath}:4 imports forbidden module "@flarex/system-test".`,
      `${invocationSourcePath}:5 imports forbidden module "../../executor/src/index".`,
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
      "./application-source": "./src/applicationSourcePublic.ts",
      "./internal/application-task-binding-v1":
        "./src/applicationTaskBinding/v1.ts",
      "./internal/relation-definition":
        "./src/relationDefinition/index.ts",
      "./internal/task-authoring-v1": "./src/taskAuthoringV1.ts",
      "./internal/task-definition-v1": "./src/taskDefinition/v1.ts",
      "./v1": "./src/v1.ts",
    },
    dependencies: {
      "@flarex/analysis": "workspace:*",
      "@flarex/application-schema-definition": "workspace:*",
      "@flarex/declarative-materializer": "workspace:*",
      "@flarex/declarative-program": "workspace:*",
      "@flarex/durable-task": "workspace:*",
      "@flarex/time": "workspace:*",
      "@flarex/utils": "workspace:*",
      "effect": "catalog:",
      "flarex-protocol": "workspace:*",
    },
  };
}

/** @returns {Readonly<Record<string, unknown>>} */
function validApplicationDefinitionManifest() {
  return {
    name: "@flarex/application-definition",
    exports: {
      ".": "./src/index.ts",
      "./internal/function-reference": "./src/internal/function-reference.ts",
      "./internal/preparation": "./src/internal/preparation.ts",
    },
    dependencies: {
      "@flarex/application-schema-definition": "workspace:*",
      "@flarex/declarative-materializer": "workspace:*",
      "@flarex/declarative-program": "workspace:*",
      "@flarex/standard-application-definition": "workspace:*",
      "@flarex/utils": "workspace:*",
      "effect": "catalog:",
    },
  };
}

/** @returns {Readonly<Record<string, unknown>>} */
function validApplicationInvocationManifest() {
  return {
    name: "@flarex/application-invocation",
    exports: {
      ".": "./src/index.ts",
    },
    dependencies: {
      "@flarex/application-definition": "workspace:*",
      "@flarex/standard-application-invocation": "workspace:*",
      "effect": "catalog:",
      "flarex-protocol": "workspace:*",
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
