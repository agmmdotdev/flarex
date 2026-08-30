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
        "./internal/run-projection": "./src/runProjection/index.ts",
        "./internal/run-result-query": "./src/runResult/index.ts",
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
      "packages/durable-task/package.json: exports must contain only the admitted compute-provider, compute-provider-testing, run-attempt, run-creation, run-projection, run-result-query, run-read, scheduling, and scheduling-testing internal subpaths.",
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

  it("admits only the Standard invocation Task run-query bridge", () => {
    const queryPath =
      "packages/standard-application-invocation/src/StandardApplicationTaskRunQuery.ts";
    const manifest = [{
      relativePath: "packages/standard-application-invocation/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }];
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: queryPath,
      text: `
        import {
          makeTaskRunQueryLayer,
          TaskRunQuery,
          type TaskRunProjection,
          type TaskRunQueryApi,
          type TaskRunQueryError,
        } from "@flarex/durable-task/internal/run-projection";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: queryPath,
      text: `
        import {
          makeTaskRunQueryLayer,
          projectTaskRun,
          TaskRunQuery,
          type TaskRunProjection,
          type TaskRunQueryApi,
          type TaskRunQueryError,
        } from "@flarex/durable-task/internal/run-projection";
      `,
    }]).errors).toEqual([
      `${queryPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the private Standard Task run-list bridge", () => {
    const listPath =
      "packages/standard-application-invocation/src/StandardApplicationTaskRunListQuery.ts";
    const manifest = [{
      relativePath: "packages/standard-application-invocation/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }];
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: listPath,
      text: `
        import {
          MAX_TASK_RUN_LIST_PAGE_SIZE,
          type TaskRunListPage,
          type TaskRunListQueryApi,
          type TaskRunListQueryError,
          type TaskRunListQueryOptions,
        } from "@flarex/durable-task/internal/run-projection";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: listPath,
      text: `
        import {
          MAX_TASK_RUN_LIST_PAGE_SIZE,
          projectTaskRun,
          type TaskRunListPage,
          type TaskRunListQueryApi,
          type TaskRunListQueryError,
          type TaskRunListQueryOptions,
        } from "@flarex/durable-task/internal/run-projection";
      `,
    }]).errors).toEqual([
      `${listPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the located Application Task run-list store contracts", () => {
    const storePath =
      "packages/persistence-postgres/src/applicationTaskRunListStore.ts";
    const manifest = [{
      relativePath: "packages/persistence-postgres/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }];
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: storePath,
      text: `
        import {
          TaskRunListStoreFailure,
          decodeTaskRunListStoreItem,
          type ApplicationTaskRunListStoreShape,
          type TaskRunListStoreItem,
          type TaskRunListStorePage,
          type TaskRunListStoreRequest,
        } from "@flarex/durable-task/internal/run-projection";
        import {
          decodeTaskDatabaseTimeMsV1,
          TASK_RUN_ATTEMPT_PERSISTED_JSON_CODEC_V1,
          type TaskDatabaseTimeMsV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: storePath,
      text: `
        import {
          projectTaskRun,
          TaskRunListStoreFailure,
          decodeTaskRunListStoreItem,
          type ApplicationTaskRunListStoreShape,
          type TaskRunListStoreItem,
          type TaskRunListStorePage,
          type TaskRunListStoreRequest,
        } from "@flarex/durable-task/internal/run-projection";
      `,
    }]).errors).toEqual([
      `${storePath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the central Standard Application Task read composition", () => {
    const readPath =
      "packages/standard-application-invocation/src/StandardApplicationTaskReadQuery.ts";
    const manifest = [{
      relativePath: "packages/standard-application-invocation/package.json",
      manifest: { dependencies: { "@flarex/durable-task": "workspace:*" } },
    }];
    const admitted = `
      import {
        makeTaskAttemptHistoryQueryLayer,
        makeTaskEventHistoryQueryLayer,
        makeTaskRunListQueryLayer,
        makeTaskRunQueryLayer,
        TaskAttemptHistoryQuery,
        TaskEventHistoryQuery,
        TaskRunListQuery,
        TaskRunQuery,
        type TaskAttemptHistory,
        type TaskAttemptHistoryQueryApi,
        type TaskAttemptHistoryQueryError,
        type TaskEventHistory,
        type TaskEventHistoryQueryApi,
        type TaskEventHistoryQueryError,
      } from "@flarex/durable-task/internal/run-projection";
    `;
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: readPath,
      text: admitted,
    }]).errors).toEqual([]);
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: readPath,
      text: admitted.replace("TaskRunQuery,", "projectTaskRun,\nTaskRunQuery,"),
    }]).errors).toEqual([
      `${readPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the opaque Application Task read-store contracts", () => {
    const readStorePath =
      "packages/persistence-postgres/src/applicationTaskAttemptHistoryStore.ts";
    const manifest = [{
      relativePath: "packages/persistence-postgres/package.json",
      manifest: { dependencies: { "@flarex/durable-task": "workspace:*" } },
    }];
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: readStorePath,
      text: `
        import {
          decodeTaskAttemptHistoryRunVersion,
          decodeTaskAttemptHistoryStoreItem,
          MAX_TASK_EVENT_HISTORY_ENTRIES,
          MAX_TASK_ATTEMPT_HISTORY_ENTRIES,
          TaskEventHistoryStoreFailure,
          TaskAttemptHistoryStoreFailure,
          type ApplicationTaskEventHistoryStoreShape,
          type ApplicationTaskAttemptHistoryStoreShape,
          type TaskEventHistoryStoreItem,
          type TaskEventHistoryStoreSnapshot,
          type TaskAttemptHistoryStoreItem,
          type TaskAttemptHistoryStoreSnapshot,
          type ApplicationTaskRunListStoreShape,
        } from "@flarex/durable-task/internal/run-projection";
        import {
          decodeTaskDatabaseTimeMsV1,
          type ApplicationTaskSystemRunAttemptStoreShape,
          type TaskDatabaseTimeMsV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);
  });

  it("admits only the private Task result-body query chain", () => {
    const standardPath =
      "packages/standard-application-invocation/src/StandardApplicationTaskResultQuery.ts";
    const backendPath =
      "packages/flarex-backend/src/taskResult/TaskResultBodyQuery.ts";
    const manifests = [{
      relativePath: "packages/standard-application-invocation/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }, {
      relativePath: "packages/flarex-backend/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }];
    expect(analyzeTriggerCompatibilityBoundary(manifests, [{
      relativePath: standardPath,
      text: `
        import { makeTaskRunResultQueryLayer } from "@flarex/durable-task/internal/run-result-query";
      `,
    }, {
      relativePath: backendPath,
      text: `
        import {
          TaskRunResultQuery,
          type TaskRunResultQueryApi,
          type TaskRunResultQueryError,
        } from "@flarex/durable-task/internal/run-result-query";
        import type {
          TaskResultStore,
          TaskResultStoreError,
        } from "./TaskResultStore.js";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary(manifests, [{
      relativePath: backendPath,
      text: `
        import {
          TaskRunResultQuery,
          TaskRunResultUnavailableError,
          type TaskRunResultQueryApi,
          type TaskRunResultQueryError,
        } from "@flarex/durable-task/internal/run-result-query";
      `,
    }]).errors).toEqual([
      `${backendPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the private Standard Task cancellation command adapter", () => {
    const cancellationPath =
      "packages/standard-application-invocation/src/StandardApplicationTaskCancellation.ts";
    const manifest = [{
      relativePath: "packages/standard-application-invocation/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }];
    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: cancellationPath,
      text: `
        import {
          decodeTaskCancellationReasonV1,
          makeApplicationRunAttemptLifecycleV1,
          type ApplicationRequestCancellationOutcomeV1,
          type ApplicationTaskSystemRunAttemptStoreShape,
          type ApplicationTaskSystemRunAttemptTransactionReceiptV1,
          type RunAttemptLifecycleErrorV1,
          type TaskCancellationReasonV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary(manifest, [{
      relativePath: cancellationPath,
      text: `
        import {
          decodeTaskCancellationReasonV1,
          makeApplicationRunAttemptLifecycleV1,
          decideApplicationRequestCancellationV1,
          type ApplicationRequestCancellationOutcomeV1,
          type ApplicationTaskSystemRunAttemptStoreShape,
          type ApplicationTaskSystemRunAttemptTransactionReceiptV1,
          type RunAttemptLifecycleErrorV1,
          type TaskCancellationReasonV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([
      `${cancellationPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the private backend compute-delivery candidate runner", () => {
    const runnerPath =
      "packages/flarex-backend/src/taskComputeDelivery/CandidateRunner.ts";
    expect(analyzeTriggerCompatibilityBoundary([{
      relativePath: "packages/flarex-backend/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }], [{
      relativePath: runnerPath,
      text: `
        import {
          TaskComputeCancellationRejectedError,
          TaskComputeCancellationStaleError,
          TaskComputeCancellationTransportError,
          TaskComputeDispatchRejectedError,
          TaskComputeDispatchTransportError,
          TaskComputeProvider,
          type TaskComputeCancellationErrorV1,
          type TaskComputeDispatchErrorV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: runnerPath,
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
        import { makeInMemoryTaskComputeProviderV1 } from "@flarex/durable-task/internal/compute-provider-testing-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { TaskComputeProvider } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([
      `${runnerPath}:2 production source must not activate @flarex/durable-task before host admission.`,
      `${runnerPath}:3 production source must not activate @flarex/durable-task before host admission.`,
      "packages/flarex-backend/src/worker.ts:2 production source must not activate @flarex/durable-task before host admission.",
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/flarex-backend/src/taskComputeDelivery/index.ts",
      text: `
        export * from "./CandidateRunner.js";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { TaskComputeDeliveryCandidateRunner } from "flarex-backend/internal/task-compute-delivery";
        import { TaskComputeDeliveryTrustedDirectory } from "./taskComputeDelivery/index.js";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the connected Task compute-delivery runtime before host admission.",
      "packages/flarex-backend/src/worker.ts:3 production source must not activate the connected Task compute-delivery runtime before host admission.",
    ]);
  });

  it("admits only the E1 terminal completion type edge", () => {
    const completionPath =
      "packages/flarex-backend/src/taskComputeDelivery/TaskWorkerTerminalCompletion.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: completionPath,
      text: `
        import type {
          TaskAttemptCompletionV1,
          TaskCancellationGenerationV1,
          TaskExecutionFailureV1,
          TaskRetryDirectiveV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: completionPath,
      text: `
        import { makeRunAttemptLifecycleV1 } from
          "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import type { TaskAttemptCompletionV1 } from
          "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([
      `${completionPath}:2 production source must not activate @flarex/durable-task before host admission.`,
      "packages/flarex-backend/src/worker.ts:2 production source must not activate @flarex/durable-task before host admission.",
    ]);
  });

  it("admits only the E2 Task result store edges", () => {
    const resultStorePath =
      "packages/flarex-backend/src/taskResult/TaskResultStore.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: resultStorePath,
      text: `
        import {
          MAX_TASK_RESULT_CANONICAL_BYTES_V1,
          TASK_RESULT_CODEC_V1,
          type TaskResultCommitmentV1,
          decodeTaskResultCommitmentV1,
          taskResultObjectKeyV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import { makeImmutableR2ByteStore } from
          "../immutableR2/ImmutableR2ByteStore.js";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: resultStorePath,
      text: `
        import { makeRunAttemptLifecycleV1 } from
          "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { makeImmutableR2ByteStore } from
          "./immutableR2/ImmutableR2ByteStore.js";
      `,
    }]).errors).toEqual([
      `${resultStorePath}:2 production source must not activate @flarex/durable-task before host admission.`,
      "packages/flarex-backend/src/worker.ts:2 production source must not consume the private immutable R2 mechanics outside admitted store adapters.",
    ]);
  });

  it("admits the DTE06-D1 launch model without admitting a host", () => {
    const modelPath =
      "packages/flarex-backend/src/taskRuntimeLaunch/Model.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: modelPath,
      text: `
        import {
          type TaskComputeDispatchRequestV1,
          validateTaskComputeDispatchRequestV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
        import {
          type TaskInputReferenceV1,
          decodeTaskInputReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: modelPath,
      text: `
        import { TaskComputeProvider } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { TaskRuntimeLaunchAuthority } from "flarex-backend/internal/task-runtime-launch";
        import { TaskRuntimeLaunchAuthority as RelativeAuthority } from "./taskRuntimeLaunch/index.js";
      `,
    }]).errors).toEqual([
      `${modelPath}:2 production source must not activate @flarex/durable-task before host admission.`,
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the Task runtime launch authority before Worker Loader admission.",
      "packages/flarex-backend/src/worker.ts:3 production source must not activate the Task runtime launch authority before Worker Loader admission.",
    ]);
  });

  it("admits only Task request-key decoding at the Standard entry", () => {
    const taskSystemPath =
      "packages/standard-application-invocation/src/StandardApplicationTaskSystem.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: taskSystemPath,
      text: `
        import {
          decodeTaskRunCreationRequestKeyV1,
          type InvalidTaskRunCreationRequestError,
          type TaskRunCreationRequestKeyV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: taskSystemPath,
      text: `
        import {
          decodeTaskRunCreationRequestKeyV1,
          makeTaskRunCreationInitialAggregateV1,
          type InvalidTaskRunCreationRequestError,
          type TaskRunCreationRequestKeyV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([
      `${taskSystemPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);
  });

  it("admits only the scope-bound Task execution principal issue and launch owners", () => {
    const storePath =
      "packages/flarex-backend/src/taskExecutionPrincipal/TaskExecutionPrincipalStore.ts";
    const taskSystemPath =
      "packages/standard-application-invocation/src/ApplicationTaskSystem.ts";
    const launchAuthorityPath =
      "packages/flarex-backend/src/taskRuntimeLaunch/Authority.ts";
    const connectedHarnessPath =
      "packages/system-test/support/applicationTaskSystemConnectedHarness.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: storePath,
      text: `
        import {
          decodeTaskExecutionPrincipalReferenceV1,
          makeTaskExecutionPrincipalReferenceV1,
          MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
          type TaskExecutionPrincipalReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
        import { makeImmutableR2ByteStore } from
          "../immutableR2/ImmutableR2ByteStore.js";
      `,
    }, {
      relativePath: taskSystemPath,
      text: `
        import type {
          TaskExecutionPrincipalIdentity,
          TaskExecutionPrincipalIssuer,
          TaskExecutionPrincipalStoreError,
        } from "flarex-backend/internal/task-execution-principal-store";
      `,
    }, {
      relativePath: launchAuthorityPath,
      text: `
        import { decodeTaskExecutionPrincipalReferenceV1 } from
          "@flarex/durable-task/internal/run-creation-v1";
        import { decodeTaskExecutionPrincipalObjectV1 } from
          "../taskExecutionPrincipal/TaskExecutionPrincipalStore.js";
      `,
    }, {
      relativePath: connectedHarnessPath,
      text: `
        import { makeTaskExecutionPrincipalStore } from
          "flarex-backend/internal/task-execution-principal-store";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { makeTaskExecutionPrincipalStore } from
          "flarex-backend/internal/task-execution-principal-store";
      `,
    }, {
      relativePath: taskSystemPath,
      text: `
        import { makeTaskExecutionPrincipalStore } from
          "flarex-backend/internal/task-execution-principal-store";
      `,
    }, {
      relativePath: launchAuthorityPath,
      text: `
        import { makeTaskExecutionPrincipalStore } from
          "../taskExecutionPrincipal/TaskExecutionPrincipalStore.js";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/worker.ts:2 production source must not consume the Task execution principal store outside admitted issue and launch owners.",
      `${taskSystemPath}:2 production source must not consume the Task execution principal store outside admitted issue and launch owners.`,
      `${launchAuthorityPath}:2 production source must not consume the Task execution principal store outside admitted issue and launch owners.`,
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: taskSystemPath,
      text: `
        import type {
          TaskExecutionPrincipalIdentity,
          TaskExecutionPrincipalIssuer,
          TaskExecutionPrincipalStoreError,
        } from "flarex-backend/internal/task-execution-principal-store";
        export type { TaskExecutionPrincipalIdentity };
      `,
    }]).errors).toEqual([
      `${taskSystemPath}:7 production source must not re-export an admitted compatibility binding beyond its owning file.`,
    ]);
  });

  it("admits only the private DTE06-D3b.iii Worker Loader provider chain", () => {
    const providerPath =
      "packages/flarex-backend/src/taskComputeDelivery/WorkerLoaderTaskComputeProvider.ts";
    const queryCallbackPath =
      "packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskQueryCallback.ts";
    const mutationCallbackPath =
      "packages/flarex-backend/src/taskComputeDelivery/ApplicationTaskMutationCallback.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: providerPath,
      text: `
        import {
          TaskComputeProvider,
          TaskComputeDispatchConflictError,
          type CurrentTaskComputeDispatchRequestV1,
          type TaskComputeExecutionIdV1,
          type TaskComputeProviderShape,
        } from "@flarex/durable-task/internal/compute-provider-v1";
        import {
          TaskRuntimeLaunchAuthority,
          type TaskRuntimeLaunchAuthorityShape,
        } from "../taskRuntimeLaunch/Authority";
        import {
          TaskRuntimeLaunchHashError,
          TaskRuntimeLaunchPortError,
          TaskRuntimeLaunchValidationError,
          type CurrentTaskRuntimeLaunchSubject,
          type TaskRuntimeInputSource,
        } from "../taskRuntimeLaunch/Model";
      `,
    }, {
      relativePath:
        "packages/flarex-backend/src/artifactRuntime/LegacyTaskWorkerDefinition.ts",
      text: `
        import type { TaskRuntimeLaunchSubject } from "../taskRuntimeLaunch/Model";
      `,
    }]).errors).toEqual([]);
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: mutationCallbackPath,
      text: `
        import type { ApplicationTaskRuntimeLaunchSubject } from
          "../taskRuntimeLaunch/Model";
        import type { TaskComputeExecutionIdV1 } from
          "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([]);
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: mutationCallbackPath,
      text: `
        import { TaskComputeProvider } from
          "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([
      `${mutationCallbackPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: queryCallbackPath,
      text: `
        import type { ApplicationTaskRuntimeLaunchSubject } from
          "../taskRuntimeLaunch/Model";
        import type { TaskComputeExecutionIdV1 } from
          "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([]);
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: queryCallbackPath,
      text: `
        import {
          type ApplicationTaskRuntimeLaunchSubject,
          TaskRuntimeLaunchPortError,
        } from "../taskRuntimeLaunch/Model";
      `,
    }]).errors).toEqual([
      `${queryCallbackPath}:2 production source must not activate the Task runtime launch authority before Worker Loader admission.`,
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: queryCallbackPath,
      text: `
        import {
          TaskComputeProvider,
          type TaskComputeExecutionIdV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([
      `${queryCallbackPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: providerPath,
      text: `
        import { RunAttemptLifecycle } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { makeWorkerLoaderTaskComputeProviderLayer } from
          "flarex-backend/internal/task-compute-delivery";
      `,
    }]).errors).toEqual([
      `${providerPath}:2 production source must not activate @flarex/durable-task before host admission.`,
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the connected Task compute-delivery runtime before host admission.",
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/flarex-backend/src/artifactRuntime/LegacyTaskWorkerDefinition.ts",
      text: `
        import { TaskRuntimeLaunchAuthority } from "../taskRuntimeLaunch/Authority";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/artifactRuntime/LegacyTaskWorkerDefinition.ts:2 production source must not activate the Task runtime launch authority before Worker Loader admission.",
    ]);

    for (const text of [
      `import type { TaskRuntimeLaunchDirectory } from "../taskRuntimeLaunch/Model";`,
      `import { TaskRuntimeLaunchAuthority } from "flarex-backend/internal/task-runtime-launch";`,
    ]) {
      expect(analyzeTriggerCompatibilityBoundary([], [{
        relativePath: providerPath,
        text,
      }]).errors).toEqual([
        `${providerPath}:1 production source must not activate the Task runtime launch authority before Worker Loader admission.`,
      ]);
    }
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
          MAX_TASK_EXECUTION_PRINCIPAL_CANONICAL_BYTES_V1,
          type TaskExecutionPrincipalSha256V1,
          type TaskInputSha256V1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([]);

    const applicationCreationPath =
      "packages/persistence-postgres/src/applicationTaskSystemRunCreation.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: applicationCreationPath,
      text: `
        import {
          type ApplicationTaskRunCreationRequestV1,
          type TaskExecutionPrincipalSha256V1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([]);
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: applicationCreationPath,
      text: `
        import { makeTaskExecutionPrincipalReferenceV1 }
          from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }]).errors).toEqual([
      `${applicationCreationPath}:2 production source must not activate @flarex/durable-task before host admission.`,
    ]);

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
        "packages/persistence-postgres/src/taskComputeDeliveryRepositoryV1.ts",
      text: `
        import {
          TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
          TASK_COMPUTE_DISPATCH_IDENTITY_VERSION_V1,
          TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
          TaskComputeCancellationRejectedError,
          TaskComputeCancellationStaleError,
          TaskComputeCancellationTransportError,
          TaskComputeDispatchRejectedError,
          TaskComputeDispatchTransportError,
          validateTaskComputeCancellationReceiptV1,
          validateTaskComputeCancellationRequestV1,
          validateTaskComputeDispatchAcceptanceV1,
          validateTaskComputeDispatchRequestV1,
          type TaskComputeCancellationReceiptV1,
          type TaskComputeCancellationRequestV1,
          type TaskComputeDispatchAcceptanceV1,
          type TaskComputeDispatchIdentityV1,
          type TaskComputeDispatchRequestV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
        import {
          decodeTaskInputReferenceV1,
          type TaskInputReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
        import {
          decodeTaskAttemptIdV1,
          decodeTaskCancellationGenerationV1,
          decodeTaskExecutionFenceV1,
          decodeTaskRequestedEffectSequenceV1,
          decodeTaskRunIdV1,
          type PersistedTaskRequestedEffectV1,
          type TaskCancellationGenerationV1,
          type TaskRequestedEffectSequenceV1,
          type TaskRunAttemptAggregateV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskComputeDeliveryDiscovery.ts",
      text: `
        import {
          TaskRunIdV1Schema,
          decodeTaskRequestedEffectSequenceV1,
          type TaskRequestedEffectSequenceV1,
          type TaskRunIdV1,
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
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskComputeDeliveryRepositoryV1.ts",
      text: `
        import { TaskComputeProvider } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskComputeDeliveryDiscovery.ts",
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
      "packages/persistence-postgres/src/taskComputeDeliveryRepositoryV1.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/taskComputeDeliveryDiscovery.ts:2 production source must not activate @flarex/durable-task before host admission.",
    ]);
  });

  it("keeps the task runtime object store production-inert", () => {
    const taskStore =
      "packages/flarex-backend/src/taskRuntimePublication/TaskRuntimeObjectStore.ts";
    const declarativeStore =
      "packages/flarex-backend/src/artifactRuntime/DeclarativeV2RuntimeArtifactStore.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: taskStore,
      text: 'import { makeImmutableR2ByteStore } from "../immutableR2/ImmutableR2ByteStore.js";',
    }, {
      relativePath: declarativeStore,
      text: 'import { makeImmutableR2ByteStore } from "../immutableR2/ImmutableR2ByteStore.js";',
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { makeTaskRuntimeObjectStore } from "flarex-backend/internal/task-runtime-object-store";
        import { makeImmutableR2ByteStore } from "./immutableR2/ImmutableR2ByteStore.js";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the Task runtime object store before publication-host admission.",
      "packages/flarex-backend/src/worker.ts:3 production source must not consume the private immutable R2 mechanics outside admitted store adapters.",
    ]);
  });

  it("keeps the control-directory adapter inside its inert composition owners", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/flarex-backend/src/taskComputeDelivery/TrustedDirectory.ts",
      text: `
        import { makeTaskComputeDeliveryControlDirectory } from "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/postgresTaskComputeDeliveryControlDirectory.ts",
      text: `
        import { createTaskComputeDeliveryControlDirectoryTargetFromPolicyInternal } from "./taskComputeDeliveryControlDirectoryTarget.js";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { makeTaskComputeDeliveryControlDirectory } from "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
        import { createPostgresTaskComputeDeliveryControlDirectoryResource } from "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the Task compute-delivery control directory before host admission.",
      "packages/flarex-backend/src/worker.ts:3 production source must not activate the Task compute-delivery control directory before host admission.",
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/flarex-backend/src/taskComputeDelivery/TrustedDirectory.ts",
      text: `
        import { createPostgresTaskComputeDeliveryControlDirectoryResource } from "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
        import { createTaskComputeDeliveryControlDirectoryTargetForSystemTest } from "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/taskComputeDelivery/TrustedDirectory.ts:2 production source must not activate the Task compute-delivery control directory before host admission.",
      "packages/flarex-backend/src/taskComputeDelivery/TrustedDirectory.ts:3 production source must not activate the Task compute-delivery control directory before host admission.",
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/persistence-postgres/src/postgres.ts",
      text: `
        import { createTaskComputeDeliveryControlDirectoryTargetForSystemTest } from "./taskComputeDeliveryControlDirectoryTargetSystemTest.js";
      `,
    }]).errors).toEqual([
      "packages/persistence-postgres/src/postgres.ts:2 production source must not activate the Task compute-delivery control directory before host admission.",
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
      `${privatePath}:3 production source must not re-export an admitted compatibility binding beyond its owning file.`,
      `${privatePath}:4 production source must not re-export an admitted compatibility binding beyond its owning file.`,
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

  it("admits only the E4 supervisor type edge to the lifecycle gateway", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskAttemptLifecycleGateway.ts",
      text: `
        import {
          decideHeartbeatAttemptV1,
          type TaskSystemRunAttemptStoreShape,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import {
          type CurrentTaskComputeDispatchRequestV1,
          validateCurrentTaskComputeDispatchRequestV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }, {
      relativePath:
        "packages/flarex-backend/src/taskComputeDelivery/TaskAttemptSupervisor.ts",
      text: `
        import {
          encodeTaskAttemptCompletionV1,
          type ApplicationHeartbeatAttemptOutcomeV1,
          type HeartbeatAttemptOutcomeV1,
          type TaskAttemptCompletionV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import type { CurrentTaskComputeDispatchRequestV1 } from
          "@flarex/durable-task/internal/compute-provider-v1";
        import type { TaskAttemptLifecycleCapability } from
          "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
      `,
    }, {
      relativePath:
        "packages/flarex-backend/src/taskComputeDelivery/TaskAttemptSupervisor.ts",
      text: `
        import { createTaskAttemptLifecycleGateway } from
          "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { createTaskAttemptLifecycleGateway } from
          "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
      `,
    }, {
      relativePath: "apps/executor/src/taskLifecycle.ts",
      text: `
        import { createTaskAttemptLifecycleGateway } from
          "../../../packages/persistence-postgres/src/taskAttemptLifecycleGateway.js";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/taskComputeDelivery/TaskAttemptSupervisor.ts:2 production source must not activate the Task attempt lifecycle gateway before supervisor admission.",
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the Task attempt lifecycle gateway before supervisor admission.",
      "apps/executor/src/taskLifecycle.ts:2 production source must not activate the Task attempt lifecycle gateway before supervisor admission.",
    ]);
  });

  it("admits only the Task external-effect authority dispatch contract", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath:
        "packages/persistence-postgres/src/taskExternalEffectAuthority.ts",
      text: `
        import {
          type ApplicationTaskComputeDispatchRequestV1,
          validateApplicationTaskComputeDispatchRequestV1,
        } from "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/taskExternalEffectAuthority.ts",
      text: `
        import { TaskComputeProvider } from
          "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }, {
      relativePath: "packages/persistence-postgres/src/postgres.ts",
      text: `
        import { validateApplicationTaskComputeDispatchRequestV1 } from
          "@flarex/durable-task/internal/compute-provider-v1";
      `,
    }]).errors).toEqual([
      "packages/persistence-postgres/src/taskExternalEffectAuthority.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/persistence-postgres/src/postgres.ts:2 production source must not activate @flarex/durable-task before host admission.",
    ]);
  });

  it("keeps the Task external-effect authority production-inert", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { prepareTaskChildMutationEffect } from
          "@flarex/persistence-postgres/internal/task-external-effect-authority";
      `,
    }, {
      relativePath:
        "packages/standard-application-invocation/src/ApplicationMutationSystem.ts",
      text: `
        import type { ApplicationTaskExternalEffectSubject } from
          "@flarex/persistence-postgres/internal/task-external-effect-authority";
      `,
    }, {
      relativePath: "packages/persistence-postgres/src/postgres.ts",
      text: `
        import { issueApplicationTaskExternalEffectSubject } from
          "./taskExternalEffectAuthority.js";
      `,
    }, {
      relativePath: "apps/executor/src/taskMutationHost.ts",
      text: `
        import { createPostgresTaskExternalEffectAuthorityResource } from
          "@flarex/persistence-postgres/internal/system-test/postgres-task-external-effect-authority";
      `,
    }, {
      relativePath: "packages/persistence-postgres/src/postgres.ts",
      text: `
        import { createPostgresTaskExternalEffectAuthorityResource } from
          "./postgresTaskExternalEffectAuthority.js";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/test/taskExternalEffectAuthority.test.ts",
      text: `
        import { prepareTaskChildMutationEffect } from
          "../src/taskExternalEffectAuthority";
      `,
    }]).errors).toEqual([
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
      "packages/standard-application-invocation/src/ApplicationMutationSystem.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
      "packages/persistence-postgres/src/postgres.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
      "apps/executor/src/taskMutationHost.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
      "packages/persistence-postgres/src/postgres.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
    ]);
  });

  it("admits only the exact Application Task mutation authority edges", () => {
    const authority =
      "packages/standard-application-invocation/src/ApplicationTaskMutationAuthority.ts";
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: authority,
      text: `
        import {
          confirmTaskChildMutationEffect,
          declareTaskChildMutationDispatch,
          issueApplicationTaskExternalEffectSubject,
          prepareTaskChildMutationEffect,
          reconcileTaskChildMutationDisposition,
          revokeApplicationTaskExternalEffectSubject,
          InvalidApplicationTaskExternalEffectSubjectError,
          TaskExternalEffectAuthorityCorruptionError,
          TaskExternalEffectAuthorityInputError,
          TaskExternalEffectAuthorityStaleError,
          TaskExternalEffectLifecycleConflictError,
          TaskExternalEffectRequestConflictError,
          TaskExternalEffectSequenceConflictError,
          type LocatedTaskExternalEffectAuthorityTarget,
          type ReconcileTaskChildMutationDispositionInput,
          type ReconcileTaskChildMutationDispositionReceipt,
          type TaskChildMutationEffectInput,
          type TaskChildMutationEffectProjection,
          type TaskExternalEffectAuthorityHashContext,
          type TaskExternalEffectAuthoritySha256,
        } from "@flarex/persistence-postgres/internal/task-external-effect-authority";
      `,
    }, {
      relativePath: authority,
      text: `
        import {
          ApplicationTaskMutationCallbackBindError,
          type ApplicationTaskMutationCallbackAuthority,
          type ApplicationTaskMutationCallbackSession,
          type ApplicationTaskMutationCallbackSessionFailure,
        } from "flarex-backend/internal/task-compute-delivery";
      `,
    }, {
      relativePath: authority,
      text: `
        import {
          decodeTaskRuntimeLaunchRequest,
          type ApplicationTaskRuntimeLaunchSubject,
        } from "flarex-backend/internal/task-runtime-launch";
      `,
    }, {
      relativePath:
        "packages/standard-application-invocation/src/ApplicationMutationSystem.ts",
      text: `
        import { prepareTaskChildMutationEffect } from
          "@flarex/persistence-postgres/internal/task-external-effect-authority";
      `,
    }, {
      relativePath: authority,
      text: `
        import { TaskAttemptSupervisor } from
          "flarex-backend/internal/task-compute-delivery";
      `,
    }, {
      relativePath: authority,
      text: `
        import { makeTaskRuntimeLaunchAuthorityLayer } from
          "flarex-backend/internal/task-runtime-launch";
      `,
    }]).errors).toEqual([
      "packages/standard-application-invocation/src/ApplicationMutationSystem.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
      `${authority}:2 production source must not activate the connected Task compute-delivery runtime before host admission.`,
      `${authority}:2 production source must not activate the Task runtime launch authority before Worker Loader admission.`,
    ]);
  });

  it("admits only the exact Task external-effect persistence adapters", () => {
    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: "packages/persistence-postgres/src/pglite.ts",
      text: `
        import {
          createLocatedTaskExternalEffectAuthorityTarget,
          type LocatedTaskExternalEffectAuthorityTarget,
          type TaskExternalEffectAuthorityConfigurationError,
        } from "./taskExternalEffectAuthority";
      `,
    }, {
      relativePath:
        "packages/persistence-postgres/src/postgresTaskExternalEffectAuthority.ts",
      text: `
        import {
          createLocatedTaskExternalEffectAuthorityTargetFromPolicyInternal,
          TaskExternalEffectAuthorityConfigurationError,
          type LocatedTaskExternalEffectAuthorityTarget,
        } from "./taskExternalEffectAuthority";
      `,
    }, {
      relativePath: "packages/persistence-postgres/src/postgres.ts",
      text: `
        import { createLocatedTaskExternalEffectAuthorityTarget } from
          "./taskExternalEffectAuthority";
      `,
    }]).errors).toEqual([
      "packages/persistence-postgres/src/postgres.ts:2 production source must not activate the Task external-effect authority before mutation-host admission.",
    ]);
  });

  it("admits only the E5 private Application supervision composition", () => {
    const applicationComposition =
      "packages/standard-application-invocation/src/ApplicationTaskComputeDelivery.ts";
    const connectedHarness =
      "packages/system-test/support/applicationTaskSystemConnectedHarness.ts";
    expect(analyzeTriggerCompatibilityBoundary([{
      relativePath: "packages/system-test/package.json",
      manifest: {
        dependencies: { "@flarex/durable-task": "workspace:*" },
      },
    }], [{
      relativePath: applicationComposition,
      text: `
        import {
          TaskComputeDeliveryCandidateRunnerLive,
          makeTaskComputeDeliveryConnectedRunnerLayer,
          makeTaskComputeDeliveryTrustedDirectoryLayer,
          makeSupervisedWorkerLoaderTaskComputeProviderLayer,
          type TaskAttemptSupervisionObserver,
          type TaskAttemptSupervisor,
          type TaskComputeDeliveryConnectedRunnerOptions,
          type TaskComputeDeliveryTrustedDirectoryOptions,
          type ApplicationTaskMutationCallbackAuthority,
          type WorkerLoaderTaskComputeProviderOptions,
        } from "flarex-backend/internal/task-compute-delivery";
        import {
          makeTaskRuntimeLaunchAuthorityLayer,
          type TaskRuntimeLaunchAuthorityOptions,
          type TaskRuntimeLaunchDirectory,
        } from "flarex-backend/internal/task-runtime-launch";
      `,
    }, {
      relativePath: connectedHarness,
      text: `
        import {
          decideApplicationRequestCancellationV1,
          decideApplicationStartAttemptV1,
          decodeTaskDurationMsV1,
          decodeTaskRetryJitterV1,
          decodeTaskRunVersionV1,
          encodeApplicationTaskRunAttemptAggregateJsonV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import {
          decodeTaskRunCreationRequestKeyV1,
          makeTaskInputReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
        import {
          makeTaskAttemptSupervisor,
          TaskComputeDeliveryConnectedRunner,
          type TaskAttemptSupervisionObserver,
          type TaskAttemptSupervisorError,
          type TaskAttemptSupervisorLifecycleResolver,
          type TaskAttemptSupervisorOutcome,
          type TaskAttemptSupervisorPolicy,
          type TaskComputeDeliveryConnectedRunnerReceipt,
        } from "flarex-backend/internal/task-compute-delivery";
        import {
          TaskRuntimeLaunchPortError,
          type TaskRuntimeLaunchDirectory,
          type TaskRuntimeLaunchLocatedSource,
          type TaskRuntimeLaunchResourceDirectory,
        } from "flarex-backend/internal/task-runtime-launch";
        import {
          makeTaskResultStore,
          TaskResultStoreSettlementUncertainError,
          type TaskResultStoreBucket,
        } from "flarex-backend/internal/task-result-store";
        import {
          createTaskAttemptLifecycleGateway,
          type ApplicationTaskAttemptLifecycleCapability,
        } from
          "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
        import type { TaskComputeDeliveryControlDirectoryTarget } from
          "@flarex/persistence-postgres/internal/task-compute-delivery-control-directory";
        import { createTaskComputeDeliveryControlDirectoryTargetForSystemTest } from
          "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
        import {
          createLocatedTaskExternalEffectAuthorityTarget,
          type LocatedTaskExternalEffectAuthorityTarget,
        } from "@flarex/persistence-postgres/internal/task-external-effect-authority";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: applicationComposition,
      text: `
        import { makeWorkerLoaderTaskComputeProviderLayer } from
          "flarex-backend/internal/task-compute-delivery";
      `,
    }, {
      relativePath: connectedHarness,
      text: `
        import { taskResultStoreResourceCause } from
          "flarex-backend/internal/task-result-store";
      `,
    }, {
      relativePath: "packages/flarex-backend/src/worker.ts",
      text: `
        import { createTaskAttemptLifecycleGateway } from
          "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
      `,
    }, {
      relativePath: "packages/system-test/support/otherHarness.ts",
      text: `
        import { decideApplicationRequestCancellationV1 } from
          "@flarex/durable-task/internal/run-attempt-v1";
        import type { TaskComputeDeliveryConnectedRunnerReceipt } from
          "flarex-backend/internal/task-compute-delivery";
        import { createLocatedTaskExternalEffectAuthorityTarget } from
          "@flarex/persistence-postgres/internal/task-external-effect-authority";
      `,
    }]).errors).toEqual([
      `${applicationComposition}:2 production source must not activate the connected Task compute-delivery runtime before host admission.`,
      `${connectedHarness}:2 production source must not activate the Task result store before connected host admission.`,
      "packages/flarex-backend/src/worker.ts:2 production source must not activate the Task attempt lifecycle gateway before supervisor admission.",
      "packages/system-test/support/otherHarness.ts:2 production source must not activate @flarex/durable-task before host admission.",
      "packages/system-test/support/otherHarness.ts:4 production source must not activate the connected Task compute-delivery runtime before host admission.",
      "packages/system-test/support/otherHarness.ts:6 production source must not activate the Task external-effect authority before mutation-host admission.",
    ]);
  });

  it("admits only the exact F1/F2 and C3 proof edges", () => {
    const inputStore =
      "packages/flarex-backend/src/taskInput/TaskInputStore.ts";
    const eventHost =
      "packages/standard-application-invocation/src/ApplicationTaskDeliveryEventHost.ts";
    const freshHost =
      "packages/system-test/support/applicationTaskSystemFreshHostTakeoverHarness.ts";
    const databaseLane = "packages/system-test/src/lanes/databaseLane.ts";
    const environment =
      "packages/system-test/src/environment/applicationEnvironment.ts";
    const runRead =
      "packages/persistence-postgres/src/taskSystemRunReadV1.ts";
    const wakeScheduler =
      "packages/persistence-postgres/src/taskSystemWakeSchedulerPartitionV1.ts";

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: inputStore,
      text: `
        import {
          decodeTaskInputReferenceV1,
          makeTaskInputReferenceV1,
          MAX_TASK_INPUT_CANONICAL_BYTES_V1,
          type TaskInputReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
        import {
          ImmutableR2BodyBudgetExceededError,
          ImmutableR2CorruptionError,
          ImmutableR2NotFoundError,
          ImmutableR2ResourceError,
          ImmutableR2SettlementUncertainError,
          immutableR2ResourceCause,
          immutableR2SettlementUncertainCause,
          makeImmutableR2ByteStore,
          type ImmutableR2Bucket,
        } from "../immutableR2/ImmutableR2ByteStore.js";
      `,
    }, {
      relativePath: eventHost,
      text: `
        import {
          makeTaskComputeDeliveryEventHost,
          type TaskAttemptSupervisionObserver,
          type TaskComputeDeliveryEventHostConfigurationError,
          type TaskComputeDeliveryEventHostPolicy,
          type TaskComputeDeliveryEventHostShape,
        } from "flarex-backend/internal/task-compute-delivery";
        import {
          makeTaskRuntimeLaunchDirectoryFromResources,
          type TaskRuntimeLaunchResourceDirectory,
        } from "flarex-backend/internal/task-runtime-launch";
      `,
    }, {
      relativePath: freshHost,
      text: `
        import {
          encodeApplicationTaskRunAttemptAggregateJsonV1,
          type ApplicationTaskSystemRunAttemptStoreShape,
          type TaskResultCommitmentV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import type { ApplicationTaskAttemptLifecycleCapability } from
          "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
        import type { ApplicationTaskSystemWakeSchedulerPartitionV1 } from
          "@flarex/persistence-postgres/internal/task-wake-scheduler-partition-v1";
        import type { StoredTaskResult, TaskResultStoreError } from
          "flarex-backend/internal/task-result-store";
      `,
    }, {
      relativePath: databaseLane,
      text: `
        import { createTaskComputeDeliveryControlDirectoryTargetForSystemTest } from
          "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
        import { createPostgresTaskComputeDeliveryControlDirectoryResource } from
          "@flarex/persistence-postgres/internal/system-test/postgres-task-compute-delivery-control-directory";
        import { createPostgresTaskExternalEffectAuthorityResource } from
          "@flarex/persistence-postgres/internal/system-test/postgres-task-external-effect-authority";
      `,
    }, {
      relativePath: environment,
      text: `
        import { decodeTaskDurationMsV1 } from
          "@flarex/durable-task/internal/run-attempt-v1";
        import type { TaskExecutionPrincipalStoreBucket } from
          "flarex-backend/internal/task-execution-principal-store";
        import { makeTaskExecutionPrincipalStore } from
          "flarex-backend/internal/task-execution-principal-store";
      `,
    }, {
      relativePath: runRead,
      text: `
        import {
          decodeTaskDatabaseTimeMsV1,
          decodeTaskRequestedEffectSequenceV1,
          type ApplicationTaskRunAttemptAggregateV1,
          type PersistedTaskRunAttemptAggregate,
          type TaskRequestedEffectPersistenceCursorV1,
          type TaskRunAttemptAggregateV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath: wakeScheduler,
      text: `
        import {
          makeApplicationRunAttemptLifecycleV1,
          makeRunAttemptLifecycleV1,
          type RunAttemptLifecycleErrorV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
        import {
          makeApplicationRunAttemptDueCandidateHandlerV1,
          makeRunAttemptDueCandidateHandlerV1,
          makeWakePublishingRunAttemptDueCandidateHandlerV1,
          makeTaskWakeSchedulerV1,
          type InvalidTaskWakeSchedulerConfigurationError,
          type TaskDueCandidateLifecycleContractError,
          type TaskRetryJitterSourceV1,
          type TaskWakeSchedulerOptionsV1,
          type TaskWakeSchedulerV1,
          type TaskWakeHintPublisherV1,
        } from "@flarex/durable-task/internal/scheduling-v1";
      `,
    }]).errors).toEqual([]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: inputStore,
      text: `
        import {
          decodeTaskInputReferenceV1,
          makeTaskInputReferenceV1,
          MAX_TASK_INPUT_CANONICAL_BYTES_V1,
          type TaskInputReferenceV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }, {
      relativePath: eventHost,
      text: `
        import {
          makeTaskComputeDeliveryEventHost,
          TaskComputeDeliveryConnectedRunner,
          type TaskAttemptSupervisionObserver,
          type TaskComputeDeliveryEventHostConfigurationError,
          type TaskComputeDeliveryEventHostPolicy,
          type TaskComputeDeliveryEventHostShape,
        } from "flarex-backend/internal/task-compute-delivery";
      `,
    }, {
      relativePath: freshHost,
      text: `
        import { TaskResultStoreError } from
          "flarex-backend/internal/task-result-store";
      `,
    }, {
      relativePath: "packages/system-test/src/lanes/otherLane.ts",
      text: `
        import { createTaskComputeDeliveryControlDirectoryTargetForSystemTest } from
          "@flarex/persistence-postgres/internal/system-test/task-compute-delivery-control-directory";
      `,
    }, {
      relativePath: environment,
      text: `
        import {
          makeTaskExecutionPrincipalStore,
          type TaskExecutionPrincipalStoreBucket,
        } from "flarex-backend/internal/task-execution-principal-store";
      `,
    }]).errors).toEqual([
      `${inputStore}:2 production source must not activate @flarex/durable-task before host admission.`,
      `${eventHost}:2 production source must not activate the connected Task compute-delivery runtime before host admission.`,
      `${freshHost}:2 production source must not activate the Task result store before connected host admission.`,
      "packages/system-test/src/lanes/otherLane.ts:2 production source must not activate the Task compute-delivery control directory before host admission.",
      `${environment}:2 production source must not consume the Task execution principal store outside admitted issue and launch owners.`,
    ]);

    expect(analyzeTriggerCompatibilityBoundary([], [{
      relativePath: inputStore,
      text: `
        import {
          decodeTaskInputReferenceV1,
          decodeTaskInputReferenceV1 as duplicateDecoder,
          MAX_TASK_INPUT_CANONICAL_BYTES_V1,
          type TaskInputReferenceV1,
        } from "@flarex/durable-task/internal/run-creation-v1";
      `,
    }, {
      relativePath: eventHost,
      text: `
        import {
          makeTaskComputeDeliveryEventHost,
          type TaskAttemptSupervisionObserver,
          type TaskComputeDeliveryEventHostConfigurationError,
          type TaskComputeDeliveryEventHostPolicy,
          type TaskComputeDeliveryEventHostShape,
        } from "flarex-backend/internal/task-compute-delivery";
        export { makeTaskComputeDeliveryEventHost };
      `,
    }, {
      relativePath: runRead,
      text: `
        import {
          ApplicationTaskRunAttemptAggregateV1,
          PersistedTaskRunAttemptAggregate,
          decodeTaskDatabaseTimeMsV1,
          decodeTaskRequestedEffectSequenceV1,
          type TaskRequestedEffectPersistenceCursorV1,
          type TaskRunAttemptAggregateV1,
          type TaskRunIdV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }, {
      relativePath: wakeScheduler,
      text: `
        import {
          type makeApplicationRunAttemptLifecycleV1,
          makeRunAttemptLifecycleV1,
          type RunAttemptLifecycleErrorV1,
        } from "@flarex/durable-task/internal/run-attempt-v1";
      `,
    }]).errors).toEqual([
      `${inputStore}:2 production source must not activate @flarex/durable-task before host admission.`,
      `${eventHost}:9 production source must not re-export an admitted compatibility binding beyond its owning file.`,
      `${runRead}:2 production source must not activate @flarex/durable-task before host admission.`,
      `${wakeScheduler}:2 production source must not activate @flarex/durable-task before host admission.`,
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
