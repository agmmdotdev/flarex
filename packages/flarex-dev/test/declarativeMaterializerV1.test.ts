import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  decodeCanonicalDeclarativeProgramV1,
  makeCanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramInputV1,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
  type DeclarativeV2MaterializationBudgetInputV1,
  type DeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Result } from "effect";
import { SOURCE_MODULE_DIGEST_FORMAT_V1 } from "flarex/artifacts";
import {
  defineGlobalTable,
  defineSchema,
  mutation,
} from "flarex/server";
import { v } from "flarex/values";
import { describe, expect, it, onTestFinished } from "vitest";

import { materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect } from "flarex-dev/internal/declarative-materializer-v1";
import { bundleSourcePackage } from "../src/sourcePackage.ts";
import type { SourcePackage } from "../src/sourcePackage.ts";

const UTF8_ENCODER = new TextEncoder();
const FUNCTION_SOURCE = "export const place = 1;\n";
const FUNCTION_SOURCE_MAP = "{\"version\":3}\n";
const EXECUTION_SOURCE = "export default { orders: {} };\n";
const SCHEMA_SOURCE = "export default { tables: {} };\n";

const PROGRAM_BUDGET = Result.getOrThrow(
  makeCanonicalDeclarativeProgramBudgetV1({
    maximumModules: 4,
    maximumFunctions: 4,
    maximumIdentifierUtf8Bytes: 4_096,
    maximumValidatorNodes: 256,
    maximumValidatorDepth: 32,
    maximumValidatorStringUtf8Bytes: 4_096,
  }),
);

const MATERIALIZATION_BUDGET_INPUT = {
  maximumModules: 4,
  maximumEntryBindings: 4,
  maximumSourceBytes: 4_096,
  maximumSourceMapBytes: 4_096,
  maximumBytesMaterialized: 64_000,
  maximumSemanticRecords: 64,
  maximumSemanticRecordBytes: 16_000,
  maximumSemanticStreamBytes: 32_000,
} satisfies DeclarativeV2MaterializationBudgetInputV1;

const MATERIALIZATION_BUDGET = Result.getOrThrow(
  makeDeclarativeV2MaterializationBudgetV1(
    MATERIALIZATION_BUDGET_INPUT,
  ),
);

const VITE_MATERIALIZATION_BUDGET = Result.getOrThrow(
  makeDeclarativeV2MaterializationBudgetV1({
    ...MATERIALIZATION_BUDGET_INPUT,
    maximumSourceBytes: 512_000,
    maximumSourceMapBytes: 2_000_000,
    maximumBytesMaterialized: 6_000_000,
  }),
);

const placeOrder = mutation({
  args: { status: v.string() },
  returns: v.null(),
  handler: async () => null,
});

const sdkSchema = defineSchema({
  orders: defineGlobalTable({
    status: v.string(),
  }).index("by_status", ["status"]),
});

