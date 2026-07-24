import { Cause, Effect, Encoding, Exit, Fiber, Random, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import {
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDecisionUncertainV1Error,
  PointCommitSqlErrorV1,
  PointCommitStaleAuthorityV1Error,
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  type CommittedPointOutcomeResolutionV1,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionResultV1,
  type PointCommitPublicationCommandV1,
  type PointCommitPublicationResultV1,
  type PointCommitPublicationV1Error,
  type PointCommitPublisherPortV1,
  type PointCommitOutcomeResolutionPortV1,
  type PointCommitRollbackProofPortV1,
  type PointCommitTransactionCommandV1,
  type PointMutationAttemptReplacementCommandV1,
  type PointMutationAttemptReplacementObservationV1,
  type PointMutationAttemptReplacementPortV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import {
  AppCreationTimeV1Schema,
  canonicalizeAppDocumentV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdV1,
  decodeAppDocumentIdentityV1,
  type AppDocumentIdV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  CanonicalSessionJournalBase64UrlV1Schema,
  CanonicalSuccessfulResultBytesV1Schema,
  CommitDocumentSemanticBytesV1Schema,
  CommitEnvelopeV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  CommitProtocolV1Error,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
  type CanonicalSessionJournalV1,
  type CanonicalSuccessfulResultV1,
  type CommitEnvelopeV1,
  type LogicalReadDependencyV1,
  type SessionJournalV1,
} from "flarex-protocol/commit-protocol";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import {
  isJsonObjectFromUnknown,
  type JsonObject,
} from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1,
  PointMutationTargetSelectionV1Error,
  decodeActivePointMutationTargetMetadataV1,
  preparePointMutationStartEvidenceV1,
} from "flarex-protocol/point-mutation-start";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ReplacementScopeIdV1Schema,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeScopeEpochUuidV1,
  decodeScopeUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionSessionIdV1Schema,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  FlarexValueSha256V1Schema,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import * as executorRoot from "../src/index";
// @ts-expect-error C04A capability types must remain absent from the package root.
import type { AuthenticatedStoredAttemptV1 as ForbiddenRootCapability } from "../src/index";
// @ts-expect-error C04B1 capability types must remain absent from the package root.
import type { AuthenticatedCommitAuthorityV1 as ForbiddenCommitAuthority } from "../src/index";
// @ts-expect-error C04B2 capability types must remain absent from the package root.
import type { VerifiedCommitInputV1 as ForbiddenVerifiedCommitInput } from "../src/index";
// @ts-expect-error C04C1 capability types must remain absent from the package root.
import type { PreparedPointCommitV1 as ForbiddenPreparedPointCommit } from "../src/index";
// @ts-expect-error O06 proof capability types must remain absent from the package root.
import type { StoredPointCommitRollbackProofV1 as ForbiddenPointCommitProof } from "../src/index";
// @ts-expect-error O07-B publisher capability types must remain absent from the package root.
import type { StoredPointCommitPublisherV1 as ForbiddenPointCommitPublisher } from "../src/index";
// @ts-expect-error C05-A continuation capability types must remain absent from the package root.
import type { FinishingPreparedPointCommitV1 as ForbiddenFinishingPointCommit } from "../src/index";
// @ts-expect-error C05-B executor capability types must remain absent from the package root.
import type { StoredPointCommitExecutorV1 as ForbiddenPointCommitExecutor } from "../src/index";
// @ts-expect-error O08-A replacement authority must remain absent from the package root.
import type { StoredPointMutationAttemptReplacementV1 as ForbiddenAttemptReplacement } from "../src/index";
// @ts-expect-error O08-B1 rerun authority must remain absent from the package root.
import type { AuthorizedPointMutationOccRerunV1 as ForbiddenOccRerun } from "../src/index";
import {
  createPointMutationSessionAttemptLoadingV1,
  InvalidPointMutationSessionAttemptSelectorV1Error,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../src/pointMutationSessionActivation";
import type {
  PointMutationSessionAttemptLoadResultV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "@flarex/persistence-postgres/transaction-execution-claim";
import {
  createPointMutationExecutionClaimVaultV1,
  type PointMutationExecutionScopeV1,
} from
  "../src/pointMutationExecutionClaim";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
  TransactionGrantVerificationV1Error,
} from "../src/transactionGrant";
import {
  CommitDocumentValidationV1Error,
  CommitInputAuthorityCorruptionV1Error,
  CommitSuccessfulResultValidationV1Error,
  InvalidAuthenticatedCommitAuthorityV1Error,
  InvalidAuthenticatedStoredAttemptV1Error,
  InvalidPreparedPointCommitV1Error,
  InvalidAuthorizedPointMutationOccRerunV1Error,
  InvalidPointMutationOccConflictV1Error,
  PointMutationOccRerunAuthorityCorruptionV1Error,
  PointMutationOccRerunExhaustedV1Error,
  PointMutationOccRerunFreshAttemptV1Error,
  PointMutationOccRerunOwnershipLostV1Error,
  PointCommitKnownSettledSqlRetryExhaustedV1Error,
  PointCommitPlannerInvariantV1Defect,
  PointCommitUncertainOutcomeRecoveryCorruptionV1Error,
  PointCommitUncertainOutcomeUnresolvedV1Error,
  InvalidVerifiedCommitInputV1Error,
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityConfigurationV1Error,
  StoredCommitAuthorityMismatchV1Error,
  StoredCommitAuthorityPersistenceV1Error,
  InvalidStoredAttemptAuthorityV1Error,
  StoredAttemptAlreadyCommittedV1Error,
  StoredAttemptAuthorityMismatchV1Error,
  StoredAttemptEnvelopeMismatchV1Error,
  StoredAttemptNotPlannableV1Error,
  StoredAttemptStorageCorruptionV1Error,
  UnsupportedPointCommitPlanV1Error,
  createStoredAttemptAuthenticationV1,
  createStoredPointCommitExecutorV1,
  createStoredPointCommitFinishingTransitionV1,
  createStoredPointCommitPlanningV1,
  createStoredPointCommitPublisherV1,
  createStoredPointCommitRollbackProofV1,
  createStoredPointMutationAttemptReplacementV1,
  createStoredPointMutationOccRerunAuthorizationV1,
  type StoredAttemptAuthenticationV1,
  type StoredAttemptEvidenceLoadResultPortV1,
  type StoredAttemptEvidencePortV1,
  type StoredCommitAuthorityEvidencePortV1,
} from "../src/storedAttemptAuthentication";
import {
  verifyCommitInputStateEffect,
  type CommitInputVerificationSourceV1,
  type VerifiedCommitInputStateV1,
  type VerifiedCommitPointV1,
} from "../src/storedAttemptAuthentication/commitInputVerification";
import {
  planPointCommitStateV1,
  type PreparedPointCommitStateV1,
} from "../src/storedAttemptAuthentication/pointCommitPlanning";
import {
  runEffect,
  runEffectFailure as runFailure,
} from "./effectTestRuntime";

const DEPLOYMENT_ID = TransactionGrantDeploymentIdV1Schema.make(
  "deployment_c04a_executor",
);
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_918f22e2-58cc-4b2a-91d8-f3f3401a0874",
);
const SCOPE_UUID = decodeScopeUuidV1(
  "918f22e2-58cc-4b2a-91d8-f3f3401a0874",
);
const SESSION_ID = TransactionSessionIdV1Schema.make(
  "91000000-0000-4000-8000-000000000001",
);
const ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(7n);
const STORAGE_FENCE = StorageGenerationFenceSchema.make(3n);
const SCHEMA_VERSION_ID = CatalogSchemaVersionIdSchema.make(
  "schema_c04a_executor",
);
const SNAPSHOT = SnapshotTokenSchema.make({
  scopeId: SCOPE_ID,
  epoch: ScopeEpochSchema.make("epoch_c04a_executor"),
  commitSeq: CommitSeqSchema.make(19n),
});
const SELECTOR = Object.freeze({
  deploymentId: DEPLOYMENT_ID,
  scopeId: SCOPE_ID,
  sessionId: SESSION_ID,
  attemptFence: ATTEMPT_FENCE.toString(),
} satisfies PointMutationSessionAttemptSelectorWireV1);
const TEST_EXECUTION_CLAIM_OBSERVATION = Object.freeze({
  claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
    "91000000-0000-4000-8000-000000000002",
  ),
  claimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
  claimedAt: "2026-07-16T00:00:00.000Z",
  claimExpiresAt: "2098-12-31T23:59:00.000Z",
});
const TEST_EXECUTION_CLAIMS = createPointMutationExecutionClaimVaultV1();
const TEST_EXECUTION_SCOPES = new WeakMap<
  object,
  PointMutationExecutionScopeV1
