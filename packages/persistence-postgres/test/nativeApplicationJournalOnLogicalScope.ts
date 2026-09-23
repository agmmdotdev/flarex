import { Effect } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { selectApplicationMutationAdmission } from "../src/applicationMutationAdmission";
import { createApplicationMutationSessionActivationPersistenceV1 } from "../src/transactionSessionActivation";
import { createSessionJournalStorePersistenceV1 } from "../src/sessionJournalStore";
import { captureSessionStorage, expectSessionPayloadScrubbed } from "./terminalSessionStorageScenario";
import { createStoredAttemptEvidenceLoaderV1 } from "../src/storedAttemptEvidence";
import { createPointCommitFinishingTransitionPortV1, createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { applicationMutationActivationFixture } from "./applicationMutationActivationFixture";
import { selectorFromRelationAnchor, relationAuthorityFromAnchor } from "./pointCommitRelationTestSupport";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1 } from "./pointCommitTransactionTestSupport";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "./transactionSessionActivationTestSupport";
import type { ApplicationNativeMutationPGliteFixture,
  ApplicationNativeMutationPostgresFixture } from "./fixtures/applicationNativeMutationTestFixture";

type NativeApplication = ApplicationNativeMutationPGliteFixture | ApplicationNativeMutationPostgresFixture;

/** Prepare an authentic native empty-range read before a framework-owned commit. */
export const prepareNativeApplicationJournalOnLogicalScope = Effect.fn("NativeApplication.prepareJournalOnLogicalScope")(
  function* (application: NativeApplication) {
    const schemaVersionId = application.active.basis.schemaVersionId;
    const admission = yield* selectApplicationMutationAdmission(application.active.selection, "users:create", {
      deploymentId: application.deploymentId, controlDb: application.control.drizzle,
      authority: application.authorityPorts, schema: application.schema,
    });
    const activation = yield* createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
      { leaseDurationMilliseconds: 60_000 }).activateEffect(yield* Effect.promise(() => applicationMutationActivationFixture({
        deploymentId: application.deploymentId, selection: application.active.selection,
        executionAuthority: admission.executionAuthority,
        requestKey: "logical-currency-native-journal", grantId: "logical-currency-native-journal-grant",
      })));
    if (activation.status !== "created") throw new Error("Expected native journal attempt");
    const store = createSessionJournalStorePersistenceV1(application.sessionAuthority,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1, indexedQueries: application.indexedQueries });
    const attempt = yield* store.openAttemptEffect({ selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim, snapshotToken: activation.anchor.snapshotToken, schemaVersionId });
    const table = yield* store.resolvePointTableEffect(attempt, "users");
    const index = yield* store.resolveDeveloperIndexEffect(table, "by_name");
    expect(yield* store.runIndexedQueryEffect(index, { kind: "indexRange",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 32 }))
      .toMatchObject({ kind: "completed", outcome: { documents: [], isDone: true } });
    const sealed = yield* store.prepareSealEffect(attempt);
    const journal = yield* canonicalizeSessionJournalV1Effect(sealed.journal);
    const result = yield* canonicalizeSuccessfulResultV1Effect({ observed: true });
    yield* store.completeSealEffect(sealed.preparation, journal, result);
    const authority = relationAuthorityFromAnchor(activation.anchor, schemaVersionId, activation.executionClaim);
    const loader = createStoredAttemptEvidenceLoaderV1(application.sessionAuthority);
    const running = yield* loader.loadEffect(authority);
    if (running.kind !== "loaded") throw new Error("Expected sealed native journal evidence");
    yield* createPointCommitFinishingTransitionPortV1(application.sessionAuthority)
      .enterFinishing(yield* Effect.promise(() => pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)));
    const finishing = yield* loader.loadFinishingEffect(selectorFromRelationAnchor(activation.anchor));
    if (finishing.kind !== "loaded") throw new Error("Expected native finishing evidence");
    const command = yield* Effect.promise(() =>
      pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(authority, finishing.evidence));
    expect(command.dependencies).toHaveLength(0);
    expect(command.indexRangeDependencies).toHaveLength(1);
    expect(command.rowIntents).toHaveLength(0);
    const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(application.control.drizzle);
    const publisher = createPointCommitPublisherPortV1(application.sessionAuthority, {
      developerIndexes: application.developerIndexes,
      intrinsicCreationTimeIndexes: application.intrinsicCreationTimeIndexes,
      uniqueConstraints, uniqueConstraintEligibility: application.uniqueConstraintEligibility,
      applicationRelations: application.applicationRelations,
      candidateSchemaWriteGuard: application.candidateSchemaWriteGuard,
    });
    const payloadBefore = yield* Effect.promise(() => captureSessionStorage(application.target, activation.anchor));
    return { publish: publisher.publish({ ...command, journalBytes: journal.canonicalBytes,
      successfulResult: { valueCodecVersion: result.evidence.valueCodecVersion, value: { observed: true },
        canonicalBytes: result.canonicalBytes, semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex } }),
      verifyUnchanged: Effect.promise(async () => expect(await captureSessionStorage(application.target,
        activation.anchor)).toEqual(payloadBefore)),
      verifyScrubbed: Effect.promise(async () => expectSessionPayloadScrubbed(payloadBefore,
        await captureSessionStorage(application.target, activation.anchor))) };
  });
