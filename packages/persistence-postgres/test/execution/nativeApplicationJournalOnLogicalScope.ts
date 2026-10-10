import { Effect } from "effect";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema, canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { selectApplicationMutationAdmission } from "../../src/application/applicationMutationAdmission";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../../src/execution/session/activation";
import { createSessionJournalStorePersistence } from "../../src/execution/sessionJournalStore";
import {
  captureSessionStorage,
  expectSessionPayloadScrubbed,
} from "./session/support/terminalStorageScenario";
import { createStoredAttemptEvidenceLoaderV1 } from "../../src/execution/storedAttemptEvidence";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
} from "../../src/commit/point/construction";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../src/storage/unique/appUniqueConstraintCommitV1";
import { applicationMutationActivationFixture } from "../application/applicationMutationActivationFixture";
import { selectorFromRelationAnchor, relationAuthorityFromAnchor } from "../commit/point/support/relations";
import { pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1 } from "../commit/point/support/commandEvidence";
import { issueSetupSeededSyscallValidatorProofV1 } from "../application/revision/applicationRevisionSyscallValidatorTestSupport";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "./session/support/activationEvidence";
import type { ApplicationNativeMutationPGliteFixture,
  ApplicationNativeMutationPostgresFixture } from "../application/applicationNativeMutationTestFixture";

type NativeApplication = ApplicationNativeMutationPGliteFixture | ApplicationNativeMutationPostgresFixture;

/** Prepare an authentic native empty-range read before a framework-owned commit. */
export const prepareNativeApplicationJournalOnLogicalScope = Effect.fn("NativeApplication.prepareJournalOnLogicalScope")(
  function* (application: NativeApplication, operation: "range" | "insert" | "delete" = "range",
    suffix?: string, targetDocumentId?: AppDocumentIdV1) {
    const schemaVersionId = application.active.basis.schemaVersionId;
    const admission = yield* selectApplicationMutationAdmission(application.active.selection, "users:create", {
      deploymentId: application.deploymentId, controlDb: application.control.drizzle,
      authority: application.authorityPorts, schema: application.schema,
    });
    const activation = yield* createApplicationMutationSessionActivationPersistenceV1(application.sessionAuthority,
      { leaseDurationMilliseconds: 60_000 }).activateEffect(yield* Effect.promise(() => applicationMutationActivationFixture({
        deploymentId: application.deploymentId, selection: application.active.selection,
        executionAuthority: admission.executionAuthority,
        requestKey: `logical-currency-native-journal-${operation}${suffix === undefined ? "" : `-${suffix}`}`,
        grantId: `logical-currency-native-journal-${operation}${suffix === undefined ? "" : `-${suffix}`}-grant`,
      })));
    if (activation.status !== "created") throw new Error("Expected native journal attempt");
    const store = createSessionJournalStorePersistence(application.sessionAuthority,
      { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1, indexedQueries: application.indexedQueries });
    const attempt = yield* store.openAttemptEffect({ selector: selectorFromRelationAnchor(activation.anchor),
      executionClaim: activation.executionClaim, snapshotToken: activation.anchor.snapshotToken, schemaVersionId });
    const table = yield* store.resolvePointTableEffect(attempt, "users");
    let insertedDocumentId: AppDocumentIdV1 | undefined;
    if (operation === "range") {
      const index = yield* store.resolveDeveloperIndexEffect(table, "by_name");
      expect(yield* store.runIndexedQueryEffect(index, { kind: "indexRange",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 32 }))
        .toMatchObject({ kind: "completed", outcome: { documents: [], isDone: true } });
    } else {
      const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId: application.authority.scopeId,
        schemaVersionId, schemaManifest: admission.schema.manifest });
      if (operation === "insert") {
        const inserted = yield* store.runPointOperationEffect(table, { kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: "strong-reference-witness" } }, validator);
        expect(inserted).toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
        if (inserted.kind !== "completed" || inserted.outcome.kind !== "inserted") throw new Error("Missing inserted document");
        insertedDocumentId = inserted.outcome.documentId;
      } else {
        if (targetDocumentId === undefined) throw new Error("Delete requires a document identity");
        expect(yield* store.runPointOperationEffect(table, { kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId: targetDocumentId }, validator))
          .toMatchObject({ kind: "completed", outcome: { kind: "unit" } });
      }
    }
    const sealed = yield* store.prepareSealEffect(attempt);
    const journal = yield* canonicalizeSessionJournalEffect(sealed.journal);
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
    expect(command.dependencies).toHaveLength(operation === "range" ? 0 : 1);
    expect(command.indexRangeDependencies).toHaveLength(operation === "range" ? 1 : 0);
    expect(command.rowIntents).toHaveLength(operation === "range" ? 0 : 1);
    const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(application.control.drizzle);
    const publisher = createPointCommitPublisherPortV1(application.sessionAuthority, {
      developerIndexes: application.developerIndexes,
      intrinsicCreationTimeIndexes: application.intrinsicCreationTimeIndexes,
      uniqueConstraints, uniqueConstraintEligibility: application.uniqueConstraintEligibility,
      applicationRelations: application.applicationRelations,
      candidateSchemaWriteGuard: application.candidateSchemaWriteGuard,
    });
    const payloadBefore = yield* Effect.promise(() => captureSessionStorage(application.target, activation.anchor));
    return { insertedDocumentId, publish: publisher.publish({ ...command, journalBytes: journal.canonicalBytes,
      successfulResult: { valueCodecVersion: result.evidence.valueCodecVersion, value: { observed: true },
        canonicalBytes: result.canonicalBytes, semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex } }),
      verifyUnchanged: Effect.promise(async () => expect(await captureSessionStorage(application.target,
        activation.anchor)).toEqual(payloadBefore)),
      verifyScrubbed: Effect.promise(async () => expectSessionPayloadScrubbed(payloadBefore,
        await captureSessionStorage(application.target, activation.anchor))) };
  });