describe("Declarative V2 flarex-dev prebuild adapter", () => {
  it("matches the direct fixture byte-for-byte without invoking Vite", async () => {
    const sourcePackage = prebuiltSourcePackage();
    const fromSdkPrebuild = await Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    );
    const directProgram = Result.getOrThrow(
      decodeCanonicalDeclarativeProgramV1(
        directProgramInput(),
        PROGRAM_BUDGET,
      ),
    );
    const fromDirectFixture = Result.getOrThrow(
      materializeDeclarativeV2ArtifactsV1(
        directProgram,
        directGraphInput(),
        MATERIALIZATION_BUDGET,
      ),
    );

    expect(fromSdkPrebuild).toEqual(fromDirectFixture);
    expect(fromSdkPrebuild.source.modules.map((module) => module.path)).toEqual([
      "_flarex/execution.js",
      "orders.js",
    ]);
    expect(fromSdkPrebuild.source.schemaPath).toBeNull();
    expect(fromSdkPrebuild.source.authPath).toBeNull();

    const repeated = await Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage: prebuiltSourcePackage(),
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    );
    expect(repeated).toEqual(fromSdkPrebuild);
  });

  it("preserves materializer failures for inconsistent prebuilt entries", async () => {
    const sourcePackage = {
      ...prebuiltSourcePackage(),
      functions: ["missing.js"],
    } satisfies SourcePackage;

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2MaterializationV1Error",
      reason: "missingArtifactModule",
      path: "orders.js",
    });
  });

  it("rejects duplicate function paths before graph construction", async () => {
    const sourcePackage = {
      ...prebuiltSourcePackage(),
      functions: ["orders.js", "orders.js"],
    } satisfies SourcePackage;

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2LoadedSdkPrebuildAdapterError",
      reason: "duplicateFunctionPath",
      path: "sourcePackage.functions[1]",
    });
  });

  it("enforces module admission before reading module source", async () => {
    let sourceRead = false;
    const fixture = prebuiltSourcePackage();
    const unreadModule = Object.defineProperty(
      { ...fixture.modules[0]! },
      "source",
      {
        enumerable: true,
        get() {
          sourceRead = true;
          throw new Error("must not read source");
        },
      },
    );
    const sourcePackage = {
      ...fixture,
      modules: [unreadModule, ...fixture.modules.slice(1)],
    } satisfies SourcePackage;

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, materializationBudget({ maximumModules: 1 })),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2LoadedSdkPrebuildAdapterError",
      reason: "budgetExceeded",
      dimension: "prebuiltModules",
      path: "sourcePackage.modules",
    });
    expect(sourceRead).toBe(false);
  });

  it("authenticates the opaque budget before reading budget or source fields", async () => {
    let budgetRead = false;
    let sourceRead = false;
    const fixture = prebuiltSourcePackage();
    const unreadModule = Object.defineProperty(
      { ...fixture.modules[0]! },
      "source",
      {
        enumerable: true,
        get() {
          sourceRead = true;
          throw new Error("must not read source");
        },
      },
    );
    const forgedBudget: DeclarativeV2MaterializationBudgetV1 =
      Object.create(MATERIALIZATION_BUDGET, {
        maximumModules: {
          enumerable: true,
          get() {
            budgetRead = true;
            throw new Error("must not read forged budget");
          },
        },
      });

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage: {
          ...fixture,
          modules: [unreadModule, ...fixture.modules.slice(1)],
        },
      }, PROGRAM_BUDGET, forgedBudget),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2MaterializationV1Error",
      operation: "materialize",
      reason: "invalidBudget",
    });
    expect(budgetRead).toBe(false);
    expect(sourceRead).toBe(false);
  });

  it.each([
    {
      label: "function",
      sourcePackage: {
        ...prebuiltSourcePackage(),
        functions: new Array<string>(1),
      } satisfies SourcePackage,
      path: "sourcePackage.functions[0]",
    },
    {
      label: "module",
      sourcePackage: {
        ...prebuiltSourcePackage(),
        modules: new Array<SourcePackage["modules"][number]>(1),
      } satisfies SourcePackage,
      path: "sourcePackage.modules[0]",
    },
  ])("rejects a sparse $label array in the typed adapter channel", async ({
    sourcePackage,
    path,
  }) => {
    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2LoadedSdkPrebuildAdapterError",
      reason: "invalidSourcePackage",
      path,
    });
  });

  it("rejects an accessor-backed module path without invoking it", async () => {
    let pathRead = false;
    let sourceRead = false;
    const fixture = prebuiltSourcePackage();
    const accessorModule = Object.defineProperties(
      { ...fixture.modules[0]! },
      {
        path: {
          enumerable: true,
          get() {
            pathRead = true;
            throw new Error("must not invoke path");
          },
        },
        source: {
          enumerable: true,
          get() {
            sourceRead = true;
            throw new Error("must not invoke source");
          },
        },
      },
    );

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage: {
          ...fixture,
          modules: [accessorModule, ...fixture.modules.slice(1)],
        },
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2LoadedSdkPrebuildAdapterError",
      reason: "invalidSourcePackage",
      path: "sourcePackage.modules[0].path",
    });
    expect(pathRead).toBe(false);
    expect(sourceRead).toBe(false);
  });

  it("stops text preflight before reading a later module", async () => {
    let laterSourceRead = false;
    const fixture = prebuiltSourcePackage();
    const unreadExecution = Object.defineProperty(
      { ...fixture.modules[2]! },
      "source",
      {
        enumerable: true,
        get() {
          laterSourceRead = true;
          throw new Error("must not read later source");
        },
      },
    );
    const sourcePackage = {
      ...fixture,
      modules: [
        { ...fixture.modules[0]!, source: "too large" },
        fixture.modules[1]!,
        unreadExecution,
      ],
    } satisfies SourcePackage;

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, materializationBudget({
        maximumSourceBytes: 1,
      })),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2LoadedSdkPrebuildAdapterError",
      reason: "budgetExceeded",
      dimension: "sourceBytes",
      path: "sourcePackage.modules[0].source",
    });
    expect(laterSourceRead).toBe(false);
  });

  it("accepts the existing Vite build owner's normalized output", async () => {
    const appDir = await createPrebuildProject();
    const functionPath = path.join(appDir, "functions/orders.ts");
    const sourcePackage = await bundleSourcePackage({
      appDir,
      functionModules: [{
        moduleName: "orders",
        absolutePath: functionPath,
      }],
    });

    const plan = await Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, VITE_MATERIALIZATION_BUDGET),
    );

    expect(plan.source.modules.map((module) => module.path)).toEqual([
      "_flarex/execution.js",
      "orders.js",
    ]);
    expect(sourcePackage.schema).toBe("_flarex/schema.js");
    expect(plan.source.schemaPath).toBeNull();
  });

  it("rejects auth prebuilds until the auth role contract is approved", async () => {
    const sourcePackage = {
      ...prebuiltSourcePackage(),
      authConfigModule: "_flarex/auth.config.js",
    } satisfies SourcePackage;

    await expect(Effect.runPromise(
      materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect({
        sdkDefinition: {
          schemaDefinition: sdkSchema,
          executionModules: {
            orders: { place: placeOrder },
          },
        },
        sourcePackage,
      }, PROGRAM_BUDGET, MATERIALIZATION_BUDGET),
    )).rejects.toMatchObject({
      _tag: "DeclarativeV2LoadedSdkPrebuildAdapterError",
      reason: "unsupportedAuthConfig",
      path: "sourcePackage.authConfigModule",
    });
  });
});

