import { Result } from "effect";
import {
  DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2,
  type DeclarativeV2VerifierBudgetDimensionV2,
  type DeclarativeV2VerifierBudgetFrameV2,
} from "flarex-protocol/internal/declarative-v2-verifier-progress-v2";
import { describe, expect, test } from "vitest";

import {
  DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1,
  planDeclarativeV2VerifierParseModuleV1,
  planDeclarativeV2VerifierSha256WorkV1,
  type DeclarativeV2VerifierParseFactsV1,
  type DeclarativeV2VerifierParseSizingBindingsV1,
  type DeclarativeV2VerifierParseSizingInputV1,
} from "../src/declarativeV2VerifierSizingV1";

const MAX_SIGNED_INT64 = 9_223_372_036_854_775_807n;
const MAX_U32 = 0xffff_ffffn;

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function bindings(seed = 1): DeclarativeV2VerifierParseSizingBindingsV1 {
  return Object.freeze({
    candidateSha256: digest(seed),
    authenticatedInputSha256: digest(seed + 1),
    rangeAndPredecessorTailsSha256: digest(seed + 2),
    analyzerIdentitySha256: digest(seed + 3),
    verifierIdentitySha256: digest(seed + 4),
  });
}

function facts(
  mutate?: Partial<DeclarativeV2VerifierParseFactsV1>,
): DeclarativeV2VerifierParseFactsV1 {
  return Object.freeze({
    driverCalls: 7n,
    modulePathByteLength: 5n,
    tokenCount: 3n,
    tokenByteLength: 8n,
    peakParserStates: 2n,
    peakNestingDepth: 1n,
    retainedStringByteLength: 6n,
    importDeclarationCount: 1n,
    callCount: 2n,
    exportCount: 1n,
    functionCount: 1n,
    valueFlowCount: 1n,
    diagnosticCount: 1n,
    diagnosticTextByteLength: 20n,
    semanticOutputByteLength: 10n,
    evidenceCanonicalByteLength: 55n,
    maximumEvidenceFrameByteLength: 30n,
    ...mutate,
  });
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
  mutate?: Partial<DeclarativeV2VerifierParseSizingInputV1>,
): DeclarativeV2VerifierParseSizingInputV1 {
  return Object.freeze({
    bindings: bindings(),
    commandKind: "parse_module",
    sequence: 1n,
    moduleOrdinal: 0n,
    sourceByteLength: 10n,
    facts: facts(),
    commandBudget: budget(),
    ...mutate,
  });
}

function required(
  input: DeclarativeV2VerifierParseSizingInputV1 = fixture(),
): DeclarativeV2VerifierBudgetFrameV2 {
  const planned = planDeclarativeV2VerifierParseModuleV1(
    input,
    bindings(),
  );
  if (Result.isFailure(planned)) throw planned.failure;
  return planned.success.required;
}

