import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, test } from "vitest";

import {
  generateDeclarativeV2VerifierBoundsV1,
} from "../scripts/declarativeV2VerifierBoundsV1";
import {
  DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1,
  type DeclarativeV2ArtifactModulePathHandleV1,
} from "../src/declarativeV2ArtifactModulePathV1";
import {
  GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1,
} from "../src/declarativeV2VerifierBoundsV1.generated";
import {
  DECLARATIVE_V2_VERIFIER_PARSE_ARENA_OPERATIONAL_BYTE_LIMIT_V1,
  DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1,
  DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1,
  planDeclarativeV2VerifierParseCapacityV1,
  planDeclarativeV2VerifierSha256WorkV1,
  type DeclarativeV2VerifierParseCapacityBindingsV1,
  type DeclarativeV2VerifierParseCapacityInputV1,
} from "../src/declarativeV2VerifierSizingV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function bindings(seed = 1): DeclarativeV2VerifierParseCapacityBindingsV1 {
  return Object.freeze({
    candidateSha256: digest(seed),
    authenticatedInputSha256: digest(seed + 1),
    rangeAndPredecessorTailsSha256: digest(seed + 2),
    analyzerIdentitySha256: digest(seed + 3),
    verifierIdentitySha256: digest(seed + 4),
  });
}

function modulePathOfLength(
  byteLength: number,
): DeclarativeV2ArtifactModulePathHandleV1 {
  const bytes = new TextEncoder().encode(
    `${"a".repeat(byteLength - 3)}.js`,
  );
  const created = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.create(
    3,
    bytes.byteLength,
    bytes.byteLength,
  );
  if (Result.isFailure(created)) throw created.failure;
  const stepped = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.step(
    created.success,
    bytes,
    1_024,
  );
  if (Result.isFailure(stepped)) throw stepped.failure;
  const finished = DECLARATIVE_V2_ARTIFACT_MODULE_PATHS_V1.finish(
    created.success,
    1,
  );
  if (Result.isFailure(finished) || "status" in finished.success) {
    throw new Error("test module path did not finish");
  }
  return finished.success;
}

function budget(
  mutate?: Partial<
    Record<DeclarativeV2VerifierBudgetDimensionV2, bigint>
  >,
): DeclarativeV2VerifierBudgetFrameV2 {
  return Object.freeze({
    kind: "command_budget",
    ...Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
        dimension,
        mutate?.[dimension] ?? MAX_SIGNED_INT64,
      ]),
    ),
  }) as DeclarativeV2VerifierBudgetFrameV2;
}

function fixture(
  mutate?: Partial<DeclarativeV2VerifierParseCapacityInputV1>,
): DeclarativeV2VerifierParseCapacityInputV1 {
  return Object.freeze({
    bindings: bindings(),
    commandKind: "parse_module",
    sequence: 1n,
    moduleOrdinal: 0n,
    modulePath: modulePathOfLength(5),
    source: new Uint8Array(10),
    sourceSha256: digest(23),
    commandBudget: budget(),
    ...mutate,
  });
}

function capacity(
  input: DeclarativeV2VerifierParseCapacityInputV1 = fixture(),
): DeclarativeV2VerifierBudgetFrameV2 {
  const planned = planDeclarativeV2VerifierParseCapacityV1(input, bindings());
  if (Result.isFailure(planned)) throw planned.failure;
  return planned.success.capacity;
}

