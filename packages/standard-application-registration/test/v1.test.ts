import {
  decodeApplicationRevisionRegistrationRequestKeyV1,
  type ApplicationRevisionRegistrationContextV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionRegistrationV1";
import type {
  AuthenticatedVerifiedStandardApplicationAnalysisV1,
} from "@flarex/standard-application-analysis/internal/system-test/legacy-v1";
import { Effect, Result } from "effect";
import type {
  DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import {
  CatalogSchemaVersionIdSchema,
} from "flarex-protocol/schema-manifest";
import { describe, expect, it } from "vitest";

import { registerStandardApplicationRevisionV1 } from "../src/v1";

describe("Standard Application registration V1", () => {
  it("exposes only the stable SAP03 result with canonical DB time", async () => {
    const registeredAt = new Date("2026-07-30T12:34:56.789Z");
    const analysis = authenticatedAnalysis(1);
    const requestKey = Result.getOrThrow(
      decodeApplicationRevisionRegistrationRequestKeyV1("request:sap03"),
    );
    const context: ApplicationRevisionRegistrationContextV1 = Object.freeze({
      register: (
        actualAnalysis: Parameters<
          ApplicationRevisionRegistrationContextV1["register"]
        >[0],
        actualRequestKey: unknown,
      ) => {
        expect(actualAnalysis).toBe(analysis);
        expect(actualRequestKey).toBe(requestKey);
        return Effect.succeed(Object.freeze({
          kind: "replayed" as const,
          revisionId: "dv2_revision",
          deploymentId: "deployment",
          scopeId: "scope",
          candidateSha256: digest(1),
          attemptSha256: digest(2),
          registrationInputSha256: digest(3),
          schemaVersionId:
            CatalogSchemaVersionIdSchema.make("dv2_schema_revision"),
          functionMetadataSha256: digest(4),
          validatorRootSha256: digest(5),
          declaredHandlerSetSha256: digest(6),
          registrationRootSha256: digest(7),
          status: "inactive" as const,
          registeredAt,
        }));
      },
    });

    const result = await Effect.runPromise(Effect.scoped(
      registerStandardApplicationRevisionV1(
        analysis,
        requestKey,
        context,
      ),
    ));

    expect(result).toEqual({
      status: "registered",
      revisionId: "dv2_revision",
      schemaVersionId: "dv2_schema_revision",
      registeredAt: "2026-07-30T12:34:56.789Z",
    });
    expect(result).not.toHaveProperty("scopeId");
    expect(result).not.toHaveProperty("candidateSha256");
    expect(result).not.toHaveProperty("registrationInputSha256");
  });
});

function authenticatedAnalysis(
  seed: number,
): AuthenticatedVerifiedStandardApplicationAnalysisV1 {
  const usage = budget("attempt_usage", BigInt(seed));
  const nextProgress = Object.freeze({
    kind: "progress_cursor" as const,
    phase: "verdict" as const,
    settledSequence: 1n,
    moduleOrdinal: 1n,
    edgeOrdinal: 0n,
    pageOrdinal: 0n,
    previousReceiptSha256: digest(seed),
  });
  const outputManifest = Object.freeze({
    kind: "command_output_manifest" as const,
    reservationSha256: digest(seed + 1),
    commandKind: "registration_page" as const,
    sequence: 1n,
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
      capacity: Object.freeze({
        _tag: "DeclarativeV2VerifierRegistrationCapacityV1" as const,
        ...budgetFields(100n),
      }),
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
  return new Uint8Array(32).fill(seed);
}
