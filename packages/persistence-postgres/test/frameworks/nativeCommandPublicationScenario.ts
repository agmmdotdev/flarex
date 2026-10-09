import { randomUUID } from "node:crypto";
import {
  captureSessionStorage,
  expectSessionPayloadScrubbed,
} from "../execution/terminalSessionStorageScenario";
import { Effect } from "effect";
import { expect } from "vitest";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../../src/execution/transactionSessionActivation";
import { createSessionJournalStorePersistence } from "../../src/execution/sessionJournalStore";
import {
  createAppDeveloperIndexQueryPortV1,
} from "../../src/execution/journal/indexQueryPort";
import {
  createAppDeveloperIndexDefinitionPortV1,
} from "../../src/storage/indexes/appDeveloperIndexCommitV1";
import { createStoredAttemptEvidenceLoaderV1 } from "../../src/execution/storedAttemptEvidence";
import {
  createPointCommitFinishingTransitionPortV1,
} from "../../src/commit/point/construction";
import {
  createPointCommitPublisherPortV1,
} from "../../src/commit/point/construction";
import {
  PointCommitConflictV1Error,
} from "../../src/commit/point/errors";
import {
  pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "../commit/point/support/commandEvidence";
import { selectApplicationMutationAdmission } from "../../src/application/applicationMutationAdmission";
import { makeApplicationSchemaAuthorityPublisher } from "../../src/application/applicationSchemaAuthority";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../../src/storage/unique/appUniqueConstraintCommitV1";
import { TEST_GRANT_RETENTION_POLICY_V1 } from "../execution/transactionSessionActivationTestSupport";
import {
  selectorFromRelationAnchor,
  relationAuthorityFromAnchor,
} from "../commit/point/support/relations";
import {
  createIntrinsicCreationTimeIndexDefinitionPortV1,
} from "../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import {
  createAppSchemaCandidateWriteGuardPort,
} from "../../src/storage/catalog/appSchemaCandidateValidation";
import {
  issueSetupSeededSyscallValidatorProofV1,
} from "../application/revision/applicationRevisionSyscallValidatorTestSupport";
import { applicationMutationActivationFixture } from "../application/applicationMutationActivationFixture";
import type { cmsHostFixture } from "./cmsTransaction/cmsHostFixture";
import type { CommerceHostTestFixture } from "./commerceTransaction/commerceHostFixture";

