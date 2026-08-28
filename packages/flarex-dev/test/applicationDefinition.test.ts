import {
  produceApplicationSource,
  type ApplicationPreparationPolicy,
} from "@flarex/application-definition";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Result } from "effect";
import { SOURCE_MODULE_DIGEST_FORMAT_V1 } from "flarex/artifacts";
import {
  defineGlobalTable,
  definePartitionTable,
  defineProjection,
  defineSchema,
  mutation,
} from "flarex/server";
import { v } from "flarex/values";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  prepareApplicationFromSdk,
} from "../src/applicationDefinition.ts";
import {
  produceApplicationSourceFromSdk,
} from "../src/applicationSource.ts";
import {
  bundleSourcePackage,
  type SourcePackage,
} from "../src/sourcePackage.ts";

const FUNCTION_SOURCE =
  "export const place = 1; export const withoutReturn = 1;\n";
const FUNCTION_SOURCE_MAP = "{\"version\":3}\n";

const POLICY = Object.freeze({
  maximumModules: 8,
  maximumFunctions: 16,
  maximumIdentifierUtf8Bytes: 4_096,
  maximumValidatorNodes: 256,
  maximumValidatorDepth: 32,
  maximumValidatorStringUtf8Bytes: 4_096,
  maximumSourceBytes: 512_000,
  maximumSourceMapBytes: 2_000_000,
  maximumBytesMaterialized: 6_000_000,
  maximumSemanticRecords: 256,
  maximumSemanticRecordBytes: 16_000,
  maximumSemanticStreamBytes: 64_000,
}) satisfies ApplicationPreparationPolicy;

const placeOrder = mutation({
  args: { status: v.string() },
  returns: v.null(),
  handler: async () => null,
});

const withoutReturn = mutation({
  args: { status: v.string() },
  handler: async () => null,
});

const sdkSchema = defineSchema({
  orders: defineGlobalTable({
    status: v.string(),
  }).index("by_status", ["status"]),
});

