import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  makeCanonicalDeclarativeProgramBudgetV1,
  makeCanonicalDeclarativeProgramFixtureV1,
} from "@flarex/declarative-program/v1";
import {
  makeDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
} from "@flarex/declarative-materializer/v1";
import { Result } from "effect";
import { describe, expect, test } from "vitest";

import {
  createDeclarativeV2SemanticStreamDecoderV1,
  makeDeclarativeV2SemanticStreamBudgetV1,
  type DeclarativeV2SemanticRecordV1,
} from "../src/declarativeV2SemanticRecordsV1";

const ITERATION_LIMIT = 10_000;

function fixture() {
  const programBudget = Result.getOrThrow(
    makeCanonicalDeclarativeProgramBudgetV1({
      maximumModules: 2,
      maximumFunctions: 2,
      maximumIdentifierUtf8Bytes: 4_096,
      maximumValidatorNodes: 256,
      maximumValidatorDepth: 32,
      maximumValidatorStringUtf8Bytes: 4_096,
    }),
  );
  const program = Result.getOrThrow(makeCanonicalDeclarativeProgramFixtureV1({
    format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
    version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
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
        argsValidator: { type: "any" },
        returnsValidator: null,
      }],
    }],
  }, programBudget));
  const materializationBudget = Result.getOrThrow(
    makeDeclarativeV2MaterializationBudgetV1({
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 1_024,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 32_000,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 8_000,
      maximumSemanticStreamBytes: 16_000,
    }),
  );
  return Result.getOrThrow(materializeDeclarativeV2ArtifactsV1(program, {
    modules: [
      {
        path: "orders.js",
        roles: ["function"],
        sourceBytes: new TextEncoder().encode("export const place = 1;"),
        sourceMapBytes: null,
      },
      {
        path: "_flarex/execution.js",
        roles: ["execution"],
        sourceBytes: new TextEncoder().encode("export const run = 1;"),
        sourceMapBytes: null,
      },
    ],
    functionEntries: [{
      logicalModulePath: "orders",
      artifactModulePath: "orders.js",
    }],
    executionPath: "_flarex/execution.js",
    schemaPath: null,
    authPath: null,
  }, materializationBudget));
}

function decodeSemantic(
  bytes: Uint8Array,
  recordCount: number,
  maximumLineBytes: number,
): ReadonlyArray<DeclarativeV2SemanticRecordV1> {
  const budget = Result.getOrThrow(makeDeclarativeV2SemanticStreamBudgetV1(
    bytes.byteLength,
    maximumLineBytes - 1,
    recordCount,
    bytes.byteLength - recordCount,
  ));
  const decoder = Result.getOrThrow(
    createDeclarativeV2SemanticStreamDecoderV1(budget),
  );
  const records: DeclarativeV2SemanticRecordV1[] = [];
  let offset = 0;
  let drained = false;
  for (let iteration = 0; iteration < ITERATION_LIMIT; iteration += 1) {
    const pushed = Result.getOrThrow(decoder.push(
      offset < bytes.byteLength ? bytes.subarray(offset) : new Uint8Array(),
      1_024,
    ));
    offset += pushed.consumedInputBytes;
    records.push(...pushed.records);
    if (
      offset >= bytes.byteLength &&
      pushed.mechanical.delta.transitions === 0
    ) {
      drained = true;
      break;
    }
  }
  if (!drained) throw new Error("materializer semantic stream did not drain");
  for (let iteration = 0; iteration < ITERATION_LIMIT; iteration += 1) {
    const finished = Result.getOrThrow(decoder.finish(1_024));
    records.push(...finished.records);
    if (finished.status === "complete") return Object.freeze(records);
  }
  throw new Error("materializer semantic stream did not finish");
}

describe("Declarative V2 materializer analyzer consumption", () => {
  test("accepts the inert orders:place semantic stream without adaptation", () => {
    const plan = fixture();
    const records = decodeSemantic(
      plan.semantic.bytes,
      plan.semantic.recordCount,
      plan.semantic.maximumRecordBytes,
    );
    expect(records.map((record) => record.kind)).toEqual([
      "header",
      "module",
      "module",
      "function",
      "schema",
      "table",
      "index",
      "validator",
      "validator",
      "handler",
    ]);
    expect(records.filter((record) => record.kind === "module")).toEqual([
      { kind: "module", modulePath: "_flarex/execution.js" },
      { kind: "module", modulePath: "orders.js" },
    ]);
    expect(records.find((record) => record.kind === "function")).toMatchObject({
      path: "orders:place",
      modulePath: "orders.js",
      partition: null,
    });
  });
});
