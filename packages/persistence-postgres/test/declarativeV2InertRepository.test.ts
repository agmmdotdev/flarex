import { webcrypto } from "node:crypto";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";

import {
  makeDeclarativeV2InertRepositoryV1,
} from "../src/declarativeV2InertRepository";
import type { AppRowTransaction } from "../src/appRows";
import {
  DeclarativeV2Sha256ResourceV1Error,
} from "../src/declarativeV2Sha256";
import {
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
} from "../src/pglite";
import {
  isLocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../src/transactionSessionAttemptKernel";
import {
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
  insertSessionTestScope,
} from "./sessionAuthorityTestSupport";
import {
  runEffect,
  runEffectFailure,
} from "./effectTestRuntime";

const scopeId = `scope_${SESSION_TEST_SCOPE_UUID}`;
const epoch = `epoch_${SESSION_TEST_EPOCH_UUID}`;
const generousCodecBudget = {
  maximumFrameBytes: 1_000_000,
  maximumCanonicalBytes: 1_000_000,
} as const;

describe("Declarative V2 inert repository", () => {
  it("inserts, exactly replays, and metadata-first reloads owned evidence", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await insertSessionTestScope(persistence);
    const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
      persistence,
      {
        kind: "shared_database",
        databaseKey: "primary",
        schemaName: "public",
      },
    );
    if (!isLocatedReadCommittedAttemptTargetV1(target)) {
      throw new Error("Expected a located READ COMMITTED target.");
    }
    const repository = makeDeclarativeV2InertRepositoryV1(target);
    const candidate = candidateFixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const exactBytes = encoded.canonicalBytes.byteLength;
    const insertBudget = {
      maximumCalls: 1,
      maximumFrameBytes: exactBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
      maximumHashBytes: exactBytes,
    } as const;

    const inserted = await runEffect(
      repository.insertCandidate(candidate, insertBudget),
    );
    expect(inserted).toMatchObject({
      kind: "inserted",
      usage: {
        calls: 1,
        frameBytes: exactBytes,
        canonicalBytes: encoded.usage.canonicalBytes,
        hashBytes: exactBytes,
      },
    });
    const replayed = await runEffect(
      repository.insertCandidate(candidate, {
        ...insertBudget,
        maximumCalls: 3,
        maximumFrameBytes: exactBytes * 2,
      }),
    );
    expect(replayed.kind).toBe("replayed");
    expect(replayed.candidateSha256).not.toBe(inserted.candidateSha256);
    expect(replayed.candidateSha256).toEqual(inserted.candidateSha256);

    const present = await runEffect(
      repository.readCandidate(scopeId, inserted.candidateSha256, {
        maximumCalls: 2,
        maximumFrameBytes: exactBytes * 2,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: exactBytes,
      }),
    );
    expect(present.kind).toBe("present");
    if (present.kind !== "present") throw new Error("Expected candidate.");
    expect(present.frame).toEqual(candidate);
    expect(present.canonicalBytes).toEqual(encoded.canonicalBytes);
    expect(present.canonicalBytes).not.toBe(encoded.canonicalBytes);
    expect(present.usage).toEqual({
      calls: 2,
      frameBytes: exactBytes * 2,
      canonicalBytes: encoded.usage.canonicalBytes,
      hashBytes: exactBytes,
    });

    candidate.sourceRootSha256[0] = 0xff;
    encoded.canonicalBytes[0] = 0xff;
    inserted.candidateSha256[0] = 0xff;
    const reread = await runEffect(
      repository.readCandidate(scopeId, replayed.candidateSha256, {
        maximumCalls: 2,
        maximumFrameBytes: exactBytes * 2,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: exactBytes,
      }),
    );
    expect(reread.kind).toBe("present");
    if (reread.kind !== "present") throw new Error("Expected candidate.");
    expect(reread.frame.sourceRootSha256[0]).toBe(1);
  });

  it("enforces exact and one-less budgets before the next operation", async () => {
    const { persistence, repository } = await fixture();
    const candidate = candidateFixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const exactBytes = encoded.canonicalBytes.byteLength;
    const base = {
      maximumCalls: 1,
      maximumFrameBytes: exactBytes,
      maximumCanonicalBytes: encoded.usage.canonicalBytes,
      maximumHashBytes: exactBytes,
    };
    const insertFrameFailure = await runEffectFailure(
      repository.insertCandidate(candidate, {
        ...base,
        maximumFrameBytes: exactBytes - 1,
      }),
    );
    expect(insertFrameFailure).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryInputV1Error",
      reason: "budgetExceeded",
      dimension: "frameBytes",
      observed: exactBytes,
      maximum: exactBytes - 1,
    });
    const inserted = await runEffect(repository.insertCandidate(
      candidate,
      base,
    ));

    const callFailure = await runEffectFailure(
      repository.readCandidate(scopeId, inserted.candidateSha256, {
        ...base,
        maximumCalls: 1,
      }),
    );
    expect(callFailure).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryInputV1Error",
      reason: "budgetExceeded",
      dimension: "calls",
      observed: 2,
      maximum: 1,
    });

    const byteFailure = await runEffectFailure(
      repository.readCandidate(scopeId, inserted.candidateSha256, {
        ...base,
        maximumCalls: 2,
        maximumFrameBytes: exactBytes - 1,
      }),
    );
    expect(byteFailure).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryInputV1Error",
      reason: "budgetExceeded",
      dimension: "frameBytes",
      observed: exactBytes,
      maximum: exactBytes - 1,
    });

    const rows = await persistence.query<{ frame_bytes: Uint8Array }>(
      "select frame_bytes from fx_system_declarative_v2_candidate",
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("fails closed on canonical-byte corruption without touching V1 rows", async () => {
    const { persistence, repository } = await fixture();
    const candidate = candidateFixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const exactBytes = encoded.canonicalBytes.byteLength;
    const inserted = await runEffect(repository.insertCandidate(
      candidate,
      {
        maximumCalls: 1,
        maximumFrameBytes: exactBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: exactBytes,
      },
    ));
    await persistence.query(
      `
        update fx_system_declarative_v2_candidate
        set frame_bytes = overlay(frame_bytes placing decode('00', 'hex') from 1 for 1)
        where scope_id = $1
      `,
      [scopeId],
    );

    const failure = await runEffectFailure(repository.readCandidate(
      scopeId,
      inserted.candidateSha256,
      {
        maximumCalls: 2,
        maximumFrameBytes: exactBytes * 2,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: exactBytes,
      },
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryCorruptionV1Error",
    });
    await persistence.query(
      "alter table fx_system_declarative_v2_candidate drop constraint fx_dv2_candidate_frame_check",
    );
    await persistence.query(
      `
        update fx_system_declarative_v2_candidate
        set frame_byte_length = 0
        where scope_id = $1
      `,
      [scopeId],
    );
    const metadataFailure = await runEffectFailure(repository.readCandidate(
      scopeId,
      inserted.candidateSha256,
      {
        maximumCalls: 2,
        maximumFrameBytes: exactBytes * 2,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: exactBytes,
      },
    ));
    expect(metadataFailure).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryCorruptionV1Error",
      reason: "invalidMetadata",
    });
    const v1Counts = await persistence.query<{ count: string }>(
      "select count(*)::text as count from deployment_packages",
    );
    expect(v1Counts.rows).toEqual([{ count: "0" }]);
  });

  it("preserves typed hash resource failures and package-private surfaces", async () => {
    const { target } = await targetFixture();
    const resourceError = new DeclarativeV2Sha256ResourceV1Error({
      reason: "unavailable",
    });
    const repository = makeDeclarativeV2InertRepositoryV1(
      target,
      (_input, _budget) => Effect.fail(resourceError),
    );
    const candidate = candidateFixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const failure = await runEffectFailure(repository.insertCandidate(
      candidate,
      {
        maximumCalls: 1,
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: encoded.usage.frameBytes,
      },
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2Sha256ResourceV1Error",
    });

    const packageJson = await import("../package.json", {
      with: { type: "json" },
    });
    expect(packageJson.default.exports).not.toHaveProperty(
      "./declarative-v2-inert-repository",
    );
  });

  it("rejects blank authority values before hashing or transaction work", async () => {
    const { target } = await targetFixture();
    let hashes = 0;
    const repository = makeDeclarativeV2InertRepositoryV1(
      target,
      () => {
        hashes += 1;
        return Effect.succeed(digest(0x71));
      },
    );
    for (const candidate of [
      { ...candidateFixture(), scopeId: " " },
      { ...candidateFixture(), scopeEpoch: "\t" },
    ]) {
      const failure = await runEffectFailure(repository.insertCandidate(
        candidate,
        {
          maximumCalls: 1,
          maximumFrameBytes: 1_000_000,
          maximumCanonicalBytes: 1_000_000,
          maximumHashBytes: 1_000_000,
        },
      ));
      expect(failure).toMatchObject({
        _tag: "DeclarativeV2InertRepositoryInputV1Error",
        reason: "invalidInput",
      });
    }
    expect(hashes).toBe(0);
  });

  it("returns an owned observation key after decision-uncertain insert settlement", async () => {
    const { target } = await targetFixture();
    const uncertainTarget = Object.create(target) as
      LocatedReadCommittedAttemptTargetV1;
    const settlementCause = new Error("settlement unknown");
    Object.defineProperty(uncertainTarget, RUN_LOCATED_READ_COMMITTED_V1, {
      configurable: true,
      value: async () => {
        throw new LocatedReadCommittedTransactionFailureV1({
          kind: "decisionUncertain",
          settlementCause,
        });
      },
    });
    const repository = makeDeclarativeV2InertRepositoryV1(uncertainTarget);
    const candidate = candidateFixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const expectedDigest = new Uint8Array(await webcrypto.subtle.digest(
      "SHA-256",
      new Uint8Array(encoded.canonicalBytes),
    ));
    const failure = await runEffectFailure(repository.insertCandidate(
      candidate,
      {
        maximumCalls: 1,
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: encoded.usage.frameBytes,
      },
    ));
    expect(failure).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryDecisionUncertainV1Error",
      operation: "insertCandidate",
      scopeId,
      candidateSha256: expectedDigest,
      cause: {
        issue: {
          kind: "decisionUncertain",
          settlementCause,
        },
      },
    });
    if (
      failure._tag !==
        "DeclarativeV2InertRepositoryDecisionUncertainV1Error"
    ) {
      throw new Error("Expected decision uncertainty.");
    }
    expect(failure.candidateSha256).not.toBe(expectedDigest);
    expect(failure).not.toHaveProperty("kind");
  });

  it("preserves synchronous statement defects and maps rejected statements", async () => {
    const { target } = await targetFixture();
    const defectTarget = Object.create(target) as
      LocatedReadCommittedAttemptTargetV1;
    const defect = new TypeError("unexpected callback defect");
    const fakeTransaction = {
      insert() {
        throw defect;
      },
    } as unknown as AppRowTransaction;
    Object.defineProperty(defectTarget, RUN_LOCATED_READ_COMMITTED_V1, {
      configurable: true,
      value: async (
        work: (tx: AppRowTransaction) => Promise<unknown>,
      ) => {
        try {
          return await work(fakeTransaction);
        } catch (callbackCause) {
          throw new LocatedReadCommittedTransactionFailureV1({
            kind: "callbackRolledBack",
            callbackCause,
          });
        }
      },
    });
    const repository = makeDeclarativeV2InertRepositoryV1(defectTarget);
    const candidate = candidateFixture();
    const encoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const exit = await runEffect(Effect.exit(repository.insertCandidate(
      candidate,
      {
        maximumCalls: 1,
        maximumFrameBytes: encoded.usage.frameBytes,
        maximumCanonicalBytes: encoded.usage.canonicalBytes,
        maximumHashBytes: encoded.usage.frameBytes,
      },
    )));
    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit)) {
      throw new Error("Expected defect exit.");
    }
    expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);

    const rejectedStatement = await runEffectFailure(
      makeDeclarativeV2InertRepositoryV1(target).insertCandidate(
        { ...candidate, scopeId: "scope_missing" },
        {
          maximumCalls: 1,
          maximumFrameBytes: encoded.usage.frameBytes,
          maximumCanonicalBytes: encoded.usage.canonicalBytes,
          maximumHashBytes: encoded.usage.frameBytes,
        },
      ),
    );
    expect(rejectedStatement).toMatchObject({
      _tag: "DeclarativeV2InertRepositoryConfirmedRollbackV1Error",
      operation: "insertCandidate",
    });
  });

  it("enforces local FKs and fail-closed nullable lifecycle groups", async () => {
    const { persistence, repository } = await fixture();
    const candidate = candidateFixture();
    const candidateEncoded = Result.getOrThrow(
      encodeDeclarativeV2PhysicalFrameV1(candidate, generousCodecBudget),
    );
    const inserted = await runEffect(repository.insertCandidate(
      candidate,
      {
        maximumCalls: 1,
        maximumFrameBytes: candidateEncoded.usage.frameBytes,
        maximumCanonicalBytes: candidateEncoded.usage.canonicalBytes,
        maximumHashBytes: candidateEncoded.usage.frameBytes,
      },
    ));
    const ceilings = await evidence({
      kind: "attempt_ceilings",
      ...zeroBudgets(),
    });
    const usage = await evidence({
      kind: "attempt_usage",
      ...zeroBudgets(),
    });
    const progress = await evidence({
      kind: "progress_cursor",
      phase: "source",
      settledSequence: 0n,
      moduleOrdinal: 0n,
      edgeOrdinal: 0n,
      pageOrdinal: 0n,
      previousReceiptSha256: null,
    });
    const identity = await evidence({
      kind: "attempt_identity",
      candidateSha256: inserted.candidateSha256,
      verifierProgressProtocolIdentity: "progress-v1",
      ceilingsSha256: ceilings.sha256,
    });
    await persistence.query(
      `
        insert into fx_system_declarative_v2_verifier_attempt (
          scope_id, attempt_sha256, candidate_sha256, lifecycle, writer_fence,
          settled_sequence,
          identity_codec_version, identity_byte_length, identity_sha256,
          identity_bytes,
          ceilings_codec_version, ceilings_byte_length, ceilings_sha256,
          ceilings_bytes,
          usage_codec_version, usage_byte_length, usage_sha256, usage_bytes,
          progress_codec_version, progress_byte_length, progress_sha256,
          progress_bytes
        ) values (
          $1, $2, $3, 'open', 0, 0,
          1, $4, $2, $5,
          1, $6, $7, $8,
          1, $9, $10, $11,
          1, $12, $13, $14
        )
      `,
      [
        scopeId,
        identity.sha256,
        inserted.candidateSha256,
        identity.bytes.byteLength,
        identity.bytes,
        ceilings.bytes.byteLength,
        ceilings.sha256,
        ceilings.bytes,
        usage.bytes.byteLength,
        usage.sha256,
        usage.bytes,
        progress.bytes.byteLength,
        progress.sha256,
        progress.bytes,
      ],
    );

    await expect(persistence.query(
      `
        update fx_system_declarative_v2_verifier_attempt
        set pending_kind = 'source_page'
        where scope_id = $1 and attempt_sha256 = $2
      `,
      [scopeId, identity.sha256],
    )).rejects.toThrow(/fx_dv2_attempt_pending_check/);

    await expect(persistence.query(
      `
        insert into fx_system_declarative_v2_page_manifest (
          scope_id, attempt_sha256, phase, page_ordinal, first_item_ordinal,
          item_count, previous_page_sha256, frame_codec_version,
          frame_byte_length, frame_sha256, frame_bytes
        ) values ($1, $2, 'source', 0, 0, 1, $3, 1, 1, $4, $5)
      `,
      [
        scopeId,
        identity.sha256,
        digest(0x41),
        digest(0x42),
        new Uint8Array([1]),
      ],
    )).rejects.toThrow(/fx_dv2_page_range_check/);

    await expect(persistence.query(
      `
        insert into fx_system_declarative_v2_page_manifest (
          scope_id, attempt_sha256, phase, page_ordinal, first_item_ordinal,
          item_count, previous_page_sha256, frame_codec_version,
          frame_byte_length, frame_sha256, frame_bytes
        ) values ($1, $2, 'source', 1, 1, 1, null, 1, 1, $3, $4)
      `,
      [
        scopeId,
        identity.sha256,
        digest(0x43),
        new Uint8Array([1]),
      ],
    )).rejects.toThrow(/fx_dv2_page_range_check/);

    await expect(persistence.query(
      `
        insert into fx_system_declarative_v2_verdict (
          scope_id, attempt_sha256, candidate_sha256, verdict_sha256,
          verdict, failure_code, frame_codec_version, frame_byte_length,
          frame_sha256, frame_bytes
        ) values ($1, $2, $3, $4, 'rejected', null, 1, 1, $4, $5)
      `,
      [
        scopeId,
        identity.sha256,
        inserted.candidateSha256,
        digest(0x31),
        new Uint8Array([1]),
      ],
    )).rejects.toThrow(/fx_dv2_verdict_state_check/);

    await expect(persistence.query(
      `
        insert into fx_system_declarative_v2_activation_head (
          scope_id, revision_counter, current_revision, candidate_sha256,
          verdict_sha256, frame_codec_version, frame_byte_length,
          frame_sha256, frame_bytes
        ) values ($1, 0, null, $2, null, 1, 1, $3, $4)
      `,
      [
        scopeId,
        inserted.candidateSha256,
        digest(0x32),
        new Uint8Array([1]),
      ],
    )).rejects.toThrow(/fx_dv2_head_state_check/);

    await expect(persistence.query(
      `
        insert into fx_system_declarative_v2_candidate (
          scope_id, candidate_sha256, storage_generation,
          storage_generation_fence, epoch, frame_codec_version,
          frame_byte_length, frame_sha256, frame_bytes
        ) values (
          'scope_missing', $1, 'flarexdb_v1', 1, 'epoch_missing',
          1, 1, $1, $2
        )
      `,
      [digest(0x33), new Uint8Array([1])],
    )).rejects.toThrow(/fx_dv2_candidate_scope_fk/);
  });
});