describe("flarex-dev clean Application Definition producer", () => {
  it("prepares the exact SDK schema, functions, omitted return, and source", async () => {
    const prepared = await Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: {
        orders: { place: placeOrder, withoutReturn },
      },
      sourcePackage: prebuiltSourcePackage(),
    }, POLICY));
    const source = Result.getOrThrow(produceApplicationSource(prepared));

    expect(Object.keys(prepared)).toEqual(["application"]);
    expect(source.modules.map(module => module.path)).toEqual([
      "_flarex/application.js",
      "_flarex/schema.js",
      "orders.js",
    ]);
    const schemaSource = new TextDecoder().decode(
      source.modules.find(module =>
        module.path === "_flarex/schema.js"
      )?.sourceBytes,
    );
    expect(schemaSource).toContain(
      '"orders": definePartitionTable(v.object({ "status": v.string() }))',
    );
    expect(schemaSource).toContain('.index("by_status", ["status"])');
    const applicationSource = new TextDecoder().decode(
      source.modules.find(module =>
        module.path === "_flarex/application.js"
      )?.sourceBytes,
    );
    expect(applicationSource).toContain('"place": mutation({');
    expect(applicationSource).toContain("returns: v.null()");
    expect(applicationSource).toContain('"withoutReturn": mutation({');
    expect(applicationSource).not.toContain(
      '"withoutReturn": mutation({ args: v.object({ "status": v.string() }), returns:',
    );
    expect(new TextDecoder().decode(
      source.modules.find(module => module.path === "orders.js")?.sourceBytes,
    )).toBe(FUNCTION_SOURCE);
  });

  it("produces the generated analysis source deterministically", async () => {
    const input = {
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: prebuiltSourcePackage(),
    };
    const first = await Effect.runPromise(
      produceApplicationSourceFromSdk(input, POLICY),
    );
    const second = await Effect.runPromise(
      produceApplicationSourceFromSdk(input, POLICY),
    );

    expect(first).toEqual(second);
    expect(first.modules.map(module => module.path)).toEqual([
      "_flarex/application.js",
      "_flarex/schema.js",
      "orders.js",
    ]);
    expect(first.executionPath).toBe("_flarex/application.js");
    expect(first.schemaPath).toBe("_flarex/schema.js");
    expect(new TextDecoder().decode(
      first.modules.find(module => module.path === "orders.js")?.sourceBytes,
    )).toBe(FUNCTION_SOURCE);
    const execution = new TextDecoder().decode(
      first.modules.find(module =>
        module.path === "_flarex/application.js"
      )?.sourceBytes,
    );
    expect(execution).toContain('"place": mutation({');
    expect(execution).toContain('"withoutReturn": mutation({');
    expect(execution).not.toContain(
      '"withoutReturn": mutation({ args: v.object({ "status": v.string() }), returns:',
    );
  });

  it("rejects unsupported schema members before source inspection", async () => {
    let sourceRead = false;
    const sourcePackage = prebuiltSourcePackage();
    Object.defineProperty(sourcePackage, "modules", {
      get() {
        sourceRead = true;
        return [];
      },
    });

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: defineSchema({
        combined: defineProjection({ sources: ["orders"] }),
      }),
      executionModules: {},
      sourcePackage,
    }, POLICY))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "unsupportedSchemaMember",
      path: "schema.tables.combined",
    });
    expect(sourceRead).toBe(false);
  });

  it("rejects partitioned tables before function exporters run", async () => {
    let exporterInvoked = false;
    const functionWithThrowingExporter = {
      exportArgs() {
        exporterInvoked = true;
        throw new Error("function exporter must not run");
      },
    };

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: defineSchema({
        orders: definePartitionTable({ status: v.string() }),
      }),
      executionModules: {
        orders: { place: functionWithThrowingExporter },
      },
      sourcePackage: prebuiltSourcePackage(),
    }, POLICY))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "unsupportedTablePlacement",
    });
    expect(exporterInvoked).toBe(false);
  });

  it("rejects partitioned functions", async () => {
    const partitioned = Object.assign(mutation({
      args: { status: v.string() },
      handler: async () => null,
    }), {
      exportPartition: () => JSON.stringify({
        type: "partitionRoot",
        table: "orders",
        partitionField: "_id",
      }),
    });

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: partitioned } },
      sourcePackage: prebuiltSourcePackage(["place"]),
    }, POLICY))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "unsupportedFunctionPartition",
      path: "modules.orders.functions.place.partition",
    });
  });

  it("maps SDK schema accessor failures at the producer boundary", async () => {
    const nativeFailure = new Error("schema getter failed");
    const schemaDefinition = Object.defineProperty({}, "tables", {
      enumerable: true,
      get() {
        throw nativeFailure;
      },
    });

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition,
      executionModules: {},
      sourcePackage: prebuiltSourcePackage([]),
    }, POLICY))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "sdkInspectionFailed",
      path: "schema.tables",
      cause: nativeFailure,
    });
  });

  it("rejects auth before reading function-source containers", async () => {
    let modulesRead = false;
    const sourcePackage = prebuiltSourcePackage();
    sourcePackage.authConfigModule = "_flarex/auth.config.js";
    Object.defineProperty(sourcePackage, "modules", {
      get() {
        modulesRead = true;
        return [];
      },
    });

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage,
    }, POLICY))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "unsupportedAuthConfig",
      path: "sourcePackage.authConfigModule",
    });
    expect(modulesRead).toBe(false);
  });

  it("rejects duplicate and unexpected function paths", async () => {
    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: {
        ...prebuiltSourcePackage(),
        functions: ["orders.js", "orders.js"],
      },
    }, POLICY))).rejects.toMatchObject({
      reason: "duplicateFunctionPath",
      path: "sourcePackage.functions[1]",
    });

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: {
        ...prebuiltSourcePackage(),
        functions: ["orders.js", "extra.js"],
      },
    }, POLICY))).rejects.toMatchObject({
      reason: "unexpectedFunctionModule",
      path: "extra.js",
    });
  });

  it("rejects missing and duplicate selected source modules", async () => {
    const missing = prebuiltSourcePackage();
    missing.modules = missing.modules.filter(module =>
      module.path !== "orders.js"
    );
    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: missing,
    }, POLICY))).rejects.toMatchObject({
      reason: "missingFunctionModule",
      path: "orders.js",
    });

    const duplicate = prebuiltSourcePackage();
    const orders = duplicate.modules[0];
    if (orders === undefined) throw new Error("Missing fixture module.");
    duplicate.modules = [orders, { ...orders }, ...duplicate.modules.slice(1)];
    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: duplicate,
    }, POLICY))).rejects.toMatchObject({
      reason: "duplicateModulePath",
      path: "sourcePackage.modules[1].path",
    });
  });

  it("enforces producer source budgets before clean preparation", async () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: prebuiltSourcePackage(),
    }, {
      ...POLICY,
      maximumSourceBytes: 1,
    }))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "budgetExceeded",
      dimension: "sourceBytes",
      path: "sourcePackage.modules.orders.js.source",
    });
    expect(encode).not.toHaveBeenCalled();
  });

  it("admits policy before SDK or source inspection", async () => {
    let policyGetterInvoked = false;
    let sourceRead = false;
    const policy = Object.defineProperty({ ...POLICY }, "maximumSourceBytes", {
      enumerable: true,
      get() {
        policyGetterInvoked = true;
        return POLICY.maximumSourceBytes;
      },
    }) as ApplicationPreparationPolicy;
    const sourcePackage = prebuiltSourcePackage();
    Object.defineProperty(sourcePackage, "functions", {
      get() {
        sourceRead = true;
        return ["orders.js"];
      },
    });

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage,
    }, policy))).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      operation: "createBudget",
      reason: "invalidBudget",
    });
    expect(policyGetterInvoked).toBe(false);
    expect(sourceRead).toBe(false);
  });

  it("bounds the complete source-module container before traversal", async () => {
    const sourcePackage = prebuiltSourcePackage();
    sourcePackage.modules.push(...Array.from({ length: 8 }, (_, index) => ({
      path: `unused-${index}.js`,
      source: "export {};\n",
      environment: "isolate" as const,
      sha256: "3".repeat(64),
    })));

    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage,
    }, POLICY))).rejects.toMatchObject({
      _tag: "LoadedSdkApplicationDefinitionError",
      reason: "budgetExceeded",
      dimension: "modules",
      observed: 11,
      maximum: 10,
      path: "sourcePackage.modules",
    });
  });

  it("preserves canonical policy failures after producer inspection", async () => {
    await expect(Effect.runPromise(prepareApplicationFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder, withoutReturn } },
      sourcePackage: prebuiltSourcePackage(),
    }, {
      ...POLICY,
      maximumIdentifierUtf8Bytes: 1,
    }))).rejects.toMatchObject({
      _tag: "CanonicalDeclarativeProgramV1Error",
      reason: "budgetExceeded",
      dimension: "identifierUtf8Bytes",
    });
  });

  it("accepts the existing Vite bundle owner's normalized output", async () => {
    const appDir = await createPrebuildProject();
    const sourcePackage = await bundleSourcePackage({
      appDir,
      functionModules: [{
        moduleName: "orders",
        absolutePath: path.join(appDir, "functions/orders.ts"),
      }],
    });
    const source = await Effect.runPromise(produceApplicationSourceFromSdk({
      schemaDefinition: sdkSchema,
      executionModules: { orders: { place: placeOrder } },
      sourcePackage,
    }, POLICY));

    expect(source.modules.map(module => module.path)).toEqual([
      "_flarex/application.js",
      "_flarex/schema.js",
      "orders.js",
    ]);
    expect(sourcePackage.schema).toBe("_flarex/schema.js");
    expect(sourcePackage.execution).toBe("_flarex/execution.js");
  });
});

function prebuiltSourcePackage(
  exports: ReadonlyArray<string> = ["place", "withoutReturn"],
): SourcePackage {
  return {
    modules: [{
      path: "orders.js",
      source: exports.map(name => `export const ${name} = 1;`).join(" ") + "\n",
      sourceMap: FUNCTION_SOURCE_MAP,
      environment: "isolate",
      sha256: "0".repeat(64),
    }, {
      path: "_flarex/schema.js",
      source: "export default { tables: {} };\n",
      environment: "isolate",
      sha256: "1".repeat(64),
    }, {
      path: "_flarex/execution.js",
      source: "export default { orders: {} };\n",
      environment: "isolate",
      sha256: "2".repeat(64),
    }],
    functions: ["orders.js"],
    sourceModuleDigestFormat: SOURCE_MODULE_DIGEST_FORMAT_V1,
    schema: "_flarex/schema.js",
    execution: "_flarex/execution.js",
  };
}

async function createPrebuildProject(): Promise<string> {
  const appDir = await mkdtemp(path.join(tmpdir(), "flarex-application-"));
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
