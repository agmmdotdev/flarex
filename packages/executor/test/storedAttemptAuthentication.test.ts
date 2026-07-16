import { Effect, Encoding, Result, Schema } from "effect";
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
import { isJson, type JsonObject } from "flarex-protocol/json";
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
import {
  createPointMutationSessionAttemptLoadingV1,
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
  InvalidVerifiedCommitInputV1Error,
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityConfigurationV1Error,
  StoredCommitAuthorityMismatchV1Error,
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
      load: async () => {
        loadCalls += 1;
        return loaded(fixture.evidence);
      },
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
      load: async () => {
        loadCalls += 1;
        return loaded(fixture.evidence);
      },
    });
    const second = createStoredAttemptAuthenticationV1({
      load: async () => loaded(fixture.evidence),
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
      load: async () => loaded(fixture.evidence),
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
        load: async () => testCase.result,
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
        load: async () => loaded(evidence),
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
      load: async () => loaded(fixture.evidence),
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
        load: async () => loaded(fixture.evidence),
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
      load: async () => loaded(deleted.evidence),
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
        load: async () => loaded(evidence),
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
      load: async () => loaded(fixture.evidence),
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
      load: async () => loaded(forgedEvidence),
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
      load: async () => loaded(fixture.evidence),
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
      { load: async () => loaded(current.fixture.evidence) },
      {
        evidenceLoader: {
          load: async () => {
            authorityLoads += 1;
            return { kind: "loaded", evidence: current.commitEvidence };
          },
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
      { load: async () => loaded(current.fixture.evidence) },
      {
        evidenceLoader: {
          load: async () => {
            authorityLoads += 1;
            return { kind: "loaded", evidence: current.commitEvidence };
          },
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
        { load: async () => loaded(current.fixture.evidence) },
        {
          evidenceLoader: {
            load: async () => ({ kind: "loaded", evidence }),
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
      { load: async () => loaded(current.fixture.evidence) },
      {
        evidenceLoader: {
          load: async () => ({ kind: "loaded", evidence: expiredEvidence }),
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
        { load: async () => loaded(current.fixture.evidence) },
        {
          evidenceLoader: {
            load: async () => ({
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
      { load: async () => loaded(current.fixture.evidence) },
      {
        evidenceLoader: {
          load: async () => ({
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
      { load: async () => loaded(current.fixture.evidence) },
      {
        evidenceLoader: {
          load: async () => ({
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
        { load: async () => loaded(current.fixture.evidence) },
        {
          evidenceLoader: {
            load: async () => ({ kind: "loaded", evidence }),
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
        { load: async () => loaded(current.fixture.evidence) },
        {
          evidenceLoader: {
            load: async () => ({
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

    const futureDependencyPoint = Object.freeze({
      ...indexedRead,
      dependency: Object.freeze({
        kind: "appRowRange",
        documentId: indexedRead.documentId,
      }),
    });
    const futureDependencySource = Object.freeze({
      ...base,
      points: Object.freeze([futureDependencyPoint]),
    });
    // @ts-expect-error The protocol currently permits point dependencies only.
    const futureDependencyResult = planPointCommitStateV1(futureDependencySource);
    const futureDependencyFailure = requirePlanFailure(futureDependencyResult);
    expect(futureDependencyFailure).toMatchObject({
      issue: { reason: "unsupportedReadDependency" },
    });
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
      load: async () => {
        storedEvidenceLoads += 1;
        return loaded(current.fixture.evidence);
      },
    },
    {
      evidenceLoader: {
        load: async () => {
          authorityEvidenceLoads += 1;
          return { kind: "loaded", evidence: current.commitEvidence };
        },
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
  if (!isJsonObject(value)) {
    throw new Error("Fixture value is not a JSON object.");
  }
  return structuredClone(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isJson(value) &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
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
