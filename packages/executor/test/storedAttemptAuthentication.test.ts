import { Effect, Encoding, Result, Schema } from "effect";
import {
  PointCommitCorruptionV1Error,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitFinishingTransitionPortV1,
  type PointCommitFinishingTransitionResultV1,
  type PointCommitPublicationCommandV1,
  type PointCommitPublisherPortV1,
  type PointCommitRollbackProofPortV1,
  type PointCommitTransactionCommandV1,
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
import {
  createPointMutationSessionAttemptLoadingV1,
  InvalidPointMutationSessionAttemptSelectorV1Error,
  type PointMutationSessionAttemptSelectorWireV1,
} from "../src/pointMutationSessionActivation";
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
    });
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
    });
    const second = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    });
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
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createStoredAttemptAuthenticationV1" in executorRoot).toBe(false);

    const fixture = await insertFixture({ name: "detached" });
    const authentication = createStoredAttemptAuthenticationV1({
      loadEffect: () => Effect.succeed(loaded(fixture.evidence)),
    });
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
      });
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
      });
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
    });
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
      });
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
    });
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
      });
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
    });
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
    });
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
    });
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
    const authentication = createStoredAttemptAuthenticationV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.sync(() => {
            authorityLoads += 1;
            return { kind: "loaded", evidence: current.commitEvidence };
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

    const second = createStoredAttemptAuthenticationV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.sync(() => {
            authorityLoads += 1;
            return { kind: "loaded", evidence: current.commitEvidence };
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
    const authentication = createStoredAttemptAuthenticationV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.fail({
            _tag: "StoredCommitAuthorityEvidencePersistenceV1Error",
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
      const authentication = createStoredAttemptAuthenticationV1(
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({ kind: "loaded", evidence }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: { load: () => Effect.succeed(metadata) },
        },
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
    const authentication = createStoredAttemptAuthenticationV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () =>
            Effect.succeed({ kind: "loaded", evidence: expiredEvidence }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => Effect.succeed(current.functionSnapshot),
        },
      },
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
      createStoredAttemptAuthenticationV1,
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
      ],
    )).toThrow(StoredCommitAuthorityConfigurationV1Error);
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
    const exactAuthentication = createStoredAttemptAuthenticationV1(
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
    const oversizedAuthentication = createStoredAttemptAuthenticationV1(
      { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
      {
        evidenceLoader: {
          loadEffect: () => Effect.succeed({
            kind: "loaded",
            evidence: oversizedEvidence,
          }),
        },
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => Effect.succeed(current.functionSnapshot),
        },
      },
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
      const authentication = createStoredAttemptAuthenticationV1(
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({ kind: "loaded", evidence }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: {
            load: () => Effect.succeed(current.functionSnapshot),
          },
        },
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
      const authentication = createStoredAttemptAuthenticationV1(
        { loadEffect: () => Effect.succeed(loaded(current.fixture.evidence)) },
        {
          evidenceLoader: {
            loadEffect: () => Effect.succeed({
              kind: "loaded",
              evidence: current.commitEvidence,
            }),
          },
          transactionGrantVerifier: current.verifier,
          functionMetadata: { load: () => Effect.succeed(metadata) },
        },
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
    await runEffect(
      first.authentication.enterPointCommitFinishing(first.prepared),
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
      const invalidReceipt = await runFailure(
        first.authentication.enterPointCommitFinishing(first.prepared),
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
    const recoveredAfterInvalidReceipts = await runEffect(
      first.authentication.enterPointCommitFinishing(first.prepared),
    );
    expect(Object.isFrozen(recoveredAfterInvalidReceipts)).toBe(true);

    outcome = "failure";
    expect(await runFailure(
      first.authentication.enterPointCommitFinishing(first.prepared),
    )).toBe(transitionFailure);

    outcome = "defect";
    let rejection: unknown;
    try {
      await runEffect(
        first.authentication.enterPointCommitFinishing(first.prepared),
      );
    } catch (cause) {
      rejection = cause;
    }
    expect(rejection).not.toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(String(rejection)).toContain(defect.message);
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
    const pointCommit: PointCommitPublisherPortV1 = Object.freeze({
      prove: Effect.fn("TestC05B.prove")(
        () => Effect.succeed(Object.freeze({ kind: "wouldCommit" as const })),
      ),
      publish: Effect.fn("TestC05B.publish")(function* (command) {
        commands.push(command);
        return yield* Effect.fail(publicationFailure);
      }),
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
    ) => createStoredAttemptAuthenticationV1(
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
    expect(await runFailure(normal.finishPointCommit(prepared))).toBe(
      publicationFailure,
    );
    const retriedNormalCommand = commands[1];
    if (retriedNormalCommand === undefined) {
      throw new Error("Missing retried normal C05-B publication command.");
    }
    expect(retriedNormalCommand).toEqual(normalCommand);
    expect(retriedNormalCommand.rowIntent).not.toBe(normalCommand.rowIntent);

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
    const recoveredCommand = commands[2];
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
    const tombstoneDeleted = deletedPlannerPoint(tombstoneDeletedId, {
      kind: "missing",
      basis: {
        kind: "tombstone",
        revisionCommitSeq: CommitSeqSchema.make(16n),
      },
    });
    const impossibleSource = await plannerSourceForTest([tombstoneDeleted]);
    expect(() => planPointCommitStateV1(impossibleSource)).toThrow(
      "Authenticated deleted point cannot carry a tombstone dependency.",
    );
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
    maximumGrantLifetimeMilliseconds: 120_000,
    maximumFutureIssuedAtSkewMilliseconds: 0,
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
  const authentication = createStoredAttemptAuthenticationV1(
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
          return { kind: "loaded", evidence: current.commitEvidence };
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
  const authentication = createStoredAttemptAuthenticationV1(
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
  const authentication = createStoredAttemptAuthenticationV1(
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
  const authentication = createStoredAttemptAuthenticationV1(
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

function unsafeFinishingTransitionResultForTest(
  value: unknown,
): PointCommitFinishingTransitionResultV1 {
  return value as PointCommitFinishingTransitionResultV1;
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
  observed: LogicalReadDependencyV1["observed"] = Object.freeze({
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
    dependency: logicalPointDependency(documentId, observed),
  });
}

async function livePlannerPoint(
  documentId: AppDocumentIdV1,
  observed: LogicalReadDependencyV1["observed"] = Object.freeze({
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
    dependency: logicalPointDependency(documentId, observed),
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
    load: async (selector) => ({
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
    }),
  });
  const loadedAttempt = await loading.load(SELECTOR);
  return runEffect(authentication.deriveAuthority(loadedAttempt));
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

function runEffect<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

function runFailure<A, E>(effect: Effect.Effect<A, E>): Promise<E> {
  return Effect.runPromise(Effect.flip(effect));
}
