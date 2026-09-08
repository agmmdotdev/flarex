import { Effect } from "effect";
import { expect } from "vitest";
import { eq } from "drizzle-orm";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalV1Effect, canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { createPointMutationSessionActivationPersistenceV1 } from "../src/transactionSessionActivation";
import { createSessionJournalStorePersistenceV1 } from "../src/sessionJournalStore";
import { createAppDeveloperIndexQueryPortV1 } from "../src/sessionJournalStore";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createStoredAttemptEvidenceLoaderV1 } from "../src/storedAttemptEvidence";
import { createPointCommitFinishingTransitionPortV1 } from "../src/pointCommitTransaction";
import { decodeReplacementScopeIdV1 } from "flarex-protocol/storage-authority";
import { createPointCommitPublisherPortV1, PointCommitConflictV1Error } from "../src/pointCommitTransaction";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1, pointCommitFinishingCommandFromStoredAttemptV1 } from "./pointCommitTransactionTestSupport";
import { selectApplicationMutationAdmission } from "../src/applicationMutationAdmission";
import { makeApplicationSchemaAuthorityPublisher } from "../src/applicationSchemaAuthority";
import { fxSystemTransactionSessions } from "../src/schema";
import { TransactionFunctionPathV1Schema } from "flarex-protocol/transaction-session";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { TEST_GRANT_RETENTION_POLICY_V1, activatePointMutationSession, pointMutationSessionActivationFixture } from "./transactionSessionActivationTestSupport";
import { selectorFromRelationAnchor, relationAuthorityFromAnchor } from "./pointCommitRelationTestSupport";
import { completeSessionJournalSeal, prepareSessionJournalSeal } from "./effectTestRuntime";
import type { CommerceHostTestFixture } from "./commerceHostFixture";

/** Native journal/OCC reads before the composite write; the existing committer must reject the phantom. */
export const assertCurrencyAnnouncementNativeOverlap = Effect.fn("CurrencyAnnouncement.testNativeOverlap")(function* <A, E>(fixture: CommerceHostTestFixture, write: Effect.Effect<A, E>) {
  const native = fixture.cms.fixture;
  const activation = (yield* Effect.promise(() => activatePointMutationSession(createPointMutationSessionActivationPersistenceV1(native.pointCommitAuthority, { leaseDurationMilliseconds: 60_000 }),
    pointMutationSessionActivationFixture(native.deploymentId, decodeReplacementScopeIdV1(native.authority.scopeId), { evidence: { schemaVersionId: native.relation.binding.schemaVersionId, functionPath: TransactionFunctionPathV1Schema.make("functions:write") } }))));
  if (activation.status !== "created") throw new Error("Expected native attempt");
  const active = (yield* native.relationActivation.readActive());
  const admission = (yield* selectApplicationMutationAdmission(active.selection, "functions:write", {
    deploymentId: native.deploymentId, controlDb: native.control.drizzle, authority: native.authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({ db: native.control.drizzle, runTransaction: run => native.control.drizzle.transaction(run) }), relationSchema: native.foldContext.schema,
  }));
  // Test fixture installation follows the existing write-policy scenario and uses
  // the real admitted canonical Application authority, never a synthetic grant.
  yield* Effect.promise(() => native.persistence.drizzle.update(fxSystemTransactionSessions).set({ executionAuthorityGeneration: "application_v1",
    packageId: null, artifactRuntime: null, artifactId: null, sourcePackageHash: null, executionModule: null,
    applicationExecutionAuthorityJson: admission.executionAuthority.authority, applicationExecutionAuthorityCanonicalBytes: admission.executionAuthority.canonicalBytes,
    applicationExecutionAuthoritySha256: admission.executionAuthority.sha256,
  }).where(eq(fxSystemTransactionSessions.sessionId, activation.anchor.sessionId)));
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(native.control.drizzle);
  const store = createSessionJournalStorePersistenceV1(native.pointCommitAuthority, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    indexedQueries: createAppDeveloperIndexQueryPortV1(native.control.drizzle, native.pointCommitAuthority, developerIndexes) });
  const attempt = (yield* store.openAttemptEffect({ selector: selectorFromRelationAnchor(activation.anchor), executionClaim: activation.executionClaim,
    snapshotToken: activation.anchor.snapshotToken, schemaVersionId: native.relation.binding.schemaVersionId }));
  const table = (yield* store.resolvePointTableEffect(attempt, "posts"));
  const index = (yield* store.resolveDeveloperIndexEffect(table, "by_title"));
  expect((yield* store.runIndexedQueryEffect(index, { kind: "indexRange", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 32 }))).toMatchObject({ kind: "completed" });
  const sealed = (yield* Effect.promise(() => prepareSessionJournalSeal(store, attempt)));
  const journal = (yield* canonicalizeSessionJournalV1Effect(sealed.journal));
  const result = (yield* canonicalizeSuccessfulResultV1Effect({ observed: true }));
  (yield* Effect.promise(() => completeSessionJournalSeal(store, sealed.preparation, journal, result)));
  const authority = relationAuthorityFromAnchor(activation.anchor, native.relation.binding.schemaVersionId, activation.executionClaim);
  const loader = createStoredAttemptEvidenceLoaderV1(native.pointCommitAuthority);
  const running = (yield* loader.loadEffect(authority));
  if (running.kind !== "loaded") throw new Error("Expected sealed native evidence");
  (yield* createPointCommitFinishingTransitionPortV1(native.pointCommitAuthority).enterFinishing((yield* Effect.promise(() => pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)))));
  const finishing = (yield* loader.loadFinishingEffect(selectorFromRelationAnchor(activation.anchor)));
  if (finishing.kind !== "loaded") throw new Error("Expected native finishing evidence");
  const command = (yield* Effect.promise(() => pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(authority, finishing.evidence)));
  yield* write;
  const failure = (yield* Effect.flip(createPointCommitPublisherPortV1(native.pointCommitAuthority, { developerIndexes, uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(native.control.drizzle) }).publish({ ...command,
    journalBytes: journal.canonicalBytes, successfulResult: { valueCodecVersion: result.evidence.valueCodecVersion, value: { observed: true }, canonicalBytes: result.canonicalBytes,
      semanticSizeBytes: result.semanticSizeBytes, sha256Hex: result.evidence.sha256Hex } })));
  expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
  expect(failure).toMatchObject({ conflict: { kind: "appIndexRange", reason: "overlap" } });
});
