import {
  CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
  CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
  type CanonicalDeclarativeProgramInputV1,
} from "@flarex/declarative-program/v1";
import type {
  DeclarativeV2PrebuiltModuleGraphInputV1,
} from "@flarex/declarative-materializer/v1";
import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
  type StandardApplicationDefinitionInputV1,
} from "@flarex/standard-application-definition/v1";
import { Cause, Data, Effect, Exit, Fiber, Result, Scope } from "effect";
import type {
  DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, it } from "vitest";

import {
  analyzeStandardApplicationV1,
  type AuthenticatedVerifiedStandardApplicationAnalysisV1,
  type StandardApplicationAnalysisContextV1,
} from "../src/v1";

const UTF8 = new TextEncoder();

class TestStandardApplicationAnalysisFailure extends Data.TaggedError(
  "TestStandardApplicationAnalysisFailure",
)<{
  readonly reason: "rejected";
}> {}

describe("Standard Application analysis V1", () => {
  it("returns the accepted owner result by identity", async () => {
    const prepared = preparedDefinition();
    const result = authenticatedAnalysis(1);
    let observed:
      | PreparedStandardApplicationDefinitionV1
      | undefined;
    const context = Object.freeze({
      analyze: Effect.fn("TestStandardApplicationAnalysis.success")(
        function* (input: PreparedStandardApplicationDefinitionV1) {
          observed = input;
          return result;
        },
      ),
    }) satisfies StandardApplicationAnalysisContextV1<never>;

    const analyzed = await Effect.runPromise(
      analyzeStandardApplicationV1(prepared, context),
    );

    expect(observed).toBe(prepared);
    expect(analyzed).toBe(result);
  });

  it("preserves typed failures without Standard wrapping", async () => {
    const failure = new TestStandardApplicationAnalysisFailure({
      reason: "rejected",
    });
    const context = Object.freeze({
      analyze() {
        return Effect.fail(failure);
      },
    }) satisfies StandardApplicationAnalysisContextV1<
      TestStandardApplicationAnalysisFailure
    >;

    const exit = await Effect.runPromiseExit(
      analyzeStandardApplicationV1(preparedDefinition(), context),
    );

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected Standard analysis to fail.");
    }
    expect(Cause.findErrorOption(exit.cause)).toMatchObject({
      _tag: "Some",
      value: {
        _tag: "TestStandardApplicationAnalysisFailure",
        reason: "rejected",
      },
    });
  });

  it("preserves trusted defects in the full Cause", async () => {
    const defect = new Error("trusted analyzer defect");
    const context = Object.freeze({
      analyze() {
        return Effect.die(defect);
      },
    }) satisfies StandardApplicationAnalysisContextV1<never>;

    const exit = await Effect.runPromiseExit(
      analyzeStandardApplicationV1(preparedDefinition(), context),
    );

    if (!Exit.isFailure(exit)) {
      throw new Error("Expected Standard analysis to preserve the defect.");
    }
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);
  });

  it("retains request Scope and releases interrupted analysis", async () => {
    let released = false;
    const context = Object.freeze({
      analyze: Effect.fn("TestStandardApplicationAnalysis.scoped")(
        function* (_input: PreparedStandardApplicationDefinitionV1) {
          yield* Effect.acquireRelease(
            Effect.void,
            () =>
              Effect.sync(() => {
                released = true;
              }),
          );
          return yield* Effect.never;
        },
      ),
    }) satisfies StandardApplicationAnalysisContextV1<never, Scope.Scope>;

    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fiber = yield* analyzeStandardApplicationV1(
        preparedDefinition(),
        context,
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
    })));

    expect(released).toBe(true);
  });

  it("keeps independently prepared inputs deterministic", async () => {
    const firstPrepared = preparedDefinition();
    const secondPrepared = preparedDefinition();
    const firstResult = authenticatedAnalysis(2);
    const secondResult = authenticatedAnalysis(2);
    const firstContext = contextFor(firstResult);
    const secondContext = contextFor(secondResult);

    const [firstAnalysis, secondAnalysis] = await Promise.all([
      Effect.runPromise(analyzeStandardApplicationV1(
        firstPrepared,
        firstContext,
      )),
      Effect.runPromise(analyzeStandardApplicationV1(
        secondPrepared,
        secondContext,
      )),
    ]);

    expect(firstPrepared).not.toBe(secondPrepared);
    expect(firstAnalysis).not.toBe(secondAnalysis);
    expect(firstAnalysis).toEqual(secondAnalysis);
  });
});

