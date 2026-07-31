// @ts-check
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
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
});
