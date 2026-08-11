import {
  APP_SCHEMA_CANDIDATE_VALIDATION_BUDGET_IDENTITY_V1,
  APP_SCHEMA_CANDIDATE_VALIDATION_CEILINGS_V1,
  canonicalizeAppSchemaCandidateValidationFrameV1Effect,
  decodeCanonicalAppSchemaCandidateValidationFrameV1Effect,
  appSchemaCandidateValidationRecoveryDispositionV1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1,
  MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1,
  type AppSchemaCandidateValidationCodecV1Error,
  type AppSchemaCandidateValidationOperationFailureReasonV1,
  type CanonicalAppSchemaCandidateValidationFrameV1,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

describe("app schema candidate validation v1", () => {
  it("pins canonical progress, failure, and receipt vectors", async () => {
    const vectors = await Promise.all([
      canonicalize(progress()),
      canonicalize(failureEvidence()),
      canonicalize(receipt()),
    ]);

    expect(vectors.map((vector) => ({
      kind: vector.frame.kind,
      byteLength: vector.canonicalBytes.byteLength,
      sha256Hex: vector.sha256Hex,
    }))).toEqual([
      {
        kind: "app_schema_candidate_validation_progress",
        byteLength: 827,
        sha256Hex:
          "5ad3d224c82e3c1e9f8ff5efedd066190088d31ceb8a8c024335b1de69b6def2",
      },
      {
        kind: "app_schema_candidate_validation_failure_evidence",
        byteLength: 1_054,
        sha256Hex:
          "a0659d103e9e62097b87f6ea65baed2d075fbaf609f750cd2465707d902ad473",
      },
      {
        kind: "app_schema_candidate_validation_receipt",
        byteLength: 811,
        sha256Hex:
          "308c84b6671773c4b2ce921370907deb137f6104dea767ab90abc811e1013750",
      },
    ]);
    expect(vectors[0]?.canonicalText).toBe(
      '{"format":"flarex.app-schema/candidate-validation/v1","frame":{"attemptFence":"3","budgetIdentity":"flarex.app-schema/candidate-validation-budget/v1","codecVersion":1,"cursor":{"afterRowId":"01010101010101010101010101010101","afterTableId":1},"frontierCommitSeq":"10","kind":"app_schema_candidate_validation_progress","previousProgressSha256Hex":"0202020202020202020202020202020202020202020202020202020202020202","progressSequence":"2","schemaManifestSha256Hex":"0101010101010101010101010101010101010101010101010101010101010101","schemaVersionId":"schema_cooking_v2","scopeEpoch":"epoch_00000000-0000-0000-0000-000000000002","scopeId":"scope_00000000-0000-0000-0000-000000000001","storageGeneration":"flarexdb_v1","storageGenerationFence":"7","validatedPageCount":"1","validatedRowCount":"128","validatedSemanticBytes":"4096"}}',
    );
    expect(vectors[1]?.canonicalText).toBe(
      '{"format":"flarex.app-schema/candidate-validation/v1","frame":{"attemptFence":"3","budgetIdentity":"flarex.app-schema/candidate-validation-budget/v1","codecVersion":1,"entries":[{"observedCommitSeq":"11","reason":"candidateValidatorRejected","rowId":"01010101010101010101010101010101","source":"pointCommit","tableId":1,"validatorPath":"$document.name"},{"observedCommitSeq":"12","reason":"candidateValidatorRejected","rowId":"02020202020202020202020202020202","source":"pointCommit","tableId":1,"validatorPath":"$document.slug"}],"frontierCommitSeq":"10","kind":"app_schema_candidate_validation_failure_evidence","observedFailureCount":"2","progressSha256Hex":"0303030303030303030303030303030303030303030303030303030303030303","schemaManifestSha256Hex":"0101010101010101010101010101010101010101010101010101010101010101","schemaVersionId":"schema_cooking_v2","scopeEpoch":"epoch_00000000-0000-0000-0000-000000000002","scopeId":"scope_00000000-0000-0000-0000-000000000001","storageGeneration":"flarexdb_v1","storageGenerationFence":"7","truncated":false}}',
    );
    expect(vectors[2]?.canonicalText).toBe(
      '{"format":"flarex.app-schema/candidate-validation/v1","frame":{"attemptFence":"3","budgetIdentity":"flarex.app-schema/candidate-validation-budget/v1","codecVersion":1,"finalProgressSha256Hex":"0404040404040404040404040404040404040404040404040404040404040404","frontierCommitSeq":"10","kind":"app_schema_candidate_validation_receipt","scanCompleted":true,"schemaManifestSha256Hex":"0101010101010101010101010101010101010101010101010101010101010101","schemaVersionId":"schema_cooking_v2","scopeEpoch":"epoch_00000000-0000-0000-0000-000000000002","scopeId":"scope_00000000-0000-0000-0000-000000000001","settledAt":"2026-08-11T00:00:00.000Z","settlementCommitSeq":"12","storageGeneration":"flarexdb_v1","storageGenerationFence":"7","validatedPageCount":"2","validatedRowCount":"256","validatedSemanticBytes":"8192"}}',
    );
  });

  it("round trips exact evidence and returns owned immutable projections", async () => {
    for (const input of [
      progress(),
      failureEvidence(),
      snapshotFailureEvidence(),
      receipt(),
    ]) {
      const canonical = await canonicalize(input);
      const firstBytes = canonical.canonicalBytes;
      const decoded = await runEffect(
        decodeCanonicalAppSchemaCandidateValidationFrameV1Effect({
          canonicalBytes: firstBytes,
          expectedSha256Hex: canonical.sha256Hex,
        }),
      );
      expect(decoded.frame).toEqual(canonical.frame);
      expect(decoded.frame).not.toBe(canonical.frame);
      expect(decoded.canonicalBytes).toEqual(firstBytes);
      expect(Object.isFrozen(decoded.frame)).toBe(true);

      firstBytes[0] ^= 0xff;
      expect(canonical.canonicalBytes[0]).not.toBe(firstBytes[0]);
    }
  });

  it("rejects invalid lifecycle relations and non-canonical evidence order", async () => {
    for (const input of [
      {
        ...progress(),
        progressSequence: 0n,
        previousProgressSha256Hex: digest(9),
      },
      {
        ...failureEvidence(),
        entries: [...failureEvidence().entries].reverse(),
      },
      {
        ...failureEvidence(),
        observedFailureCount: 2n,
        truncated: true,
      },
      {
        ...failureEvidence(),
        entries: [{
          ...failureEvidence().entries[0],
          reason: "candidateTableRemoved",
          validatorPath: "$document.name",
        }],
        observedFailureCount: 1n,
      },
      {
        ...failureEvidence(),
        entries: [{
          ...failureEvidence().entries[0],
          source: "snapshotScan",
        }],
        observedFailureCount: 1n,
      },
      {
        ...failureEvidence(),
        entries: [{
          ...failureEvidence().entries[0],
          observedCommitSeq: 10n,
        }],
        observedFailureCount: 1n,
      },
      {
        ...receipt(),
        frontierCommitSeq: 13n,
        settlementCommitSeq: 12n,
      },
      {
        ...progress(),
        validatedPageCount: 1n,
        validatedRowCount: 129n,
      },
      {
        ...receipt(),
        validatedPageCount: 1n,
        validatedSemanticBytes: 8_388_609n,
      },
      {
        ...progress(),
        schemaVersionId: "x".repeat(1_025),
      },
      {
        ...failureEvidence(),
        entries: [{
          ...failureEvidence().entries[0],
          validatorPath: "x".repeat(4_097),
        }],
        observedFailureCount: 1n,
      },
    ]) {
      const result = await canonicalizeResult(input);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure.issue.reason).toBe("invalidSchema");
      }
    }
  });

  it("enforces entry, canonical-byte, and capture ceilings before authority", async () => {
    const tooManyEntries = Array.from(
      { length: MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1 + 1 },
      (_, index) => failureEntry(index + 1, `field_${index}`),
    );
    expect(Result.isFailure(await canonicalizeResult({
      ...failureEvidence(),
      entries: tooManyEntries,
      observedFailureCount: BigInt(tooManyEntries.length),
    }))).toBe(true);

    const maximumEntries = Array.from(
      { length: MAX_APP_SCHEMA_CANDIDATE_VALIDATION_FAILURE_ENTRIES_V1 },
      (_, index) => failureEntry(index + 1, "x".repeat(4_086)),
    );
    const byteLimit = await canonicalizeResult({
      ...failureEvidence(),
      entries: maximumEntries,
      observedFailureCount: BigInt(maximumEntries.length),
    });
    expect(Result.isFailure(byteLimit)).toBe(true);
    if (Result.isFailure(byteLimit)) {
      expect(byteLimit.failure.issue).toMatchObject({
        reason: "limitExceeded",
        dimension: "failureEvidenceFrameBytes",
      });
    }

    const captureLimit = await canonicalizeResult({
      ...progress(),
      ignored: Array.from({ length: 512 }, () => Object.freeze({ value: 1 })),
    });
    expect(Result.isFailure(captureLimit)).toBe(true);
    if (Result.isFailure(captureLimit)) {
      expect(captureLimit.failure.issue).toMatchObject({
        reason: "limitExceeded",
        dimension: "captureNodes",
      });
    }

    const byteBearingFrame = await canonicalizeResult({
      ...progress(),
      ignored: Uint8Array.of(1),
    });
    expect(Result.isFailure(byteBearingFrame)).toBe(true);
    if (Result.isFailure(byteBearingFrame)) {
      expect(byteBearingFrame.failure.issue.reason).toBe("invalidInput");
    }
  });

  it("rejects malformed, non-canonical, and digest-mismatched stored frames", async () => {
    const canonical = await canonicalize(progress());
    const parsed: unknown = JSON.parse(canonical.canonicalText);
    const pretty = new TextEncoder().encode(JSON.stringify(parsed, null, 2));

    await expectDecodeFailure(pretty, canonical.sha256Hex, "nonCanonical");
    await expectDecodeFailure(
      canonical.canonicalBytes,
      digest(99),
      "digestMismatch",
    );
    await expectDecodeFailure(
      Uint8Array.of(0xff),
      canonical.sha256Hex,
      "invalidUtf8",
    );
    await expectDecodeFailure(
      new TextEncoder().encode("{"),
      canonical.sha256Hex,
      "invalidJson",
    );
    await expectDecodeFailure(
      new Uint8Array(
        MAX_APP_SCHEMA_CANDIDATE_VALIDATION_CANONICAL_FRAME_BYTES_V1 + 1,
      ),
      canonical.sha256Hex,
      "limitExceeded",
    );
  });

  it("rejects reflection traps without escaping the typed channel", async () => {
    const reflectionTrap = new Proxy({}, {
      ownKeys: () => {
        throw new Error("reflection trap");
      },
    });
    const result = await canonicalizeResult(reflectionTrap);
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure.issue.reason).toBe("invalidInput");
    }

    const canonical = await canonicalize(progress());
    const revoked = Proxy.revocable({
      canonicalBytes: canonical.canonicalBytes,
      expectedSha256Hex: canonical.sha256Hex,
    }, {});
    revoked.revoke();
    const decodeResult = await runEffect(Effect.result(
      decodeCanonicalAppSchemaCandidateValidationFrameV1Effect(revoked.proxy),
    ));
    expect(Result.isFailure(decodeResult)).toBe(true);
    if (Result.isFailure(decodeResult)) {
      expect(decodeResult.failure.issue.reason).toBe("invalidInput");
    }
  });

  it("preserves extra own keys so strict decoding rejects them", async () => {
    const protoKeyInput = { ...progress() };
    Object.defineProperty(protoKeyInput, "__proto__", {
      value: "must-not-disappear",
      enumerable: true,
    });
    const protoKeyResult = await canonicalizeResult(protoKeyInput);
    expect(Result.isFailure(protoKeyResult)).toBe(true);

    const entries = [...failureEvidence().entries];
    Object.defineProperty(entries, "4294967295", {
      value: "must-not-disappear",
      enumerable: true,
    });
    const arrayKeyResult = await canonicalizeResult({
      ...failureEvidence(),
      entries,
    });
    expect(Result.isFailure(arrayKeyResult)).toBe(true);
  });

  it("pins Worker-safe ceilings and operation recovery semantics", () => {
    expect(APP_SCHEMA_CANDIDATE_VALIDATION_CEILINGS_V1).toEqual({
      maximumRowsPerPage: 128,
      maximumSemanticBytesPerPage: 8_388_608,
      maximumElapsedMillisecondsPerSlice: 5_000,
      maximumFailureEntries: 16,
      maximumFailureFrameBytes: 65_536,
      maximumCanonicalFrameBytes: 131_072,
      maximumValidatorPathBytes: 4_096,
    });
    const reasons = [
      "corruption",
      "superseded",
      "interrupted",
      "rollbackConfirmed",
      "decisionUncertain",
    ] as const satisfies ReadonlyArray<
      AppSchemaCandidateValidationOperationFailureReasonV1
    >;
    expect(reasons.map(appSchemaCandidateValidationRecoveryDispositionV1))
      .toEqual([
      "failClosed",
      "obsolete",
      "reloadBeforeRetry",
      "retryAllowed",
      "reconcileBeforeRetry",
    ]);
  });
});