function prebuiltSourcePackage(): SourcePackage {
  return {
    modules: [
      {
        path: "orders.js",
        source: FUNCTION_SOURCE,
        sourceMap: FUNCTION_SOURCE_MAP,
        environment: "isolate",
        sha256: "0".repeat(64),
      },
      {
        path: "_flarex/schema.js",
        source: SCHEMA_SOURCE,
        environment: "isolate",
        sha256: "1".repeat(64),
      },
      {
        path: "_flarex/execution.js",
        source: EXECUTION_SOURCE,
        environment: "isolate",
        sha256: "2".repeat(64),
      },
    ],
    functions: ["orders.js"],
    sourceModuleDigestFormat: SOURCE_MODULE_DIGEST_FORMAT_V1,
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}

function directGraphInput(): DeclarativeV2PrebuiltModuleGraphInputV1 {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        roles: ["execution"],
        sourceBytes: UTF8_ENCODER.encode(EXECUTION_SOURCE),
        sourceMapBytes: null,
      },
      {
        path: "orders.js",
        roles: ["function"],
        sourceBytes: UTF8_ENCODER.encode(FUNCTION_SOURCE),
        sourceMapBytes: UTF8_ENCODER.encode(FUNCTION_SOURCE_MAP),
      },
    ],
    functionEntries: [{
      logicalModulePath: "orders",
      artifactModulePath: "orders.js",
    }],
    executionPath: "_flarex/execution.js",
    schemaPath: null,
    authPath: null,
  };
}

function directProgramInput(): CanonicalDeclarativeProgramInputV1 {
  return {
    format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
    version: 1,
    schema: {
      tables: [{
        logicalName: "orders",
        definition: {
          kind: "appDocument",
          definitionVersion: 1,
          documentType: {
            type: "object",
            value: {
              status: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
        },
      }],
      indexes: [{
        tableLogicalName: "orders",
        descriptor: "by_status",
        fields: ["status"],
      }],
    },
    modules: [{
      modulePath: "orders",
      functions: [{
        exportName: "place",
        kind: "mutation",
        visibility: "public",
        argsValidator: {
          type: "object",
          value: {
            status: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        returnsValidator: { type: "null" },
      }],
    }],
  };
}

async function createPrebuildProject(): Promise<string> {
  const appDir = await mkdtemp(path.join(tmpdir(), "flarex-declarative-v2-"));
  onTestFinished(() => rm(appDir, { recursive: true, force: true }));
  await mkdir(path.join(appDir, "functions"), { recursive: true });
  await writeFile(
    path.join(appDir, "schema.ts"),
    `import { defineGlobalTable, defineSchema } from "flarex/server";
import { v } from "flarex/values";
export default defineSchema({
  orders: defineGlobalTable({ status: v.string() }).index("by_status", ["status"]),
});
`,
  );
  await writeFile(
    path.join(appDir, "functions/orders.ts"),
    `import { mutation } from "flarex/server";
import { v } from "flarex/values";
export const place = mutation({
  args: { status: v.string() },
  returns: v.null(),
  handler: async () => null,
});
`,
  );
  return appDir;
}

function materializationBudget(
  overrides: Partial<DeclarativeV2MaterializationBudgetInputV1>,
) {
  return Result.getOrThrow(makeDeclarativeV2MaterializationBudgetV1({
    ...MATERIALIZATION_BUDGET_INPUT,
    ...overrides,
  }));
}
