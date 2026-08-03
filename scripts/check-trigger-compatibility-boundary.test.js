// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeDurableTaskManifest,
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

  it("keeps the durable-task package private, narrow, and root-catalog owned", () => {
    expect(analyzeDurableTaskManifest({
      name: "@flarex/durable-task",
      version: "0.0.1",
      private: true,
      type: "module",
      files: ["src", "THIRD_PARTY_NOTICES.md", "trigger-source-map.json", "licenses"],
      exports: { "./internal/run-attempt-v1": "./src/runAttempt/v1.ts" },
      dependencies: { effect: "catalog:" },
    })).toEqual([]);

    expect(analyzeDurableTaskManifest({
      name: "wrong-name",
      version: "1.0.0",
      private: false,
      type: "commonjs",
      files: ["src", "extra"],
      exports: { ".": "./src/index.ts" },
      dependencies: { effect: "catalog:", ioredis: "catalog:" },
      devDependencies: { prisma: "catalog:" },
      optionalDependencies: { cache: "npm:ioredis@5.0.0" },
    })).toEqual(expect.arrayContaining([
      "packages/durable-task/package.json: name must be @flarex/durable-task.",
      "packages/durable-task/package.json: version must be 0.0.1 during the private vertical.",
      "packages/durable-task/package.json: private must remain true during the private vertical.",
      "packages/durable-task/package.json: type must be module.",
      "packages/durable-task/package.json: exports must contain only ./internal/run-attempt-v1.",
      "packages/durable-task/package.json: runtime dependencies must contain only root-catalog effect.",
      "packages/durable-task/package.json: optionalDependencies must be absent or empty.",
      'packages/durable-task/package.json: dependencies must not contain non-portable dependency "ioredis".',
      'packages/durable-task/package.json: devDependencies must not contain non-portable dependency "prisma".',
      'packages/durable-task/package.json: optionalDependencies must not contain non-portable dependency "cache".',
      "packages/durable-task/package.json: files must exactly match the admitted distribution list.",
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
});