>();
const makeTestExecutionScope = (
  attemptFence: bigint = ATTEMPT_FENCE,
): PointMutationExecutionScopeV1 => Effect.runSync(Effect.fromResult(
  TEST_EXECUTION_CLAIMS.admission.admit(
    TEST_EXECUTION_CLAIMS.issuer.mint({
      selector: Object.freeze({
        deploymentId: DEPLOYMENT_ID,
        scopeId: SCOPE_ID,
        sessionId: SESSION_ID,
        attemptFence: TransactionAttemptFenceSchema.make(attemptFence),
      }),
      observation: TEST_EXECUTION_CLAIM_OBSERVATION,
      mode: "execute",
    }),
    "execute",
  ),
));
const testExecutionScopeFor = (
  authentication: StoredAttemptAuthenticationV1,
): PointMutationExecutionScopeV1 => {
  const existing = TEST_EXECUTION_SCOPES.get(authentication);
  if (existing !== undefined) return existing;
  const created = makeTestExecutionScope();
  TEST_EXECUTION_SCOPES.set(authentication, created);
  return created;
};
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describe("C04A stored-attempt authentication", () => {
  it("rejects malformed and inline carriage before authority inspection or I/O", async () => {
    const fixture = await emptyFixture();
    let loadCalls = 0;
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.sync(() => {
        loadCalls += 1;
        return loaded(fixture.evidence);
      }),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(authentication);
    const inline: CommitEnvelopeV1 = {
      ...fixture.envelope,
      journal: {
        kind: "inlineUntrusted",
        canonicalJournalBase64Url:
          CanonicalSessionJournalBase64UrlV1Schema.make(
            Encoding.encodeBase64Url(fixture.journal.canonicalBytes),
          ),
      },
    };

    const malformedFailure = await runFailure(
      authentication.authenticate(authority, null),
    );
    const inlineFailure = await runFailure(
      authentication.authenticate(authority, encodeEnvelope(inline)),
    );

    expect(malformedFailure).toBeInstanceOf(CommitProtocolV1Error);
    expect(inlineFailure).toBeInstanceOf(CommitProtocolV1Error);
    expect(inlineFailure).toMatchObject({
      issue: { reason: "inlineJournalCarriageDormant" },
    });
    expect(loadCalls).toBe(0);
  });

  it("uses verifier-local WeakMap membership for both capabilities", async () => {
    const fixture = await emptyFixture();
    let loadCalls = 0;
    const first = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.sync(() => {
        loadCalls += 1;
        return loaded(fixture.evidence);
      }),
    }, TEST_EXECUTION_CLAIMS);
    const second = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(first);

    const forgedFailure = await runFailure(Reflect.apply(
      first.authenticate,
      undefined,
      [Object.freeze({}), encodeEnvelope(fixture.envelope)],
    ));
    const crossInstanceFailure = await runFailure(
      second.authenticate(authority, encodeEnvelope(fixture.envelope)),
    );

    expect(forgedFailure).toBeInstanceOf(
      InvalidStoredAttemptAuthorityV1Error,
    );
    expect(crossInstanceFailure).toBeInstanceOf(
      InvalidStoredAttemptAuthorityV1Error,
    );
    expect(loadCalls).toBe(0);
  });

  it("returns an opaque, non-forgeable, non-exported authenticated capability", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "AuthenticatedStoredAttemptV1"
      | "AuthenticatedCommitAuthorityV1"
      | "createStoredAttemptAuthenticationV1"
      | "createStoredPointCommitPlanningV1"
      | "createStoredPointCommitRollbackProofV1"
      | "createStoredPointCommitPublisherV1"
      | "createStoredPointCommitFinishingTransitionV1"
      | "createStoredPointCommitExecutorV1"
      | "createStoredPointMutationAttemptReplacementV1"
      | "createStoredPointMutationOccRerunAuthorizationV1"
      | "createStoredPointMutationOccRerunExecutionV1"
      | "createStoredPointMutationCrashRedispatchV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    for (
      const constructorName of [
        "createStoredAttemptAuthenticationV1",
        "createStoredPointCommitPlanningV1",
        "createStoredPointCommitRollbackProofV1",
        "createStoredPointCommitPublisherV1",
        "createStoredPointCommitFinishingTransitionV1",
        "createStoredPointCommitExecutorV1",
        "createStoredPointMutationAttemptReplacementV1",
        "createStoredPointMutationOccRerunAuthorizationV1",
        "createStoredPointMutationOccRerunExecutionV1",
        "createStoredPointMutationCrashRedispatchV1",
      ] as const
    ) {
      expect(constructorName in executorRoot).toBe(false);
    }

    const fixture = await insertFixture({ name: "detached" });
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(authentication);
    const authenticated = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(fixture.envelope),
    ));

    expect(authentication.isAuthenticated(authenticated)).toBe(true);
    expect(authentication.isAuthenticated({ ...authenticated })).toBe(false);
    expect(authentication.isAuthenticated(
      structuredClone(authenticated),
    )).toBe(false);
    expect(JSON.stringify(authenticated)).toBe("{}");
    expect(Reflect.ownKeys(authenticated)).toHaveLength(1);

    expect(authentication.remainsAuthenticatedStateUnchangedForTest(
      authenticated,
      () => {
        Object.assign(fixture.evidence.session, { packageId: "mutated" });
        fixture.evidence.root.journalBytes.fill(0);
        fixture.evidence.root.journalSha256.fill(0);
        fixture.evidence.root.resultBytes.fill(0);
        fixture.evidence.root.resultSha256.fill(0);
        const sourcePoint = requirePoint(fixture.evidence);
        sourcePoint.rowId.fill(0);
        sourcePoint.overlayValueBytes?.fill(0);
        if (sourcePoint.overlayValueJson !== null) {
          Object.assign(sourcePoint.overlayValueJson, { name: "mutated" });
        }
      },
    )).toBe(true);
    expect(authentication.isAuthenticated(authenticated)).toBe(true);
  });

  it("does not inspect dependencies above the requested lifecycle facet", async () => {
    const current = await commitAuthorityFixture();
    let higherStageReads = 0;
    const loader = Object.defineProperty(
      {
        loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
      },
      "loadFinishingEffect",
      {
        get: () => {
          higherStageReads += 1;
          throw new Error("planning must not inspect finishing loading");
        },
      },
    );
    const configuration = Object.defineProperty(
      {
        evidenceLoader: {
          loadEffect: () => Effect.succeed({
            kind: "loaded" as const,
            evidence: current.commitEvidence,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () =>
            Effect.succeed(structuredClone(current.functionSnapshot)),
        },
      },
      "pointCommit",
      {
        get: () => {
          higherStageReads += 1;
          throw new Error("planning must not inspect point commit");
        },
      },
    );

    expect(() =>
      createStoredPointCommitPlanningV1(
        loader,
        configuration,
        TEST_EXECUTION_CLAIMS,
      )
    ).not.toThrow();
    expect(higherStageReads).toBe(0);
  });

  it("does not inspect publication while constructing rollback proof", async () => {
    const current = await commitAuthorityFixture();
    let publicationReads = 0;
    const pointCommit = Object.defineProperty(
      {
        prove: Effect.fn("TestPointCommit.proveConstructionBoundary")(
          () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
        ),
      },
      "publish",
      {
        get: () => {
          publicationReads += 1;
          throw new Error("rollback proof must not inspect publication");
        },
      },
    );

    expect(() =>
      createStoredPointCommitRollbackProofV1(
        {
          loadEffect: () =>
            Effect.succeed(loaded(current.fixture.evidence)),
        },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({
              kind: "loaded" as const,
              evidence: current.commitEvidence,
            }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: {
            load: () =>
              Effect.succeed(structuredClone(current.functionSnapshot)),
          },
          pointCommit,
        },
        TEST_EXECUTION_CLAIMS,
      )
    ).not.toThrow();
    expect(publicationReads).toBe(0);
  });

  it("does not inspect recovery while constructing finishing transition", async () => {
    const current = await commitAuthorityFixture();
    let recoveryReads = 0;
    const loader = Object.defineProperty(
      {
        loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
      },
      "loadFinishingEffect",
      {
        get: () => {
          recoveryReads += 1;
          throw new Error("finishing transition must not inspect recovery");
        },
      },
    );
    const pointCommit = Object.defineProperty(
      {
        prove: Effect.fn("TestPointCommit.proveFinishingConstructionBoundary")(
          () => Effect.die(new Error("finishing construction must not prove")),
        ),
        publish: Effect.fn(
          "TestPointCommit.publishFinishingConstructionBoundary",
        )(
          () =>
            Effect.die(new Error("finishing construction must not publish")),
        ),
      },
      RESOLVE_POINT_COMMIT_OUTCOME_V1,
      {
        get: () => {
          recoveryReads += 1;
          throw new Error(
            "finishing transition must not inspect outcome resolution",
          );
        },
      },
    );

    expect(() =>
      createStoredPointCommitFinishingTransitionV1(
        loader,
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({
              kind: "loaded" as const,
              evidence: current.commitEvidence,
            }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: {
            load: () =>
              Effect.succeed(structuredClone(current.functionSnapshot)),
          },
          pointCommit,
          pointCommitFinishing: {
            enterFinishing: Effect.fn(
              "TestPointCommit.enterFinishingConstructionBoundary",
            )(
              () =>
                Effect.die(
                  new Error("finishing construction must not transition"),
                ),
            ),
          },
        },
        TEST_EXECUTION_CLAIMS,
      )
    ).not.toThrow();
    expect(recoveryReads).toBe(0);
  });

  it("does not inspect OCC rerun dependencies while constructing replacement", async () => {
    const current = await commitAuthorityFixture();
    let occRerunReads = 0;
    const pointCommit = {
      prove: Effect.fn("TestPointCommit.proveReplacementConstructionBoundary")(
        () => Effect.die(new Error("replacement construction must not prove")),
      ),
      publish: Effect.fn(
        "TestPointCommit.publishReplacementConstructionBoundary",
      )(
        () => Effect.die(new Error("replacement construction must not publish")),
      ),
      [RESOLVE_POINT_COMMIT_OUTCOME_V1]: Effect.fn(
        "TestPointCommit.resolveReplacementConstructionBoundary",
      )(
        () => Effect.die(new Error("replacement construction must not resolve")),
      ),
    };
    const configuration = Object.defineProperty(
      {
        evidenceLoader: {
          loadEffect: () => Effect.succeed({
            kind: "loaded" as const,
            evidence: current.commitEvidence,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () =>
            Effect.succeed(structuredClone(current.functionSnapshot)),
        },
        pointCommit,
        pointCommitFinishing: {
          enterFinishing: Effect.fn(
            "TestPointCommit.enterReplacementConstructionBoundary",
          )(
            () =>
              Effect.die(
                new Error("replacement construction must not transition"),
              ),
          ),
        },
        pointMutationAttemptReplacement: {
          replace: Effect.fn(
            "TestPointCommit.replaceConstructionBoundary",
          )(
            () =>
              Effect.die(
                new Error("replacement construction must not replace"),
              ),
          ),
        },
      },
      "pointMutationOccRerun",
      {
        get: () => {
          occRerunReads += 1;
          throw new Error("replacement must not inspect OCC rerun dependencies");
        },
      },
    );

    expect(() =>
      createStoredPointMutationAttemptReplacementV1(
        {
          loadEffect: () =>
            Effect.succeed(loaded(current.fixture.evidence)),
          loadFinishingEffect: () =>
            Effect.succeed(loaded(current.fixture.evidence)),
        },
        configuration,
        TEST_EXECUTION_CLAIMS,
      )
    ).not.toThrow();
    expect(occRerunReads).toBe(0);
  });

  it("preserves typed lifecycle, committed, authority, and corruption results", async () => {
    const fixture = await emptyFixture();
    const cases: ReadonlyArray<Readonly<{
      result: StoredAttemptEvidenceLoadResultPortV1;
      expected: new (...arguments_: never[]) => Error;
    }>> = [
      {
        result: Object.freeze({
          kind: "alreadyCommitted",
          updatedAtMilliseconds: 1_700_000_000_000,
        }),
        expected: StoredAttemptAlreadyCommittedV1Error,
      },
      {
        result: Object.freeze({
          kind: "notPlannable",
          reason: "rootNotSealed",
          rootState: "open",
        }),
        expected: StoredAttemptNotPlannableV1Error,
      },
      {
        result: Object.freeze({
          kind: "authorityMismatch",
          reason: "attemptReplaced",
        }),
        expected: StoredAttemptAuthorityMismatchV1Error,
      },
      {
        result: Object.freeze({
          kind: "corrupt",
          reason: "journalRootInvalid",
        }),
        expected: StoredAttemptStorageCorruptionV1Error,
      },
    ];

    for (const testCase of cases) {
      const authentication = createStoredAttemptAuthenticationV1({
        loadEffect: () => Effect.succeed(testCase.result),
      }, TEST_EXECUTION_CLAIMS);
      const authority = await deriveAuthority(authentication);
      const failure = await runFailure(authentication.authenticate(
        authority,
        encodeEnvelope(fixture.envelope),
      ));
      expect(failure).toBeInstanceOf(testCase.expected);
    }
  });

  it("binds exact envelope, canonical evidence, successful result, and counters", async () => {
    const fixture = await emptyFixture();
    const cases: ReadonlyArray<Readonly<{
      mutate: (
        evidence: StoredAttemptEvidencePortV1,
        envelope: CommitEnvelopeV1,
      ) => void;
      expected: new (...arguments_: never[]) => Error;
      reason?: string;
    }>> = [
      {
        mutate: (_evidence, envelope) => {
          Object.assign(envelope, {
            finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
          });
        },
        expected: StoredAttemptEnvelopeMismatchV1Error,
        reason: "sequence",
      },
      {
        mutate: (_evidence, envelope) => {
          Object.assign(envelope, {
            sessionId: TransactionSessionIdV1Schema.make(
              "91000000-0000-4000-8000-000000000002",
            ),
          });
        },
        expected: StoredAttemptEnvelopeMismatchV1Error,
        reason: "attempt",
      },
      {
        mutate: (_evidence, envelope) => {
          Object.assign(envelope, { journalSha256Hex: "0".repeat(64) });
        },
        expected: StoredAttemptEnvelopeMismatchV1Error,
        reason: "journalDigest",
      },
      {
        mutate: (_evidence, envelope) => {
          Object.assign(envelope.successfulResult, {
            sha256Hex: "0".repeat(64),
          });
        },
        expected: StoredAttemptEnvelopeMismatchV1Error,
        reason: "successfulResult",
      },
      {
        mutate: (evidence) => evidence.root.journalBytes.fill(0),
        expected: StoredAttemptStorageCorruptionV1Error,
        reason: "journalEvidenceInvalid",
      },
      {
        mutate: (evidence) => evidence.root.resultBytes.fill(0),
        expected: StoredAttemptStorageCorruptionV1Error,
        reason: "successfulResultEvidenceInvalid",
      },
      {
        mutate: (evidence) => {
          Object.assign(evidence.root, { readDocuments: 1 });
        },
        expected: StoredAttemptStorageCorruptionV1Error,
      },
      {
        mutate: (evidence) => {
          Object.assign(evidence.session, { schemaVersionId: "stale" });
        },
        expected: StoredAttemptAuthorityMismatchV1Error,
        reason: "schemaChanged",
      },
      {
        mutate: (evidence) => {
          Object.assign(evidence, {
            attemptFence: TransactionAttemptFenceSchema.make(8n),
          });
        },
        expected: StoredAttemptAuthorityMismatchV1Error,
        reason: "attemptReplaced",
      },
      {
        mutate: (evidence) => {
          Object.assign(evidence.session, {
            storageGenerationFence: StorageGenerationFenceSchema.make(4n),
          });
        },
        expected: StoredAttemptAuthorityMismatchV1Error,
        reason: "generationChanged",
      },
      {
        mutate: (evidence) => {
          Object.assign(evidence.lease.snapshotToken, {
            epoch: ScopeEpochSchema.make("epoch_c04a_stale"),
          });
        },
        expected: StoredAttemptAuthorityMismatchV1Error,
        reason: "epochChanged",
      },
      {
        mutate: (evidence) => {
          Object.assign(evidence.lease.snapshotToken, {
            commitSeq: CommitSeqSchema.make(20n),
          });
        },
        expected: StoredAttemptAuthorityMismatchV1Error,
        reason: "snapshotChanged",
      },
    ];

    for (const testCase of cases) {
      const evidence = structuredClone(fixture.evidence);
      const envelope = structuredClone(fixture.envelope);
      testCase.mutate(evidence, envelope);
      const authentication = createStoredAttemptAuthenticationV1({
        loadEffect: () => Effect.succeed(loaded(evidence)),
      }, TEST_EXECUTION_CLAIMS);
      const authority = await deriveAuthority(authentication);
      const failure = await runFailure(authentication.authenticate(
        authority,
        encodeEnvelope(envelope),
      ));
      expect(failure).toBeInstanceOf(testCase.expected);
      if (testCase.reason !== undefined) {
        expect(failure).toMatchObject({ reason: testCase.reason });
      }
    }
  });

  it("correlates exact insert and live overlay evidence", async () => {
    const fixture = await insertFixture({ name: "Ada", active: true });
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(authentication);

    await expect(runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(fixture.envelope),
    ))).resolves.toSatisfy(authentication.isAuthenticated);
  });

  it("correlates complete replace and terminal delete overlays", async () => {
    for (const fixture of [
      await replaceFixture({ name: "Grace", active: true }),
      await deleteFixture(),
    ]) {
      const authentication = createStoredAttemptAuthenticationV1({
        loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
      }, TEST_EXECUTION_CLAIMS);
      const authority = await deriveAuthority(authentication);
      await expect(runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(fixture.envelope),
      ))).resolves.toSatisfy(authentication.isAuthenticated);
    }

    const deleted = await deleteFixture();
    Object.assign(requirePoint(deleted.evidence), { overlayKind: "none" });
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(deleted.evidence)),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(authentication);
    await expect(runFailure(authentication.authenticate(
      authority,
      encodeEnvelope(deleted.envelope),
    ))).resolves.toMatchObject({ reason: "deleteOverlayMismatch" });
  });

  it("rejects missing, extra, mismatched, and forged point overlays", async () => {
    const fixture = await insertFixture({ name: "Ada" });
    const cases: ReadonlyArray<(
      evidence: StoredAttemptEvidencePortV1,
    ) => void> = [
      (evidence) => {
        Reflect.apply(Array.prototype.splice, evidence.points, [0, 1]);
      },
      (evidence) => {
        Reflect.apply(Array.prototype.push, evidence.points, [
          structuredClone(evidence.points[0]),
        ]);
      },
      (evidence) => {
        const point = requirePoint(evidence);
        Object.assign(point, { dependencyKind: "present" });
      },
      (evidence) => {
        const point = requirePoint(evidence);
        point.overlayValueBytes?.fill(0);
      },
    ];

    for (const mutate of cases) {
      const evidence = structuredClone(fixture.evidence);
      mutate(evidence);
      const authentication = createStoredAttemptAuthenticationV1({
        loadEffect: () => Effect.succeed(loaded(evidence)),
      }, TEST_EXECUTION_CLAIMS);
      const authority = await deriveAuthority(authentication);
      const failure = await runFailure(authentication.authenticate(
        authority,
        encodeEnvelope(fixture.envelope),
      ));
      expect(failure).toBeInstanceOf(
        StoredAttemptStorageCorruptionV1Error,
      );
    }
  });

  it("checks terminal patch effects without pretending to own the base row", async () => {
    const fixture = await patchFixture("after");
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(authentication);
    await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(fixture.envelope),
    ));

    const forgedOverlay = await patchFixture("wrong");
    const forgedEvidence = structuredClone(fixture.evidence);
    Reflect.apply(Array.prototype.splice, forgedEvidence.points, [
      0,
      1,
      structuredClone(forgedOverlay.evidence.points[0]),
    ]);
    const forgedAuthentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(forgedEvidence)),
    }, TEST_EXECUTION_CLAIMS);
    const forgedAuthority = await deriveAuthority(forgedAuthentication);
    const failure = await runFailure(forgedAuthentication.authenticate(
      forgedAuthority,
      encodeEnvelope(fixture.envelope),
    ));
    expect(failure).toBeInstanceOf(StoredAttemptStorageCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "patchSetOverlayMismatch" });
  });

  it("preserves unexpected point-evidence verifier failures as defects", async () => {
    const fixture = await insertFixture({ name: "defect-boundary" });
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    }, TEST_EXECUTION_CLAIMS);
    const authority = await deriveAuthority(authentication);
    const pointBytes = requirePoint(fixture.evidence).overlayValueBytes;
    if (pointBytes === null) throw new Error("Missing live point bytes.");
    const defect = new Error("point verifier defect sentinel");
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let targetedPointDigest = false;
    const digestSpy = vi.spyOn(crypto.subtle, "digest").mockImplementation(
      async (algorithm, data) => {
        const actual = data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const isPointEvidence = actual.byteLength === pointBytes.byteLength &&
          actual.every((byte, index) => byte === pointBytes[index]);
        if (isPointEvidence) {
          targetedPointDigest = true;
          throw defect;
        }
        return originalDigest(algorithm, data);
      },
    );
    let rejection: unknown;
    try {
      await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(fixture.envelope),
      ));
    } catch (cause) {
      rejection = cause;
    } finally {
      digestSpy.mockRestore();
    }

    expect(targetedPointDigest).toBe(true);
    expect(rejection).not.toBeInstanceOf(
      StoredAttemptStorageCorruptionV1Error,
    );
    expect(String(rejection)).toContain(defect.message);
  });

  it("mints C04B1 authority only from a genuine same-factory C04A capability", async () => {
    const current = await commitAuthorityFixture();
    let authorityLoads = 0;
    let metadataLoads = 0;
    const authentication = createStoredPointCommitPlanningV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.sync(() => {
            authorityLoads += 1;
            return { kind: "loaded" as const, evidence: current.commitEvidence };
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => {
            metadataLoads += 1;
            return Effect.succeed(structuredClone(current.functionSnapshot));
          },
        },
      },
      TEST_EXECUTION_CLAIMS,
    );
    const authority = await deriveAuthority(authentication);
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(current.fixture.envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(stored),
    );

    expect(authentication.isCommitAuthorityAuthenticated(commitAuthority)).toBe(
      true,
    );
    expect(authentication.isCommitAuthorityAuthenticated({
      ...commitAuthority,
    })).toBe(false);
    expect(JSON.stringify(commitAuthority)).toBe("{}");
    expect(authorityLoads).toBe(1);
    expect(metadataLoads).toBe(1);
    expect(current.hostClockReads()).toBe(0);
    expect(authentication.remainsCommitAuthorityStateUnchangedForTest(
      commitAuthority,
      () => {
        current.commitEvidence.session.validatedArgsCanonicalBytes.fill(0);
        current.commitEvidence.session.authorizationGrantCanonicalBytes.fill(0);
        Object.assign(current.commitEvidence.schema.manifest, {
          kind: "mutated",
        });
        Object.assign(current.functionSnapshot.functionMetadata, {
          visibility: "internal",
        });
      },
    )).toBe(true);

    const second = createStoredPointCommitPlanningV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.sync(() => {
            authorityLoads += 1;
            return { kind: "loaded" as const, evidence: current.commitEvidence };
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => {
            metadataLoads += 1;
            return Effect.succeed(current.functionSnapshot);
          },
        },
      },
      TEST_EXECUTION_CLAIMS,
    );
    const crossFactoryFailure = await runFailure(
      second.authenticateCommitAuthority(stored),
    );
    expect(crossFactoryFailure).toBeInstanceOf(
      InvalidAuthenticatedStoredAttemptV1Error,
    );
    expect(authorityLoads).toBe(1);
    expect(metadataLoads).toBe(1);
  });

  it("maps commit-authority persistence failures once and stops", async () => {
    const current = await commitAuthorityFixture();
    const cause = new Error("commit-authority persistence sentinel");
    let metadataLoads = 0;
    const authentication = createStoredPointCommitPlanningV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.fail({
            _tag: "StoredCommitAuthorityEvidencePersistenceV1Error" as const,
            cause,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => {
            metadataLoads += 1;
            return Effect.succeed(current.functionSnapshot);
          },
        },
      },
      TEST_EXECUTION_CLAIMS,
    );
    const authority = await deriveAuthority(authentication);
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(current.fixture.envelope),
    ));

    const failure = await runFailure(
      authentication.authenticateCommitAuthority(stored),
    );

    expect(failure).toBeInstanceOf(StoredCommitAuthorityPersistenceV1Error);
    expect(failure).toMatchObject({ cause });
    expect(metadataLoads).toBe(0);
  });

  it("fails C04B1 closed for revocation, argument, and metadata drift", async () => {
    const cases: ReadonlyArray<Readonly<{
      readonly expected: new (...arguments_: never[]) => Error;
      readonly mutateEvidence?: (
        evidence: StoredCommitAuthorityEvidencePortV1,
      ) => void;
      readonly mutateMetadata?: (metadata: Record<string, unknown>) => void;
    }>> = [
      {
        expected: StoredCommitAuthorityMismatchV1Error,
        mutateEvidence: (evidence: StoredCommitAuthorityEvidencePortV1) => {
          Object.assign(evidence, { currentAuthorizationRevocationEpoch: 1n });
        },
      },
      {
        expected: StoredCommitAuthorityCorruptionV1Error,
        mutateEvidence: (evidence: StoredCommitAuthorityEvidencePortV1) => {
          evidence.session.validatedArgsCanonicalBytes.fill(0);
        },
      },
      {
        expected: StoredCommitAuthorityCorruptionV1Error,
        mutateMetadata: (metadata: Record<string, unknown>) => {
          Object.assign(metadata, { sourcePackageHash: "f".repeat(64) });
        },
      },
    ];

    for (const testCase of cases) {
      const current = await commitAuthorityFixture();
      const evidence = structuredClone(current.commitEvidence);
      const metadata = structuredClone(current.functionSnapshot);
      testCase.mutateEvidence?.(evidence);
      testCase.mutateMetadata?.(metadata);
      const authentication = createStoredPointCommitPlanningV1(
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () =>
              Effect.succeed({ kind: "loaded" as const, evidence }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: { load: () => Effect.succeed(metadata) },
        },
        TEST_EXECUTION_CLAIMS,
      );
      const authority = await deriveAuthority(authentication);
      const stored = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(current.fixture.envelope),
      ));
      const failure = await runFailure(
        authentication.authenticateCommitAuthority(stored),
      );
      expect(failure).toBeInstanceOf(testCase.expected);
    }
  });

  it("uses captured database time for grant expiry and rejects fake verifiers", async () => {
    const current = await commitAuthorityFixture();
    const expiredEvidence = structuredClone(current.commitEvidence);
    Object.assign(expiredEvidence, {
      databaseNowMilliseconds:
        expiredEvidence.session.authorizationGrantExpiresAtMilliseconds,
    });
    const authentication = createStoredPointCommitPlanningV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () =>
            Effect.succeed({
              kind: "loaded" as const,
              evidence: expiredEvidence,
            }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => Effect.succeed(current.functionSnapshot),
        },
      },
      TEST_EXECUTION_CLAIMS,
    );
    const authority = await deriveAuthority(authentication);
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(current.fixture.envelope),
    ));
    const failure = await runFailure(
      authentication.authenticateCommitAuthority(stored),
    );
    expect(failure).toBeInstanceOf(TransactionGrantVerificationV1Error);
    expect(failure).toMatchObject({ issue: { reason: "expired" } });
    expect(current.hostClockReads()).toBe(0);

    expect(() => Reflect.apply(
      createStoredPointCommitPlanningV1,
      undefined,
      [
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({
              kind: "loaded",
              evidence: current.commitEvidence,
            }),
          },
          transactionGrantVerifier: Object.freeze({ verify: async () => ({}) }),
          functionMetadata: {
            load: () => Effect.succeed(current.functionSnapshot),
          },
        },
        TEST_EXECUTION_CLAIMS,
      ],
    )).toThrow(expect.objectContaining({
      _tag: "StoredCommitAuthorityConfigurationV1Error",
      reason: "unregisteredTransactionGrantVerifier",
    }));

    expect(() => Reflect.apply(
      createStoredPointCommitPlanningV1,
      undefined,
      [
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({
              kind: "loaded",
              evidence: current.commitEvidence,
            }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: {
            load: () => Effect.succeed(current.functionSnapshot),
          },
        },
      ],
    )).toThrow(expect.objectContaining({
      _tag: "StoredCommitAuthorityConfigurationV1Error",
      reason: "missingExecutionClaimVault",
    }));
  });

  it("rechecks the stored implicit argument array at the exact 16 MiB boundary", async () => {
    const exactPayload = "x".repeat(
      MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 - 8,
    );
    const argumentsValidator = {
      type: "object",
      value: {
        x: {
          fieldType: { type: "string" },
          optional: false,
        },
      },
    };
    const current = await commitAuthorityFixture(
      { x: exactPayload },
      argumentsValidator,
    );
    const exactAuthentication = createStoredPointCommitPlanningV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.succeed({
            kind: "loaded" as const,
            evidence: current.commitEvidence,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => Effect.succeed(current.functionSnapshot),
        },
      },
      TEST_EXECUTION_CLAIMS,
    );
    const exactAuthority = await deriveAuthority(exactAuthentication);
    const exactStored = await runEffect(exactAuthentication.authenticate(
      exactAuthority,
      encodeEnvelope(current.fixture.envelope),
    ));
    await expect(runEffect(
      exactAuthentication.authenticateCommitAuthority(exactStored),
    )).resolves.toSatisfy((authority) =>
      exactAuthentication.isCommitAuthorityAuthenticated(authority)
    );

    const oversizedEvidence = structuredClone(current.commitEvidence);
    Object.assign(oversizedEvidence.session, {
      validatedArgsJson: { x: `${exactPayload}x` },
    });
    const oversizedAuthentication = createStoredPointCommitPlanningV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.succeed({
            kind: "loaded" as const,
            evidence: oversizedEvidence,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => Effect.succeed(current.functionSnapshot),
        },
      },
      TEST_EXECUTION_CLAIMS,
    );
    const oversizedAuthority = await deriveAuthority(
      oversizedAuthentication,
    );
    const oversizedStored = await runEffect(
      oversizedAuthentication.authenticate(
        oversizedAuthority,
        encodeEnvelope(current.fixture.envelope),
      ),
    );
    const failure = await runFailure(
      oversizedAuthentication.authenticateCommitAuthority(oversizedStored),
    );
    expect(failure).toBeInstanceOf(PointMutationTargetSelectionV1Error);
    expect(failure).toMatchObject({
      issue: {
        reason: "argumentsTooLarge",
        observed:
          MAX_POINT_MUTATION_ARGUMENT_ARRAY_SEMANTIC_BYTES_V1 + 1,
      },
    });
  }, 120_000);

  it("rejects tampered grant representations and missing or corrupt metadata", async () => {
    const grantCases: ReadonlyArray<(
      evidence: StoredCommitAuthorityEvidencePortV1,
    ) => void> = [
      (evidence) => evidence.session.authorizationGrantCanonicalBytes.fill(0),
      (evidence) => Object.assign(evidence.session.authorizationGrantJson, {
        payload: "not-canonical-base64url",
      }),
      (evidence) => evidence.session.validatedArgsSha256.fill(0),
    ];
    for (const mutate of grantCases) {
      const current = await commitAuthorityFixture();
      const evidence = structuredClone(current.commitEvidence);
      mutate(evidence);
      const authentication = createStoredPointCommitPlanningV1(
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () =>
              Effect.succeed({ kind: "loaded" as const, evidence }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: {
            load: () => Effect.succeed(current.functionSnapshot),
          },
        },
        TEST_EXECUTION_CLAIMS,
      );
      const authority = await deriveAuthority(authentication);
      const stored = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(current.fixture.envelope),
      ));
      await expect(runEffect(
        authentication.authenticateCommitAuthority(stored),
      )).rejects.toBeDefined();
    }

    const current = await commitAuthorityFixture();
    for (const metadata of [
      null,
      [current.functionSnapshot, current.functionSnapshot],
      { ...current.functionSnapshot, unexpected: true },
    ]) {
      const authentication = createStoredPointCommitPlanningV1(
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({
              kind: "loaded" as const,
              evidence: current.commitEvidence,
            }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: { load: () => Effect.succeed(metadata) },
        },
        TEST_EXECUTION_CLAIMS,
      );
      const authority = await deriveAuthority(authentication);
      const stored = await runEffect(authentication.authenticate(
        authority,
        encodeEnvelope(current.fixture.envelope),
      ));
      const failure = await runFailure(
        authentication.authenticateCommitAuthority(stored),
      );
      expect(failure).toBeInstanceOf(StoredCommitAuthorityCorruptionV1Error);
      expect(failure).toMatchObject({
        reason: metadata === null
          ? "functionMetadataMissing"
          : "functionMetadataInvalid",
      });
    }
  });

  it("mints an opaque C04B2 capability with zero post-authority I/O", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "VerifiedCommitInputV1"
      | "StoredCommitInputVerificationV1"
      | "verifyCommitInputStateEffect"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("VerifiedCommitInputV1" in executorRoot).toBe(false);

    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await emptyFixture("verified"),
      returnsValidator: { type: "string" },
    });
    const first = await verifyCommitInputFixture(current);

    expect(first.authentication.isCommitInputVerified(
      first.verifiedCommitInput,
    )).toBe(true);
    expect(Object.isFrozen(first.verifiedCommitInput)).toBe(true);
    expect(JSON.stringify(first.verifiedCommitInput)).toBe("{}");
    expect(Reflect.ownKeys(first.verifiedCommitInput)).toHaveLength(1);
    expect(first.countsAfterVerification()).toEqual(
      first.countsBeforeVerification,
    );

    const forgedFailure = await runFailure(
      first.authentication.verifyCommitInput({ ...first.commitAuthority }),
    );
    expect(forgedFailure).toBeInstanceOf(
      InvalidAuthenticatedCommitAuthorityV1Error,
    );
    expect(first.countsAfterVerification()).toEqual(
      first.countsBeforeVerification,
    );

    const second = await verifyCommitInputFixture(current);
    const secondCounts = second.countsAfterVerification();
    const crossFactoryFailure = await runFailure(
      second.authentication.verifyCommitInput(first.commitAuthority),
    );
    expect(crossFactoryFailure).toBeInstanceOf(
      InvalidAuthenticatedCommitAuthorityV1Error,
    );
    expect(second.countsAfterVerification()).toEqual(secondCounts);

    expect(first.authentication.remainsVerifiedCommitInputStateUnchangedForTest(
      first.verifiedCommitInput,
      () => {
        current.fixture.evidence.root.resultBytes.fill(0);
        current.fixture.evidence.root.resultSha256.fill(0);
        Object.assign(current.commitEvidence.schema.manifest, {
          kind: "mutated",
        });
        Object.assign(current.functionSnapshot.functionMetadata, {
          returnsValidator: { type: "null" },
        });
      },
    )).toBe(true);
  });

  it("validates complete live insert, replace, and patch projections only", async () => {
    const nameDocument = {
      type: "object",
      value: {
        name: { optional: false, fieldType: { type: "string" } },
      },
    };
    const patchDocument = {
      type: "object",
      value: {
        name: { optional: false, fieldType: { type: "string" } },
        stable: { optional: false, fieldType: { type: "boolean" } },
      },
    };
    for (const current of [
      await commitAuthorityFixture({}, undefined, {
        fixture: await insertFixture({ name: "insert" }, "ok"),
        documentType: nameDocument,
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await replaceFixture({ name: "replace" }, "ok"),
        documentType: nameDocument,
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await patchFixture("after", "ok"),
        documentType: patchDocument,
        returnsValidator: { type: "string" },
      }),
    ]) {
      const verified = await verifyCommitInputFixture(current);
      expect(verified.authentication.isCommitInputVerified(
        verified.verifiedCommitInput,
      )).toBe(true);
    }

    for (const fixture of [await readFixture("ok"), await deleteFixture("ok")]) {
      const current = await commitAuthorityFixture({}, undefined, {
        fixture,
        documentType: {
          type: "object",
          value: {
            neverPresent: {
              optional: false,
              fieldType: { type: "string" },
            },
          },
        },
        returnsValidator: { type: "string" },
      });
      const verified = await verifyCommitInputFixture(current);
      expect(verified.authentication.isCommitInputVerified(
        verified.verifiedCommitInput,
      )).toBe(true);
    }

    const detachedCurrent = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({ name: "detached" }, "ok"),
      documentType: nameDocument,
      returnsValidator: { type: "string" },
    });
    const detached = await verifyCommitInputFixture(detachedCurrent);
    expect(detached.authentication.remainsVerifiedCommitInputStateUnchangedForTest(
      detached.verifiedCommitInput,
      () => {
        const point = requirePoint(detachedCurrent.fixture.evidence);
        point.overlayValueBytes?.fill(0);
        if (point.overlayValueJson !== null) {
          Object.assign(point.overlayValueJson, { name: "mutated" });
        }
        detachedCurrent.fixture.evidence.root.resultBytes.fill(0);
      },
    )).toBe(true);

    const strictFailureCurrent = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({ name: "strict", extra: true }, "ok"),
      documentType: nameDocument,
      returnsValidator: { type: "string" },
    });
    const strictAuthentication = await authenticateCommitAuthorityFixture(
      strictFailureCurrent,
    );
    const strictFailure = await runFailure(
      strictAuthentication.authentication.verifyCommitInput(
        strictAuthentication.commitAuthority,
      ),
    );
    expect(strictFailure).toBeInstanceOf(CommitDocumentValidationV1Error);
    expect(strictFailure).toMatchObject({
      issue: {
        reason: "validator",
        issue: { reason: "unexpectedField", field: "extra" },
      },
    });
  });

  it("rejects non-Convex system fields before developer validation", async () => {
    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({ _private: true }, "ok"),
      documentType: {
        type: "object",
        value: {
          _private: { optional: false, fieldType: { type: "boolean" } },
        },
      },
      returnsValidator: { type: "string" },
    });
    const authenticated = await authenticateCommitAuthorityFixture(current);
    const failure = await runFailure(
      authenticated.authentication.verifyCommitInput(
        authenticated.commitAuthority,
      ),
    );
    expect(failure).toBeInstanceOf(CommitDocumentValidationV1Error);
    expect(failure).toMatchObject({
      issue: { reason: "unexpectedSystemField", field: "_private" },
    });
  });

  it("uses only pinned manifest table authority for document IDs", async () => {
    const validUsersId = "1:00000000-0000-4000-8000-000000000010";
    const wrongUsersId = "2:00000000-0000-4000-8000-000000000010";
    const validatorFor = (tableName: string) => ({
      type: "object",
      value: {
        friendId: {
          optional: false,
          fieldType: { type: "id", tableName },
        },
      },
    });

    const valid = await verifyCommitInputFixture(
      await commitAuthorityFixture({}, undefined, {
        fixture: await insertFixture({ friendId: validUsersId }, "ok"),
        documentType: validatorFor("users"),
        returnsValidator: { type: "string" },
      }),
    );
    expect(valid.authentication.isCommitInputVerified(
      valid.verifiedCommitInput,
    )).toBe(true);

    for (const testCase of [
      {
        value: wrongUsersId,
        tableName: "users",
        reason: "idMismatch",
      },
      {
        value: validUsersId,
        tableName: "missing",
        reason: "idAuthorityUnavailable",
      },
      {
        value: validUsersId,
        tableName: "_storage",
        reason: "idAuthorityUnavailable",
      },
    ]) {
      const current = await commitAuthorityFixture({}, undefined, {
        fixture: await insertFixture({ friendId: testCase.value }, "ok"),
        documentType: validatorFor(testCase.tableName),
        returnsValidator: { type: "string" },
      });
      const authenticated = await authenticateCommitAuthorityFixture(current);
      const failure = await runFailure(
        authenticated.authentication.verifyCommitInput(
          authenticated.commitAuthority,
        ),
      );
      expect(failure).toBeInstanceOf(CommitDocumentValidationV1Error);
      expect(failure).toMatchObject({
        issue: { reason: "validator", issue: { reason: testCase.reason } },
      });
    }
  });

  it("implements null, any, and explicit-null return-validator behavior", async () => {
    for (const current of [
      await commitAuthorityFixture({}, undefined, {
        fixture: await emptyFixture({ unvalidated: true }),
        returnsValidator: null,
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await emptyFixture({ accepted: "by-any" }),
        returnsValidator: { type: "any" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await emptyFixture(null),
        returnsValidator: { type: "null" },
      }),
    ]) {
      const verified = await verifyCommitInputFixture(current);
      expect(verified.authentication.isCommitInputVerified(
        verified.verifiedCommitInput,
      )).toBe(true);
    }

    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await emptyFixture("not-null"),
      returnsValidator: { type: "null" },
    });
    const authenticated = await authenticateCommitAuthorityFixture(current);
    const failure = await runFailure(
      authenticated.authentication.verifyCommitInput(
        authenticated.commitAuthority,
      ),
    );
    expect(failure).toBeInstanceOf(
      CommitSuccessfulResultValidationV1Error,
    );
    expect(failure).toMatchObject({ issue: { reason: "typeMismatch" } });
  });

  it("fails typed before planning for result-seal and validator-authority corruption", async () => {
    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await emptyFixture("verified"),
      returnsValidator: { type: "string" },
    });
    const source = commitInputSourceForTest(current);
    const sealFailure = await runFailure(verifyCommitInputStateEffect({
      ...source,
      sealIdentity: {
        ...source.sealIdentity,
        resultSemanticBytes: source.sealIdentity.resultSemanticBytes + 1,
      },
    }));
    expect(sealFailure).toBeInstanceOf(
      CommitInputAuthorityCorruptionV1Error,
    );
    expect(sealFailure).toMatchObject({
      reason: "successfulResultSemanticBytesMismatch",
    });

    const missingReturns = structuredClone(source.functionMetadata);
    expect(Reflect.deleteProperty(missingReturns, "returnsValidator")).toBe(
      true,
    );
    const authorityFailure = await runFailure(verifyCommitInputStateEffect({
      ...source,
      functionMetadata: missingReturns,
    }));
    expect(authorityFailure).toBeInstanceOf(
      CommitInputAuthorityCorruptionV1Error,
    );
    expect(authorityFailure).toMatchObject({ reason: "returnsValidatorMissing" });

    const tombstoneWriteDocumentId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000017",
    );
    const tombstoneWriteIdentity = decodeAppDocumentIdentityV1(
      tombstoneWriteDocumentId,
    );
    const writableDependencyFailure = await runFailure(
      verifyCommitInputStateEffect({
        ...source,
        points: [Object.freeze({
          documentId: tombstoneWriteDocumentId,
          tableId: tombstoneWriteIdentity.tableId,
          rowId: tombstoneWriteIdentity.rowId,
          dependency: logicalPointDependency(tombstoneWriteDocumentId, {
            kind: "missing",
            basis: {
              kind: "tombstone",
              revisionCommitSeq: CommitSeqSchema.make(17n),
            },
          }),
          overlayKind: "deleted",
          overlayCreationTime: null,
          overlayValue: null,
          overlayBytes: null,
          overlaySemanticBytes: null,
        })],
      }),
    );
    expect(writableDependencyFailure).toBeInstanceOf(
      CommitInputAuthorityCorruptionV1Error,
    );
    expect(writableDependencyFailure).toMatchObject({
      reason: "pointWritableDependencyInvalid",
    });
  });

  it("mints an opaque same-factory C04C1 capability with zero I/O", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "PreparedPointCommitV1"
      | "StoredPointCommitPlanningV1"
      | "planPointCommitStateV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("PreparedPointCommitV1" in executorRoot).toBe(false);

    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await emptyFixture("planned"),
      returnsValidator: { type: "string" },
    });
    const first = await verifyCommitInputFixture(current);
    const countsBeforePlanning = first.countsAfterVerification();
    const prepared = await runEffect(
      first.authentication.planPointCommit(first.verifiedCommitInput),
    );

    expect(first.authentication.isPointCommitPrepared(prepared)).toBe(true);
    expect(Object.isFrozen(prepared)).toBe(true);
    expect(JSON.stringify(prepared)).toBe("{}");
    expect(Reflect.ownKeys(prepared)).toHaveLength(1);
    expect(first.countsAfterVerification()).toEqual(countsBeforePlanning);

    const forgedFailure = await runFailure(
      first.authentication.planPointCommit({ ...first.verifiedCommitInput }),
    );
    expect(forgedFailure).toBeInstanceOf(InvalidVerifiedCommitInputV1Error);
    expect(forgedFailure).toMatchObject({ reason: "notSameFactory" });
    expect(first.countsAfterVerification()).toEqual(countsBeforePlanning);

    const replanned = await runEffect(
      first.authentication.planPointCommit(first.verifiedCommitInput),
    );
    expect(first.authentication.arePreparedPointCommitStatesEquivalentForTest(
      prepared,
      replanned,
    )).toBe(true);

    const second = await verifyCommitInputFixture(current);
    const secondCounts = second.countsAfterVerification();
    const crossFactoryFailure = await runFailure(
      second.authentication.planPointCommit(first.verifiedCommitInput),
    );
    expect(crossFactoryFailure).toBeInstanceOf(
      InvalidVerifiedCommitInputV1Error,
    );
    expect(second.countsAfterVerification()).toEqual(secondCounts);
  });

  it("runs O06 only from a genuine same-factory plan without exposing provenance", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "StoredPointCommitRollbackProofV1"
      | "provePointCommitRollback"
      | "PointCommitTransactionCommandV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("provePointCommitRollback" in executorRoot).toBe(false);

    const commands: PointCommitTransactionCommandV1[] = [];
    let outcome: "success" | "failure" | "defect" = "success";
    const typedFailure = new PointCommitCorruptionV1Error({
      reason: "journalRootInvalid",
    });
    const defect = new Error("O06 persistence defect sentinel");
    const port: PointCommitRollbackProofPortV1 = Object.freeze({
      prove: Effect.fn("TestPointCommit.prove")(function* (command) {
        commands.push(command);
        switch (outcome) {
          case "success":
            return Object.freeze({ kind: "wouldCommit" as const });
          case "failure":
            return yield* Effect.fail(typedFailure);
          case "defect":
            return yield* Effect.die(defect);
        }
      }),
    });
    const o06Fixture = await emptyFixture("o06");
    Object.assign(o06Fixture.evidence.session, { lifecycle: "finishing" });
    const current = await commitAuthorityFixture({}, undefined, {
      fixture: o06Fixture,
      returnsValidator: { type: "string" },
    });
    const first = await pointCommitRollbackFixture(current, port);
    const result = await runEffect(
      first.authentication.provePointCommitRollback(first.prepared),
    );
    expect(result).toEqual({ kind: "wouldCommit" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command === undefined) throw new Error("Missing captured O06 command.");
    expect(Object.hasOwn(command, "successfulResult")).toBe(false);
    expect(command.session.lifecycle).toBe("finishing");
    expect(command.authorityPins.snapshotToken).toEqual(SNAPSHOT);
    expect(command.session.identityAccessPolicySha256).not.toEqual(
      new Uint8Array(32),
    );

    const callCount = commands.length;
    const forgedFailure = await runFailure(
      first.authentication.provePointCommitRollback({ ...first.prepared }),
    );
    expect(forgedFailure).toBeInstanceOf(InvalidPreparedPointCommitV1Error);
    expect(commands).toHaveLength(callCount);

    const second = await pointCommitRollbackFixture(current, port);
    const crossFactoryFailure = await runFailure(
      second.authentication.provePointCommitRollback(first.prepared),
    );
    expect(crossFactoryFailure).toBeInstanceOf(
      InvalidPreparedPointCommitV1Error,
    );
    expect(commands).toHaveLength(callCount);

    current.fixture.evidence.session.identityAccessPolicySha256.fill(0);
    current.fixture.evidence.root.journalSha256.fill(0);
    await runEffect(
      first.authentication.provePointCommitRollback(first.prepared),
    );
    const detached = commands.at(-1);
    if (detached === undefined) throw new Error("Missing detached O06 command.");
    expect(detached.session.identityAccessPolicySha256).not.toEqual(
      new Uint8Array(32),
    );
    expect(detached.sealIdentity.journalSha256).not.toEqual(
      new Uint8Array(32),
    );

    outcome = "failure";
    expect(await runFailure(
      first.authentication.provePointCommitRollback(first.prepared),
    )).toBe(typedFailure);

    outcome = "defect";
    let rejection: unknown;
    try {
      await runEffect(
        first.authentication.provePointCommitRollback(first.prepared),
      );
    } catch (cause) {
      rejection = cause;
    }
    expect(rejection).not.toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(String(rejection)).toContain(defect.message);
  });

  it("publishes O07-B only from a genuine same-factory plan with owned result evidence", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "StoredPointCommitPublisherV1"
      | "publishPointCommit"
      | "PointCommitPublicationCommandV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("publishPointCommit" in executorRoot).toBe(false);

    const commands: PointCommitPublicationCommandV1[] = [];
    const typedFailure = new PointCommitCorruptionV1Error({
      reason: "publicationInvariantInvalid",
    });
    const port: PointCommitPublisherPortV1 = Object.freeze({
      prove: Effect.fn("TestPointCommit.provePublisherRollback")(
        () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
      ),
      publish: Effect.fn("TestPointCommit.publish")(function* (command) {
        commands.push(command);
        return yield* Effect.fail(typedFailure);
      }),
    });
    const fixture = await emptyFixture("o07b");
    Object.assign(fixture.evidence.session, { lifecycle: "finishing" });
    const current = await commitAuthorityFixture({}, undefined, {
      fixture,
      returnsValidator: { type: "string" },
    });
    const first = await pointCommitPublisherFixture(current, port);

    expect(await runFailure(
      first.authentication.publishPointCommit(first.prepared),
    )).toBe(typedFailure);
    expect(commands).toHaveLength(1);
    const command = commands[0];
    if (command === undefined) {
      throw new Error("Missing captured O07-B publication command.");
    }
    expect(command.successfulResult.value).toBe("o07b");
    expect(command.successfulResult.semanticSizeBytes).toBe(
      fixture.result.semanticSizeBytes,
    );
    expect(command.successfulResult.sha256Hex).toBe(
      fixture.result.evidence.sha256Hex,
    );
    expect(command.successfulResult.canonicalBytes).toEqual(
      fixture.result.canonicalBytes,
    );
    expect(command.successfulResult.canonicalBytes).not.toBe(
      fixture.result.canonicalBytes,
    );

    const calls = commands.length;
    const forged = await runFailure(
      first.authentication.publishPointCommit({ ...first.prepared }),
    );
    expect(forged).toBeInstanceOf(InvalidPreparedPointCommitV1Error);
    expect(commands).toHaveLength(calls);

    const second = await pointCommitPublisherFixture(current, port);
    const crossFactory = await runFailure(
      second.authentication.publishPointCommit(first.prepared),
    );
    expect(crossFactory).toBeInstanceOf(InvalidPreparedPointCommitV1Error);
    expect(commands).toHaveLength(calls);

    fixture.evidence.root.resultBytes.fill(0);
    fixture.evidence.root.resultSha256.fill(0);
    expect(await runFailure(
      first.authentication.publishPointCommit(first.prepared),
    )).toBe(typedFailure);
    const detached = commands.at(-1);
    if (detached === undefined) {
      throw new Error("Missing detached O07-B publication command.");
    }
    expect(detached.successfulResult.canonicalBytes).not.toEqual(
      new Uint8Array(detached.successfulResult.canonicalBytes.byteLength),
    );
    expect(detached.sealIdentity.resultSha256).not.toEqual(
      new Uint8Array(32),
    );
  });

  it("retries only source-owned confirmed rollbacks with deterministic full jitter", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "PointCommitKnownSettledSqlRetryExhaustedV1Error"
      | "PointCommitFinishingPublicationExecutionV1Error"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect(
      "PointCommitKnownSettledSqlRetryExhaustedV1Error" in executorRoot,
    ).toBe(false);

    const first = new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: "writeCommitHeader",
      sqlState: "40001",
      cause: new Error("first confirmed rollback"),
    });
    const second = new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: "writeWake",
      sqlState: "40P01",
      cause: new Error("second confirmed rollback"),
    });
    const expected = expiredPointCommitPublicationResultForTest();
    const fixture = await pointCommitSqlRetryFixture([
      Object.freeze({ kind: "failure", failure: first }),
      Object.freeze({ kind: "failure", failure: second }),
      Object.freeze({ kind: "success", result: expected }),
    ]);
    let randomCalls = 0;
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.authentication.publishPointCommit(
        fixture.finishing,
      ).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => {
            randomCalls += 1;
            return 0.5;
          },
          nextIntUnsafe: () => 0,
        }),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      expect(fixture.commands).toHaveLength(1);
      yield* TestClock.adjust("4 millis");
      expect(fixture.commands).toHaveLength(1);
      yield* TestClock.adjust("1 millis");
      expect(fixture.commands).toHaveLength(2);
      yield* TestClock.adjust("9 millis");
      expect(fixture.commands).toHaveLength(2);
      yield* TestClock.adjust("1 millis");
      expect(yield* Fiber.join(fiber)).toBe(expected);
    });
    await runEffect(program.pipe(Effect.provide(TestClock.layer())));

    expect(randomCalls).toBe(2);
    expect(fixture.commands).toHaveLength(3);
    expect(fixture.commands[1]).toBe(fixture.commands[0]);
    expect(fixture.commands[2]).toBe(fixture.commands[0]);
  });

  it("exhausts exactly three confirmed attempts with an owned frozen failure snapshot", async () => {
    const causes = [
      new Error("confirmed rollback one"),
      new Error("confirmed rollback two"),
      new Error("confirmed rollback three"),
    ];
    const failures = causes.map((cause, index) =>
      new PointCommitConfirmedPreDecisionRollbackV1Error({
        operation: index === 1 ? "writeWake" : "writeCommitHeader",
        sqlState: index === 1 ? "40P01" : "40001",
        cause,
      })
    );
    const fixture = await pointCommitSqlRetryFixture(failures.map((failure) =>
      Object.freeze({ kind: "failure" as const, failure })
    ));
    let randomCalls = 0;
    const failure = await runFailure(
      fixture.authentication.publishPointCommit(fixture.finishing).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => {
            randomCalls += 1;
            return 0;
          },
          nextIntUnsafe: () => 0,
        }),
      ),
    );

    expect(failure).toBeInstanceOf(
      PointCommitKnownSettledSqlRetryExhaustedV1Error,
    );
    expect(failure).toMatchObject({ attempts: 3, maximumAttempts: 3 });
    if (!(failure instanceof PointCommitKnownSettledSqlRetryExhaustedV1Error)) {
      throw new Error("Expected the O08-C exhaustion error.");
    }
    expect(Object.isFrozen(failure.failures)).toBe(true);
    expect(failure.failures).toEqual([
      { operation: "writeCommitHeader", sqlState: "40001", cause: causes[0] },
      { operation: "writeWake", sqlState: "40P01", cause: causes[1] },
      { operation: "writeCommitHeader", sqlState: "40001", cause: causes[2] },
    ]);
    for (const snapshot of failure.failures) {
      expect(Object.isFrozen(snapshot)).toBe(true);
    }
    expect(fixture.commands).toHaveLength(3);
    expect(randomCalls).toBe(2);
  });

  it("does not retry ordinary, uncertain, OCC, corrupt, structural, or defect failures", async () => {
    const conflict = new PointCommitConflictV1Error({
      documentId: decodeAppDocumentIdV1(
        "1:00000000-0000-4000-8000-000000000099",
      ),
      snapshotCommitSeq: CommitSeqSchema.make(1n),
      currentCommitSeq: CommitSeqSchema.make(2n),
    });
    const failures: ReadonlyArray<PointCommitPublicationV1Error> = [
      new PointCommitSqlErrorV1({
        operation: "writeCommitHeader",
        sqlState: "40001",
        cause: { cause: { code: "40P01" } },
      }),
      new PointCommitDecisionUncertainV1Error({
        phase: "commitOrRelease",
        cause: new Error("lost commit response"),
        outcomeCheck: Object.freeze({ kind: "missing" }),
      }),
      new PointCommitCorruptionV1Error({
        reason: "publicationInvariantInvalid",
      }),
      conflict,
    ];
    for (const expected of failures) {
      const fixture = await pointCommitSqlRetryFixture([
        Object.freeze({ kind: "failure", failure: expected }),
      ]);
      expect(await runFailure(
        fixture.authentication.publishPointCommit(fixture.finishing),
      )).toBe(expected);
      expect(fixture.commands).toHaveLength(1);
    }

    const structural = unsafePointCommitPublicationFailureForTest(
      Object.freeze({
        _tag: "PointCommitConfirmedPreDecisionRollbackV1Error",
        operation: "writeCommitHeader",
        sqlState: "40001",
        cause: new Error("structural retry impostor"),
      }),
    );
    const structuralFixture = await pointCommitSqlRetryFixture([
      Object.freeze({ kind: "failure", failure: structural }),
    ]);
    const structuralExit = await runEffect(Effect.exit(
      structuralFixture.authentication.publishPointCommit(
        structuralFixture.finishing,
      ),
    ));
    expect(Exit.isFailure(structuralExit)).toBe(true);
    if (Exit.isFailure(structuralExit)) {
      const observedDefect = Cause.findDefect(structuralExit.cause);
      expect(Result.isSuccess(observedDefect)).toBe(true);
      if (Result.isSuccess(observedDefect)) {
        expect(observedDefect.success).toBe(structural);
      }
    }
    expect(structuralFixture.commands).toHaveLength(1);

    const defect = new Error("publication defect");
    const defectFixture = await pointCommitSqlRetryFixture([
      Object.freeze({ kind: "defect", defect }),
    ]);
    const defectExit = await runEffect(Effect.exit(
      defectFixture.authentication.publishPointCommit(defectFixture.finishing),
    ));
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      const observedDefect = Cause.findDefect(defectExit.cause);
      expect(Result.isSuccess(observedDefect)).toBe(true);
      if (Result.isSuccess(observedDefect)) {
        expect(observedDefect.success).toBe(defect);
      }
    }
    expect(defectFixture.commands).toHaveLength(1);
  });

  it("interrupts retry backoff before another publication attempt", async () => {
    const failure = new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: "writeCommitHeader",
      sqlState: "40001",
      cause: new Error("confirmed rollback before interruption"),
    });
    const fixture = await pointCommitSqlRetryFixture([
      Object.freeze({ kind: "failure", failure }),
    ]);
    const interrupted = await runFailure(
      fixture.authentication.publishPointCommit(fixture.finishing).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0.99,
          nextIntUnsafe: () => 0,
        }),
        Effect.timeout("1 millis"),
      ),
    );
    expect(interrupted).toMatchObject({ _tag: "TimeoutError" });
    expect(fixture.commands).toHaveLength(1);
  });

  it("honors fresh authority failure from the next publication attempt", async () => {
    const confirmed = new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: "writeCommitHeader",
      sqlState: "40001",
      cause: new Error("first transaction rolled back"),
    });
    const stale = new PointCommitStaleAuthorityV1Error({ reason: "expired" });
    const fixture = await pointCommitSqlRetryFixture([
      Object.freeze({ kind: "failure", failure: confirmed }),
      Object.freeze({ kind: "failure", failure: stale }),
    ]);
    expect(await runFailure(
      fixture.authentication.publishPointCommit(fixture.finishing).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        }),
      ),
    )).toBe(stale);
    expect(fixture.commands).toHaveLength(2);
    expect(fixture.commands[1]).toBe(fixture.commands[0]);
  });

  it("keeps the generic prepared-plan publisher single-attempt", async () => {
    const commands: PointCommitPublicationCommandV1[] = [];
    const confirmed = new PointCommitConfirmedPreDecisionRollbackV1Error({
      operation: "writeCommitHeader",
      sqlState: "40001",
      cause: new Error("raw one-attempt publisher rollback"),
    });
    const port: PointCommitPublisherPortV1 = Object.freeze({
      prove: Effect.fn("TestPointCommit.proveRawSingleAttempt")(
        () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
      ),
      publish: Effect.fn("TestPointCommit.publishRawSingleAttempt")(
        (command) => Effect.sync(() => commands.push(command)).pipe(
          Effect.flatMap(() => Effect.fail(confirmed)),
        ),
      ),
    });
    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await emptyFixture("o08c_raw"),
      returnsValidator: { type: "string" },
    });
    const fixture = await pointCommitPublisherFixture(current, port);
    expect(await runFailure(
      fixture.authentication.publishPointCommit(fixture.prepared),
    )).toBe(confirmed);
    expect(commands).toHaveLength(1);
  });

  it("mints C05-A finishing continuations only from genuine same-factory running plans", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "FinishingPreparedPointCommitV1"
      | "StoredPointCommitFinishingTransitionV1"
      | "enterPointCommitFinishing"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("enterPointCommitFinishing" in executorRoot).toBe(false);

    const transitionCommands: PointCommitFinishingTransitionCommandV1[] = [];
    const proofCommands: PointCommitTransactionCommandV1[] = [];
    const publicationCommands: PointCommitPublicationCommandV1[] = [];
    const transitionFailure = new PointCommitCorruptionV1Error({
      reason: "journalRootInvalid",
    });
    const publicationFailure = new PointCommitCorruptionV1Error({
      reason: "publicationInvariantInvalid",
    });
    const defect = new Error("C05-A transition defect sentinel");
    let outcome: "success" | "observed" | "failure" | "defect" =
      "success";
    let receiptMutation:
      | ((
        receipt: PointCommitFinishingTransitionResultV1,
        command: PointCommitFinishingTransitionCommandV1,
      ) => unknown)
      | undefined;
    const pointCommitFinishing: PointCommitFinishingTransitionPortV1 =
      Object.freeze({
        enterFinishing: Effect.fn("TestPointCommit.enterFinishing")(
          function* (command) {
            transitionCommands.push(command);
            if (outcome === "failure") {
              return yield* Effect.fail(transitionFailure);
            }
            if (outcome === "defect") return yield* Effect.die(defect);
            const prior = command.session.updatedAtMilliseconds;
            const receipt = Object.freeze({
              kind: outcome === "observed" ? "observed" as const :
                "transitioned" as const,
              scopeUuid: command.sealIdentity.scopeUuid,
              sessionId: command.authorityPins.sessionId,
              attemptFence: command.authorityPins.attemptFence,
              priorSessionUpdatedAtMilliseconds: prior,
              finishingSessionUpdatedAtMilliseconds: prior + 2,
            });
            return unsafeFinishingTransitionResultForTest(
              receiptMutation?.(receipt, command) ?? receipt,
            );
          },
        ),
      });
    const pointCommit: PointCommitPublisherPortV1 = Object.freeze({
      prove: Effect.fn("TestPointCommit.proveC05ARollback")(
        (command) => {
          proofCommands.push(command);
          return Effect.succeed(Object.freeze({ kind: "wouldCommit" as const }));
        },
      ),
      publish: Effect.fn("TestPointCommit.publishC05A")(function* (command) {
        publicationCommands.push(command);
        return yield* Effect.fail(publicationFailure);
      }),
    });
    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await emptyFixture("c05a"),
      returnsValidator: { type: "string" },
    });
    const first = await pointCommitFinishingFixture(
      current,
      pointCommit,
      pointCommitFinishing,
    );
    await runEffect(
      first.authentication.provePointCommitRollback(first.prepared),
    );

    // @ts-expect-error C05-A publication requires the finishing continuation.
    const prematurePublicationEffect = first.authentication.publishPointCommit(first.prepared);
    const prematurePublication = await runFailure(prematurePublicationEffect);
    expect(prematurePublication).toBeInstanceOf(
      InvalidPreparedPointCommitV1Error,
    );
    expect(prematurePublication).toMatchObject({ reason: "notFinishing" });
    expect(publicationCommands).toHaveLength(0);

    const continued = await runEffect(
      first.authentication.enterPointCommitFinishing(first.prepared),
    );
    expect(continued).not.toBe(first.prepared);
    expect(Object.isFrozen(continued)).toBe(true);
    expect(JSON.stringify(continued)).toBe("{}");
    expect(Reflect.ownKeys(continued)).toHaveLength(2);
    expect(first.authentication.isPointCommitPrepared(first.prepared)).toBe(
      true,
    );
    expect(first.authentication.isPointCommitPrepared(continued)).toBe(true);
    const continuedTransitionCalls = transitionCommands.length;
    expect(await runFailure(
      first.authentication.enterPointCommitFinishing(continued),
    )).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "alreadyFinishing",
    });
    expect(transitionCommands).toHaveLength(continuedTransitionCalls);
    expect(first.authentication.arePreparedPointCommitStatesEquivalentForTest(
      first.prepared,
      continued,
    )).toBe(false);
    expect(transitionCommands).toHaveLength(1);
    const transitionCommand = transitionCommands[0];
    if (transitionCommand === undefined) {
      throw new Error("Missing captured C05-A transition command.");
    }
    expect(Reflect.ownKeys(transitionCommand).sort()).toEqual([
      "authorityPins",
      "executionClaim",
      "sealIdentity",
      "session",
    ]);
    expect(transitionCommand.session.lifecycle).toBe("running");
    expect(transitionCommand.sealIdentity.lifecycle).toBe("running");
    expect(Object.hasOwn(transitionCommand, "dependencies")).toBe(false);
    expect(Object.hasOwn(transitionCommand, "successfulResult")).toBe(false);

    transitionCommand.session.identityAccessPolicySha256.fill(0);
    transitionCommand.sealIdentity.journalSha256.fill(0);
    expect(await runFailure(
      first.authentication.publishPointCommit(continued),
    )).toBe(publicationFailure);
    const publicationCommand = publicationCommands[0];
    if (publicationCommand === undefined) {
      throw new Error("Missing captured C05-A publication command.");
    }
    expect(publicationCommand.session.lifecycle).toBe("finishing");
    expect(publicationCommand.sealIdentity.lifecycle).toBe("finishing");
    expect(publicationCommand.session.updatedAtMilliseconds).toBe(
      transitionCommand.session.updatedAtMilliseconds + 2,
    );
    expect(publicationCommand.sealIdentity.sessionUpdatedAtMilliseconds).toBe(
      publicationCommand.session.updatedAtMilliseconds,
    );
    expect(publicationCommand.session.identityAccessPolicySha256).not.toEqual(
      new Uint8Array(32),
    );
    expect(publicationCommand.sealIdentity.journalSha256).not.toEqual(
      new Uint8Array(32),
    );
    const baselineCommand = proofCommands[0];
    if (baselineCommand === undefined) {
      throw new Error("Missing captured C05-A baseline command.");
    }
    const { successfulResult: _successfulResult, ...publicationPlan } =
      publicationCommand;
    expect({
      ...publicationPlan,
      session: {
        ...publicationPlan.session,
        lifecycle: baselineCommand.session.lifecycle,
        updatedAtMilliseconds: baselineCommand.session.updatedAtMilliseconds,
      },
      sealIdentity: {
        ...publicationPlan.sealIdentity,
        lifecycle: baselineCommand.sealIdentity.lifecycle,
        sessionUpdatedAtMilliseconds:
          baselineCommand.sealIdentity.sessionUpdatedAtMilliseconds,
      },
    }).toEqual(baselineCommand);

    outcome = "observed";
    const observedFixture = await pointCommitFinishingFixture(
      current,
      pointCommit,
      pointCommitFinishing,
    );
    await runEffect(
      observedFixture.authentication.enterPointCommitFinishing(
        observedFixture.prepared,
      ),
    );
    expect(transitionCommands.at(-1)?.session.lifecycle).toBe("running");

    const transitionCalls = transitionCommands.length;
    const forged = await runFailure(
      first.authentication.enterPointCommitFinishing({ ...first.prepared }),
    );
    expect(forged).toBeInstanceOf(InvalidPreparedPointCommitV1Error);
    expect(transitionCommands).toHaveLength(transitionCalls);

    const second = await pointCommitFinishingFixture(
      current,
      pointCommit,
      pointCommitFinishing,
    );
    const crossFactory = await runFailure(
      second.authentication.enterPointCommitFinishing(first.prepared),
    );
    expect(crossFactory).toBeInstanceOf(InvalidPreparedPointCommitV1Error);
    expect(transitionCommands).toHaveLength(transitionCalls);

    const crossFactoryPublication = await runFailure(
      second.authentication.publishPointCommit(continued),
    );
    expect(crossFactoryPublication).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "notSameFactory",
    });
    expect(publicationCommands).toHaveLength(1);

    outcome = "success";
    const corruptReceipts: ReadonlyArray<Readonly<{
      readonly name: string;
      readonly mutate: NonNullable<typeof receiptMutation>;
    }>> = [
      {
        name: "kind",
        mutate: (receipt) => ({ ...receipt, kind: "invalid" }),
      },
      {
        name: "scope",
        mutate: (receipt) => ({
          ...receipt,
          scopeUuid: "00000000-0000-4000-8000-000000000000",
        }),
      },
      {
        name: "session",
        mutate: (receipt) => ({ ...receipt, sessionId: "session_corrupt" }),
      },
      {
        name: "fence",
        mutate: (receipt) => ({
          ...receipt,
          attemptFence: receipt.attemptFence + 1n,
        }),
      },
      {
        name: "prior timestamp",
        mutate: (receipt) => ({
          ...receipt,
          priorSessionUpdatedAtMilliseconds:
            receipt.priorSessionUpdatedAtMilliseconds + 1,
        }),
      },
      {
        name: "zero finishing timestamp",
        mutate: (receipt) => ({
          ...receipt,
          finishingSessionUpdatedAtMilliseconds: 0,
        }),
      },
      {
        name: "fractional finishing timestamp",
        mutate: (receipt) => ({
          ...receipt,
          finishingSessionUpdatedAtMilliseconds:
            receipt.priorSessionUpdatedAtMilliseconds + 0.5,
        }),
      },
      {
        name: "unsafe finishing timestamp",
        mutate: (receipt) => ({
          ...receipt,
          finishingSessionUpdatedAtMilliseconds: Number.MAX_SAFE_INTEGER + 1,
        }),
      },
      {
        name: "regressed finishing timestamp",
        mutate: (receipt) => ({
          ...receipt,
          finishingSessionUpdatedAtMilliseconds:
            receipt.priorSessionUpdatedAtMilliseconds - 1,
        }),
      },
      {
        name: "lease-expiry finishing timestamp",
        mutate: (receipt, command) => ({
          ...receipt,
          finishingSessionUpdatedAtMilliseconds:
            command.sealIdentity.leaseExpiresAtMilliseconds,
        }),
      },
    ];
    for (const testCase of corruptReceipts) {
      receiptMutation = testCase.mutate;
      const publicationCalls = publicationCommands.length;
      const invalidReceiptFixture = await pointCommitFinishingFixture(
        current,
        pointCommit,
        pointCommitFinishing,
      );
      const invalidReceipt = await runFailure(
        invalidReceiptFixture.authentication.enterPointCommitFinishing(
          invalidReceiptFixture.prepared,
        ),
      );
      expect(invalidReceipt, testCase.name).toBeInstanceOf(
        PointCommitCorruptionV1Error,
      );
      expect(invalidReceipt, testCase.name).toMatchObject({
        reason: "finishingTransitionInvalid",
      });
      expect(publicationCommands, testCase.name).toHaveLength(publicationCalls);
    }
    receiptMutation = undefined;
    const recoveredReceiptFixture = await pointCommitFinishingFixture(
      current,
      pointCommit,
      pointCommitFinishing,
    );
    const recoveredAfterInvalidReceipts = await runEffect(
      recoveredReceiptFixture.authentication.enterPointCommitFinishing(
        recoveredReceiptFixture.prepared,
      ),
    );
    expect(Object.isFrozen(recoveredAfterInvalidReceipts)).toBe(true);

    outcome = "failure";
    const failureFixture = await pointCommitFinishingFixture(
      current,
      pointCommit,
      pointCommitFinishing,
    );
    expect(await runFailure(
      failureFixture.authentication.enterPointCommitFinishing(
        failureFixture.prepared,
      ),
    )).toBe(transitionFailure);

    outcome = "defect";
    const defectFixture = await pointCommitFinishingFixture(
      current,
      pointCommit,
      pointCommitFinishing,
    );
    let rejection: unknown;
    try {
      await runEffect(
        defectFixture.authentication.enterPointCommitFinishing(
          defectFixture.prepared,
        ),
      );
    } catch (cause) {
      rejection = cause;
    }
    expect(rejection).not.toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(String(rejection)).toContain(defect.message);
  });

  it("captures O08-A only from a genuine same-factory finishing plan", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "StoredPointMutationAttemptReplacementV1"
      | "replaceConflictedPointMutationAttempt"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("replaceConflictedPointMutationAttempt" in executorRoot).toBe(false);

    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({ name: "o08a" }, "o08a"),
      documentType: {
        type: "object",
        value: {
          name: { optional: false, fieldType: { type: "string" } },
        },
      },
      returnsValidator: { type: "string" },
    });
    const replacementCommands: PointMutationAttemptReplacementCommandV1[] = [];
    const publicationFailure = new PointCommitCorruptionV1Error({
      reason: "publicationInvariantInvalid",
    });
    const pointCommit:
      PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1 =
      Object.freeze({
      prove: Effect.fn("TestO08A.prove")(
        () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
      ),
      publish: Effect.fn("TestO08A.publish")(
        () => Effect.fail(publicationFailure),
      ),
      [RESOLVE_POINT_COMMIT_OUTCOME_V1]: Effect.fn(
        "TestO08A.resolveOutcome",
      )(() => Effect.succeed(Object.freeze({ kind: "missing" as const }))),
    });
    const pointCommitFinishing: PointCommitFinishingTransitionPortV1 =
      Object.freeze({
        enterFinishing: Effect.fn("TestO08A.enterFinishing")((command) =>
          Effect.succeed(Object.freeze({
            kind: "transitioned" as const,
            scopeUuid: command.sealIdentity.scopeUuid,
            sessionId: command.authorityPins.sessionId,
            attemptFence: command.authorityPins.attemptFence,
            priorSessionUpdatedAtMilliseconds:
              command.session.updatedAtMilliseconds,
            finishingSessionUpdatedAtMilliseconds:
              command.session.updatedAtMilliseconds + 2,
          }))),
      });
    const replacement: PointMutationAttemptReplacementPortV1 = Object.freeze({
      replace: Effect.fn("TestO08A.replace")((command) => {
        replacementCommands.push(command);
        return Effect.succeed(Object.freeze({
          kind: "replaced" as const,
          scopeUuid: command.sealIdentity.scopeUuid,
          sessionId: command.authorityPins.sessionId,
          previousAttemptFence: command.authorityPins.attemptFence,
          attemptFence: TransactionAttemptFenceSchema.make(
            command.authorityPins.attemptFence + 1n,
          ),
          executionClaim: TEST_EXECUTION_CLAIM_OBSERVATION,
        }));
      }),
    });
    const first = await pointCommitReplacementFixture(
      current,
      pointCommit,
      pointCommitFinishing,
      replacement,
    );
    const finishing = await runEffect(
      first.authentication.enterPointCommitFinishing(first.prepared),
    );
    const observation = await runEffect(
      first.authentication.replaceConflictedPointMutationAttempt(finishing),
    );
    expect(Object.isFrozen(observation)).toBe(true);
    expect(observation).toMatchObject({
      kind: "replaced",
      previousAttemptFence:
        replacementCommands[0]?.authorityPins.attemptFence,
      attemptFence:
        (replacementCommands[0]?.authorityPins.attemptFence ?? 0n) + 1n,
    });
    expect(Reflect.ownKeys(observation).sort()).toEqual([
      "attemptFence",
      "executionClaim",
      "kind",
      "previousAttemptFence",
      "scopeUuid",
      "sessionId",
    ]);
    const command = replacementCommands[0];
    if (command === undefined) throw new Error("Missing O08-A command.");
    expect(Reflect.ownKeys(command).sort()).toEqual([
      "authorityPins",
      "dependencies",
      "sealIdentity",
      "session",
    ]);
    expect(Object.hasOwn(command, "rowIntent")).toBe(false);
    expect(Object.hasOwn(command, "successfulResult")).toBe(false);
    expect(Object.hasOwn(command, "journal")).toBe(false);
    expect(command.dependencies).toHaveLength(1);

    command.session.requestSha256.fill(0);
    command.sealIdentity.journalSha256.fill(0);
    await runEffect(
      first.authentication.replaceConflictedPointMutationAttempt(finishing),
    );
    expect(replacementCommands[1]?.session.requestSha256).not.toEqual(
      new Uint8Array(32),
    );
    expect(replacementCommands[1]?.sealIdentity.journalSha256).not.toEqual(
      new Uint8Array(32),
    );

    const calls = replacementCommands.length;
    const runningFailure = await runFailure(
      first.authentication.replaceConflictedPointMutationAttempt(
        // @ts-expect-error O08-A accepts only a finishing capability.
        first.prepared,
      ),
    );
    expect(runningFailure).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "notFinishing",
    });
    expect(replacementCommands).toHaveLength(calls);
    const forged = await runFailure(
      first.authentication.replaceConflictedPointMutationAttempt({
        ...finishing,
      }),
    );
    expect(forged).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "notSameFactory",
    });
    expect(replacementCommands).toHaveLength(calls);

    const second = await pointCommitReplacementFixture(
      current,
      pointCommit,
      pointCommitFinishing,
      replacement,
    );
    const crossFactory = await runFailure(
      second.authentication.replaceConflictedPointMutationAttempt(finishing),
    );
    expect(crossFactory).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "notSameFactory",
    });
    expect(replacementCommands).toHaveLength(calls);

    const observationMisuse = await runFailure(
      first.authentication.publishPointCommit(
        // @ts-expect-error Observations are not publisher capabilities.
        observation,
      ),
    );
    expect(observationMisuse).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "notSameFactory",
    });
  });

  it("authorizes O08-B1 only from the exact consumed O07-B conflict and a pristine fresh attempt", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "AuthorizedPointMutationOccRerunV1"
      | "authorizePointMutationOccRerun"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("authorizePointMutationOccRerun" in executorRoot).toBe(false);

    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({ name: "o08b1" }, "o08b1"),
      documentType: {
        type: "object",
        value: {
          name: { optional: false, fieldType: { type: "string" } },
        },
      },
      returnsValidator: { type: "string" },
    });
    const fixture = await pointMutationOccAuthorizationFixture(current);
    const authorized = await runEffect(
      fixture.authentication.authorizePointMutationOccRerun(
        fixture.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0.5,
        nextIntUnsafe: () => 0,
      })),
    );
    expect(authorized).toMatchObject({
      kind: "authorized",
      backoffUpperBoundMilliseconds: 100,
      backoffMilliseconds: 50,
    });
    if (authorized.kind !== "authorized") {
      throw new Error("Expected an authorized O08-B1 rerun.");
    }
    expect(Object.isFrozen(authorized.rerun)).toBe(true);
    expect(JSON.stringify(authorized.rerun)).toBe("{}");
    expect(Reflect.ownKeys(authorized.rerun)).toHaveLength(1);
    expect(fixture.counts()).toEqual({
      outcomeCalls: 1,
      replacementCalls: 1,
      loadCalls: 2,
    });
    const inspection =
      fixture.authentication.consumeAuthorizedPointMutationOccRerunForTest(
        authorized.rerun,
      );
    expect(inspection).toMatchObject({
      attemptFence: 2n,
      previousAttemptFence: 1n,
      snapshotToken: fixture.freshSnapshot,
      conflictingCommitSeq: fixture.freshSnapshot.commitSeq,
    });
    expect(() =>
      fixture.authentication.consumeAuthorizedPointMutationOccRerunForTest(
        authorized.rerun,
      )
    ).toThrow(InvalidAuthorizedPointMutationOccRerunV1Error);

    const consumed = await runFailure(
      fixture.authentication.authorizePointMutationOccRerun(fixture.conflict),
    );
    expect(consumed).toBeInstanceOf(InvalidPointMutationOccConflictV1Error);
    expect(consumed).toMatchObject({ reason: "alreadyConsumed" });
    const copied = new PointCommitConflictV1Error({
      documentId: fixture.conflict.documentId,
      snapshotCommitSeq: fixture.conflict.snapshotCommitSeq,
      currentCommitSeq: fixture.conflict.currentCommitSeq,
    });
    expect(await runFailure(
      fixture.authentication.authorizePointMutationOccRerun(copied),
    )).toMatchObject({
      _tag: "InvalidPointMutationOccConflictV1Error",
      reason: "notCaptured",
    });
    expect(await runFailure(
      fixture.authentication.authorizePointMutationOccRerun({
        ...fixture.conflict,
      }),
    )).toMatchObject({
      _tag: "InvalidPointMutationOccConflictV1Error",
      reason: "notCaptured",
    });
  });

  it("applies the bounded four-rerun full-jitter policy before outcome lookup", async () => {
    const expectedUpperBounds = [100, 200, 400, 800] as const;
    for (const [index, expectedUpperBound] of expectedUpperBounds.entries()) {
      const current = await commitAuthorityFixture({}, undefined, {
        fixture: await insertFixture({ name: `o08b1_${index}` }, "ok"),
        documentType: {
          type: "object",
          value: {
            name: { optional: false, fieldType: { type: "string" } },
          },
        },
        returnsValidator: { type: "string" },
      });
      const fixture = await pointMutationOccAuthorizationFixture(current, {
        attemptFence: BigInt(index + 1),
      });
      const result = await runEffect(
        fixture.authentication.authorizePointMutationOccRerun(
          fixture.conflict,
        ).pipe(Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        })),
      );
      expect(result).toMatchObject({
        kind: "authorized",
        backoffUpperBoundMilliseconds: expectedUpperBound,
        backoffMilliseconds: 0,
      });
    }

    const exhaustedCurrent = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({ name: "o08b1_exhausted" }, "ok"),
      documentType: {
        type: "object",
        value: {
          name: { optional: false, fieldType: { type: "string" } },
        },
      },
      returnsValidator: { type: "string" },
    });
    const exhaustedFixture = await pointMutationOccAuthorizationFixture(
      exhaustedCurrent,
      { attemptFence: 5n },
    );
    const exhausted = await runFailure(
      exhaustedFixture.authentication.authorizePointMutationOccRerun(
        exhaustedFixture.conflict,
      ),
    );
    expect(exhausted).toBeInstanceOf(PointMutationOccRerunExhaustedV1Error);
    expect(exhausted).toMatchObject({ attemptFence: 5n, maximumReruns: 4 });
    expect(exhaustedFixture.counts()).toEqual({
      outcomeCalls: 0,
      replacementCalls: 0,
      loadCalls: 1,
    });
  });

  it("waits the deterministic full-jitter delay before outcome lookup", async () => {
    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture(
        { name: "o08b1_test_clock" },
        "test_clock",
      ),
      documentType: {
        type: "object",
        value: {
          name: { optional: false, fieldType: { type: "string" } },
        },
      },
      returnsValidator: { type: "string" },
    });
    const fixture = await pointMutationOccAuthorizationFixture(current);
    const program = Effect.gen(function* () {
      const fiber = yield* fixture.authentication
        .authorizePointMutationOccRerun(fixture.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0.5,
            nextIntUnsafe: () => 0,
          }),
          Effect.forkChild,
        );
      yield* Effect.yieldNow;
      expect(fixture.counts().outcomeCalls).toBe(0);
      yield* TestClock.adjust("49 millis");
      expect(fixture.counts().outcomeCalls).toBe(0);
      yield* TestClock.adjust("1 millis");
      const authorized = yield* Fiber.join(fiber);
      expect(authorized).toMatchObject({
        kind: "authorized",
        backoffUpperBoundMilliseconds: 100,
        backoffMilliseconds: 50,
      });
      expect(fixture.counts()).toEqual({
        outcomeCalls: 1,
        replacementCalls: 1,
        loadCalls: 2,
      });
    });
    await runEffect(program.pipe(Effect.provide(TestClock.layer())));
  });

  it("consumes authority on cancellation and mints nothing after replacement settlement", async () => {
    const makeCurrent = async (name: string) => commitAuthorityFixture(
      {},
      undefined,
      {
        fixture: await insertFixture({ name }, name),
        documentType: {
          type: "object",
          value: {
            name: { optional: false, fieldType: { type: "string" } },
          },
        },
        returnsValidator: { type: "string" },
      },
    );
    const duringBackoff = await pointMutationOccAuthorizationFixture(
      await makeCurrent("o08b1_backoff_interrupt"),
    );
    const backoffTimeout = await runFailure(
      duringBackoff.authentication.authorizePointMutationOccRerun(
        duringBackoff.conflict,
      ).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0.99,
          nextIntUnsafe: () => 0,
        }),
        Effect.timeout("1 millis"),
      ),
    );
    expect(backoffTimeout).toMatchObject({ _tag: "TimeoutError" });
    expect(duringBackoff.counts()).toEqual({
      outcomeCalls: 0,
      replacementCalls: 0,
      loadCalls: 1,
    });
    expect(await runFailure(
      duringBackoff.authentication.authorizePointMutationOccRerun(
        duringBackoff.conflict,
      ),
    )).toMatchObject({ reason: "alreadyConsumed" });

    const afterReplacement = await pointMutationOccAuthorizationFixture(
      await makeCurrent("o08b1_post_replace_interrupt"),
      { freshLoadNever: true },
    );
    const postReplacementTimeout = await runFailure(
      afterReplacement.authentication.authorizePointMutationOccRerun(
        afterReplacement.conflict,
      ).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        }),
        Effect.timeout("10 millis"),
      ),
    );
    expect(postReplacementTimeout).toMatchObject({ _tag: "TimeoutError" });
    expect(afterReplacement.counts()).toEqual({
      outcomeCalls: 1,
      replacementCalls: 1,
      loadCalls: 2,
    });
    expect(await runFailure(
      afterReplacement.authentication.authorizePointMutationOccRerun(
        afterReplacement.conflict,
      ),
    )).toMatchObject({ reason: "alreadyConsumed" });
  });

  it("closes O08-B1 with replay, expiry, or ownership loss before rerun authority", async () => {
    const makeCurrent = async (name: string) => commitAuthorityFixture(
      {},
      undefined,
      {
        fixture: await insertFixture({ name }, name),
        documentType: {
          type: "object",
          value: {
            name: { optional: false, fieldType: { type: "string" } },
          },
        },
        returnsValidator: { type: "string" },
      },
    );
    const token = Object.freeze({
      scopeUuid: SCOPE_UUID,
      epochUuid: decodeScopeEpochUuidV1(
        "92000000-0000-4000-8000-000000000001",
      ),
      commitSeq: CommitSeqSchema.make(1n),
    });
    const replayCurrent = await makeCurrent("o08b1_replay");
    const replayCanonical = replayCurrent.fixture.result;
    const replayFixture = await pointMutationOccAuthorizationFixture(
      replayCurrent,
      {
        outcome: Object.freeze({
          kind: "available",
          token,
          successfulResult: Object.freeze({
            valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
            valueJson: structuredClone(replayCanonical.valueJson),
            semanticSizeBytes: replayCanonical.semanticSizeBytes,
            canonicalText: replayCanonical.canonicalText,
            canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
              new Uint8Array(replayCanonical.canonicalBytes),
            ),
            sha256: FlarexValueSha256V1Schema.make(
              hexBytes(replayCanonical.evidence.sha256Hex),
            ),
          }),
        }),
      },
    );
    const replayed = await runEffect(
      replayFixture.authentication.authorizePointMutationOccRerun(
        replayFixture.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      })),
    );
    expect(replayed.kind).toBe("replayed");
    expect(replayFixture.counts()).toEqual({
      outcomeCalls: 1,
      replacementCalls: 0,
      loadCalls: 1,
    });

    const expiredFixture = await pointMutationOccAuthorizationFixture(
      await makeCurrent("o08b1_expired"),
      { outcome: Object.freeze({ kind: "expired", token }) },
    );
    expect((await runEffect(
      expiredFixture.authentication.authorizePointMutationOccRerun(
        expiredFixture.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      })),
    )).kind).toBe("expired");
    expect(expiredFixture.counts().replacementCalls).toBe(0);

    const ownershipFixture = await pointMutationOccAuthorizationFixture(
      await makeCurrent("o08b1_lost"),
      { replacementKind: "alreadyReplaced" },
    );
    const ownershipLost = await runFailure(
      ownershipFixture.authentication.authorizePointMutationOccRerun(
        ownershipFixture.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      })),
    );
    expect(ownershipLost).toBeInstanceOf(
      PointMutationOccRerunOwnershipLostV1Error,
    );
    expect(ownershipFixture.counts()).toEqual({
      outcomeCalls: 1,
      replacementCalls: 1,
      loadCalls: 1,
    });
  });

  it("fails closed on unrecognized O08-B1 outcome and replacement observations", async () => {
    const makeCurrent = async (name: string) => commitAuthorityFixture(
      {},
      undefined,
      {
        fixture: await insertFixture({ name }, name),
        documentType: {
          type: "object",
          value: {
            name: { optional: false, fieldType: { type: "string" } },
          },
        },
        returnsValidator: { type: "string" },
      },
    );
    const invalidOutcome = await pointMutationOccAuthorizationFixture(
      await makeCurrent("o08b1_future_outcome"),
      { unsafeOutcomeForTest: Object.freeze({ kind: "future" }) },
    );
    const outcomeFailure = await runFailure(
      invalidOutcome.authentication.authorizePointMutationOccRerun(
        invalidOutcome.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      })),
    );
    expect(outcomeFailure).toBeInstanceOf(
      PointMutationOccRerunAuthorityCorruptionV1Error,
    );
    expect(outcomeFailure).toMatchObject({
      reason: "outcomeObservationInvalid",
    });
    expect(invalidOutcome.counts()).toEqual({
      outcomeCalls: 1,
      replacementCalls: 0,
      loadCalls: 1,
    });

    const invalidReplacement = await pointMutationOccAuthorizationFixture(
      await makeCurrent("o08b1_future_replacement"),
      { unsafeReplacementKindForTest: "future" },
    );
    const replacementFailure = await runFailure(
      invalidReplacement.authentication.authorizePointMutationOccRerun(
        invalidReplacement.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      })),
    );
    expect(replacementFailure).toBeInstanceOf(
      PointMutationOccRerunAuthorityCorruptionV1Error,
    );
    expect(replacementFailure).toMatchObject({
      reason: "replacementObservationInvalid",
    });
    expect(invalidReplacement.counts()).toEqual({
      outcomeCalls: 1,
      replacementCalls: 1,
      loadCalls: 1,
    });
  });

  it("rejects mismatched or non-pristine fresh O08-B1 attempts", async () => {
    const cases: ReadonlyArray<Readonly<{
      readonly label: string;
      readonly reason: string;
      readonly conflictCommitSeqOffset?: bigint;
      readonly mutate: (
        result: PointMutationSessionAttemptLoadResultV1,
      ) => PointMutationSessionAttemptLoadResultV1;
    }>> = [
      {
        label: "storage_fence",
        reason: "storageGenerationFence",
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            anchor: Object.freeze({
              ...result.anchor,
              storageGenerationFence: StorageGenerationFenceSchema.make(
                result.anchor.storageGenerationFence + 1n,
              ),
            }),
          }),
      },
      {
        label: "epoch",
        reason: "epoch",
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            anchor: Object.freeze({
              ...result.anchor,
              snapshotToken: SnapshotTokenSchema.make({
                ...result.anchor.snapshotToken,
                epoch: ScopeEpochSchema.make(
                  result.anchor.snapshotToken.epoch + 1n,
                ),
              }),
            }),
          }),
      },
      {
        label: "schema",
        reason: "schema",
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            executionPin: Object.freeze({
              schemaVersionId: CatalogSchemaVersionIdSchema.make(
                "schema_o08b1_mismatch",
              ),
            }),
          }),
      },
      {
        label: "request_key",
        reason: "requestKey",
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            anchor: Object.freeze({
              ...result.anchor,
              requestKey: TransactionRequestKeyV1Schema.make(
                "request:o08b1-mismatch",
              ),
            }),
          }),
      },
      {
        label: "snapshot_not_advanced",
        reason: "snapshotNotAdvanced",
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            anchor: Object.freeze({
              ...result.anchor,
              snapshotToken: SnapshotTokenSchema.make({
                ...result.anchor.snapshotToken,
                commitSeq: CommitSeqSchema.make(
                  result.anchor.snapshotToken.commitSeq - 1n,
                ),
              }),
            }),
          }),
      },
      {
        label: "conflict_not_visible",
        reason: "conflictingCommitNotVisible",
        conflictCommitSeqOffset: 2n,
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            anchor: Object.freeze({
              ...result.anchor,
              snapshotToken: SnapshotTokenSchema.make({
                ...result.anchor.snapshotToken,
                commitSeq: CommitSeqSchema.make(
                  result.anchor.snapshotToken.commitSeq - 1n,
                ),
              }),
            }),
          }),
      },
      {
        label: "not_pristine",
        reason: "attemptNotPristine",
        mutate: (result: PointMutationSessionAttemptLoadResultV1) =>
          Object.freeze({
            ...result,
            attemptFacet: Object.freeze({ kind: "nonPristine" as const }),
          }),
      },
    ];

    for (const currentCase of cases) {
      const current = await commitAuthorityFixture({}, undefined, {
        fixture: await insertFixture(
          { name: `o08b1_${currentCase.label}` },
          currentCase.label,
        ),
        documentType: {
          type: "object",
          value: {
            name: { optional: false, fieldType: { type: "string" } },
          },
        },
        returnsValidator: { type: "string" },
      });
      const fixture = await pointMutationOccAuthorizationFixture(current, {
        ...(currentCase.conflictCommitSeqOffset === undefined
          ? {}
          : { conflictCommitSeqOffset: currentCase.conflictCommitSeqOffset }),
        mutateFreshLoadForTest: currentCase.mutate,
      });
      const failure = await runFailure(
        fixture.authentication.authorizePointMutationOccRerun(
          fixture.conflict,
        ).pipe(Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        })),
      );
      expect(failure).toBeInstanceOf(
        PointMutationOccRerunFreshAttemptV1Error,
      );
      expect(failure).toMatchObject({ reason: currentCase.reason });
      expect(fixture.counts()).toEqual({
        outcomeCalls: 1,
        replacementCalls: 1,
        loadCalls: 2,
      });
    }
  });

  it("composes C05-A publication and fresh finishing recovery through one private publisher", async () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      | "StoredPointCommitExecutorV1"
      | "finishPointCommit"
      | "resumePointCommit"
      | "reconstructPointCommitFinishing"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("resumePointCommit" in executorRoot).toBe(false);

    const current = await commitAuthorityFixture({}, undefined, {
      fixture: await insertFixture({
        name: "c05b",
        nested: { label: "stable" },
      }, "c05b"),
      documentType: {
        type: "object",
        value: {
          name: { optional: false, fieldType: { type: "string" } },
          nested: {
            optional: false,
            fieldType: {
              type: "object",
              value: {
                label: {
                  optional: false,
                  fieldType: { type: "string" },
                },
              },
            },
          },
        },
      },
      returnsValidator: { type: "string" },
    });
    const publicationFailure = new PointCommitCorruptionV1Error({
      reason: "publicationInvariantInvalid",
    });
    const commands: PointCommitPublicationCommandV1[] = [];
    const pointCommit:
      PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1 =
      Object.freeze({
      prove: Effect.fn("TestC05B.prove")(
        () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
      ),
      publish: Effect.fn("TestC05B.publish")(function* (command) {
        commands.push(command);
        return yield* Effect.fail(publicationFailure);
      }),
      [RESOLVE_POINT_COMMIT_OUTCOME_V1]: Effect.fn(
        "TestC05B.resolveOutcome",
      )(() => Effect.succeed(Object.freeze({ kind: "missing" as const }))),
    });
    const pointCommitFinishing: PointCommitFinishingTransitionPortV1 =
      Object.freeze({
        enterFinishing: Effect.fn("TestC05B.enterFinishing")((command) =>
          Effect.succeed(Object.freeze({
            kind: "transitioned" as const,
            scopeUuid: command.sealIdentity.scopeUuid,
            sessionId: command.authorityPins.sessionId,
            attemptFence: command.authorityPins.attemptFence,
            priorSessionUpdatedAtMilliseconds:
              command.session.updatedAtMilliseconds,
            finishingSessionUpdatedAtMilliseconds:
              command.session.updatedAtMilliseconds + 2,
          }))),
      });

    const buildExecutor = (
      storedEvidence: StoredAttemptEvidencePortV1,
      authorityEvidence: StoredCommitAuthorityEvidencePortV1,
      onFinishingLoad: () => void = () => undefined,
    ) => createStoredPointCommitExecutorV1(
      {
        loadEffect: () => Effect.succeed(loaded(storedEvidence)),
        loadFinishingEffect: () => Effect.sync(() => {
          onFinishingLoad();
          return loaded(storedEvidence);
        }),
      },
      {
        evidenceLoader: {
          loadEffect: () => Effect.succeed({
            kind: "loaded" as const,
            evidence: authorityEvidence,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
        },
        pointCommit,
        pointCommitFinishing,
      },
      TEST_EXECUTION_CLAIMS,
    );

    const normal = buildExecutor(
      current.fixture.evidence,
      current.commitEvidence,
    );
    const authority = await deriveAuthority(normal);
    const storedAttempt = await runEffect(normal.authenticate(
      authority,
      encodeEnvelope(current.fixture.envelope),
    ));
    const commitAuthority = await runEffect(
      normal.authenticateCommitAuthority(storedAttempt),
    );
    const verifiedInput = await runEffect(
      normal.verifyCommitInput(commitAuthority),
    );
    const prepared = await runEffect(normal.planPointCommit(verifiedInput));
    expect(await runFailure(normal.finishPointCommit(prepared))).toBe(
      publicationFailure,
    );
    const normalCommand = commands[0];
    if (normalCommand === undefined) {
      throw new Error("Missing normal C05-B publication command.");
    }
    if (
      normalCommand.rowIntent === null ||
      normalCommand.rowIntent.kind !== "live" ||
      !isCanonicalFlarexRuntimeObjectV1(normalCommand.rowIntent.value)
    ) {
      throw new Error("Expected a live normal-path C05-B row intent.");
    }
    const nested = normalCommand.rowIntent.value.nested;
    if (!isCanonicalFlarexRuntimeObjectV1(nested)) {
      throw new Error("Expected a nested normal-path document object.");
    }
    expect(Reflect.set(nested, "label", "mutated")).toBe(false);
    expect(await runFailure(normal.finishPointCommit(prepared))).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "executionClaimUnavailable",
    });
    expect(commands).toHaveLength(1);

    const recoveredEvidence = structuredClone(current.fixture.evidence);
    Object.assign(recoveredEvidence.session, {
      lifecycle: "finishing",
      updatedAtMilliseconds: normalCommand.session.updatedAtMilliseconds,
    });
    const recoveredAuthorityEvidence = structuredClone(current.commitEvidence);
    Object.assign(recoveredAuthorityEvidence.session, {
      lifecycle: "finishing",
      updatedAtMilliseconds: normalCommand.session.updatedAtMilliseconds,
    });
    let finishingLoads = 0;
    const recovered = buildExecutor(
      recoveredEvidence,
      recoveredAuthorityEvidence,
      () => {
        finishingLoads += 1;
      },
    );
    const beforeInvalid = finishingLoads;
    expect(await runFailure(recovered.resumePointCommit({
      deploymentId: DEPLOYMENT_ID,
    }))).toBeInstanceOf(InvalidPointMutationSessionAttemptSelectorV1Error);
    expect(finishingLoads).toBe(beforeInvalid);

    expect(await runFailure(recovered.resumePointCommit(SELECTOR))).toBe(
      publicationFailure,
    );
    expect(finishingLoads).toBe(1);
    const recoveredCommand = commands[1];
    if (recoveredCommand === undefined) {
      throw new Error("Missing recovered C05-B publication command.");
    }
    expect(recoveredCommand).toEqual(normalCommand);
    expect(recoveredCommand).not.toBe(normalCommand);
    expect(recoveredCommand.successfulResult.canonicalBytes).not.toBe(
      normalCommand.successfulResult.canonicalBytes,
    );
    expect(recoveredCommand.sealIdentity.journalSha256).not.toBe(
      normalCommand.sealIdentity.journalSha256,
    );

    const recoveredHandle = await runEffect(
      recovered.reconstructPointCommitFinishing(SELECTOR),
    );
    expect(Object.isFrozen(recoveredHandle)).toBe(true);
    expect(JSON.stringify(recoveredHandle)).toBe("{}");
    const crossFactoryCalls = commands.length;
    expect(await runFailure(
      normal.publishPointCommit(recoveredHandle),
    )).toMatchObject({
      _tag: "InvalidPreparedPointCommitV1Error",
      reason: "notSameFactory",
    });
    expect(commands).toHaveLength(crossFactoryCalls);

    const running = buildExecutor(
      current.fixture.evidence,
      current.commitEvidence,
    );
    expect(await runFailure(running.resumePointCommit(SELECTOR))).toMatchObject({
      _tag: "StoredAttemptNotPlannableV1Error",
      reason: "lifecycle",
      lifecycle: "running",
    });

    const defect = new Error("C05-B stored-evidence defect sentinel");
    const defectiveEvidence = structuredClone(recoveredEvidence);
    Object.assign(defectiveEvidence.root, {
      resultBytes: new Proxy(defectiveEvidence.root.resultBytes, {
        getPrototypeOf: () => {
          throw defect;
        },
      }),
    });
    const defective = buildExecutor(
      defectiveEvidence,
      recoveredAuthorityEvidence,
    );
    let defectRejection: unknown;
    try {
      await runEffect(defective.reconstructPointCommitFinishing(SELECTOR));
    } catch (cause) {
      defectRejection = cause;
    }
    expect(defectRejection).not.toBeInstanceOf(
      StoredAttemptStorageCorruptionV1Error,
    );
    expect(String(defectRejection)).toContain(defect.message);
  });

  it("closes one direct uncertain decision through exact C05-B reconstruction and one guarded publication", async () => {
    const primary = pointCommitDecisionUncertainForTest(
      "o08d first lost response",
    );
    const fixture = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [primary],
    });
    let randomCalls = 0;
    const result = await runEffect(
      fixture.authentication.publishPointCommit(fixture.finishing).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => {
            randomCalls += 1;
            return 0;
          },
          nextIntUnsafe: () => 0,
        }),
      ),
    );

    expect(result).toBe(fixture.successfulPublication);
    expect(fixture.commands).toHaveLength(2);
    expect(fixture.commands[1]).toBe(fixture.commands[0]);
    expect(fixture.counts()).toEqual({
      finishingLoads: 1,
      authorityLoads: 2,
      outcomeCalls: 0,
    });
    expect(randomCalls).toBe(0);
  });

  it("keeps lookup failure and a second uncertain decision terminal with the original uncertainty primary", async () => {
    const lookupError = Object.freeze({
      _tag: "CommittedPointOutcomeSqlErrorV1" as const,
      operation: "resolve" as const,
      cause: new Error("O08-D outcome lookup failed"),
    });
    const lookupPrimary = new PointCommitDecisionUncertainV1Error({
      phase: "commitOrRelease",
      cause: new Error("O08-D primary lost response"),
      outcomeCheck: unsafeDecisionUncertainOutcomeCheckForTest({
        kind: "lookupFailed",
        error: lookupError,
      }),
    });
    const lookupFixture = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [lookupPrimary],
    });
    const lookupFailure = await runFailure(
      lookupFixture.authentication.publishPointCommit(
        lookupFixture.finishing,
      ),
    );
    expect(lookupFailure).toBeInstanceOf(
      PointCommitUncertainOutcomeUnresolvedV1Error,
    );
    expect(lookupFailure).toMatchObject({
      stage: "postSettlementOutcomeLookup",
      primary: lookupPrimary,
      secondary: { kind: "outcomeLookupFailed", error: lookupError },
    });
    expect(lookupFixture.counts()).toEqual({
      finishingLoads: 0,
      authorityLoads: 1,
      outcomeCalls: 0,
    });

    const primary = pointCommitDecisionUncertainForTest(
      "O08-D original uncertainty",
    );
    const secondary = pointCommitDecisionUncertainForTest(
      "O08-D guarded uncertainty",
    );
    const secondFixture = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [primary, secondary],
    });
    const secondFailure = await runFailure(
      secondFixture.authentication.publishPointCommit(
        secondFixture.finishing,
      ),
    );
    expect(secondFailure).toBeInstanceOf(
      PointCommitUncertainOutcomeUnresolvedV1Error,
    );
    expect(secondFailure).toMatchObject({
      stage: "guardedPublication",
      primary,
      secondary: { kind: "secondDecisionUncertain", error: secondary },
    });
    expect(secondFixture.commands).toHaveLength(2);
    expect(secondFixture.commands[1]).toBe(secondFixture.commands[0]);
  });

  it("resolves an already-committed reconstruction only through the original authoritative outcome evidence", async () => {
    const alreadyCommitted = Object.freeze({
      kind: "alreadyCommitted" as const,
      updatedAtMilliseconds: 1_721_234_567_890,
    });
    for (const outcomeKind of ["available", "expired"] as const) {
      const primary = pointCommitDecisionUncertainForTest(
        `O08-D already committed ${outcomeKind}`,
      );
      const fixture = await pointCommitUncertainOutcomeFixture({
        publicationFailures: [primary],
        finishingLoadResult: alreadyCommitted,
        outcomeKind,
      });
      const result = await runEffect(
        fixture.authentication.publishPointCommit(fixture.finishing),
      );
      expect(result.kind).toBe(
        outcomeKind === "available" ? "replayed" : "expired",
      );
      expect(fixture.commands).toHaveLength(1);
      expect(fixture.counts()).toEqual({
        finishingLoads: 1,
        authorityLoads: 1,
        outcomeCalls: 1,
      });
    }

    const missingPrimary = pointCommitDecisionUncertainForTest(
      "O08-D committed without outcome",
    );
    const missing = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [missingPrimary],
      finishingLoadResult: alreadyCommitted,
      outcomeKind: "missing",
    });
    expect(await runFailure(
      missing.authentication.publishPointCommit(missing.finishing),
    )).toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "committedOutcomeMissing",
    });

    const resolverSql = new PointCommitSqlErrorV1({
      operation: "resolveAuthority",
      cause: new Error("O08-D final outcome lookup failed"),
    });
    const lookupPrimary = pointCommitDecisionUncertainForTest(
      "O08-D committed final lookup",
    );
    const lookupFailed = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [lookupPrimary],
      finishingLoadResult: alreadyCommitted,
      resolveOutcome: Effect.fn("TestO08D.resolveOutcomeFailed")(
        () => Effect.fail(resolverSql),
      ),
    });
    expect(await runFailure(
      lookupFailed.authentication.publishPointCommit(
        lookupFailed.finishing,
      ),
    )).toMatchObject({
      _tag: "PointCommitUncertainOutcomeUnresolvedV1Error",
      stage: "alreadyCommittedOutcomeLookup",
      primary: lookupPrimary,
      secondary: { kind: "outcomeLookupFailed", error: resolverSql },
    });
  });

  it("fails closed on reconstructed command drift and consumes each exact uncertainty only once", async () => {
    const primary = pointCommitDecisionUncertainForTest(
      "O08-D command comparison",
    );
    const mismatchFixture = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [primary],
      mutateCommandBeforeFailure: (command, call) => {
        if (call === 1) command.sealIdentity.journalSha256.fill(0);
      },
    });
    const mismatch = await runFailure(
      mismatchFixture.authentication.publishPointCommit(
        mismatchFixture.finishing,
      ),
    );
    expect(mismatch).toBeInstanceOf(
      PointCommitUncertainOutcomeRecoveryCorruptionV1Error,
    );
    expect(mismatch).toMatchObject({
      reason: "reconstructedCommandMismatch",
    });
    expect(mismatchFixture.commands).toHaveLength(1);

    const reused = pointCommitDecisionUncertainForTest(
      "O08-D reused exact uncertainty",
    );
    const reuseFixture = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [reused],
      publicationFailureForCall: (call) =>
        call === 1 || call === 3 ? reused : undefined,
    });
    await runEffect(
      reuseFixture.authentication.publishPointCommit(reuseFixture.finishing),
    );
    let reusedDefect: unknown;
    try {
      await runEffect(
        reuseFixture.authentication.publishPointCommit(
          reuseFixture.finishing,
        ),
      );
    } catch (cause) {
      reusedDefect = cause;
    }
    expect(String(reusedDefect)).toContain("already consumed");
  });

  it("rejects structural uncertainty evidence as a defect before recovery", async () => {
    const structural = unsafePointCommitPublicationFailureForTest(
      Object.freeze({
        _tag: "PointCommitDecisionUncertainV1Error",
        phase: "commitOrRelease",
        cause: new Error("structural O08-D uncertainty"),
        outcomeCheck: Object.freeze({ kind: "missing" }),
      }),
    );
    const fixture = await pointCommitUncertainOutcomeFixture({
      publicationFailures: [structural],
    });
    let defect: unknown;
    try {
      await runEffect(
        fixture.authentication.publishPointCommit(fixture.finishing),
      );
    } catch (cause) {
      defect = cause;
    }
    expect(defect).toBe(structural);
    expect(fixture.counts().finishingLoads).toBe(0);
  });

  it("composes every current point outcome through C04C1 without new I/O", async () => {
    const nameDocument = {
      type: "object",
      value: {
        name: { optional: false, fieldType: { type: "string" } },
      },
    };
    const cases = [
      await commitAuthorityFixture({}, undefined, {
        fixture: await emptyFixture("empty"),
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await readFixture("read"),
        documentType: { type: "object", value: {} },
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await insertFixture({ name: "insert" }, "insert"),
        documentType: nameDocument,
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await replaceFixture({ name: "replace" }, "replace"),
        documentType: nameDocument,
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await patchFixture("after", "patch"),
        documentType: {
          type: "object",
          value: {
            name: { optional: false, fieldType: { type: "string" } },
            stable: { optional: false, fieldType: { type: "boolean" } },
          },
        },
        returnsValidator: { type: "string" },
      }),
      await commitAuthorityFixture({}, undefined, {
        fixture: await deleteFixture("delete"),
        documentType: { type: "object", value: {} },
        returnsValidator: { type: "string" },
      }),
    ];

    for (const current of cases) {
      const verified = await verifyCommitInputFixture(current);
      const countsBeforePlanning = verified.countsAfterVerification();
      const prepared = await runEffect(
        verified.authentication.planPointCommit(verified.verifiedCommitInput),
      );
      expect(verified.authentication.isPointCommitPrepared(prepared)).toBe(true);
      expect(verified.countsAfterVerification()).toEqual(countsBeforePlanning);
    }
  });

  it("preserves every dependency and the complete live or logical delete intent", async () => {
    const unchangedId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000011",
    );
    const unchanged = unchangedPlannerPoint(unchangedId, {
      kind: "missing",
      basis: {
        kind: "tombstone",
        revisionCommitSeq: CommitSeqSchema.make(14n),
      },
    });
    const unchangedPlan = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([unchanged]),
    ));
    expect(unchangedPlan.rowIntent).toBeNull();
    expect(unchangedPlan.dependencies).toEqual([{
      documentId: unchangedId,
      tableId: decodeCatalogTableId(1),
      rowId: decodeAppDocumentIdentityV1(unchangedId).rowId,
      dependency: unchanged.dependency,
    }]);

    const liveId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000012",
    );
    const live = await livePlannerPoint(liveId, {
      kind: "missing",
      basis: { kind: "noVisibleRevision" },
    });
    const liveSource = await plannerSourceForTest([live]);
    const livePlan = requirePlanSuccess(planPointCommitStateV1(liveSource));
    expect(livePlan.rowIntent).toMatchObject({
      kind: "live",
      documentId: liveId,
      dependency: live.dependency,
      creationTime: live.creationTime,
      semanticSizeBytes: live.semanticSizeBytes,
    });
    if (livePlan.rowIntent?.kind !== "live") {
      throw new Error("Expected one live logical intent.");
    }
    const originalLiveBytes = livePlan.rowIntent.canonicalBytes;
    live.canonicalBytes.fill(0);
    livePlan.rowIntent.canonicalBytes.fill(0);
    livePlan.sealIdentity.journalSha256.fill(0);
    expect(livePlan.rowIntent.canonicalBytes).toEqual(originalLiveBytes);
    expect(livePlan.sealIdentity.journalSha256).not.toEqual(
      new Uint8Array(32),
    );

    const deletedId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000013",
    );
    const deleted = deletedPlannerPoint(deletedId, {
      kind: "present",
      revisionCommitSeq: CommitSeqSchema.make(15n),
    });
    const deletedPlan = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([deleted]),
    ));
    expect(deletedPlan.rowIntent).toEqual({
      kind: "deleted",
      documentId: deletedId,
      tableId: decodeCatalogTableId(1),
      rowId: decodeAppDocumentIdentityV1(deletedId).rowId,
      dependency: deleted.dependency,
    });
    expect(Object.hasOwn(deletedPlan.rowIntent ?? {}, "creationTime")).toBe(
      false,
    );
  });

  it("collapses insert then delete without consuming the net material-row budget", async () => {
    const insertedThenDeletedId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000014",
    );
    const insertedThenDeleted = deletedPlannerPoint(insertedThenDeletedId, {
      kind: "missing",
      basis: { kind: "noVisibleRevision" },
    });
    const noOpPlan = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([insertedThenDeleted]),
    ));
    expect(noOpPlan.rowIntent).toBeNull();
    expect(noOpPlan.dependencies).toEqual([{
      documentId: insertedThenDeletedId,
      tableId: decodeCatalogTableId(1),
      rowId: decodeAppDocumentIdentityV1(insertedThenDeletedId).rowId,
      dependency: insertedThenDeleted.dependency,
    }]);

    const liveId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000015",
    );
    const live = await livePlannerPoint(liveId);
    const combinedPlan = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([live, insertedThenDeleted]),
    ));
    expect(combinedPlan.dependencies.map(({ documentId }) => documentId))
      .toEqual([insertedThenDeletedId, liveId]);
    expect(combinedPlan.rowIntent).toMatchObject({
      kind: "live",
      documentId: liveId,
      dependency: live.dependency,
    });

    const tombstoneDeletedId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000016",
    );
    const tombstoneDeletedIdentity = decodeAppDocumentIdentityV1(
      tombstoneDeletedId,
    );
    const tombstoneDeleted = Object.freeze({
      kind: "deleted" as const,
      documentId: tombstoneDeletedId,
      tableId: tombstoneDeletedIdentity.tableId,
      rowId: tombstoneDeletedIdentity.rowId,
      dependency: logicalPointDependency(tombstoneDeletedId, {
        kind: "missing",
        basis: {
          kind: "tombstone",
          revisionCommitSeq: CommitSeqSchema.make(16n),
        },
      }),
    });
    const impossiblePoints: ReadonlyArray<VerifiedCommitPointV1> = [
      // @ts-expect-error A verified deleted point cannot carry a tombstone.
      tombstoneDeleted,
    ];
    const impossibleSource = await plannerSourceForTest(impossiblePoints);
    let plannerDefect: unknown;
    try {
      planPointCommitStateV1(impossibleSource);
    } catch (cause) {
      plannerDefect = cause;
    }
    expect(plannerDefect).toBeInstanceOf(PointCommitPlannerInvariantV1Defect);
    expect(plannerDefect).toMatchObject({
      _tag: "PointCommitPlannerInvariantV1Defect",
      reason: "deletedPointWithTombstoneDependency",
    });
  });

  it("orders logical evidence by numeric table ID and canonical row bytes", async () => {
    const tableTen = unchangedPlannerPoint(decodeAppDocumentIdV1(
      "10:00000000-0000-4000-8000-000000000001",
    ));
    const tableTwoHigh = unchangedPlannerPoint(decodeAppDocumentIdV1(
      "2:00000000-0000-4000-8000-000000000010",
    ));
    const tableTwoLow = unchangedPlannerPoint(decodeAppDocumentIdV1(
      "2:00000000-0000-4000-8000-00000000000f",
    ));
    const plan = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([tableTen, tableTwoHigh, tableTwoLow]),
    ));

    expect(plan.dependencies.map((dependency) => dependency.documentId)).toEqual([
      tableTwoLow.documentId,
      tableTwoHigh.documentId,
      tableTen.documentId,
    ]);
    expect(plan.rowIntent).toBeNull();
  });

  it("fails typed for multiple material rows, indexed writes, and future shapes", async () => {
    const firstLive = await livePlannerPoint(decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000021",
    ));
    const secondLive = await livePlannerPoint(decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000022",
    ));
    const multipleFailure = requirePlanFailure(planPointCommitStateV1(
      await plannerSourceForTest([firstLive, secondLive]),
    ));
    expect(multipleFailure).toBeInstanceOf(UnsupportedPointCommitPlanV1Error);
    expect(multipleFailure).toMatchObject({
      issue: { reason: "multipleMaterialRows", maximum: 1, observed: 2 },
    });

    const developerIndex = {
      logicalIndexId: 1,
      tableId: 1,
      namespace: "app",
      descriptor: "by_name",
      spec: {
        kind: "developerOrdered",
        specVersion: 1,
        fields: ["name"],
      },
    };
    const indexedFailure = requirePlanFailure(planPointCommitStateV1(
      await plannerSourceForTest([firstLive], [developerIndex]),
    ));
    expect(indexedFailure).toMatchObject({
      issue: { reason: "developerIndexMaintenance", tableId: 1 },
    });
    const indexedRead = unchangedPlannerPoint(firstLive.documentId);
    expect(Result.isSuccess(planPointCommitStateV1(
      await plannerSourceForTest([indexedRead], [developerIndex]),
    ))).toBe(true);

    const base = await plannerSourceForTest([indexedRead]);
    const futurePoint = Object.freeze({ ...indexedRead, kind: "future" });
    const futurePointSource = Object.freeze({
      ...base,
      points: Object.freeze([futurePoint]),
    });
    // @ts-expect-error The runtime guard proves a future point variant fails closed.
    const futurePointResult = planPointCommitStateV1(futurePointSource);
    const futurePointFailure = requirePlanFailure(futurePointResult);
    expect(futurePointFailure).toMatchObject({
      issue: { reason: "unsupportedPointState" },
    });

    let invalidPointRowIdReads = 0;
    const skippedRowIdDefect = new Error(
      "row ID must not be read after dependency failure",
    );
    let invalidPointKindReads = 0;
    const skippedMaterialCheckDefect = new Error(
      "material state must not be read after dependency failure",
    );
    const futureDependencyPoint = Object.freeze({
      ...indexedRead,
      dependency: Object.freeze({
        kind: "appRowRange",
        documentId: indexedRead.documentId,
      }),
      get rowId(): never {
        invalidPointRowIdReads += 1;
        throw skippedRowIdDefect;
      },
      get kind(): never {
        invalidPointKindReads += 1;
        throw skippedMaterialCheckDefect;
      },
    });
    let laterDependencyReads = 0;
    const skippedLaterPointDefect = new Error(
      "later point must not be read after dependency failure",
    );
    const laterPoint = Object.freeze({
      ...indexedRead,
      get dependency(): never {
        laterDependencyReads += 1;
        throw skippedLaterPointDefect;
      },
    });
    const futureDependencySource = Object.freeze({
      ...base,
      points: Object.freeze([futureDependencyPoint, laterPoint]),
    });
    // @ts-expect-error The protocol currently permits point dependencies only.
    const futureDependencyResult = planPointCommitStateV1(futureDependencySource);
    const futureDependencyFailure = requirePlanFailure(futureDependencyResult);
    expect(futureDependencyFailure).toMatchObject({
      issue: { reason: "unsupportedReadDependency" },
    });
    expect(invalidPointRowIdReads).toBe(0);
    expect(invalidPointKindReads).toBe(0);
    expect(laterDependencyReads).toBe(0);
  });

  it("reconstructs equivalent logical state and owned evidence bytes", async () => {
    const documentId = decodeAppDocumentIdV1(
      "1:00000000-0000-4000-8000-000000000031",
    );
    const firstPoint = await livePlannerPoint(documentId);
    const secondPoint = await livePlannerPoint(documentId);
    const first = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([firstPoint]),
    ));
    const second = requirePlanSuccess(planPointCommitStateV1(
      await plannerSourceForTest([secondPoint]),
    ));

    expect(first).toEqual(second);
    if (first.rowIntent?.kind !== "live" || second.rowIntent?.kind !== "live") {
      throw new Error("Expected reconstructed live logical intents.");
    }
    expect(first.rowIntent.canonicalBytes).toEqual(
      second.rowIntent.canonicalBytes,
    );
    expect(first.successfulResult.canonicalBytes).toEqual(
      second.successfulResult.canonicalBytes,
    );
  });
});

