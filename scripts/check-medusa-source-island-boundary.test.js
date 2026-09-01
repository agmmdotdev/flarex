// @ts-check
import { describe, expect, it } from "vitest";
import { analyzeMedusaSourceIslandBoundary } from "./check-medusa-source-island-boundary.mjs";

const emptyInput = {
  rootManifests: [],
  rootSources: [],
  rootConfigs: [],
  rootSymlinks: [],
  rootToolSources: [],
  islandManifests: [],
  islandSources: [],
  islandConfigs: [],
  islandSymlinks: [],
  islandWorkspaceText: undefined,
  rootWorkspaceText: "packages:\n  - packages/*\n  - apps/*\n",
  rootScripts: {},
};

describe("Medusa source-island boundary checker", () => {
  it("accepts independent Flarex and Medusa graphs", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: { dependencies: { "flarex-protocol": "workspace:*" } },
      }],
      rootSources: [{
        relativePath: "packages/example/src/index.ts",
        text: 'export { value } from "flarex-protocol";',
      }],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: { dependencies: { "@medusajs/types": "workspace:*" } },
      }],
      islandSources: [{
        relativePath: "third_party/medusa/upstream/packages/example/src/index.ts",
        text: 'export { value } from "@medusajs/types";',
      }],
      rootScripts: {
        "medusa:install": "corepack pnpm@11.7.0 --dir third_party/medusa/upstream install",
      },
    }).errors).toEqual([]);
  });

  it("rejects Medusa packages and island paths in Flarex manifests", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          dependencies: { "@medusajs/types": "workspace:*" },
          devDependencies: {
            medusa: "file:../../third_party/medusa/upstream/packages/medusa",
          },
        },
      }],
    }).errors).toEqual([
      'packages/example/package.json: dependencies must not reference Medusa source-island dependency "@medusajs/types".',
      'packages/example/package.json: devDependencies must not use a path dependency into the Medusa source island "medusa".',
    ]);
  });

  it("rejects every static Flarex import form into Medusa", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootSources: [{
        relativePath: "apps/example/src/index.ts",
        text: `
          import { one } from "@medusajs/types";
          export type { Two } from "@medusajs/framework/types";
          type Three = import("@medusajs/utils").Three;
          import Four = require("@medusajs/modules-sdk");
          const five = require("@medusajs/dal");
          const six = require.resolve("@medusajs/dml");
          void import("../../../third_party/medusa/upstream/package.json");
        `,
      }],
    }).errors).toEqual([
      'apps/example/src/index.ts:2 must not import Medusa source-island module "@medusajs/types".',
      'apps/example/src/index.ts:3 must not import Medusa source-island module "@medusajs/framework/types".',
      'apps/example/src/index.ts:4 must not import Medusa source-island module "@medusajs/utils".',
      'apps/example/src/index.ts:5 must not import Medusa source-island module "@medusajs/modules-sdk".',
      'apps/example/src/index.ts:6 must not import Medusa source-island module "@medusajs/dal".',
      'apps/example/src/index.ts:7 must not import Medusa source-island module "@medusajs/dml".',
      'apps/example/src/index.ts:8 must not import Medusa source-island module "../../../third_party/medusa/upstream/package.json".',
    ]);
  });

  it("rejects Flarex dependencies and escaping paths in island manifests", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: {
          dependencies: { "@flarex/utils": "workspace:*" },
          devDependencies: { host: "file:../../../../../packages/executor" },
        },
      }],
    }).errors).toEqual([
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not reference Flarex dependency "@flarex/utils".',
      'third_party/medusa/upstream/packages/example/package.json: devDependencies must not use a path dependency outside the Medusa source island "host".',
    ]);
  });

  it("rejects Flarex and escaping imports from island source", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      islandSources: [{
        relativePath: "third_party/medusa/upstream/packages/example/src/index.ts",
        text: `
          import { one } from "@flarex/utils/records";
          export { two } from "flarex-protocol";
          void import("../../../../../packages/executor/src/index.ts");
        `,
      }],
    }).errors).toEqual([
      'third_party/medusa/upstream/packages/example/src/index.ts:2 must not import Flarex or escape the Medusa source island through "@flarex/utils/records".',
      'third_party/medusa/upstream/packages/example/src/index.ts:3 must not import Flarex or escape the Medusa source island through "flarex-protocol".',
      'third_party/medusa/upstream/packages/example/src/index.ts:4 must not import Flarex or escape the Medusa source island through "../../../../../packages/executor/src/index.ts".',
    ]);
  });

  it("rejects root-workspace membership and implicit root-script entry", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootWorkspaceText: "packages:\n  - packages/*\n  - third_party/medusa/upstream/packages/*\n",
      rootScripts: {
        test: "pnpm --dir third_party/medusa/upstream test",
        "medusa:test": "pnpm --dir third_party/medusa/upstream test",
      },
    }).errors).toEqual([
      "pnpm-workspace.yaml must not include the Medusa source island.",
      'package.json: non-Medusa script "test" must not enter the Medusa source island.',
    ]);
  });

  it("rejects package scripts and unsupported workspace declarations that can evade root recursion", () => {
    const packageScriptErrors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          name: "example",
          scripts: { build: "pnpm --dir ../../third_party/medusa/upstream build" },
        },
      }],
    }).errors;
    expect(packageScriptErrors).toContain(
      'packages/example/package.json: root-workspace script "build" must not enter the Medusa source island.',
    );

    for (const rootWorkspaceText of [
      'packages: ["packages/*", "apps/*", "third_party/medusa/upstream/*"]\n',
      "packages:\n  - packages/**\n  - apps/*\n",
    ]) {
      expect(analyzeMedusaSourceIslandBoundary({
        ...emptyInput,
        rootWorkspaceText,
      }).errors).toContain(
        "pnpm-workspace.yaml must not include the Medusa source island.",
      );
    }
  });

  it("rejects indirect Medusa command entry from ordinary root recursion", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootScripts: {
        test: "pnpm medusa:source:verify",
        "medusa:verify": "pnpm medusa:source:verify",
      },
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          scripts: {
            test: "pnpm --workspace-root medusa:test:workerd",
          },
        },
      }],
    }).errors).toEqual([
      'package.json: non-Medusa script "test" must not enter the Medusa source island.',
      'packages/example/package.json: root-workspace script "test" must not enter the Medusa source island.',
    ]);
  });

  it("rejects Medusa workspace scripts that enter Flarex", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/executor/package.json",
        manifest: { name: "@flarex/executor" },
      }],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: {
          scripts: {
            build: "node ../../../../../packages/executor/src/index.ts",
            test: "pnpm --filter @flarex/executor test",
          },
        },
      }],
    }).errors).toEqual([
      'third_party/medusa/upstream/packages/example/package.json: Medusa script "build" must not enter the Flarex root workspace.',
      'third_party/medusa/upstream/packages/example/package.json: Medusa script "test" must not enter the Flarex root workspace.',
    ]);
  });

  it("rejects inherited root aliases and root tooling entry", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootConfigs: [{
        relativePath: "tsconfig.base.json",
        text: '{"compilerOptions":{"paths":{"commerce":["./third_party/medusa/upstream/packages/medusa"]}}}',
      }],
      rootToolSources: [{
        relativePath: "scripts/run-tests.mjs",
        text: 'await import("../third_party/medusa/upstream/package.json");',
      }, {
        relativePath: "test-lanes.json",
        text: '{"steps":[{"args":["medusa:source:verify"]}]}',
      }],
      rootSymlinks: [{
        relativePath: "scripts/lib",
        target: "../third_party/medusa/upstream",
      }],
    }).errors).toEqual([
      "scripts/run-tests.mjs: root tooling must not enter the Medusa source island.",
      "test-lanes.json: root tooling must not enter the Medusa source island.",
      "tsconfig.base.json: configuration must not alias the Medusa source island.",
      "scripts/lib: symlink must not target the Medusa source island.",
    ]);
  });

  it("rejects package-manager resolver edges across the island boundary", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "package.json",
        manifest: {
          pnpm: {
            overrides: { commerce: "link:third_party/medusa/upstream/packages/medusa" },
            packageExtensions: {
              host: { dependencies: { "@medusajs/types": "workspace:*" } },
            },
          },
        },
      }],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/package.json",
        manifest: {
          resolutions: { host: "link:../../../packages/executor" },
        },
      }],
    }).errors).toEqual([
      "package.json: pnpm must not resolve Medusa or the Medusa source island.",
      "third_party/medusa/upstream/package.json: resolutions must not resolve Flarex or escape the Medusa source island.",
    ]);
  });

  it("rejects workspace-level resolver edges across both package graphs", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/flarex-dev/package.json",
        manifest: { name: "flarex-dev" },
      }],
      rootWorkspaceText: `${emptyInput.rootWorkspaceText}
catalog:
  commerce: link:third_party/medusa/upstream/packages/medusa
`,
      islandWorkspaceText: `packages:
  - packages/*
catalog:
  host: link:../../../packages/flarex-dev
`,
    }).errors).toEqual([
      "pnpm-workspace.yaml must not resolve Medusa or the Medusa source island.",
      "third_party/medusa/upstream/pnpm-workspace.yaml must not resolve Flarex or escape the Medusa source island.",
    ]);
  });

  it("rejects island workspace membership that escapes into Flarex", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      islandWorkspaceText: `packages:
  - packages/*
  - ../../../packages/*
`,
    }).errors).toEqual([
      "third_party/medusa/upstream/pnpm-workspace.yaml must not include paths outside the Medusa source island.",
    ]);
  });

  it("fails closed on unsupported workspace resolver YAML forms", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootWorkspaceText: `${emptyInput.rootWorkspaceText}
catalog: { commerce: "link:third_party/medusa/upstream/packages/medusa" }
`,
      islandWorkspaceText: `packages:
  - packages/*
catalog:
  host: &host link:../../../packages/executor
`,
    }).errors).toEqual([
      "pnpm-workspace.yaml must not resolve Medusa or the Medusa source island.",
      "third_party/medusa/upstream/pnpm-workspace.yaml must not resolve Flarex or escape the Medusa source island.",
    ]);
  });

  it("rejects workspace path dependencies, config aliases, bundler aliases, and symlinks into the island", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          devDependencies: {
            medusa: "workspace:../../third_party/medusa/upstream/packages/medusa",
          },
        },
      }],
      rootConfigs: [{
        relativePath: "packages/example/tsconfig.json",
        text: '{"compilerOptions":{"paths":{"medusa":["../../third_party/medusa/upstream"]}}}',
      }],
      rootSources: [{
        relativePath: "apps/example/vite.config.ts",
        text: 'const alias = "../../third_party/medusa/upstream/packages/medusa";',
      }],
      rootSymlinks: [{
        relativePath: "packages/example/medusa",
        target: "../../third_party/medusa/upstream",
      }],
    }).errors).toEqual([
      'packages/example/package.json: devDependencies must not use a path dependency into the Medusa source island "medusa".',
      "apps/example/vite.config.ts:1 must not alias the Medusa source island.",
      "packages/example/tsconfig.json: configuration must not alias the Medusa source island.",
      "packages/example/medusa: symlink must not target the Medusa source island.",
    ]);
  });

  it("rejects absolute dependency paths, absolute symlinks, and broad workspace membership", () => {
    const errors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootWorkspaceText: "packages:\n  - \"**\"\n",
      rootScripts: {
        build: "pnpm --dir THIRD_PARTY/MEDUSA/upstream build",
      },
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          dependencies: {
            medusa: "file:C:/repo/third_party/medusa/upstream/packages/medusa",
            medusaCaseVariant: "link:../../THIRD_PARTY/MEDUSA/upstream/packages/medusa",
          },
        },
      }],
      rootSymlinks: [
        {
          relativePath: "packages/example/medusa",
          target: "C:/repo/third_party/medusa/upstream",
        },
        {
          relativePath: "packages/example/medusa-case-variant",
          target: "../../THIRD_PARTY/MEDUSA/upstream",
        },
      ],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: { dependencies: { host: "link:C:/repo/packages/executor" } },
      }],
    }).errors;

    expect(errors).toContain("pnpm-workspace.yaml must not include the Medusa source island.");
    expect(errors).toContain(
      'package.json: non-Medusa script "build" must not enter the Medusa source island.',
    );
    expect(errors).toContain(
      'packages/example/package.json: dependencies must not use a path dependency into the Medusa source island "medusa".',
    );
    expect(errors).toContain(
      'packages/example/package.json: dependencies must not use a path dependency into the Medusa source island "medusaCaseVariant".',
    );
    expect(errors).toContain(
      "packages/example/medusa: symlink must not target the Medusa source island.",
    );
    expect(errors).toContain(
      "packages/example/medusa-case-variant: symlink must not target the Medusa source island.",
    );
    expect(errors).toContain(
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not use a path dependency outside the Medusa source island "host".',
    );
  });

  it("rejects module.require, triple-slash, and JSDoc references in both directions", () => {
    const errors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/flarex-dev/package.json",
        manifest: { name: "flarex-dev" },
      }],
      rootSources: [{
        relativePath: "packages/example/src/index.js",
        text: `/// <reference types="@medusajs/types" />
/** @type {import("@medusajs/utils").Thing} */
/** @import { Other } from "@medusajs/framework" */
module.require("@medusajs/dal");`,
      }],
      islandSources: [{
        relativePath: "third_party/medusa/upstream/packages/example/src/index.js",
        text: `/// <reference types="flarex-dev" />
/** @type {import("flarex-dev/runtime").Thing} */
module.require("flarex-dev");`,
      }],
    }).errors;

    expect(errors).toHaveLength(7);
    expect(errors).toEqual(expect.arrayContaining([
      'packages/example/src/index.js:1 must not import Medusa source-island module "@medusajs/types".',
      'packages/example/src/index.js:2 must not import Medusa source-island module "@medusajs/utils".',
      'packages/example/src/index.js:3 must not import Medusa source-island module "@medusajs/framework".',
      'packages/example/src/index.js:4 must not import Medusa source-island module "@medusajs/dal".',
      'third_party/medusa/upstream/packages/example/src/index.js:1 must not import Flarex or escape the Medusa source island through "flarex-dev".',
      'third_party/medusa/upstream/packages/example/src/index.js:2 must not import Flarex or escape the Medusa source island through "flarex-dev/runtime".',
      'third_party/medusa/upstream/packages/example/src/index.js:3 must not import Flarex or escape the Medusa source island through "flarex-dev".',
    ]));
  });

  it("derives root package names and rejects manifest, config, and symlink aliases", () => {
    const errors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [
        {
          relativePath: "packages/flarex-dev/package.json",
          manifest: { name: "flarex-dev" },
        },
        {
          relativePath: "packages/example/package.json",
          manifest: {
            imports: { "#medusa": "../../third_party/medusa/upstream/package.json" },
          },
        },
      ],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: {
          dependencies: {
            dev: "flarex-dev",
            devAlias: "npm:flarex-dev@0.0.0",
          },
          imports: { "#host": "../../../../../packages/flarex-dev/src/index.ts" },
        },
      }],
      islandConfigs: [{
        relativePath: "third_party/medusa/upstream/packages/example/tsconfig.json",
        text: '{"compilerOptions":{"paths":{"host":["../../../../../packages/flarex-dev/src"]}}}',
      }],
      islandSymlinks: [{
        relativePath: "third_party/medusa/upstream/packages/example/host",
        target: "../../../../../packages/flarex-dev",
      }],
    }).errors;

    expect(errors).toEqual(expect.arrayContaining([
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not reference Flarex dependency "dev".',
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not reference Flarex dependency "devAlias".',
      'packages/example/package.json: imports must not alias the Medusa source island through "../../third_party/medusa/upstream/package.json".',
      'third_party/medusa/upstream/packages/example/package.json: imports must not alias Flarex or escape the Medusa source island through "../../../../../packages/flarex-dev/src/index.ts".',
      "third_party/medusa/upstream/packages/example/tsconfig.json: configuration must not alias Flarex or escape the Medusa source island.",
      "third_party/medusa/upstream/packages/example/host: symlink must not escape the Medusa source island.",
    ]));
  });
});