function contextFor(
  result: AuthenticatedVerifiedStandardApplicationAnalysisV1,
): StandardApplicationAnalysisContextV1<never> {
  return Object.freeze({
    analyze() {
      return Effect.succeed(result);
    },
  });
}

function preparedDefinition(): PreparedStandardApplicationDefinitionV1 {
  const input = {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 256,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 256,
    },
    programInput: {
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
      schema: { tables: [], indexes: [] },
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
    } satisfies CanonicalDeclarativeProgramInputV1,
    materializationBudgetInput: {
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 1_024,
      maximumSourceMapBytes: 1_024,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 32,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [
        {
          path: "orders.js",
          roles: ["function"],
          sourceBytes: UTF8.encode("export const place = 1;\n"),
          sourceMapBytes: null,
        },
        {
          path: "_flarex/execution.js",
          roles: ["execution"],
          sourceBytes: UTF8.encode("export const run = 1;\n"),
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
    } satisfies DeclarativeV2PrebuiltModuleGraphInputV1,
  } satisfies StandardApplicationDefinitionInputV1;

  return Result.getOrThrow(prepareStandardApplicationDefinitionV1(input));
}

function authenticatedAnalysis(
  seed: number,
): AuthenticatedVerifiedStandardApplicationAnalysisV1 {
  const usage = budget("attempt_usage", BigInt(seed));
  const nextProgress = Object.freeze({
    kind: "progress_cursor" as const,
    phase: "verdict" as const,
    settledSequence: 3n,
    moduleOrdinal: 1n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: digest(seed),
  });
  const outputManifest = Object.freeze({
    kind: "command_output_manifest" as const,
    reservationSha256: digest(seed + 1),
    commandKind: "registration_page" as const,
    sequence: 3n,
    evidenceRootSha256: digest(seed + 2),
    evidenceCount: 1n,
    diagnosticsRootSha256: digest(seed + 3),
    diagnosticCount: 0n,
    nextProgressSha256: digest(seed + 4),
  });

  return Object.freeze({
    status: "complete",
    kind: "registration_page",
    result: Object.freeze({
      status: "complete",
      capacity: capacity(BigInt(seed + 10)),
      actual: usage,
      registrationFrames: Object.freeze([digest(seed + 5)]),
      nextProgress,
      nextProgressBytes: digest(seed + 6),
      outputManifest,
      outputManifestBytes: digest(seed + 7),
      registrationRootSha256: digest(seed + 8),
      receipt: Object.freeze({
        transitionCount: 1,
        deltaUsage: usage,
        usage,
      }),
    }),
  });
}

function capacity(value: bigint):
  AuthenticatedVerifiedStandardApplicationAnalysisV1["result"]["capacity"]
{
  return Object.freeze({
    _tag: "DeclarativeV2VerifierRegistrationCapacityV1",
    ...budgetFields(value),
  });
}

function budget(
  kind: DeclarativeV2VerifierBudgetFrameV2["kind"],
  value: bigint,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({ kind, ...budgetFields(value) });
}

function budgetFields(value: bigint) {
  return {
    calls: value,
    objectCalls: value,
    objectBodyBytes: value,
    sourceBytes: value,
    sourceMapBytes: value,
    semanticBytes: value,
    modules: value,
    importEdges: value,
    exports: value,
    functions: value,
    tokens: value,
    tokenBytes: value,
    parserStates: value,
    nestingDepth: value,
    schemaNodes: value,
    validatorNodes: value,
    graphNodes: value,
    frontierEntries: value,
    stringBytes: value,
    tableBytes: value,
    canonicalBytes: value,
    frameBytes: value,
    hashBytes: value,
    diagnosticBytes: value,
    outputBytes: value,
    elapsedMilliseconds: value,
  } as const;
}

function digest(seed: number): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, index) => (seed + index) % 256);
}