describe("private parse-module verifier sizing", () => {
  test("derives the owner-specific exact 26-dimensional requirement", () => {
    const planned = planDeclarativeV2VerifierParseModuleV1(
      fixture(),
      bindings(),
    );
    if (Result.isFailure(planned)) throw planned.failure;
    expect(planned.success.required).toEqual({
      kind: "attempt_usage",
      calls: 200n,
      objectCalls: 0n,
      objectBodyBytes: 10n,
      sourceBytes: 10n,
      sourceMapBytes: 0n,
      semanticBytes: 0n,
      modules: 1n,
      importEdges: 3n,
      exports: 1n,
      functions: 1n,
      tokens: 3n,
      tokenBytes: 8n,
      parserStates: 2n,
      nestingDepth: 1n,
      schemaNodes: 0n,
      validatorNodes: 0n,
      graphNodes: 2n,
      frontierEntries: 1n,
      stringBytes: 6n,
      tableBytes: DECLARATIVE_V2_VERIFIER_PARSE_TABLE_BYTES_V1,
      canonicalBytes: 55n,
      frameBytes: 55n,
      hashBytes: 55n,
      diagnosticBytes: 32n,
      outputBytes: 15n,
      elapsedMilliseconds: 0n,
    });
    expect(planned.success.arenaByteLength).toBeGreaterThan(0);
  });

  test("uses every command-budget dimension only as an exact ceiling", () => {
    const exact = required();
    const exactBudget = budget(Object.fromEntries(
      DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((dimension) => [
        dimension,
        exact[dimension],
      ]),
    ));
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({ commandBudget: exactBudget }),
      bindings(),
    )).toMatchObject({ success: { required: exact } });

    for (const dimension of DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2) {
      const amount = exact[dimension];
      if (amount === 0n) {
        expect(exactBudget[dimension]).toBe(0n);
        continue;
      }
      const oneLess = budget({
        ...Object.fromEntries(
          DECLARATIVE_V2_VERIFIER_BUDGET_DIMENSIONS_V2.map((candidate) => [
            candidate,
            exact[candidate],
          ]),
        ),
        [dimension]: amount - 1n,
      });
      expect(planDeclarativeV2VerifierParseModuleV1(
        fixture({ commandBudget: oneLess }),
        bindings(),
      )).toMatchObject({
        failure: {
          operation: "size",
          reason: "budgetExceeded",
          path: dimension,
          observed: amount,
          maximum: amount - 1n,
        },
      });
    }
  });

  test("sizes shared graph scratch for the largest ordered record set", () => {
    const exact = required(fixture({
      facts: facts({
        importDeclarationCount: 0n,
        functionCount: 1n,
        exportCount: 2n,
        diagnosticCount: 3n,
      }),
    }));
    expect(exact.graphNodes).toBe(3n);
  });

  test("derives SHA-256 calls at every final-block boundary", () => {
    const cases = new Map<bigint, bigint>([
      [0n, 193n],
      [1n, 193n],
      [55n, 193n],
      [56n, 386n],
      [63n, 386n],
      [64n, 386n],
      [65n, 386n],
    ]);
    for (const [byteLength, calls] of cases) {
      expect(planDeclarativeV2VerifierSha256WorkV1(byteLength)).toEqual(
        Result.succeed(Object.freeze({
          calls,
          hashBytes: byteLength,
          transitions: calls,
        })),
      );
    }
  });

  test("rejects hostile shapes without invoking accessors and keeps failure order", () => {
    let getterCalls = 0;
    const hostileFacts = Object.defineProperty(
      { ...facts() },
      "driverCalls",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return 7n;
        },
      },
    );
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({ facts: hostileFacts }),
      bindings(),
    )).toMatchObject({
      failure: {
        operation: "size",
        reason: "invalidInput",
        path: "facts.driverCalls",
      },
    });
    expect(getterCalls).toBe(0);

    const revoked = Proxy.revocable(facts(), {});
    revoked.revoke();
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({ facts: revoked.proxy }),
      bindings(),
    )).toMatchObject({
      failure: { reason: "invalidInput", path: "facts" },
    });

    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({ commandKind: "link_page" as "parse_module" }),
      bindings(20),
    )).toMatchObject({
      failure: { reason: "identityMismatch", path: "bindings" },
    });

    const extra = Object.defineProperty(
      { ...fixture() },
      "source",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("sizing must not read source bytes");
        },
      },
    );
    expect(planDeclarativeV2VerifierParseModuleV1(
      extra,
      bindings(),
    )).toMatchObject({
      failure: { reason: "invalidInput", path: "input" },
    });
    expect(getterCalls).toBe(0);
  });

  test("checks signed-int64, u32, and total arena addressability", () => {
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({ sourceByteLength: MAX_U32 + 1n }),
      bindings(),
    )).toMatchObject({
      failure: {
        reason: "addressabilityExceeded",
        path: "sourceByteLength",
      },
    });
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({ facts: facts({ tokenCount: MAX_U32 + 1n }) }),
      bindings(),
    )).toMatchObject({
      failure: {
        reason: "addressabilityExceeded",
        path: "facts.tokenCount",
      },
    });
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({
        facts: facts({
          driverCalls: MAX_SIGNED_INT64,
        }),
      }),
      bindings(),
    )).toMatchObject({
      failure: { reason: "overflow", path: "calls" },
    });
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({
        sourceByteLength: MAX_U32,
        facts: facts({
          tokenByteLength: 0n,
          retainedStringByteLength: MAX_U32,
        }),
      }),
      bindings(),
    )).toMatchObject({
      failure: { reason: "addressabilityExceeded" },
    });
  });

  test("binds every identity and owns cold-stable output bytes", () => {
    const mutableBindings = {
      candidateSha256: digest(1),
      authenticatedInputSha256: digest(2),
      rangeAndPredecessorTailsSha256: digest(3),
      analyzerIdentitySha256: digest(4),
      verifierIdentitySha256: digest(5),
    };
    const input = fixture({ bindings: mutableBindings });
    const first = planDeclarativeV2VerifierParseModuleV1(input, bindings());
    const second = planDeclarativeV2VerifierParseModuleV1(input, bindings());
    if (Result.isFailure(first) || Result.isFailure(second)) {
      throw new Error("cold sizing fixture failed");
    }
    expect(first.success).toEqual(second.success);
    mutableBindings.candidateSha256.fill(99);
    expect(first.success.bindings.candidateSha256).toEqual(digest(1));

    for (const key of [
      "candidateSha256",
      "authenticatedInputSha256",
      "rangeAndPredecessorTailsSha256",
      "analyzerIdentitySha256",
      "verifierIdentitySha256",
    ] as const) {
      const mismatch = bindings();
      mismatch[key].fill(77);
      expect(planDeclarativeV2VerifierParseModuleV1(input, mismatch))
        .toMatchObject({
          failure: { reason: "identityMismatch", path: "bindings" },
        });
    }

    const detached = digest(1);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(planDeclarativeV2VerifierParseModuleV1(
      fixture({
        bindings: {
          ...bindings(),
          candidateSha256: detached,
        },
      }),
      bindings(),
    )).toMatchObject({
      failure: {
        reason: "invalidInput",
        path: "bindings.candidateSha256",
      },
    });
  });
});