describe("private parse-module verifier capacity", () => {
  test("pins generated parser/diagnostic bounds and the selected limit proof", () => {
    expect(GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1).toMatchObject({
      maximumProductionRhsLength: 3,
      epsilonProductionCount: 2,
      parseDiagnosticPhasesPerDomainUnit: 4,
      parseDiagnosticDefinitionsPerDomainUnit: 19,
      parserStackEntriesPerDomainUnit: 6,
      evidenceFramesPerDomainUnit: 21,
      maximumSemanticOutputBytesPerDomainByte: 8,
      arenaOperationalByteLimit: 67_108_864,
      selectedSourceAndModulePathByteLimit: 128,
      arenaBytesAtSelectedLimit: 48_273_592,
      arenaBytesAtNextPowerOfTwo: 156_553_528,
    });
    expect(DECLARATIVE_V2_VERIFIER_PARSE_DOMAIN_BYTE_LIMIT_V1).toBe(128);
    expect(DECLARATIVE_V2_VERIFIER_PARSE_ARENA_OPERATIONAL_BYTE_LIMIT_V1)
      .toBe(67_108_864);
    expect(generateDeclarativeV2VerifierBoundsV1()).toContain(
      GENERATED_DECLARATIVE_V2_VERIFIER_PARSE_BOUNDS_V1.boundsIdentity,
    );
  });

  test("derives immutable capacity only from authenticated lengths", () => {
    const planned = planDeclarativeV2VerifierParseCapacityV1(
      fixture(),
      bindings(),
    );
    if (Result.isFailure(planned)) throw planned.failure;
    expect(planned.success).toMatchObject({
      sequence: 1n,
      moduleOrdinal: 0n,
      modulePathByteLength: 5n,
      sourceByteLength: 10n,
      domainByteLength: 15n,
    });
    expect(planned.success.capacity).toEqual({
      kind: "attempt_usage",
      calls: 1_380_654n,
      objectCalls: 0n,
      objectBodyBytes: 10n,
      sourceBytes: 10n,
      sourceMapBytes: 0n,
      semanticBytes: 0n,
      modules: 1n,
      importEdges: 32n,
      exports: 16n,
      functions: 16n,
      tokens: 16n,
      tokenBytes: 10n,
      parserStates: 96n,
      nestingDepth: 16n,
      schemaNodes: 0n,
      validatorNodes: 0n,
      graphNodes: 304n,
      frontierEntries: 16n,
      stringBytes: 15n,
      tableBytes: DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1,
      canonicalBytes: 436_078n,
      frameBytes: 436_078n,
      hashBytes: 436_078n,
      diagnosticBytes: 338_656n,
      outputBytes: 109_824n,
      elapsedMilliseconds: 0n,
    });
    expect(planned.success.arenaByteLength).toBeLessThanOrEqual(
      DECLARATIVE_V2_VERIFIER_PARSE_ARENA_OPERATIONAL_BYTE_LIMIT_V1,
    );
  });

  test("pins exact and one-less admission for every dimension", () => {
    const exact = capacity();
    const exactPlan = planDeclarativeV2VerifierParseCapacityV1(
      fixture({ commandBudget: Object.freeze({
        ...exact,
        kind: "command_budget",
      }) as DeclarativeV2VerifierBudgetFrameV2 }),
      bindings(),
    );
    expect(Result.isSuccess(exactPlan)).toBe(true);
    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      if (exact[dimension] === 0n) continue;
      const rejected = planDeclarativeV2VerifierParseCapacityV1(
        fixture({
          commandBudget: Object.freeze({
            ...exact,
            kind: "command_budget",
            [dimension]: exact[dimension] - 1n,
          }) as DeclarativeV2VerifierBudgetFrameV2,
        }),
        bindings(),
      );
      expect(rejected, dimension).toMatchObject({
        failure: {
          operation: "capacity",
          reason: "budgetExceeded",
          path: dimension,
        },
      });
    }
  });

  test("rejects the first byte beyond the combined source/path domain", () => {
    const exact = planDeclarativeV2VerifierParseCapacityV1(
      fixture({
        modulePath: modulePathOfLength(12),
        source: new Uint8Array(116),
      }),
      bindings(),
    );
    if (Result.isFailure(exact)) throw exact.failure;
    expect(exact.success.domainByteLength).toBe(128n);
    expect(exact.success.arenaByteLength).toBeLessThanOrEqual(48_273_592);
    expect(planDeclarativeV2VerifierParseCapacityV1(
      fixture({
        modulePath: modulePathOfLength(12),
        source: new Uint8Array(117),
      }),
      bindings(),
    )).toMatchObject({
      failure: {
        operation: "capacity",
        reason: "domainLimitExceeded",
        path: "domainByteLength",
        observed: 129n,
        maximum: 128n,
      },
    });
  });

  test("captures hostile records once and compares every binding", () => {
    const fields = Object.keys(bindings()) as Array<
      keyof DeclarativeV2VerifierParseCapacityBindingsV1
    >;
    for (const field of fields) {
      const mismatch = Object.freeze({
        ...bindings(),
        [field]: digest(99),
      });
      expect(planDeclarativeV2VerifierParseCapacityV1(
        fixture(),
        mismatch,
      )).toMatchObject({
        failure: { reason: "identityMismatch", path: "bindings" },
      });
    }
    const hostile = new Proxy(fixture(), {
      ownKeys() {
        throw new Error("hostile");
      },
    });
    expect(planDeclarativeV2VerifierParseCapacityV1(
      hostile,
      bindings(),
    )).toMatchObject({
      failure: { reason: "invalidInput", path: "input" },
    });
    if (typeof SharedArrayBuffer !== "undefined") {
      expect(planDeclarativeV2VerifierParseCapacityV1(
        fixture({
          sourceSha256: new Uint8Array(new SharedArrayBuffer(32)),
        }),
        bindings(),
      )).toMatchObject({
        failure: { reason: "invalidInput", path: "sourceSha256" },
      });
      expect(planDeclarativeV2VerifierParseCapacityV1(
        fixture({
          source: new Uint8Array(new SharedArrayBuffer(10)),
        }),
        bindings(),
      )).toMatchObject({
        failure: { reason: "invalidInput", path: "source" },
      });
    }
  });

  test("derives SHA-256 work at every final-block boundary", () => {
    for (const [byteLength, calls] of [
      [0n, 193n],
      [1n, 193n],
      [55n, 193n],
      [56n, 386n],
      [63n, 386n],
      [64n, 386n],
      [65n, 386n],
    ] as const) {
      expect(planDeclarativeV2VerifierSha256WorkV1(byteLength)).toEqual(
        Result.succeed(Object.freeze({
          calls,
          hashBytes: byteLength,
          transitions: calls,
        })),
      );
    }
  });
});