async function canonicalize(
  input: unknown,
): Promise<CanonicalAppSchemaCandidateValidationFrameV1> {
  return runEffect(
    canonicalizeAppSchemaCandidateValidationFrameV1Effect(input),
  );
}

async function canonicalizeResult(
  input: unknown,
): Promise<
  Result.Result<
    CanonicalAppSchemaCandidateValidationFrameV1,
    AppSchemaCandidateValidationCodecV1Error
  >
> {
  return runEffect(Effect.result(
    canonicalizeAppSchemaCandidateValidationFrameV1Effect(input),
  ));
}

async function expectDecodeFailure(
  canonicalBytes: Uint8Array,
  expectedSha256Hex: string,
  reason: AppSchemaCandidateValidationCodecV1Error["issue"]["reason"],
): Promise<void> {
  const result = await runEffect(Effect.result(
    decodeCanonicalAppSchemaCandidateValidationFrameV1Effect({
      canonicalBytes,
      expectedSha256Hex,
    }),
  ));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.issue.reason).toBe(reason);
}

function identity() {
  return {
    codecVersion: 1,
    budgetIdentity: APP_SCHEMA_CANDIDATE_VALIDATION_BUDGET_IDENTITY_V1,
    scopeId: "scope_00000000-0000-0000-0000-000000000001",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 7n,
    scopeEpoch: "epoch_00000000-0000-0000-0000-000000000002",
    schemaVersionId: "schema_cooking_v2",
    schemaManifestSha256Hex: digest(1),
    frontierCommitSeq: 10n,
    attemptFence: 3n,
  } as const;
}

