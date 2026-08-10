// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDurableTaskManifest,
  analyzeDurableTaskTsconfig,
  analyzeTriggerCompatibilityBoundary,
  collectFiles,
  discoverWorkspaceManifests,
  discoverWorkspaceSources,
} from "./check-trigger-compatibility-boundary.mjs";

describe("Trigger compatibility boundary checker", () => {
  it("accepts ordinary Flarex dependencies and imports", () => {
    expect(analyzeTriggerCompatibilityBoundary(
      [{
        relativePath: "packages/example/package.json",
        manifest: { dependencies: { "flarex-protocol": "workspace:*" } },
      }],
      [{
        relativePath: "packages/example/src/index.ts",
        text: 'export { value } from "flarex-protocol";',
      }],
    ).errors).toEqual([]);
  });

  it("rejects imported Trigger packages and file dependencies", () => {
    expect(analyzeTriggerCompatibilityBoundary(
      [{
        relativePath: "packages/example/package.json",
        manifest: {
          dependencies: { "@internal/run-engine": "workspace:*" },
          devDependencies: {
            core: "npm:@trigger.dev/core@4.5.9",
            engine: "file:../../third_party/./trigger.dev/upstream/internal-packages/run-engine",
            store: "workspace:@internal/run-store@*",
          },
        },
      }],
      [],
    ).errors).toEqual([
      'packages/example/package.json: dependencies must not reference Trigger compatibility dependency "@internal/run-engine".',
      'packages/example/package.json: devDependencies must not reference Trigger compatibility dependency "core".',
      'packages/example/package.json: devDependencies must not reference Trigger compatibility dependency "engine".',
      'packages/example/package.json: devDependencies must not reference Trigger compatibility dependency "store".',
    ]);
  });

  it("rejects static, dynamic, CommonJS, type, and relative island imports", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "apps/example/src/index.ts",
      text: `
        import { engine } from "@internal/run-engine";
        import { testEngine } from "@internal/run-engine/tests";
        export type { Run } from "@trigger.dev/core";
        type Store = import("@internal/run-store").RunStore;
        void import(\`../../third_party/trigger.dev/upstream/apps/supervisor/src/index.ts\`, { with: { type: "json" } });
        void import("../../third_party/source/../trigger.dev/upstream/packages/core/src/index.ts");
        const compute = require("@internal/compute");
      `,
    }]).errors).toEqual([
      'apps/example/src/index.ts:2 must not import Trigger compatibility module "@internal/run-engine".',
      'apps/example/src/index.ts:3 must not import Trigger compatibility module "@internal/run-engine/tests".',
      'apps/example/src/index.ts:4 must not import Trigger compatibility module "@trigger.dev/core".',
      'apps/example/src/index.ts:5 must not import Trigger compatibility module "@internal/run-store".',
      'apps/example/src/index.ts:6 must not import Trigger compatibility module "../../third_party/trigger.dev/upstream/apps/supervisor/src/index.ts".',
      'apps/example/src/index.ts:7 must not import Trigger compatibility module "../../third_party/source/../trigger.dev/upstream/packages/core/src/index.ts".',
      'apps/example/src/index.ts:8 must not import Trigger compatibility module "@internal/compute".',
    ]);
  });

  it("discovers executable workspace code outside src directories", () => {
    const manifests = new Set(
      discoverWorkspaceManifests().map(({ relativePath }) => relativePath),
    );
    const discovered = new Set(
      discoverWorkspaceSources().map(({ relativePath }) => relativePath),
    );

    expect(manifests).toContain("package.json");
    expect(discovered).toContain("packages/flarex-dev/bin/flarex-dev.mjs");
    expect(discovered).toContain("apps/example/scripts/generate.ts");
    expect(discovered).toContain("apps/executor/h05/probeWorker.ts");
    expect(discovered).toContain("scripts/check-effect-boundaries.mjs");
    expect(discovered).toContain("integration/invoke.integration.test.ts");
  });

  it("scans nested source directories with artifact-like names", () => {
    const root = mkdtempSync(path.join(tmpdir(), "flarex-trigger-boundary-"));
    try {
      const nestedBuild = path.join(root, "src", "build");
      const rootDist = path.join(root, "dist");
      mkdirSync(nestedBuild, { recursive: true });
      mkdirSync(rootDist);
      writeFileSync(path.join(nestedBuild, "adapter.ts"), "export {};\n");
      writeFileSync(path.join(rootDist, "ignored.js"), "export {};\n");

      expect(collectFiles(root)).toEqual([
        path.join(nestedBuild, "adapter.ts"),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the durable-task package private, narrow, and dependency-owned", () => {
    expect(analyzeDurableTaskManifest({
      name: "@flarex/durable-task",
      version: "0.0.1",
      private: true,
      type: "module",
      files: ["src", "THIRD_PARTY_NOTICES.md", "trigger-source-map.json", "licenses"],
      exports: {
        "./internal/compute-provider-v1": "./src/computeProvider/v1.ts",
        "./internal/compute-provider-testing-v1": "./src/computeProvider/testing-v1.ts",
        "./internal/run-attempt-v1": "./src/runAttempt/v1.ts",
        "./internal/run-creation-v1": "./src/runCreation/v1.ts",
        "./internal/run-read-v1": "./src/runRead/v1.ts",
        "./internal/scheduling-v1": "./src/scheduling/v1.ts",
        "./internal/scheduling-testing-v1": "./src/scheduling/testing-v1.ts",
      },
      scripts: {
        build: "tsc -p tsconfig.json",
        typecheck: "tsc -p tsconfig.json",
        test: "vitest run",
      },
      dependencies: {
        "@flarex/utils": "workspace:*",
        effect: "catalog:",
        "flarex-protocol": "workspace:*",
      },
      devDependencies: { typescript: "catalog:", vitest: "catalog:" },
    })).toEqual([]);

    expect(analyzeDurableTaskManifest({
      name: "wrong-name",
      version: "1.0.0",
      private: false,
      type: "commonjs",
      files: ["src", "extra"],
      exports: { ".": "./src/index.ts" },
      scripts: { test: "node test.js" },
      dependencies: { effect: "catalog:", ioredis: "catalog:" },
      devDependencies: { prisma: "catalog:" },
      optionalDependencies: { cache: "npm:ioredis@5.0.0" },
    })).toEqual(expect.arrayContaining([
      "packages/durable-task/package.json: name must be @flarex/durable-task.",
      "packages/durable-task/package.json: version must be 0.0.1 during the private vertical.",
      "packages/durable-task/package.json: private must remain true during the private vertical.",
      "packages/durable-task/package.json: type must be module.",
      "packages/durable-task/package.json: exports must contain only the admitted compute-provider, compute-provider-testing, run-attempt, run-creation, run-read, scheduling, and scheduling-testing internal subpaths.",
      "packages/durable-task/package.json: runtime dependencies must contain only workspace @flarex/utils, root-catalog effect, and workspace flarex-protocol.",
      "packages/durable-task/package.json: scripts must exactly match the admitted build, typecheck, and test commands.",
      "packages/durable-task/package.json: devDependencies must contain only root-catalog typescript and vitest.",
      "packages/durable-task/package.json: optionalDependencies must be absent or empty.",
      'packages/durable-task/package.json: dependencies must not contain non-portable dependency "ioredis".',
      'packages/durable-task/package.json: devDependencies must not contain non-portable dependency "prisma".',
      'packages/durable-task/package.json: optionalDependencies must not contain non-portable dependency "cache".',
      "packages/durable-task/package.json: files must exactly match the admitted distribution list.",
    ]));
  });

  it("removes DOM, Cloudflare, and ambient host types from durable-task", () => {
    expect(analyzeDurableTaskTsconfig({
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        lib: ["ES2022"],
        types: [],
        noUncheckedIndexedAccess: true,
      },
      include: ["src", "test"],
    })).toEqual([]);

    expect(analyzeDurableTaskTsconfig({
      extends: "../../tsconfig.base.json",
      compilerOptions: {
        lib: ["ES2022", "DOM"],
        types: ["@cloudflare/workers-types"],
      },
      include: ["src"],
      references: [],
    })).toEqual(expect.arrayContaining([
      "packages/durable-task/tsconfig.json must contain only extends, compilerOptions, and include.",
      "packages/durable-task/tsconfig.json include must exactly match src and test.",
      "packages/durable-task/tsconfig.json compilerOptions must contain only lib, types, and noUncheckedIndexedAccess.",
      "packages/durable-task/tsconfig.json compilerOptions.lib must exactly match ES2022 without DOM.",
      "packages/durable-task/tsconfig.json compilerOptions.types must be empty.",
      "packages/durable-task/tsconfig.json compilerOptions.noUncheckedIndexedAccess must be true.",
    ]));
  });

  it("rejects Node, Prisma, Redis, and compatibility-harness imports at production boundaries", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/runAttempt/Policy.ts",
      text: `
        import fs from "node:fs";
        import Redis from "ioredis";
        import { PrismaClient } from "@prisma/client";
        export { compare } from "../../../integration/durable-task-compatibility/compare.mjs";
      `,
    }]).errors).toEqual([
      'packages/durable-task/src/runAttempt/Policy.ts:2 must not import non-portable durable-task module "node:fs".',
      'packages/durable-task/src/runAttempt/Policy.ts:3 must not import non-portable durable-task module "ioredis".',
      'packages/durable-task/src/runAttempt/Policy.ts:4 must not import non-portable durable-task module "@prisma/client".',
      'packages/durable-task/src/runAttempt/Policy.ts:5 production source must not import durable-task compatibility harness "../../../integration/durable-task-compatibility/compare.mjs".',
    ]);
  });

  it("allows only the admitted protocol subpaths in durable-task production", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [
      {
        relativePath: "packages/durable-task/src/runAttempt/PersistenceCodec.ts",
        text: 'import type { JsonObject } from "flarex-protocol/json";',
      },
      {
        relativePath: "packages/durable-task/src/runCreation/Schema.ts",
        text: 'import { copyBytes } from "@flarex/utils/bytes";',
      },
      {
        relativePath: "packages/durable-task/src/computeProvider/Model.ts",
        text: 'import type { ReplacementScopeIdV1 } from "flarex-protocol/storage-authority";',
      },
    ]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/runAttempt/PersistenceCodec.ts",
      text: 'import { decode } from "flarex-protocol";',
    }]).errors).toEqual([
      'packages/durable-task/src/runAttempt/PersistenceCodec.ts:1 must not import non-portable durable-task module "flarex-protocol".',
    ]);
  });

  it("allows Node test mechanics without making them production imports", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/test/compatibility/runner.test.ts",
      text: 'import { spawn } from "node:child_process";',
    }]).errors).toEqual([]);

  });

  it("resolves relative generated-Prisma and compatibility-runner imports", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/Policy.ts",
      text: `
        import { client } from "./generated/prisma";
        import { run } from "../test/compatibility/runner.js";
      `,
    }]).errors).toEqual([
      'packages/durable-task/src/Policy.ts:2 must not import non-portable durable-task module "./generated/prisma".',
      'packages/durable-task/src/Policy.ts:3 production source must not import durable-task compatibility harness "../test/compatibility/runner.js".',
    ]);
  });

  it("treats fixtures under src as production source", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/fixtures/redis.ts",
      text: `
        import Redis from "ioredis";
        import { run } from "../../test/compatibility/runner.js";
      `,
    }]).errors).toEqual([
      'packages/durable-task/src/fixtures/redis.ts:2 must not import non-portable durable-task module "ioredis".',
      'packages/durable-task/src/fixtures/redis.ts:3 production source must not import durable-task compatibility harness "../../test/compatibility/runner.js".',
    ]);
  });

  it("rejects premature durable-task manifest and source activation", () => {
    expect(analyzeTriggerCompatibilityBoundary([{
      relativePath: "apps/backend/package.json",
      manifest: {
        dependencies: { task: "npm:@flarex/durable-task@0.0.1" },
      },
    }], [{
      relativePath: "apps/backend/src/worker.ts",
      text: `
        import { lifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
        import { internal } from "../../../packages/durable-task/src/runAttempt/v1.ts";
      `,
    }]).errors).toEqual([
      "apps/backend/package.json: dependencies must not activate @flarex/durable-task before host admission.",
      "apps/backend/src/worker.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "apps/backend/src/worker.ts:3 production source must not activate @flarex/durable-task before host admission.",
    ]);
  });

  it("admits only the Standard task-definition schema dependency", () => {
    expect(analyzeTriggerCompatibilityBoundary([{
      relativePath: "packages/standard-application-definition/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }], [{
      relativePath:
        "packages/standard-application-definition/src/taskDefinition/Schema.ts",
      text: `
        import { RunAttemptPolicyV1Schema } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([{
      relativePath: "packages/standard-application-definition/package.json",
      manifest: {
        dependencies: { task: "workspace:@flarex/durable-task@*" },
      },
    }], [{
      relativePath:
        "packages/standard-application-definition/src/taskDefinition/Schema.ts",
      text: `
        import { create } from "@flarex/durable-task/internal/run-creation-v1";
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath: "packages/standard-application-definition/src/v1.ts",
      text: `
        import { policy } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([
      "packages/standard-application-definition/package.json: dependencies must not activate @flarex/durable-task before host admission.",
      "packages/standard-application-definition/src/taskDefinition/Schema.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/standard-application-definition/src/taskDefinition/Schema.ts:3 production source must not activate @flarex/durable-task before host admission.",
      "packages/standard-application-definition/src/v1.ts:2 production source must not activate @flarex/durable-task before host admission.",
    ]);
  });

  it("admits only the checkpoint-owned persistence task symbols", () => {
    const schemaPath = "packages/persistence-postgres/src/schema.ts";
    expect(analyzeTriggerCompatibilityBoundary([{
      relativePath: "packages/persistence-postgres/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }], [{
      relativePath: schemaPath,
      text: `
        import {
          MAX_TASK_RUN_ATTEMPT_PERSISTED_JSON_BYTES_V1,
          type TaskAttemptNumberV1,
          type TaskDurationMsV1,
          type TaskRequestedEffectV1,
          type TaskRunAttemptPersistenceProjectionV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import {
          MAX_TASK_INPUT_CANONICAL_BYTES_V1,
          type TaskInputSha256V1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskComputeDeliveryEvidenceV1.ts",
      text: `
        import {
          decodeTaskComputeDispatchRequestV1,
          encodeTaskComputeCancellationReceiptV1,
          type TaskComputeCancellationReceiptV1,
          type TaskComputeDispatchRequestV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
        import {
          decodeTaskInputReferenceV1,
          type TaskInputReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
        import {
          TaskComputeProfileRefV1Schema,
          type TaskComputeProfileRefV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1.ts",
      text: `
        import type {
          InvalidTaskWakeSchedulerConfigurationError,
        } from "@flarex/durable-task/internal/scheduling-v1";
        import {
          makeTaskSystemWakeSchedulerPartitionV1,
        } from "./taskSystemWakeSchedulerPartitionV1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts",
      text: `
        import {
          makeRunAttemptLifecycleV1,
          type RunAttemptLifecycleErrorV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import {
          makeRunAttemptDueCandidateHandlerV1,
          makeTaskWakeSchedulerV1,
          type TaskWakeSchedulerV1,
        } from "@flarex/durable-task/internal/scheduling-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunAttemptStoreV1.ts",
      text: `
        import {
          TaskSystemRunAttemptStore,
          decodePersistedTaskRunAttemptAggregateJsonV1,
          type TaskSystemRunAttemptTransactionV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemLifecycleLedgerCorrelationV1.ts",
      text: `
        import type {
          PersistedTaskRequestedEffectV1,
          TaskAttemptIdV1,
          TaskAttemptNumberV1,
          TaskExecutionFenceV1,
          TaskRunAttemptAggregateV1,
          TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunCreationV1.ts",
      text: `
        import {
          decodeTaskRunCreationRequestV1,
          makeTaskRunCreationInitialAggregateV1,
          type TaskRunCreationRequestV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
        import {
          decodeTaskRunIdV1,
          projectTaskRunAttemptPersistenceV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunRowV1.ts",
      text: `
        import {
          decodePersistedTaskRunAttemptAggregateJsonV1,
          type TaskRunAttemptAggregateV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemRequestedEffectRowV1.ts",
      text: `
        import {
          decodePersistedTaskRequestedEffectJsonV1,
          encodePersistedTaskRequestedEffectJsonV1,
          type PersistedTaskRequestedEffectV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunReadV1.ts",
      text: `
        import {
          decodeTaskDueDiscoveryRequestV1,
          type TaskDueDiscoveryPageV1,
        } from "@flarex/durable-task/internal/run-read-v1";
        import {
          decodeTaskDatabaseTimeMsV1,
          type TaskRunAttemptAggregateV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: schemaPath,
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
        import { decodeTaskRunCreationRequestV1 } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }, {
      relativePath: "packages/persistence-postgres/src/postgres.ts",
      text: `
        import type { TaskRunIdV1 } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunCreationV1.ts",
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunRowV1.ts",
      text: `
        import { decodeTaskRunCreationRequestV1 } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemRunReadV1.ts",
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
        import { MAX_TASK_SYSTEM_READ_PAGE_SIZE_V1 } from "@flarex/durable-task/internal/run-read-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts",
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
        import { makeInMemoryTaskDueWorkSourceV1 } from "@flarex/durable-task/internal/scheduling-testing-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1.ts",
      text: `
        import { makeTaskWakeSchedulerV1 } from "@flarex/durable-task/internal/scheduling-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskComputeDeliveryEvidenceV1.ts",
      text: `
        import { TaskComputeProvider } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskSystemLifecycleLedgerCorrelationV1.ts",
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([
      `${schemaPath}:2 production source must not activate @flarex/durable-task before host admission.`,
      `${schemaPath}:3 production source must not activate @flarex/durable-task before host admission.`,
      "packages/persistence-postgres/src/postgres.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemRunCreationV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemRunRowV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemRunReadV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemRunReadV1.ts:3 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts:3 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskComputeDeliveryEvidenceV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskSystemLifecycleLedgerCorrelationV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
    ]);
  });

  it("rejects local re-exports of admitted durable-task bindings", () => {
    const privatePath =
      "packages/standard-application-definition/src/taskDefinition/Schema.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: privatePath,
      text: `
        import { RunAttemptPolicyV1Schema as Leaked } from "@flarex/durable-task/internal/run-attempt-v1";
        export { Leaked };
        export default Leaked;
      `,
    }]).errors).toEqual([
      `${privatePath}:3 production source must not re-export admitted @flarex/durable-task bindings before host admission.`,
      `${privatePath}:4 production source must not re-export admitted @flarex/durable-task bindings before host admission.`,
    ]);
  });

  it("keeps the Task wake scheduler partition production-inert", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "apps/executor/src/taskScheduler.ts",
      text: `
        import { makeTaskSystemWakeSchedulerPartitionV1 } from
          "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskScheduler.ts",
      text: `
        import { makeTaskSystemWakeSchedulerPartitionV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskSchedulerNodeNext.ts",
      text: `
        import { makeTaskSystemWakeSchedulerPartitionV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.js";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskSchedulerBundled.ts",
      text: `
        import { makeTaskSystemWakeSchedulerPartitionV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerPartitionV1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/test/taskSystemWakeSchedulerPartition.test.ts",
      text: `
        import { makeTaskSystemWakeSchedulerPartitionV1 } from
          "../src/taskSystemWakeSchedulerPartitionV1.ts";
      `,
    }]).errors).toEqual([
      "apps/executor/src/taskScheduler.ts:2 production source must not activate the Task wake scheduler partition before host admission.",
      "packages/flarex-backend/src/taskScheduler.ts:2 production source must not activate the Task wake scheduler partition before host admission.",
      "packages/flarex-backend/src/taskSchedulerNodeNext.ts:2 production source must not activate the Task wake scheduler partition before host admission.",
      "packages/flarex-backend/src/taskSchedulerBundled.ts:2 production source must not activate the Task wake scheduler partition before host admission.",
    ]);
  });

  it("keeps the Task wake scheduler directory production-inert", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "apps/executor/src/taskSchedulerDirectory.ts",
      text: `
        import { createTaskSystemWakeSchedulerDirectoryV1 } from
          "@flarex/persistence-postgres/internal/task-wake-scheduler-directory-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskSchedulerDirectory.ts",
      text: `
        import { createTaskSystemWakeSchedulerDirectoryV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1.ts";
      `,
    }, {
      relativePath:
        "packages/flarex-backend/src/taskSchedulerDirectoryNodeNext.ts",
      text: `
        import { createTaskSystemWakeSchedulerDirectoryV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1.js";
      `,
    }, {
      relativePath:
        "packages/flarex-backend/src/taskSchedulerDirectoryBundled.ts",
      text: `
        import { createTaskSystemWakeSchedulerDirectoryV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerDirectoryV1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/test/taskSystemWakeSchedulerDirectory.test.ts",
      text: `
        import { createTaskSystemWakeSchedulerDirectoryV1 } from
          "../src/taskSystemWakeSchedulerDirectoryV1.ts";
      `,
    }]).errors).toEqual([
      "apps/executor/src/taskSchedulerDirectory.ts:2 production source must not activate the Task wake scheduler directory before host admission.",
      "packages/flarex-backend/src/taskSchedulerDirectory.ts:2 production source must not activate the Task wake scheduler directory before host admission.",
      "packages/flarex-backend/src/taskSchedulerDirectoryNodeNext.ts:2 production source must not activate the Task wake scheduler directory before host admission.",
      "packages/flarex-backend/src/taskSchedulerDirectoryBundled.ts:2 production source must not activate the Task wake scheduler directory before host admission.",
    ]);
  });

  it("admits only the unwired Task Queue adapter over the fresh scheduler resolver", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/executor/src/taskQueueWakeV1.ts",
      text: `
        import { createTaskSystemWakeSchedulerResolverV1 } from
          "@flarex/persistence-postgres/internal/task-wake-scheduler-resolver-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskQueueWakeResolver.ts",
      text: `
        import { createTaskSystemWakeSchedulerResolverV1 } from
          "../../persistence-postgres/src/taskSystemWakeSchedulerResolverV1.ts";
      `,
    }, {
      relativePath: "apps/executor/src/taskQueueWakeResolverNodeNext.ts",
      text: `
        import { createTaskSystemWakeSchedulerResolverV1 } from
          "../../../packages/persistence-postgres/src/taskSystemWakeSchedulerResolverV1.js";
      `,
    }, {
      relativePath: "apps/executor/src/taskQueueWakeResolverBundled.ts",
      text: `
        import { createTaskSystemWakeSchedulerResolverV1 } from
          "../../../packages/persistence-postgres/src/taskSystemWakeSchedulerResolverV1";
      `,
    }, {
      relativePath: "apps/executor/src/worker.ts",
      text: `
        import { makeTaskQueueWakeAdapterV1 } from
          "@flarex/executor/internal/task-queue-wake-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskQueueWake.ts",
      text: `
        import { makeTaskQueueWakeAdapterV1 } from
          "../../executor/src/taskQueueWakeV1.ts";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskQueueWakeNodeNext.ts",
      text: `
        import { makeTaskQueueWakeAdapterV1 } from
          "../../executor/src/taskQueueWakeV1.js";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskQueueWakeBundled.ts",
      text: `
        import { makeTaskQueueWakeAdapterV1 } from
          "../../executor/src/taskQueueWakeV1";
      `,
    }, {
      relativePath: "packages/executor/test/taskQueueWakeV1.test.ts",
      text: `
        import { makeTaskQueueWakeAdapterV1 } from
          "../src/taskQueueWakeV1.ts";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/taskQueueWakeResolver.ts:2 production source must not consume the Task wake scheduler resolver outside the admitted Queue adapter.",
      "apps/executor/src/taskQueueWakeResolverNodeNext.ts:2 production source must not consume the Task wake scheduler resolver outside the admitted Queue adapter.",
      "apps/executor/src/taskQueueWakeResolverBundled.ts:2 production source must not consume the Task wake scheduler resolver outside the admitted Queue adapter.",
      "apps/executor/src/worker.ts:2 production source must not activate the Task Queue wake adapter before Worker admission.",
      "packages/flarex-backend/src/taskQueueWake.ts:2 production source must not activate the Task Queue wake adapter before Worker admission.",
      "packages/flarex-backend/src/taskQueueWakeNodeNext.ts:2 production source must not activate the Task Queue wake adapter before Worker admission.",
      "packages/flarex-backend/src/taskQueueWakeBundled.ts:2 production source must not activate the Task Queue wake adapter before Worker admission.",
    ]);
  });

  it("admits only the unwired repair sweep over its tolerant directory", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskSystemWakeSchedulerRepairDirectoryV1.ts",
      text: `
        import { decodeTaskDueDiscoveryRequestV1 } from
          "@flarex/durable-task/internal/run-read-v1";
      `,
    }, {
      relativePath: "packages/executor/src/taskRepairSweepV1.ts",
      text: `
        import { createTaskSystemWakeSchedulerRepairDirectoryV1 } from
          "@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1";
      `,
    }, {
      relativePath:
        "packages/executor/src/taskRepairSweepContinuationCodecV1.ts",
      text: `
        import { decodeTaskSystemWakeSchedulerRepairDueCursorV1 } from
          "@flarex/persistence-postgres/internal/task-wake-scheduler-repair-directory-v1";
        import type { TaskRepairSweepContinuationV1 } from
          "./taskRepairSweepV1";
      `,
    }, {
      relativePath: "packages/executor/src/taskRepairSchedulerRunV1.ts",
      text: `
        import { createTaskRepairSweepV1 } from
          "./taskRepairSweepV1";
      `,
    }, {
      relativePath: "apps/executor/src/taskRepairDirectory.ts",
      text: `
        import { createTaskSystemWakeSchedulerRepairDirectoryV1 } from
          "../../../packages/persistence-postgres/src/taskSystemWakeSchedulerRepairDirectoryV1.js";
      `,
    }, {
      relativePath: "apps/executor/src/taskRepairScheduler.ts",
      text: `
        import { createTaskRepairSchedulerRunV1 } from
          "@flarex/executor/internal/task-repair-scheduler-run-v1";
      `,
    }, {
      relativePath: "apps/executor/src/worker.ts",
      text: `
        import { createTaskRepairSweepV1 } from
          "@flarex/executor/internal/task-repair-sweep-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/taskRepairSweep.ts",
      text: `
        import { createTaskRepairSweepV1 } from
          "../../executor/src/taskRepairSweepV1.ts";
      `,
    }, {
      relativePath: "packages/executor/test/taskRepairSweepV1.test.ts",
      text: `
        import { createTaskRepairSweepV1 } from
          "../src/taskRepairSweepV1.ts";
      `,
    }]).errors).toEqual([
      "apps/executor/src/taskRepairDirectory.ts:2 production source must not consume the Task repair scheduler directory outside the admitted repair sweep.",
      "apps/executor/src/taskRepairScheduler.ts:2 production source must not activate the connected Task repair runner before scheduled-host admission.",
      "apps/executor/src/worker.ts:2 production source must not activate the Task repair sweep before scheduled-host admission.",
      "packages/flarex-backend/src/taskRepairSweep.ts:2 production source must not activate the Task repair sweep before scheduled-host admission.",
    ]);
  });

  it("rejects file, link, and workspace path aliases to durable-task before host admission", () => {
    for (const reference of [
      "file:../../packages/durable-task",
      "link:../../packages/durable-task",
      "workspace:../../packages/durable-task",
      "file:../../PACKAGES/DURABLE-TASK",
      "file:C:/workspace/packages/durable-task",
      "link:/workspace/PACKAGES/DURABLE-TASK/src",
    ]) {
      expect(analyzeTriggerCompatibilityBoundary([{
        relativePath: "apps/backend/package.json",
        manifest: { dependencies: { task: reference } },
      }], []).errors).toEqual([
        "apps/backend/package.json: dependencies must not activate @flarex/durable-task before host admission.",
      ]);
    }
  });

  it("allows only Effect and contained relative imports in durable-task production source", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/runAttempt/Policy.ts",
      text: `
        import { Effect } from "effect";
        import { pipe } from "effect/Function";
        import { model } from "./Model.js";
        export const epoch = new Date(0);
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/runAttempt/Policy.ts",
      text: `
        import { sql } from "drizzle-orm";
        import { db } from "@flarex/persistence-postgres";
        import { host } from "flarex-backend";
        import { unstable_dev } from "wrangler";
        import { rows } from "../../../persistence-postgres/src/index.ts";
        export const dbNow = Date.now();
        export const hostNow = new Date();
        export const jitter = Math.random();
        export const secret = process.env.SECRET;
      `,
    }]).errors).toEqual([
      'packages/durable-task/src/runAttempt/Policy.ts:2 must not import non-portable durable-task module "drizzle-orm".',
      'packages/durable-task/src/runAttempt/Policy.ts:3 must not import non-portable durable-task module "@flarex/persistence-postgres".',
      'packages/durable-task/src/runAttempt/Policy.ts:4 must not import non-portable durable-task module "flarex-backend".',
      'packages/durable-task/src/runAttempt/Policy.ts:5 must not import non-portable durable-task module "wrangler".',
      'packages/durable-task/src/runAttempt/Policy.ts:6 must not import non-portable durable-task module "../../../persistence-postgres/src/index.ts".',
      'packages/durable-task/src/runAttempt/Policy.ts:7 must not use prohibited durable-task global "Date.now".',
      'packages/durable-task/src/runAttempt/Policy.ts:8 must not use prohibited durable-task global "new Date()".',
      'packages/durable-task/src/runAttempt/Policy.ts:9 must not use prohibited durable-task global "Math.random".',
      'packages/durable-task/src/runAttempt/Policy.ts:10 must not use prohibited durable-task global "process".',
    ]);
  });

  it("rejects captured, computed, explicit-global, and destructured authority globals", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/runAttempt/Policy.ts",
      text: `
        const clock = Date.now;
        const jitter = globalThis["Math"]["random"];
        const hostDate = Date();
        const constructed = new globalThis.Date();
        const { now: capturedClock } = globalThis.Date;
        const { "random": capturedJitter } = Math;
        const secret = globalThis["process"].env.SECRET;
      `,
    }]).errors).toEqual([
      'packages/durable-task/src/runAttempt/Policy.ts:2 must not use prohibited durable-task global "Date.now".',
      'packages/durable-task/src/runAttempt/Policy.ts:3 must not use prohibited durable-task global "Math.random".',
      'packages/durable-task/src/runAttempt/Policy.ts:4 must not use prohibited durable-task global "Date()".',
      'packages/durable-task/src/runAttempt/Policy.ts:5 must not use prohibited durable-task global "new Date()".',
      'packages/durable-task/src/runAttempt/Policy.ts:6 must not use prohibited durable-task global "Date.now".',
      'packages/durable-task/src/runAttempt/Policy.ts:7 must not use prohibited durable-task global "Math.random".',
      'packages/durable-task/src/runAttempt/Policy.ts:8 must not use prohibited durable-task global "process".',
    ]);
  });

  it("rejects network, Cloudflare cache, host-random ID, and performance-clock globals", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/durable-task/src/runAttempt/Policy.ts",
      text: `
        const request = globalThis["fetch"];
        const cache = caches.default;
        const id = globalThis.crypto.randomUUID();
        const mark = performance.now();
      `,
    }]).errors).toEqual([
      'packages/durable-task/src/runAttempt/Policy.ts:2 must not use prohibited durable-task global "fetch".',
      'packages/durable-task/src/runAttempt/Policy.ts:3 must not use prohibited durable-task global "caches".',
      'packages/durable-task/src/runAttempt/Policy.ts:4 must not use prohibited durable-task global "crypto".',
      'packages/durable-task/src/runAttempt/Policy.ts:5 must not use prohibited durable-task global "performance".',
    ]);
  });
});
