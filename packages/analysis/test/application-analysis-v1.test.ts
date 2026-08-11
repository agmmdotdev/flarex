import { describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { isJson } from "flarex-protocol/json";
import type { DeploymentAnalysis } from "../src/index.ts";
import {
  APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1,
  APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1,
  APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
  APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1,
  APPLICATION_MANIFEST_FORMAT_V1,
  ApplicationAnalysisRejectionCodeV1,
  ApplicationManifestV1Schema,
  canonicalizeApplicationAnalysisReceiptV1,
  canonicalizeApplicationManifestV1,
  makeApplicationManifestV1,
} from "@flarex/analysis/application-analysis";

const digest = (digit: string) => digit.repeat(64);

describe("Application Analysis V1 contracts", () => {
  it("lowers loaded registration analysis to one deterministic manifest", async () => {
    const analysis = applicationAnalysis();
    const source = {
      rootSha256: digest("1"),
      executionModulePath: "_flarex/execution.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [
        {
          path: "orders.js",
          roles: 1,
          sourceSha256: digest("3"),
          sourceByteLength: 24,
        },
        {
          path: "_flarex/execution.js",
          roles: 8,
          sourceSha256: digest("2"),
          sourceByteLength: 48,
        },
        {
          path: "_flarex/schema.js",
          roles: 2,
          sourceSha256: digest("4"),
          sourceByteLength: 32,
        },
      ],
    };

    const first = await Effect.runPromise(makeApplicationManifestV1(analysis, source));
    const second = await Effect.runPromise(makeApplicationManifestV1(analysis, {
      ...source,
      modules: [...source.modules].reverse(),
    }));

    expect(first.canonicalBytes).toEqual(second.canonicalBytes);
    expect(first.manifest.format).toBe(APPLICATION_MANIFEST_FORMAT_V1);
    expect(first.manifest.sourceArtifact.modules.map(module => module.path)).toEqual([
      "_flarex/execution.js",
      "_flarex/schema.js",
      "orders.js",
    ]);
    expect(first.manifest.functions).toEqual([{
      path: "orders:place",
      moduleName: "orders",
      exportName: "place",
      kind: "mutation",
      visibility: "public",
      args: { type: "any" },
      returns: null,
      partition: null,
    }]);
  });

  it("rejects duplicate source module paths before manifest encoding", async () => {
    const failure = await Effect.runPromise(Effect.flip(makeApplicationManifestV1(
      applicationAnalysis(),
      {
        rootSha256: digest("1"),
        executionModulePath: "_flarex/execution.js",
        schemaModulePath: null,
        modules: [
          moduleIdentity("_flarex/execution.js", "2"),
          moduleIdentity("_flarex/execution.js", "3"),
        ],
      },
    )));

    expect(failure).toMatchObject({
      _tag: "ApplicationAnalysisContractError",
      reason: "duplicateModulePath",
      path: "_flarex/execution.js",
    });
  });

  it("strictly decodes and snapshots canonical manifest input", () => {
    const input = manifestInput();
    const canonical = canonicalizeApplicationManifestV1(input);
    expect(Result.isSuccess(canonical)).toBe(true);
    if (Result.isFailure(canonical)) return;
    const callerOwnedModule = input.sourceArtifact.modules[0];
    if (callerOwnedModule === undefined) {
      throw new Error("Manifest fixture lost its execution module.");
    }
    callerOwnedModule.path = "changed.js";
    expect(canonical.success.manifest.sourceArtifact.modules[0]?.path).toBe(
      "_flarex/execution.js",
    );
    expect(Object.isFrozen(canonical.success.manifest.sourceArtifact.modules)).toBe(true);
    expect(canonical.success.canonicalText).toContain(
      '"format":"flarex.application-manifest"',
    );
    expect(canonicalizeApplicationManifestV1({
      ...manifestInput(),
      unexpected: true,
    })._tag).toBe("Failure");
  });

  it("preserves analyzer tuple order for named and default exports", async () => {
    const base = applicationAnalysis();
    const analysis: DeploymentAnalysis = {
      ...base,
      functions: [{
        moduleName: "orders",
        functions: [
          analyzedFunction("orders", "archive", "mutation"),
          analyzedFunction("orders", "default", "query"),
        ],
      }, {
        moduleName: "users",
        functions: [analyzedFunction("users", "default", "query")],
      }],
    };

    const result = await Effect.runPromise(makeApplicationManifestV1(
      analysis,
      sourceArtifactWithSchema(),
    ));

    expect(result.manifest.functions.map(fn => fn.path)).toEqual([
      "orders:archive",
      "orders",
      "users",
    ]);
    expect(result.manifest.functions.map(fn => [fn.moduleName, fn.exportName])).toEqual([
      ["orders", "archive"],
      ["orders", "default"],
      ["users", "default"],
    ]);
  });

  it("preserves the accepted deployment placement string contract", async () => {
    const base = applicationAnalysis();
    const analysis: DeploymentAnalysis = {
      ...base,
      schema: {
        ...base.schema,
        tables: base.schema.tables.map(table => ({
          ...table,
          placement: { kind: "partitionBy", field: "" },
        })),
      },
    };

    const result = await Effect.runPromise(makeApplicationManifestV1(
      analysis,
      sourceArtifactWithSchema(),
    ));
    expect(result.manifest.schema.tables[0]?.placement).toEqual({
      kind: "partitionBy",
      field: "",
    });
  });

  it("rejects ambiguous analyzer names instead of rebinding them", async () => {
    const base = applicationAnalysis();
    const analysis: DeploymentAnalysis = {
      ...base,
      functions: [{
        moduleName: "orders:admin",
        functions: [analyzedFunction("orders:admin", "default", "query")],
      }],
    };

    const failure = await Effect.runPromise(Effect.flip(
      makeApplicationManifestV1(analysis, sourceArtifactWithSchema()),
    ));

    expect(failure).toMatchObject({
      _tag: "ApplicationAnalysisContractError",
      operation: "lowerManifest",
      reason: "invalidAnalyzedFunction",
      path: "orders:admin",
    });

    const invalidSourceIdentity = await Effect.runPromise(Effect.flip(
      makeApplicationManifestV1(applicationAnalysis(), {
        ...sourceArtifactWithSchema(),
        rootSha256: "not-a-digest",
      }),
    ));
    expect(invalidSourceIdentity).toMatchObject({
      _tag: "ApplicationAnalysisContractError",
      operation: "lowerManifest",
      reason: "invalidInput",
    });
  });

  it("enforces Source Artifact module paths and unique runtime roles", () => {
    const validManifest = manifestInput();
    const invalidPath = {
      ...validManifest,
      sourceArtifact: {
        ...validManifest.sourceArtifact,
        executionModulePath: "../execution.js",
        modules: [{
          ...moduleIdentity("../execution.js", "2"),
          roles: 8,
        }],
      },
    };
    expect(canonicalizeApplicationManifestV1(invalidPath)).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalidSourceModulePath" },
    });

    const extraExecutionRole = {
      ...validManifest,
      sourceArtifact: {
        ...validManifest.sourceArtifact,
        modules: [
          ...validManifest.sourceArtifact.modules,
          { ...moduleIdentity("orders.js", "3"), roles: 9 },
        ],
      },
    };
    expect(canonicalizeApplicationManifestV1(extraExecutionRole)).toMatchObject({
      _tag: "Failure",
      failure: { reason: "invalidExecutionModuleRole", path: "orders.js" },
    });
  });

  it("rejects dangling indexes and invalid colocation chains", () => {
    const validManifest = manifestInput();
    const sourceArtifact = sourceArtifactWithSchema();
    const danglingIndex = {
      ...validManifest,
      sourceArtifact,
      schema: {
        ...validManifest.schema,
        indexes: [{
          indexId: 1,
          tableId: 99,
          name: "by_status",
          fields: ["status"],
        }],
      },
    };
    expect(canonicalizeApplicationManifestV1(danglingIndex)).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "invalidSchemaRelationship",
        path: "schema.indexes[0]",
      },
    });

    const invalidColocation = {
      ...validManifest,
      sourceArtifact,
      schema: {
        ...validManifest.schema,
        tables: [{
          tableId: 1,
          name: "orders",
          validator: { type: "any" },
          placement: {
            kind: "colocateWith",
            table: "missing",
            field: "ownerId",
          },
        }],
      },
    };
    expect(canonicalizeApplicationManifestV1(invalidColocation)).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "invalidSchemaRelationship",
        path: "schema.tables[0].placement",
      },
    });
  });

  it("keeps the public Schema and named decoder semantic boundary aligned", () => {
    const validManifest = manifestInput();
    const duplicateModules = {
      ...validManifest,
      sourceArtifact: {
        ...validManifest.sourceArtifact,
        modules: [
          ...validManifest.sourceArtifact.modules,
          moduleIdentity("_flarex/execution.js", "3"),
        ],
      },
    };
    expect(Result.isFailure(Schema.decodeUnknownResult(
      ApplicationManifestV1Schema,
    )(duplicateModules))).toBe(true);
    expect(canonicalizeApplicationManifestV1(duplicateModules)).toMatchObject({
      _tag: "Failure",
      failure: { reason: "duplicateModulePath" },
    });
  });

  it("applies the protocol validator admission limits before encoding", () => {
    let validator: unknown = { type: "any" };
    for (let depth = 0; depth < 2_048; depth += 1) {
      validator = { type: "array", value: validator };
    }
    const input = manifestWithTableValidator(validator);

    expect(canonicalizeApplicationManifestV1(input)).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "validatorLimitExceeded",
        path: "schema.tables[0].validator",
      },
    });
    expect(Result.isFailure(Schema.decodeUnknownResult(
      ApplicationManifestV1Schema,
    )(input))).toBe(true);

    const cyclicValidator: { type: "array"; value?: unknown } = {
      type: "array",
    };
    cyclicValidator.value = cyclicValidator;
    const cyclicInput = manifestWithTableValidator(cyclicValidator);
    expect(canonicalizeApplicationManifestV1(cyclicInput)).toMatchObject({
      _tag: "Failure",
      failure: { reason: "validatorLimitExceeded" },
    });
    expect(Result.isFailure(Schema.decodeUnknownResult(
      ApplicationManifestV1Schema,
    )(cyclicInput))).toBe(true);
  });

  it("returns the same owned plain JSON representation from public decoders", () => {
    const input = manifestWithTableValidator({ type: "any" });
    const schemaDecoded = Schema.decodeUnknownResult(
      ApplicationManifestV1Schema,
    )(input);
    const namedDecoded = canonicalizeApplicationManifestV1(input);
    expect(Result.isSuccess(schemaDecoded)).toBe(true);
    expect(Result.isSuccess(namedDecoded)).toBe(true);
    if (Result.isFailure(schemaDecoded) || Result.isFailure(namedDecoded)) return;
    const schemaPlacement = schemaDecoded.success.schema.tables[0]?.placement;
    const namedPlacement = namedDecoded.success.manifest.schema.tables[0]?.placement;
    expect(Object.getPrototypeOf(schemaPlacement)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(namedPlacement)).toBe(Object.prototype);
    expect(Object.isFrozen(schemaDecoded.success)).toBe(true);
    expect(Object.isFrozen(schemaPlacement)).toBe(true);
    expect(isJson(schemaDecoded.success)).toBe(true);
    expect(schemaDecoded.success).toEqual(namedDecoded.success.manifest);
  });

  it("reports every admitted collection and source-byte ceiling as a limit", () => {
    const base = manifestInput();
    const functionEntry = {
      path: "orders:place",
      moduleName: "orders",
      exportName: "place",
      kind: "mutation",
      visibility: "public",
      args: { type: "any" },
      returns: null,
      partition: null,
    } as const;
    const tableEntry = {
      tableId: 1,
      name: "orders",
      validator: { type: "any" },
      placement: { kind: "global" },
    } as const;
    const indexEntry = {
      indexId: 1,
      tableId: 1,
      name: "by_status",
      fields: ["status"],
    } as const;
    const cases = [
      {
        input: {
          ...base,
          sourceArtifact: {
            ...base.sourceArtifact,
            executionModulePath: "module-000.js",
            modules: Array.from(
              { length: APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1 + 1 },
              (_, index) => ({
                ...moduleIdentity(`module-${String(index).padStart(3, "0")}.js`, "2"),
                roles: index === 0 ? 8 : 1,
              }),
            ),
          },
        },
        path: "sourceArtifact.modules",
        observed: APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1 + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_MODULES_V1,
      },
      {
        input: {
          ...base,
          sourceArtifact: {
            ...base.sourceArtifact,
            modules: [{
              ...moduleIdentity("_flarex/execution.js", "2"),
              sourceByteLength: APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1 + 1,
            }],
          },
        },
        path: "sourceArtifact.modules[0].sourceByteLength",
        observed: APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1 + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_MODULE_BYTES_V1,
      },
      {
        input: {
          ...base,
          sourceArtifact: {
            ...base.sourceArtifact,
            modules: [
              {
                ...moduleIdentity("_flarex/execution.js", "2"),
                sourceByteLength: 1_000_001,
              },
              {
                ...moduleIdentity("orders.js", "3"),
                roles: 1,
                sourceByteLength: 1_000_000,
              },
            ],
          },
        },
        path: "sourceArtifact.modules",
        observed: APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1 + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_SOURCE_BYTES_V1,
      },
      {
        input: {
          ...base,
          functions: Array.from(
            { length: APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1 + 1 },
            () => functionEntry,
          ),
        },
        path: "functions",
        observed: APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1 + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_FUNCTIONS_V1,
      },
      {
        input: {
          ...base,
          sourceArtifact: sourceArtifactWithSchema(),
          schema: {
            version: 1,
            tables: Array.from(
              { length: APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1 + 1 },
              () => tableEntry,
            ),
            indexes: [],
          },
        },
        path: "schema.tables",
        observed: APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1 + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_TABLES_V1,
      },
      {
        input: {
          ...base,
          sourceArtifact: sourceArtifactWithSchema(),
          schema: {
            version: 1,
            tables: [tableEntry],
            indexes: Array.from(
              { length: APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1 + 1 },
              () => indexEntry,
            ),
          },
        },
        path: "schema.indexes",
        observed: APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1 + 1,
        maximum: APPLICATION_ANALYSIS_MAXIMUM_INDEXES_V1,
      },
    ];

    for (const entry of cases) {
      expect(canonicalizeApplicationManifestV1(entry.input)).toMatchObject({
        _tag: "Failure",
        failure: {
          reason: "limitExceeded",
          path: entry.path,
          observed: entry.observed,
          maximum: entry.maximum,
        },
      });
    }

    expect(canonicalizeApplicationAnalysisReceiptV1({
      ...receiptInput(),
      detail: "x".repeat(
        APPLICATION_ANALYSIS_MAXIMUM_REJECTION_DETAIL_BYTES_V1 + 1,
      ),
    })).toMatchObject({
      _tag: "Failure",
      failure: {
        reason: "limitExceeded",
        path: "detail",
      },
    });
  });

  it("canonicalizes analyzed and rejected receipts as distinct terminal shapes", () => {
    const common = {
      format: APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1,
      version: 1,
      analysisId: "analysis_1",
      candidateId: "candidate_1",
      scopeId: "scope_1",
      sourceArtifactRootSha256: digest("1"),
      analyzerIdentity: "application-analysis-build-1",
      analyzerPolicyIdentity: "application-analysis-policy-1",
      completedAt: "2026-08-11T00:00:00.000Z",
    } as const;
    const analyzed = canonicalizeApplicationAnalysisReceiptV1({
      ...common,
      status: "analyzed",
      manifestSha256: digest("2"),
    });
    const rejected = canonicalizeApplicationAnalysisReceiptV1({
      ...common,
      status: "rejected",
      failureCode: ApplicationAnalysisRejectionCodeV1.invalidRegistration,
      detail: "Registered export metadata is invalid.",
    });
    expect(Result.isSuccess(analyzed)).toBe(true);
    expect(Result.isSuccess(rejected)).toBe(true);
    expect(analyzed).not.toEqual(rejected);
    expect(canonicalizeApplicationAnalysisReceiptV1({
      ...common,
      status: "rejected",
      failureCode: "unknown_failure",
      detail: "Unknown failures are not a durable rejection code.",
    })._tag).toBe("Failure");
  });
});

function applicationAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "orders",
        validator: { type: "any" },
        placement: { kind: "global" },
      }],
      indexes: [],
    },
    functions: [{
      moduleName: "orders",
      functions: [{
        moduleName: "orders",
        exportName: "place",
        kind: "mutation",
        visibility: "public",
        args: { type: "any" },
        returns: null,
        partition: null,
      }],
    }],
  };
}

function analyzedFunction(
  moduleName: string,
  exportName: string,
  kind: "query" | "mutation",
): DeploymentAnalysis["functions"][number]["functions"][number] {
  return {
    moduleName,
    exportName,
    kind,
    visibility: "public",
    args: { type: "any" },
    returns: null,
    partition: null,
  };
}

function sourceArtifactWithSchema() {
  return {
    rootSha256: digest("1"),
    executionModulePath: "_flarex/execution.js",
    schemaModulePath: "_flarex/schema.js",
    modules: [
      moduleIdentity("_flarex/execution.js", "2"),
      {
        ...moduleIdentity("_flarex/schema.js", "3"),
        roles: 2,
      },
    ],
  };
}

function manifestWithTableValidator(validator: unknown) {
  const validManifest = manifestInput();
  return {
    ...validManifest,
    sourceArtifact: sourceArtifactWithSchema(),
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "orders",
        validator,
        placement: { kind: "global" },
      }],
      indexes: [],
    },
  };
}

function receiptInput() {
  return {
    format: APPLICATION_ANALYSIS_RECEIPT_FORMAT_V1,
    version: 1,
    analysisId: "analysis_1",
    candidateId: "candidate_1",
    scopeId: "scope_1",
    sourceArtifactRootSha256: digest("1"),
    analyzerIdentity: "application-analysis-build-1",
    analyzerPolicyIdentity: "application-analysis-policy-1",
    completedAt: "2026-08-11T00:00:00.000Z",
    status: "rejected",
    failureCode: ApplicationAnalysisRejectionCodeV1.limitExceeded,
    detail: "Limit exceeded.",
  } as const;
}

function moduleIdentity(path: string, digit: string) {
  return {
    path,
    roles: 8,
    sourceSha256: digest(digit),
    sourceByteLength: 48,
  };
}

function manifestInput() {
  return {
    format: APPLICATION_MANIFEST_FORMAT_V1,
    version: 1,
    sourceArtifact: {
      rootSha256: digest("1"),
      executionModulePath: "_flarex/execution.js",
      schemaModulePath: null,
      modules: [moduleIdentity("_flarex/execution.js", "2")],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  };
}