interface Fixture {
  readonly journal: CanonicalSessionJournalV1;
  readonly result: CanonicalSuccessfulResultV1;
  readonly envelope: CommitEnvelopeV1;
  readonly evidence: StoredAttemptEvidencePortV1;
}

interface CommitAuthorityFixtureOptions {
  readonly fixture?: Fixture;
  readonly documentType?: unknown;
  readonly indexBindings?: ReadonlyArray<unknown>;
  readonly returnsValidator?: unknown | null;
}

async function commitAuthorityFixture(
  args: JsonObject = {},
  argumentsValidator: unknown = { type: "object", value: {} },
  options: CommitAuthorityFixtureOptions = {},
) {
  const fixture = options.fixture ?? await emptyFixture();
  const revocationEpoch = TransactionAuthorizationRevocationEpochSchema.make(
    0n,
  );
  const target = decodeActivePointMutationTargetMetadataV1({
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    packageId: "package_c04b1",
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"a".repeat(32)}`,
    sourcePackageHash: "a".repeat(64),
    schemaVersionId: SCHEMA_VERSION_ID,
    functions: [{
      path: "users:create",
      executionModule: "flarex/users.ts",
      kind: "mutation",
      visibility: "public",
      argsValidator: argumentsValidator,
      returnsValidator: Object.hasOwn(options, "returnsValidator")
        ? options.returnsValidator
        : { type: "string" },
    }],
    schemaManifest: {
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [{
          tableId: 1,
          namespace: "app",
          logicalName: "users",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: options.documentType ?? { type: "object", value: {} },
          },
        }],
      },
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: options.indexBindings ?? [],
      },
    },
  });
  const requestKey = TransactionRequestKeyV1Schema.make("request:c04b1");
  const prepared = await preparePointMutationStartEvidenceV1(
    target,
    {
      deploymentId: DEPLOYMENT_ID,
      functionPath: TransactionFunctionPathV1Schema.make("users:create"),
      args,
      requestKey,
    },
    revocationEpoch,
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const issuedAtMilliseconds = fixture.evidence.databaseNowMilliseconds - 1_000;
  const expiresAtMilliseconds = fixture.evidence.databaseNowMilliseconds + 60_000;
  const payload = await canonicalizeTransactionGrantPayloadV1({
    format: "flarex.transaction-grant",
    version: 1,
    grantId: "grant_c04b1",
    ...prepared.logicalPins,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256: policy.sha256Hex,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    auth: { kind: "anonymous" },
    issuedAt: new Date(issuedAtMilliseconds).toISOString(),
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    authorizationRevocationEpoch: revocationEpoch.toString(),
  });
  const kid = TransactionGrantKeyIdV1Schema.make("key_c04b1");
  const header = canonicalizeTransactionGrantProtectedHeaderV1({
    alg: "Ed25519",
    kid,
    typ: "flarex-transaction-grant+jws",
  });
  const grant = await deriveInertTransactionGrantEvidenceV1({
    protected: header.base64url,
    payload: payload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(
      new Uint8Array(64),
    ),
  });
  Object.assign(fixture.evidence.session, {
    packageId: prepared.logicalPins.packageId,
    artifactRuntime: prepared.logicalPins.artifactRuntime,
    artifactId: prepared.logicalPins.artifactId,
    sourcePackageHash: prepared.logicalPins.sourcePackageHash,
    executionModule: prepared.logicalPins.executionModule,
    functionPath: prepared.logicalPins.functionPath,
    functionKind: prepared.logicalPins.functionKind,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256:
      transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
        policy.sha256Hex,
      ),
    validatedArgsValueCodecVersion:
      prepared.logicalPins.validatedArgsValueCodecVersion,
    validatedArgsCanonicalByteLength:
      prepared.validatedArguments.canonicalBytes.byteLength,
    validatedArgsSha256: new Uint8Array(prepared.validatedArguments.sha256),
    authorizationGrantId: grant.authorizationGrantId,
    authorizationGrantValueCodecVersion:
      grant.authorizationGrantValueCodecVersion,
    authorizationGrantCanonicalByteLength:
      grant.authorizationGrantCanonicalBytes.byteLength,
    authorizationGrantSha256: new Uint8Array(
      grant.authorizationGrantSha256,
    ),
    authorizationRevocationEpoch: revocationEpoch,
    authorizationGrantExpiresAtMilliseconds: expiresAtMilliseconds,
    requestKey,
    requestSha256: new Uint8Array(prepared.requestEvidence.sha256),
    hardExpiresAtMilliseconds: expiresAtMilliseconds,
  });

  let hostClockReadCount = 0;
  const verifier = createTransactionGrantVerifierV1({
    clock: {
      now: () => {
        hostClockReadCount += 1;
        return new Date(0);
      },
    },
    verificationKeyNamespace:
      createTransactionGrantVerificationKeyNamespaceV1({
        deploymentId: DEPLOYMENT_ID,
        keys: [{
          state: "active",
          kid,
          purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
          issuedAtInclusiveEpochMilliseconds: issuedAtMilliseconds - 1_000,
          verificationEndsAtExclusiveEpochMilliseconds:
            expiresAtMilliseconds + 1_000,
          verify: async () => true,
        }],
      }),
    grantRetentionPolicy: Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 120_000,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds: 120_000,
      }),
    ),
  });
  const sessionEvidence = fixture.evidence.session;
  const commitEvidence: StoredCommitAuthorityEvidencePortV1 = {
    databaseNowMilliseconds: fixture.evidence.databaseNowMilliseconds,
    currentAuthorizationRevocationEpoch: revocationEpoch,
    session: {
      ...structuredClone(sessionEvidence),
      validatedArgsJson: structuredClone(
        prepared.validatedArguments.valueJson,
      ),
      validatedArgsCanonicalBytes: new Uint8Array(
        prepared.validatedArguments.canonicalBytes,
      ),
      authorizationGrantJson: structuredClone(grant.authorizationGrantJson),
      authorizationGrantCanonicalBytes: new Uint8Array(
        grant.authorizationGrantCanonicalBytes,
      ),
    },
    schema: {
      deploymentId: DEPLOYMENT_ID,
      schemaVersionId: SCHEMA_VERSION_ID,
      manifest: structuredClone(target.schemaManifest),
      stableBindings: [{ logicalName: "users", tableId: decodeCatalogTableId(1) }],
    },
  };
  const functionMetadata = target.functions[0];
  if (functionMetadata === undefined) throw new Error("Missing metadata.");
  const functionSnapshot = {
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    packageId: prepared.logicalPins.packageId,
    artifactRuntime: prepared.logicalPins.artifactRuntime,
    artifactId: prepared.logicalPins.artifactId,
    sourcePackageHash: prepared.logicalPins.sourcePackageHash,
    executionModule: prepared.logicalPins.executionModule,
    functionPath: prepared.logicalPins.functionPath,
    functionKind: prepared.logicalPins.functionKind,
    schemaVersionId: prepared.logicalPins.schemaVersionId,
    functionMetadata: structuredClone(functionMetadata),
  };
  return {
    fixture,
    commitEvidence,
    functionSnapshot,
    verifier,
    hostClockReads: () => hostClockReadCount,
  };
}

type CommitAuthorityFixture = Awaited<ReturnType<typeof commitAuthorityFixture>>;

async function authenticateCommitAuthorityFixture(
  current: CommitAuthorityFixture,
) {
  let storedEvidenceLoads = 0;
  let authorityEvidenceLoads = 0;
  let metadataLoads = 0;
  const authentication = createStoredPointCommitPlanningV1(
    {
      loadEffect: () => Effect.sync(() => {
        storedEvidenceLoads += 1;
        return loaded(current.fixture.evidence);
      }),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.sync(() => {
          authorityEvidenceLoads += 1;
          return {
            kind: "loaded" as const,
            evidence: current.commitEvidence,
          };
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => {
          metadataLoads += 1;
          return Effect.succeed(structuredClone(current.functionSnapshot));
        },
      },
    },
    TEST_EXECUTION_CLAIMS,
  );
  const authority = await deriveAuthority(authentication);
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  return {
    authentication,
    storedAttempt,
    commitAuthority,
    counts: () => Object.freeze({
      storedEvidenceLoads,
      authorityEvidenceLoads,
      metadataLoads,
      hostClockReads: current.hostClockReads(),
    }),
  };
}

async function verifyCommitInputFixture(current: CommitAuthorityFixture) {
  const authenticated = await authenticateCommitAuthorityFixture(current);
  const countsBeforeVerification = authenticated.counts();
  const verifiedCommitInput = await runEffect(
    authenticated.authentication.verifyCommitInput(
      authenticated.commitAuthority,
    ),
  );
  return {
    ...authenticated,
    verifiedCommitInput,
    countsBeforeVerification,
    countsAfterVerification: authenticated.counts,
  };
}

async function pointCommitRollbackFixture(
  current: CommitAuthorityFixture,
  pointCommit: PointCommitRollbackProofPortV1,
) {
  const authentication = createStoredPointCommitRollbackProofV1(
    {
      loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.succeed({
          kind: "loaded" as const,
          evidence: current.commitEvidence,
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit,
    },
    TEST_EXECUTION_CLAIMS,
  );
  const authority = await deriveAuthority(authentication);
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  const verifiedCommitInput = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const prepared = await runEffect(
    authentication.planPointCommit(verifiedCommitInput),
  );
  return { authentication, prepared };
}

async function pointCommitPublisherFixture(
  current: CommitAuthorityFixture,
  pointCommit: PointCommitPublisherPortV1,
) {
  const authentication = createStoredPointCommitPublisherV1(
    {
      loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.succeed({
          kind: "loaded" as const,
          evidence: current.commitEvidence,
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit,
    },
    TEST_EXECUTION_CLAIMS,
  );
  const authority = await deriveAuthority(authentication);
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  const verifiedCommitInput = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const prepared = await runEffect(
    authentication.planPointCommit(verifiedCommitInput),
  );
  return { authentication, prepared };
}

async function pointCommitFinishingFixture(
  current: CommitAuthorityFixture,
  pointCommit: PointCommitPublisherPortV1,
  pointCommitFinishing: PointCommitFinishingTransitionPortV1,
) {
  const authentication = createStoredPointCommitFinishingTransitionV1(
    {
      loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.succeed({
          kind: "loaded" as const,
          evidence: current.commitEvidence,
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit,
      pointCommitFinishing,
    },
    TEST_EXECUTION_CLAIMS,
  );
  const authority = await deriveAuthority(authentication);
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  const verifiedCommitInput = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const prepared = await runEffect(
    authentication.planPointCommit(verifiedCommitInput),
  );
  return { authentication, prepared };
}

function pointCommitFinishingPortForTest(): PointCommitFinishingTransitionPortV1 {
  return Object.freeze({
    enterFinishing: Effect.fn("TestPointCommit.enterFinishingForSqlRetry")(
      (command) => Effect.succeed(Object.freeze({
        kind: "transitioned" as const,
        scopeUuid: command.sealIdentity.scopeUuid,
        sessionId: command.authorityPins.sessionId,
        attemptFence: command.authorityPins.attemptFence,
        priorSessionUpdatedAtMilliseconds:
          command.session.updatedAtMilliseconds,
        finishingSessionUpdatedAtMilliseconds:
          command.session.updatedAtMilliseconds + 1,
      } satisfies PointCommitFinishingTransitionResultV1)),
    ),
  });
}

function expiredPointCommitPublicationResultForTest(): PointCommitPublicationResultV1 {
  return Object.freeze({
    kind: "expired",
    token: Object.freeze({
      scopeUuid: SCOPE_UUID,
      epochUuid: decodeScopeEpochUuidV1(
        "92000000-0000-4000-8000-000000000002",
      ),
      commitSeq: CommitSeqSchema.make(1n),
    }),
  });
}

function unsafePointCommitPublicationFailureForTest(
  value: unknown,
): PointCommitPublicationV1Error {
  return value as PointCommitPublicationV1Error;
}

function pointCommitDecisionUncertainForTest(
  message: string,
): PointCommitDecisionUncertainV1Error {
  return new PointCommitDecisionUncertainV1Error({
    phase: "commitOrRelease",
    cause: new Error(message),
    outcomeCheck: Object.freeze({ kind: "missing" }),
  });
}

function unsafeDecisionUncertainOutcomeCheckForTest(
  value: unknown,
): PointCommitDecisionUncertainV1Error["outcomeCheck"] {
  return value as PointCommitDecisionUncertainV1Error["outcomeCheck"];
}

type PointCommitPublicationTestOutcomeV1 =
  | Readonly<{
      readonly kind: "success";
      readonly result: PointCommitPublicationResultV1;
    }>
  | Readonly<{
      readonly kind: "failure";
      readonly failure: PointCommitPublicationV1Error;
    }>
  | Readonly<{
      readonly kind: "defect";
      readonly defect: unknown;
    }>;

async function pointCommitSqlRetryFixture(
  outcomes: ReadonlyArray<PointCommitPublicationTestOutcomeV1>,
) {
  const commands: PointCommitPublicationCommandV1[] = [];
  const pointCommit: PointCommitPublisherPortV1 = Object.freeze({
    prove: Effect.fn("TestPointCommit.proveSqlRetry")(
      () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
    ),
    publish: Effect.fn("TestPointCommit.publishSqlRetry")(function* (command) {
      commands.push(command);
      const outcome = outcomes[commands.length - 1];
      if (outcome === undefined) {
        return yield* Effect.die(new Error(
          "Missing configured point-commit publication test outcome.",
        ));
      }
      if (outcome.kind === "failure") {
        return yield* Effect.fail(outcome.failure);
      }
      if (outcome.kind === "defect") {
        return yield* Effect.die(outcome.defect);
      }
      return outcome.result;
    }),
  });
  const current = await commitAuthorityFixture({}, undefined, {
    fixture: await emptyFixture("o08c"),
    returnsValidator: { type: "string" },
  });
  const fixture = await pointCommitFinishingFixture(
    current,
    pointCommit,
    pointCommitFinishingPortForTest(),
  );
  const finishing = await runEffect(
    fixture.authentication.enterPointCommitFinishing(fixture.prepared),
  );
  return { ...fixture, finishing, commands };
}

async function pointCommitUncertainOutcomeFixture(
  options: Readonly<{
    readonly publicationFailures: ReadonlyArray<PointCommitPublicationV1Error>;
    readonly publicationFailureForCall?: (
      call: number,
    ) => PointCommitPublicationV1Error | undefined;
    readonly mutateCommandBeforeFailure?: (
      command: PointCommitPublicationCommandV1,
      call: number,
    ) => void;
    readonly resolveOutcome?: PointCommitOutcomeResolutionPortV1[
      typeof RESOLVE_POINT_COMMIT_OUTCOME_V1
    ];
    readonly outcomeKind?: "missing" | "available" | "expired";
    readonly finishingLoadResult?: StoredAttemptEvidenceLoadResultPortV1;
    readonly mutateRecoveredEvidence?: (
      evidence: StoredAttemptEvidencePortV1,
      authorityEvidence: StoredCommitAuthorityEvidencePortV1,
    ) => void;
  }>,
) {
  const current = await commitAuthorityFixture({}, undefined, {
    fixture: await emptyFixture("o08d"),
    returnsValidator: { type: "string" },
  });
  const finishingUpdatedAtMilliseconds =
    current.fixture.evidence.session.updatedAtMilliseconds + 1;
  const recoveredEvidence = structuredClone(current.fixture.evidence);
  Object.assign(recoveredEvidence.session, {
    lifecycle: "finishing",
    updatedAtMilliseconds: finishingUpdatedAtMilliseconds,
  });
  const recoveredAuthorityEvidence = structuredClone(current.commitEvidence);
  Object.assign(recoveredAuthorityEvidence.session, {
    lifecycle: "finishing",
    updatedAtMilliseconds: finishingUpdatedAtMilliseconds,
  });
  options.mutateRecoveredEvidence?.(
    recoveredEvidence,
    recoveredAuthorityEvidence,
  );

  const commands: PointCommitPublicationCommandV1[] = [];
  let finishingLoads = 0;
  let authorityLoads = 0;
  let outcomeCalls = 0;
  const successfulPublication = pointCommitPublishedResultForTest(current);
  const defaultResolveOutcome: PointCommitOutcomeResolutionPortV1[
    typeof RESOLVE_POINT_COMMIT_OUTCOME_V1
  ] = Effect.fn("TestO08D.resolveOutcome")(() => Effect.sync(
    (): CommittedPointOutcomeResolutionV1 => {
    if (options.outcomeKind === "available") {
      if (successfulPublication.kind === "expired") {
        throw new Error("O08-D fixture result was unavailable.");
      }
      return Object.freeze({
        kind: "available" as const,
        token: successfulPublication.token,
        successfulResult: successfulPublication.successfulResult,
      });
    }
    if (options.outcomeKind === "expired") {
      return Object.freeze({
        kind: "expired" as const,
        token: successfulPublication.token,
      });
    }
    return Object.freeze({ kind: "missing" as const });
  }));
  const resolveOutcome = options.resolveOutcome ?? defaultResolveOutcome;
  const pointCommit = Object.freeze({
    prove: Effect.fn("TestO08D.prove")(
      () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
    ),
    publish: Effect.fn("TestO08D.publish")((command) => Effect.suspend(() => {
      commands.push(command);
      const call = commands.length;
      const failure = options.publicationFailureForCall?.(call) ??
        options.publicationFailures[call - 1];
      if (failure !== undefined) {
        options.mutateCommandBeforeFailure?.(command, call);
      }
      return failure === undefined
        ? Effect.succeed(successfulPublication)
        : Effect.fail(failure);
    })),
    [RESOLVE_POINT_COMMIT_OUTCOME_V1]: Effect.fn(
      "TestO08D.resolveOutcome",
    )((deploymentId, input) => Effect.suspend(() => {
      outcomeCalls += 1;
      return resolveOutcome(deploymentId, input);
    })),
  } satisfies PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1);
  const pointCommitFinishing = pointCommitFinishingPortForTest();
  const authentication = createStoredPointCommitExecutorV1(
    {
      loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
      loadFinishingEffect: () => Effect.sync(() => {
        finishingLoads += 1;
        return options.finishingLoadResult ?? loaded(recoveredEvidence);
      }),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.sync(() => {
          authorityLoads += 1;
          return {
            kind: "loaded" as const,
            evidence: authorityLoads === 1
              ? current.commitEvidence
              : recoveredAuthorityEvidence,
          };
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit,
      pointCommitFinishing,
    },
    TEST_EXECUTION_CLAIMS,
  );
  const authority = await deriveAuthority(authentication);
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  const verifiedInput = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const prepared = await runEffect(
    authentication.planPointCommit(verifiedInput),
  );
  const finishing = await runEffect(
    authentication.enterPointCommitFinishing(prepared),
  );
  return {
    authentication,
    finishing,
    commands,
    successfulPublication,
    counts: () => ({ finishingLoads, authorityLoads, outcomeCalls }),
  };
}

function pointCommitPublishedResultForTest(
  current: CommitAuthorityFixture,
): PointCommitPublicationResultV1 {
  const canonical = current.fixture.result;
  return Object.freeze({
    kind: "published" as const,
    token: Object.freeze({
      scopeUuid: SCOPE_UUID,
      epochUuid: decodeScopeEpochUuidV1(
        "92000000-0000-4000-8000-000000000008",
      ),
      commitSeq: CommitSeqSchema.make(8n),
    }),
    successfulResult: Object.freeze({
      valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      valueJson: structuredClone(canonical.valueJson),
      semanticSizeBytes: canonical.semanticSizeBytes,
      canonicalText: canonical.canonicalText,
      canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
        new Uint8Array(canonical.canonicalBytes),
      ),
      sha256: FlarexValueSha256V1Schema.make(
        hexBytes(canonical.evidence.sha256Hex),
      ),
    }),
  });
}

async function pointCommitReplacementFixture(
  current: CommitAuthorityFixture,
  pointCommit: PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1,
  pointCommitFinishing: PointCommitFinishingTransitionPortV1,
  pointMutationAttemptReplacement: PointMutationAttemptReplacementPortV1,
) {
  const authentication = createStoredPointMutationAttemptReplacementV1(
    {
      loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
      loadFinishingEffect: () =>
        Effect.succeed(loaded(current.fixture.evidence)),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.succeed({
          kind: "loaded" as const,
          evidence: current.commitEvidence,
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit,
      pointCommitFinishing,
      pointMutationAttemptReplacement,
    },
    TEST_EXECUTION_CLAIMS,
  );
  const authority = await deriveAuthority(authentication);
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  const verifiedCommitInput = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const prepared = await runEffect(
    authentication.planPointCommit(verifiedCommitInput),
  );
  return { authentication, prepared };
}

async function pointMutationOccAuthorizationFixture(
  current: CommitAuthorityFixture,
  options: Readonly<{
    readonly attemptFence?: bigint;
    readonly outcome?: CommittedPointOutcomeResolutionV1;
    readonly replacementKind?: "replaced" | "alreadyReplaced";
    readonly unsafeOutcomeForTest?: unknown;
    readonly unsafeReplacementKindForTest?: unknown;
    readonly freshLoadNever?: boolean;
    readonly conflictCommitSeqOffset?: bigint;
    readonly mutateFreshLoadForTest?: (
      result: PointMutationSessionAttemptLoadResultV1,
    ) => PointMutationSessionAttemptLoadResultV1;
  }> = {},
) {
  const attemptFence = TransactionAttemptFenceSchema.make(
    options.attemptFence ?? 1n,
  );
  Object.assign(current.fixture.envelope, { attemptFence });
  Object.assign(current.fixture.evidence, { attemptFence });
  const previousSnapshot = current.fixture.evidence.lease.snapshotToken;
  const currentCommitSeq = CommitSeqSchema.make(
    previousSnapshot.commitSeq + (options.conflictCommitSeqOffset ?? 1n),
  );
  const freshSnapshot = SnapshotTokenSchema.make({
    ...previousSnapshot,
    commitSeq: currentCommitSeq,
  });
  const dependency = current.fixture.journal.journal.readDependencies[0];
  if (dependency?.kind !== "appRowPoint") {
    throw new Error("O08-B1 fixture requires one point dependency.");
  }
  const conflict = new PointCommitConflictV1Error({
    documentId: dependency.documentId,
    snapshotCommitSeq: previousSnapshot.commitSeq,
    currentCommitSeq,
  });
  let outcome: unknown = options.unsafeOutcomeForTest ?? options.outcome ??
    Object.freeze({ kind: "missing" as const });
  let outcomeCalls = 0;
  let replacementCalls = 0;
  let loadCalls = 0;
  const attemptLoading = createPointMutationSessionAttemptLoadingV1({
    loadEffect: (selector) => {
      const isFresh = selector.attemptFence === attemptFence + 1n;
      if (isFresh && options.freshLoadNever === true) {
        return Effect.sync(() => {
          loadCalls += 1;
        }).pipe(Effect.flatMap(() => Effect.never));
      }
      return Effect.sync(() => {
        loadCalls += 1;
      const result = Object.freeze({
        status: "loaded" as const,
        anchor: Object.freeze({
          deploymentId: selector.deploymentId,
          scopeId: selector.scopeId,
          sessionId: selector.sessionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            current.fixture.evidence.session.requestKey,
          ),
          storageGeneration: FlarexDbV1StorageGenerationSchema.make(
            "flarexdb_v1",
          ),
          storageGenerationFence: StorageGenerationFenceSchema.make(
            current.fixture.evidence.session.storageGenerationFence,
          ),
          attemptFence: selector.attemptFence,
          snapshotToken: isFresh ? freshSnapshot : previousSnapshot,
          hardExpiresAt: "2099-01-01T00:00:00.000Z",
          leaseExpiresAt: "2098-12-31T23:59:00.000Z",
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
        }),
        executionPin: Object.freeze({ schemaVersionId: SCHEMA_VERSION_ID }),
        attemptFacet: Object.freeze({
          kind: isFresh ? "pristineOpen" as const : "nonPristine" as const,
        }),
      } satisfies PointMutationSessionAttemptLoadResultV1);
      return isFresh && options.mutateFreshLoadForTest !== undefined
        ? options.mutateFreshLoadForTest(result)
        : result;
      });
    },
  });
  const pointCommit = Object.freeze({
    prove: Effect.fn("TestO08B1.prove")(
      () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
    ),
    publish: Effect.fn("TestO08B1.publish")(
      () => Effect.fail(conflict),
    ),
    [RESOLVE_POINT_COMMIT_OUTCOME_V1]: Effect.fn(
      "TestO08B1.resolveOutcome",
    )(() => Effect.sync(() => {
      outcomeCalls += 1;
      return unsafeCommittedPointOutcomeResolutionForTest(outcome);
    })),
  } satisfies PointCommitPublisherPortV1 & PointCommitOutcomeResolutionPortV1);
  const pointCommitFinishing: PointCommitFinishingTransitionPortV1 =
    Object.freeze({
      enterFinishing: Effect.fn("TestO08B1.enterFinishing")((command) =>
        Effect.succeed(Object.freeze({
          kind: "transitioned" as const,
          scopeUuid: command.sealIdentity.scopeUuid,
          sessionId: command.authorityPins.sessionId,
          attemptFence: command.authorityPins.attemptFence,
          priorSessionUpdatedAtMilliseconds:
            command.session.updatedAtMilliseconds,
          finishingSessionUpdatedAtMilliseconds:
            command.session.updatedAtMilliseconds + 2,
        }))
      ),
    });
  const pointMutationAttemptReplacement:
    PointMutationAttemptReplacementPortV1 = Object.freeze({
      replace: Effect.fn("TestO08B1.replace")((command) => Effect.sync(() => {
        replacementCalls += 1;
        return unsafePointMutationAttemptReplacementObservationForTest(
          Object.freeze({
          kind: options.unsafeReplacementKindForTest ??
            options.replacementKind ?? "replaced",
          scopeUuid: command.sealIdentity.scopeUuid,
          sessionId: command.authorityPins.sessionId,
          previousAttemptFence: command.authorityPins.attemptFence,
          attemptFence: TransactionAttemptFenceSchema.make(
            command.authorityPins.attemptFence + 1n,
          ),
          }),
        );
      })),
    });
  const authentication = createStoredPointMutationOccRerunAuthorizationV1(
    {
      loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)),
      loadFinishingEffect: () =>
        Effect.succeed(loaded(current.fixture.evidence)),
    },
    {
      evidenceLoader: {
        loadEffect: () => Effect.succeed({
          kind: "loaded" as const,
          evidence: current.commitEvidence,
        }),
      },
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit,
      pointCommitFinishing,
      pointMutationAttemptReplacement,
      pointMutationOccRerun: { attemptLoading },
    },
    TEST_EXECUTION_CLAIMS,
  );
  const initialAttempt = await runEffect(attemptLoading.load({
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    sessionId: SESSION_ID,
    attemptFence: attemptFence.toString(),
  }));
  const authority = await runEffect(authentication.deriveAuthority(
    initialAttempt,
    makeTestExecutionScope(attemptFence),
  ));
  const storedAttempt = await runEffect(authentication.authenticate(
    authority,
    encodeEnvelope(current.fixture.envelope),
  ));
  const commitAuthority = await runEffect(
    authentication.authenticateCommitAuthority(storedAttempt),
  );
  const verified = await runEffect(
    authentication.verifyCommitInput(commitAuthority),
  );
  const prepared = await runEffect(authentication.planPointCommit(verified));
  const finishing = await runEffect(
    authentication.enterPointCommitFinishing(prepared),
  );
  const observedConflict = await runFailure(
    authentication.publishPointCommit(finishing),
  );
  if (observedConflict !== conflict) {
    throw new Error("O08-B1 fixture did not observe its exact OCC conflict.");
  }
  return {
    authentication,
    conflict,
    prepared,
    finishing,
    attemptFence,
    freshSnapshot,
    setOutcome: (next: CommittedPointOutcomeResolutionV1) => {
      outcome = next;
    },
    counts: () => ({ outcomeCalls, replacementCalls, loadCalls }),
  };
}

function unsafeFinishingTransitionResultForTest(
  value: unknown,
): PointCommitFinishingTransitionResultV1 {
  return value as PointCommitFinishingTransitionResultV1;
}

function unsafeCommittedPointOutcomeResolutionForTest(
  value: unknown,
): CommittedPointOutcomeResolutionV1 {
  return value as CommittedPointOutcomeResolutionV1;
}

function unsafePointMutationAttemptReplacementObservationForTest(
  value: unknown,
): PointMutationAttemptReplacementObservationV1 {
  return value as PointMutationAttemptReplacementObservationV1;
}

function commitInputSourceForTest(
  current: CommitAuthorityFixture,
): CommitInputVerificationSourceV1 {
  const evidence = current.fixture.evidence;
  if (evidence.points.length !== 0) {
    throw new Error("The synthetic corruption source supports empty journals only.");
  }
  const result = normalizeFlarexValueJsonV1(current.fixture.result.valueJson);
  return {
    authority: Object.freeze({
      deploymentId: evidence.deploymentId,
      scopeId: evidence.scopeId,
      sessionId: evidence.sessionId,
      attemptFence: evidence.attemptFence,
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: STORAGE_FENCE,
      snapshotToken: Object.freeze({ ...evidence.lease.snapshotToken }),
      schemaVersionId: SCHEMA_VERSION_ID,
    }),
    session: structuredClone(evidence.session),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: evidence.root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: evidence.root.updatedAtMilliseconds,
      sealedAtMilliseconds: evidence.root.sealedAtMilliseconds,
      finalSyscallSequence: evidence.root.sealedFinalSyscallSequence,
      creationTimeSeed: evidence.root.creationTimeSeed,
      nextCreationTime: evidence.root.nextCreationTime,
      journalFormat: current.fixture.journal.journal.format,
      journalProtocolVersion: current.fixture.journal.journal.protocolVersion,
      journalValueCodecVersion: current.fixture.journal.journal.valueCodecVersion,
      journalByteLength: evidence.root.journalBytes.byteLength,
      journalSha256: new Uint8Array(evidence.root.journalSha256),
      resultValueCodecVersion: evidence.root.resultValueCodecVersion,
      resultSemanticBytes: evidence.root.resultSemanticBytes,
      resultByteLength: evidence.root.resultBytes.byteLength,
      resultSha256: new Uint8Array(evidence.root.resultSha256),
      readDocuments: evidence.root.readDocuments,
      readSemanticBytes: evidence.root.readSemanticBytes,
      pointDependencyCount: evidence.root.pointDependencyCount,
      writeOperations: evidence.root.writeOperations,
      writeSemanticBytes: evidence.root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        evidence.root.materialWriteEventEvidenceBytes,
    }),
    journal: structuredClone(current.fixture.journal.journal),
    points: [],
    successfulResult: Object.freeze({
      value: result.value,
      valueJson: structuredClone(current.fixture.result.valueJson),
      canonicalBytes: new Uint8Array(current.fixture.result.canonicalBytes),
      semanticSizeBytes: current.fixture.result.semanticSizeBytes,
      sha256Hex: current.fixture.result.evidence.sha256Hex,
    }),
    schemaManifest: structuredClone(current.commitEvidence.schema.manifest),
    functionMetadata: structuredClone(current.functionSnapshot.functionMetadata),
  };
}

async function plannerSourceForTest(
  points: ReadonlyArray<VerifiedCommitPointV1>,
  indexBindings: ReadonlyArray<unknown> = [],
): Promise<VerifiedCommitInputStateV1> {
  const current = await commitAuthorityFixture({}, undefined, {
    fixture: await emptyFixture("planned"),
    returnsValidator: { type: "string" },
  });
  const base = await runEffect(verifyCommitInputStateEffect(
    commitInputSourceForTest(current),
  ));
  const tableDefinitions: unknown[] = [
    ...structuredClone(base.schemaManifest.tableDefinitions.tables),
  ];
  const knownTableIds = new Set(
    base.schemaManifest.tableDefinitions.tables.map((table) => table.tableId),
  );
  const missingTableIds = new Set<VerifiedCommitPointV1["tableId"]>();
  for (const point of points) {
    if (knownTableIds.has(point.tableId)) continue;
    missingTableIds.add(point.tableId);
  }
  for (const tableId of [...missingTableIds].sort((left, right) => left - right)) {
    tableDefinitions.push({
      tableId,
      namespace: "app",
      logicalName: `table${tableId}`,
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: { type: "object", value: {} },
      },
    });
  }
  const schemaManifest = decodeSchemaManifestAppSchemaV1({
    ...structuredClone(base.schemaManifest),
    tableDefinitions: {
      ...structuredClone(base.schemaManifest.tableDefinitions),
      tables: tableDefinitions,
    },
    indexBindings: {
      kind: "indexBindings",
      sectionVersion: 1,
      indexes: structuredClone(indexBindings),
    },
  });
  return Object.freeze({
    ...base,
    points: Object.freeze([...points]),
    schemaManifest,
  } satisfies VerifiedCommitInputStateV1);
}

function unchangedPlannerPoint(
  documentId: AppDocumentIdV1,
  observed: LogicalReadDependencyV1["observed"] = Object.freeze({
    kind: "missing",
    basis: Object.freeze({ kind: "noVisibleRevision" }),
  }),
): Extract<VerifiedCommitPointV1, { readonly kind: "unchanged" }> {
  const identity = decodeAppDocumentIdentityV1(documentId);
  return Object.freeze({
    kind: "unchanged",
    documentId,
    tableId: identity.tableId,
    rowId: identity.rowId,
    dependency: logicalPointDependency(documentId, observed),
  });
}

function deletedPlannerPoint(
  documentId: AppDocumentIdV1,
  observed: Extract<
    VerifiedCommitPointV1,
    { readonly kind: "deleted" }
  >["dependency"]["observed"] = Object.freeze({
    kind: "present",
    revisionCommitSeq: CommitSeqSchema.make(1n),
  }),
): Extract<VerifiedCommitPointV1, { readonly kind: "deleted" }> {
  const identity = decodeAppDocumentIdentityV1(documentId);
  return Object.freeze({
    kind: "deleted",
    documentId,
    tableId: identity.tableId,
    rowId: identity.rowId,
    dependency: writableLogicalPointDependency(documentId, observed),
  });
}

async function livePlannerPoint(
  documentId: AppDocumentIdV1,
  observed: Extract<
    VerifiedCommitPointV1,
    { readonly kind: "live" }
  >["dependency"]["observed"] = Object.freeze({
    kind: "missing",
    basis: Object.freeze({ kind: "noVisibleRevision" }),
  }),
): Promise<Extract<VerifiedCommitPointV1, { readonly kind: "live" }>> {
  const identity = decodeAppDocumentIdentityV1(documentId);
  const creationTime = AppCreationTimeV1Schema.make(1_700_000_000_100.25);
  const document = await canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    fields: { name: "planned" },
  });
  return Object.freeze({
    kind: "live",
    documentId,
    tableId: identity.tableId,
    rowId: identity.rowId,
    dependency: writableLogicalPointDependency(documentId, observed),
    creationTime,
    value: document.value,
    canonicalBytes: new Uint8Array(document.canonicalBytes),
    semanticSizeBytes: document.semanticSizeBytes,
  });
}

function logicalPointDependency(
  documentId: AppDocumentIdV1,
  observed: LogicalReadDependencyV1["observed"],
): LogicalReadDependencyV1 {
  if (observed.kind === "present") {
    return Object.freeze({
      kind: "appRowPoint",
      documentId,
      observed: Object.freeze({
        kind: "present",
        revisionCommitSeq: observed.revisionCommitSeq,
      }),
    });
  }
  const basis = observed.basis.kind === "noVisibleRevision"
    ? Object.freeze({ kind: "noVisibleRevision" as const })
    : Object.freeze({
      kind: "tombstone" as const,
      revisionCommitSeq: observed.basis.revisionCommitSeq,
    });
  return Object.freeze({
    kind: "appRowPoint",
    documentId,
    observed: Object.freeze({ kind: "missing", basis }),
  });
}

function writableLogicalPointDependency(
  documentId: AppDocumentIdV1,
  observed: Extract<
    VerifiedCommitPointV1,
    { readonly kind: "live" | "deleted" }
  >["dependency"]["observed"],
): Extract<
  VerifiedCommitPointV1,
  { readonly kind: "live" | "deleted" }
>["dependency"] {
  if (observed.kind === "present") {
    return Object.freeze({
      kind: "appRowPoint",
      documentId,
      observed: Object.freeze({
        kind: "present",
        revisionCommitSeq: observed.revisionCommitSeq,
      }),
    });
  }
  return Object.freeze({
    kind: "appRowPoint",
    documentId,
    observed: Object.freeze({
      kind: "missing",
      basis: Object.freeze({ kind: "noVisibleRevision" }),
    }),
  });
}

function requirePlanSuccess(
  result: Result.Result<
    PreparedPointCommitStateV1,
    UnsupportedPointCommitPlanV1Error
  >,
): PreparedPointCommitStateV1 {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function requirePlanFailure(
  result: Result.Result<
    PreparedPointCommitStateV1,
    UnsupportedPointCommitPlanV1Error
  >,
): UnsupportedPointCommitPlanV1Error {
  if (Result.isSuccess(result)) {
    throw new Error("Expected point commit planning to fail.");
  }
  return result.failure;
}

async function emptyFixture(successfulResult: unknown = { ok: true }): Promise<Fixture> {
  return fixtureForJournal(emptyJournal(), successfulResult);
}

async function insertFixture(
  fields: JsonObject,
  successfulResult: unknown = { ok: true },
): Promise<Fixture> {
  const documentId = decodeAppDocumentIdV1(
    "1:00000000-0000-4000-8000-000000000001",
  );
  const identity = decodeAppDocumentIdentityV1(documentId);
  const creationTime = AppCreationTimeV1Schema.make(1_700_000_000_000.25);
  const document = await canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    fields,
  });
  const journal: SessionJournalV1 = {
    ...emptyJournal(),
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
    readDependencies: [{
      kind: "appRowPoint",
      documentId,
      observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
    }],
    writes: [{
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      documentId,
      creationTime,
      fieldsValueJson: fields,
      resultingDocumentSemanticBytes:
        CommitDocumentSemanticBytesV1Schema.make(document.semanticSizeBytes),
    }],
  };
  const fixture = await fixtureForJournal(journal, successfulResult);
  Object.assign(fixture.evidence.root, {
    pointDependencyCount: 1,
    writeOperations: 1,
    writeSemanticBytes: document.semanticSizeBytes,
  });
  Reflect.apply(Array.prototype.push, fixture.evidence.points, [{
    tableId: decodeCatalogTableId(1),
    rowId: appRowIdHexV1ToBytes(identity.rowId),
    dependencyKind: "missing_no_visible_revision",
    dependencyRevisionCommitSeq: null,
    overlayKind: "live",
    overlayCreationTime: creationTime,
    overlayValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    overlayValueJson: requireJsonObject(document.valueJson),
    overlayValueBytes: new Uint8Array(document.canonicalBytes),
    overlayValueSha256: new Uint8Array(document.sha256),
    overlaySemanticBytes: document.semanticSizeBytes,
    createdAtMilliseconds: 1_700_000_000_000,
    updatedAtMilliseconds: 1_700_000_000_000,
  }]);
  return fixture;
}

async function patchFixture(
  finalName: string,
  successfulResult: unknown = { ok: true },
): Promise<Fixture> {
  const documentId = decodeAppDocumentIdV1(
    "1:00000000-0000-4000-8000-000000000002",
  );
  const identity = decodeAppDocumentIdentityV1(documentId);
  const creationTime = AppCreationTimeV1Schema.make(1_700_000_000_001.25);
  const document = await canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    fields: { name: finalName, stable: true },
  });
  const journal: SessionJournalV1 = {
    ...emptyJournal(),
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
    readDependencies: [{
      kind: "appRowPoint",
      documentId,
      observed: {
        kind: "present",
        revisionCommitSeq: CommitSeqSchema.make(9n),
      },
    }],
    writes: [{
      kind: "patch",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      documentId,
      changes: [{ kind: "set", field: "name", valueJson: "after" }],
      resultingDocumentSemanticBytes:
        CommitDocumentSemanticBytesV1Schema.make(document.semanticSizeBytes),
    }],
  };
  const fixture = await fixtureForJournal(journal, successfulResult);
  Object.assign(fixture.evidence.root, {
    pointDependencyCount: 1,
    writeOperations: 1,
    writeSemanticBytes: document.semanticSizeBytes,
  });
  Reflect.apply(Array.prototype.push, fixture.evidence.points, [{
    tableId: decodeCatalogTableId(1),
    rowId: appRowIdHexV1ToBytes(identity.rowId),
    dependencyKind: "present",
    dependencyRevisionCommitSeq: 9n,
    overlayKind: "live",
    overlayCreationTime: creationTime,
    overlayValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    overlayValueJson: requireJsonObject(document.valueJson),
    overlayValueBytes: new Uint8Array(document.canonicalBytes),
    overlayValueSha256: new Uint8Array(document.sha256),
    overlaySemanticBytes: document.semanticSizeBytes,
    createdAtMilliseconds: 1_700_000_000_000,
    updatedAtMilliseconds: 1_700_000_000_000,
  }]);
  return fixture;
}

async function replaceFixture(
  fields: JsonObject,
  successfulResult: unknown = { ok: true },
): Promise<Fixture> {
  const documentId = decodeAppDocumentIdV1(
    "1:00000000-0000-4000-8000-000000000003",
  );
  const identity = decodeAppDocumentIdentityV1(documentId);
  const creationTime = AppCreationTimeV1Schema.make(1_700_000_000_002.25);
  const document = await canonicalizeAppDocumentV1({
    tableId: identity.tableId,
    rowId: identity.rowId,
    creationTime,
    fields,
  });
  const journal: SessionJournalV1 = {
    ...emptyJournal(),
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
    readDependencies: [{
      kind: "appRowPoint",
      documentId,
      observed: {
        kind: "present",
        revisionCommitSeq: CommitSeqSchema.make(10n),
      },
    }],
    writes: [{
      kind: "replace",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      documentId,
      fieldsValueJson: fields,
      resultingDocumentSemanticBytes:
        CommitDocumentSemanticBytesV1Schema.make(document.semanticSizeBytes),
    }],
  };
  const fixture = await fixtureForJournal(journal, successfulResult);
  Object.assign(fixture.evidence.root, {
    pointDependencyCount: 1,
    writeOperations: 1,
    writeSemanticBytes: document.semanticSizeBytes,
  });
  Reflect.apply(Array.prototype.push, fixture.evidence.points, [{
    tableId: identity.tableId,
    rowId: appRowIdHexV1ToBytes(identity.rowId),
    dependencyKind: "present",
    dependencyRevisionCommitSeq: 10n,
    overlayKind: "live",
    overlayCreationTime: creationTime,
    overlayValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    overlayValueJson: requireJsonObject(document.valueJson),
    overlayValueBytes: new Uint8Array(document.canonicalBytes),
    overlayValueSha256: new Uint8Array(document.sha256),
    overlaySemanticBytes: document.semanticSizeBytes,
    createdAtMilliseconds: 1_700_000_000_000,
    updatedAtMilliseconds: 1_700_000_000_000,
  }]);
  return fixture;
}

async function deleteFixture(
  successfulResult: unknown = { ok: true },
): Promise<Fixture> {
  const documentId = decodeAppDocumentIdV1(
    "1:00000000-0000-4000-8000-000000000004",
  );
  const identity = decodeAppDocumentIdentityV1(documentId);
  const journal: SessionJournalV1 = {
    ...emptyJournal(),
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
    readDependencies: [{
      kind: "appRowPoint",
      documentId,
      observed: {
        kind: "present",
        revisionCommitSeq: CommitSeqSchema.make(11n),
      },
    }],
    writes: [{
      kind: "delete",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      documentId,
    }],
  };
  const fixture = await fixtureForJournal(journal, successfulResult);
  Object.assign(fixture.evidence.root, {
    pointDependencyCount: 1,
    writeOperations: 1,
  });
  Reflect.apply(Array.prototype.push, fixture.evidence.points, [{
    tableId: identity.tableId,
    rowId: appRowIdHexV1ToBytes(identity.rowId),
    dependencyKind: "present",
    dependencyRevisionCommitSeq: 11n,
    overlayKind: "deleted",
    overlayCreationTime: null,
    overlayValueCodecVersion: null,
    overlayValueJson: null,
    overlayValueBytes: null,
    overlayValueSha256: null,
    overlaySemanticBytes: null,
    createdAtMilliseconds: 1_700_000_000_000,
    updatedAtMilliseconds: 1_700_000_000_000,
  }]);
  return fixture;
}

async function readFixture(
  successfulResult: unknown = { ok: true },
): Promise<Fixture> {
  const documentId = decodeAppDocumentIdV1(
    "1:00000000-0000-4000-8000-000000000005",
  );
  const identity = decodeAppDocumentIdentityV1(documentId);
  const journal: SessionJournalV1 = {
    ...emptyJournal(),
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
    readDependencies: [{
      kind: "appRowPoint",
      documentId,
      observed: {
        kind: "present",
        revisionCommitSeq: CommitSeqSchema.make(12n),
      },
    }],
  };
  const fixture = await fixtureForJournal(journal, successfulResult);
  Object.assign(fixture.evidence.root, { pointDependencyCount: 1 });
  Reflect.apply(Array.prototype.push, fixture.evidence.points, [{
    tableId: identity.tableId,
    rowId: appRowIdHexV1ToBytes(identity.rowId),
    dependencyKind: "present",
    dependencyRevisionCommitSeq: 12n,
    overlayKind: "none",
    overlayCreationTime: null,
    overlayValueCodecVersion: null,
    overlayValueJson: null,
    overlayValueBytes: null,
    overlayValueSha256: null,
    overlaySemanticBytes: null,
    createdAtMilliseconds: 1_700_000_000_000,
    updatedAtMilliseconds: 1_700_000_000_000,
  }]);
  return fixture;
}

async function fixtureForJournal(
  journalValue: SessionJournalV1,
  successfulResult: unknown = { ok: true },
): Promise<Fixture> {
  const journal = await runEffect(canonicalizeSessionJournalV1Effect(
    journalValue,
  ));
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect(successfulResult),
  );
  const envelope: CommitEnvelopeV1 = {
    format: COMMIT_ENVELOPE_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    sessionId: SESSION_ID,
    attemptFence: ATTEMPT_FENCE,
    finalSyscallSequence: journal.journal.finalSyscallSequence,
    journal: { kind: "storedForSessionAttempt" },
    journalSha256Hex: journal.sha256Hex,
    successfulResult: result.evidence,
  };
  const evidence: StoredAttemptEvidencePortV1 = {
    deploymentId: DEPLOYMENT_ID,
    scopeId: SCOPE_ID,
    scopeUuid: SCOPE_UUID,
    sessionId: SESSION_ID,
    attemptFence: ATTEMPT_FENCE,
    databaseNowMilliseconds: 1_700_000_000_000,
    session: {
      lifecycle: "running",
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: STORAGE_FENCE,
      packageId: "package_c04a",
      artifactRuntime: "dynamic-worker",
      artifactId: "artifact_00000000000000000000000000000000",
      sourcePackageHash: "0".repeat(64),
      executionModule: "flarex/users.ts",
      functionPath: "users:create",
      functionKind: "mutation",
      schemaVersionId: SCHEMA_VERSION_ID,
      policyVersion: "policy_c04a",
      identityAccessPolicySha256: new Uint8Array(32),
      validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsCanonicalByteLength: 1,
      validatedArgsSha256: new Uint8Array(32),
      authorizationGrantId: "grant_c04a",
      authorizationGrantValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      authorizationGrantCanonicalByteLength: 1,
      authorizationGrantSha256: new Uint8Array(32),
      authorizationRevocationEpoch: 0n,
      authorizationGrantExpiresAtMilliseconds: 1_800_000_000_000,
      requestKey: TransactionRequestKeyV1Schema.make("request:c04a"),
      requestSha256: new Uint8Array(32),
      protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      hardExpiresAtMilliseconds: 1_800_000_000_000,
      createdAtMilliseconds: 1_700_000_000_000,
      updatedAtMilliseconds: 1_700_000_000_000,
    },
    lease: {
      snapshotToken: SNAPSHOT,
      leaseExpiresAtMilliseconds: 1_799_000_000_000,
    },
    root: {
      lastSyscallSequence: journal.journal.finalSyscallSequence,
      creationTimeSeed: AppCreationTimeV1Schema.make(1_700_000_000_000),
      nextCreationTime: AppCreationTimeV1Schema.make(1_700_000_000_001),
      readDocuments: journal.journal.readUsage.documentsRead,
      readSemanticBytes: journal.journal.readUsage.semanticBytesRead,
      pointDependencyCount: journal.journal.readDependencies.length,
      writeOperations: journal.journal.writes.length,
      writeSemanticBytes: journal.journal.writes.reduce(
        (total, write) => total +
          (write.kind === "delete" ? 0 : write.resultingDocumentSemanticBytes),
        0,
      ),
      materialWriteEventEvidenceBytes:
        CommitMaterialWriteEventEvidenceBytesV1Schema.make(0),
      sealedFinalSyscallSequence: journal.journal.finalSyscallSequence,
      journalBytes: new Uint8Array(journal.canonicalBytes),
      journalSha256: hexBytes(journal.sha256Hex),
      resultValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      resultSemanticBytes: result.semanticSizeBytes,
      resultBytes: new Uint8Array(result.canonicalBytes),
      resultSha256: hexBytes(result.evidence.sha256Hex),
      createdAtMilliseconds: 1_700_000_000_000,
      updatedAtMilliseconds: 1_700_000_000_001,
      sealedAtMilliseconds: 1_700_000_000_001,
    },
    points: [],
  };
  return { journal, result, envelope, evidence };
}

function emptyJournal(): SessionJournalV1 {
  return {
    format: SESSION_JOURNAL_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(0n),
    readDependencies: [],
    readUsage: {
      documentsRead: CommitReadDocumentsV1Schema.make(0),
      semanticBytesRead: CommitReadSemanticBytesV1Schema.make(0),
    },
    writes: [],
  };
}

async function deriveAuthority(authentication: StoredAttemptAuthenticationV1) {
  const loading = createPointMutationSessionAttemptLoadingV1({
    loadEffect: (selector) => Effect.succeed({
      status: "loaded",
      anchor: {
        deploymentId: selector.deploymentId,
        scopeId: selector.scopeId,
        sessionId: selector.sessionId,
        requestKey: TransactionRequestKeyV1Schema.make("request:c04a"),
        storageGeneration:
          FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
        storageGenerationFence: STORAGE_FENCE,
        attemptFence: selector.attemptFence,
        snapshotToken: SNAPSHOT,
        hardExpiresAt: "2099-01-01T00:00:00.000Z",
        leaseExpiresAt: "2098-12-31T23:59:00.000Z",
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
      },
      executionPin: { schemaVersionId: SCHEMA_VERSION_ID },
      attemptFacet: { kind: "nonPristine" },
    }),
  });
  const loadedAttempt = await runEffect(loading.load(SELECTOR));
  return runEffect(authentication.deriveAuthority(
    loadedAttempt,
    testExecutionScopeFor(authentication),
  ));
}

function loaded(
  evidence: StoredAttemptEvidencePortV1,
): StoredAttemptEvidenceLoadResultPortV1 {
  return { kind: "loaded", evidence };
}

function requirePoint(evidence: StoredAttemptEvidencePortV1) {
  const point = evidence.points[0];
  if (point === undefined) throw new Error("Fixture point is missing.");
  return point;
}

function requireJsonObject(value: unknown): JsonObject {
  if (!isJsonObjectFromUnknown(value)) {
    throw new Error("Fixture value is not a JSON object.");
  }
  return structuredClone(value);
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}