async function fixture() {
  const { persistence, target } = await targetFixture();
  return {
    persistence,
    repository: makeDeclarativeV2InertRepositoryV1(target),
  };
}

async function targetFixture() {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    {
      kind: "shared_database",
      databaseKey: "primary",
      schemaName: "public",
    },
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located READ COMMITTED target.");
  }
  return { persistence, target };
}

function candidateFixture(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project",
    deploymentId: "deployment",
    deploymentCreatedAt: "2026-07-23T00:00:00.000Z",
    scopeId,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: epoch,
    sourceRootSha256: digest(1),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    runtimeProjectionSetSha256: digest(13),
    functionGroupManifestSha256: digest(14),
    readinessPolicyIdentity:
      "flarex.readiness/runtime-projection-cold-materialization/v1",
  };
}

function digest(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function zeroBudgets() {
  return {
    calls: 0n,
    sourceBytes: 0n,
    modules: 0n,
    importEdges: 0n,
    tokens: 0n,
    tokenBytes: 0n,
    nestingDepth: 0n,
    functions: 0n,
    schemaNodes: 0n,
    validatorNodes: 0n,
    graphNodes: 0n,
    frontierEntries: 0n,
    canonicalBytes: 0n,
    frameBytes: 0n,
    hashBytes: 0n,
    diagnosticBytes: 0n,
    outputBytes: 0n,
    elapsedMilliseconds: 0n,
  } as const;
}

async function evidence(frame: unknown): Promise<Readonly<{
  bytes: Uint8Array;
  sha256: Uint8Array;
}>> {
  const encoded = Result.getOrThrow(
    encodeDeclarativeV2PhysicalFrameV1(frame, generousCodecBudget),
  );
  const digestBuffer = await webcrypto.subtle.digest(
    "SHA-256",
    new Uint8Array(encoded.canonicalBytes),
  );
  return Object.freeze({
    bytes: new Uint8Array(encoded.canonicalBytes),
    sha256: new Uint8Array(digestBuffer),
  });
}