function progress() {
  return {
    kind: "app_schema_candidate_validation_progress",
    ...identity(),
    progressSequence: 2n,
    previousProgressSha256Hex: digest(2),
    cursor: {
      afterTableId: 1,
      afterRowId: "01".repeat(16),
    },
    validatedRowCount: 128n,
    validatedPageCount: 1n,
    validatedSemanticBytes: 4_096n,
  } as const;
}

function failureEvidence() {
  return {
    kind: "app_schema_candidate_validation_failure_evidence",
    ...identity(),
    progressSha256Hex: digest(3),
    observedFailureCount: 2n,
    truncated: false,
    entries: [
      failureEntry(1, "name"),
      failureEntry(2, "slug"),
    ],
  } as const;
}

function snapshotFailureEvidence() {
  return {
    ...failureEvidence(),
    observedFailureCount: 1n,
    entries: [{
      ...failureEntry(1, "name"),
      observedCommitSeq: 9n,
      source: "snapshotScan",
    }],
  } as const;
}

function failureEntry(seed: number, field: string) {
  return {
    tableId: 1,
    rowId: seed.toString(16).padStart(2, "0").repeat(16),
    observedCommitSeq: BigInt(10 + seed),
    source: "pointCommit",
    reason: "candidateValidatorRejected",
    validatorPath: `$document.${field}`,
  } as const;
}

function receipt() {
  return {
    kind: "app_schema_candidate_validation_receipt",
    ...identity(),
    finalProgressSha256Hex: digest(4),
    validatedRowCount: 256n,
    validatedPageCount: 2n,
    validatedSemanticBytes: 8_192n,
    settlementCommitSeq: 12n,
    scanCompleted: true,
    settledAt: "2026-08-11T00:00:00.000Z",
  } as const;
}

function digest(seed: number): string {
  return seed.toString(16).padStart(2, "0").repeat(32);
}

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}