/** Real admission, journal and finishing owners for the bounded native range workload. */
export const prepareNativeRangePublication = Effect.fn("NativeCommand.prepareRangePublication")(function* (
  native: Awaited<ReturnType<typeof cmsHostFixture>>["fixture"], auditTitle?: string,
) {
  const active = (yield* native.relationActivation.readActive());
  const admission = (yield* selectApplicationMutationAdmission(active.selection, "functions:write", {
    deploymentId: native.deploymentId, controlDb: native.control.drizzle, authority: native.authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({ db: native.control.drizzle, runTransaction: run => native.control.drizzle.transaction(run) }), relationSchema: native.foldContext.schema,
  }));
  const activationInput = yield* Effect.promise(() => applicationMutationActivationFixture({
    deploymentId: native.deploymentId, selection: active.selection, executionAuthority: admission.executionAuthority,
    requestKey: randomUUID(), grantId: randomUUID(),
  }));
  const activation = yield* createApplicationMutationSessionActivationPersistenceV1(native.pointCommitAuthority,
    { leaseDurationMilliseconds: 60_000 }).activateEffect(activationInput);
  if (activation.status !== "created") throw new Error("Expected native attempt");
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(native.control.drizzle);
  const store = createSessionJournalStorePersistence(native.pointCommitAuthority, { grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    indexedQueries: createAppDeveloperIndexQueryPortV1(native.control.drizzle, native.pointCommitAuthority, developerIndexes) });
  const attempt = (yield* store.openAttemptEffect({ selector: selectorFromRelationAnchor(activation.anchor), executionClaim: activation.executionClaim,
    snapshotToken: activation.anchor.snapshotToken, schemaVersionId: native.relation.binding.schemaVersionId }));
  const table = (yield* store.resolvePointTableEffect(attempt, "posts"));
  const index = (yield* store.resolveDeveloperIndexEffect(table, "by_title"));
  expect((yield* store.runIndexedQueryEffect(index, { kind: "indexRange", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), bounds: {}, limit: 32 }))).toMatchObject({ kind: "completed" });
  if (auditTitle !== undefined) {
    const audit = yield* store.resolvePointTableEffect(attempt, "audit");
    const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId: native.authority.scopeId,
      schemaVersionId: native.relation.binding.schemaVersionId, schemaManifest: admission.schema.manifest });
    expect(yield* store.runPointOperationEffect(audit, { kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
      fields: { title: auditTitle } }, validator)).toMatchObject({ kind: "completed", outcome: { kind: "inserted" } });
  }
  const sealed = yield* store.prepareSealEffect(attempt);
  const journal = (yield* canonicalizeSessionJournalEffect(sealed.journal));
  const result = (yield* canonicalizeSuccessfulResultV1Effect({ observed: true }));
  yield* store.completeSealEffect(sealed.preparation, journal, result);
  const authority = relationAuthorityFromAnchor(activation.anchor, native.relation.binding.schemaVersionId, activation.executionClaim);
  const loader = createStoredAttemptEvidenceLoaderV1(native.pointCommitAuthority);
  const running = (yield* loader.loadEffect(authority));
  if (running.kind !== "loaded") throw new Error("Expected sealed native evidence");
  (yield* createPointCommitFinishingTransitionPortV1(native.pointCommitAuthority).enterFinishing((yield* Effect.promise(() => pointCommitFinishingCommandFromStoredAttemptV1(authority, running.evidence)))));
  const finishing = (yield* loader.loadFinishingEffect(selectorFromRelationAnchor(activation.anchor)));
  if (finishing.kind !== "loaded") throw new Error("Expected native finishing evidence");
  const command = (yield* Effect.promise(() => pointCommitCommandWithJournalReadDependenciesFromStoredAttemptV1(authority, finishing.evidence)));
  return { activation, command: { ...command, journalBytes: journal.canonicalBytes,
    successfulResult: { valueCodecVersion: result.evidence.valueCodecVersion, value: { observed: true }, canonicalBytes: result.canonicalBytes,
      semanticSizeBytes: result.semanticSizeBytes, sha256Hex: result.evidence.sha256Hex } },
    options: { developerIndexes, intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(native.control.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(native.control.drizzle), applicationRelations: native.relationCommit,
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: native.candidateValidation, pointCommitAuthority: native.pointCommitAuthority }) } };
});

/** A native attempt reads before a trusted command. The original committer must
 * reject an Application phantom and accept unrelated commerce-only changes. */
export const assertNativeCommandPublication = Effect.fn("NativeCommand.testPublication")(function* <A, E>(
  fixture: CommerceHostTestFixture, write: Effect.Effect<A, E>, expected: "overlap" | "disjoint",
) {
  const native = fixture.cms.fixture;
  const { activation, command, options } = yield* prepareNativeRangePublication(native);
  const payloadBefore = yield* Effect.promise(() => captureSessionStorage(native.persistence, activation.anchor));
  yield* write;
  const publication = createPointCommitPublisherPortV1(native.pointCommitAuthority, options).publish(command);
  if (expected === "overlap") {
    const failure = yield* Effect.flip(publication);
    expect(yield* Effect.promise(() => captureSessionStorage(native.persistence, activation.anchor))).toEqual(payloadBefore);
    expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
    expect(failure).toMatchObject({ conflict: { kind: "appIndexRange", reason: "overlap" } });
  } else {
    expect((yield* publication).kind).toBe("published");
    expectSessionPayloadScrubbed(payloadBefore, yield* Effect.promise(() => captureSessionStorage(native.persistence, activation.anchor)));
  }
});
