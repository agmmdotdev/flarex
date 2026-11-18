import { Effect, Result } from "effect";
import { expect } from "vitest";
import type { ScopeId, CommitSeq } from "flarex-protocol/storage-authority";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";
import { createJournalAttemptOwner } from "../../../src/execution/journal/attemptOwner";
import { projectLogicalCommerceActivity } from "../../../src/frameworks/commerceTransaction/logicalParticipant";
import { inspectLogicalRealWriteAttempt } from "../../../src/storage/documents/logicalDocuments/realWriteEvidence";
import { acceptLogicalDocumentRootWrite, attachLogicalDocumentRootEvaluator,
  borrowClosedLogicalDocumentRoot, makeLogicalDocumentRootEvaluator,
  observeLogicalDocumentRootRow, takeLogicalDocumentRootSnapshot } from "../../../src/storage/documents/logicalDocuments/rootEvaluator";
import type { LogicalDocumentAttempt } from "../../../src/storage/documents/logicalDocuments/workingSet";
import type { ApplicationDocumentObservation } from "../../../src/storage/materialization/model";

/** Neutral native owner proof, not live finite admission. The caller supplies
 * the existing fixture's genuine SQL conversion, accepted REAL-attempt proof
 * and actual missing SQL read. The journal owner issues the opaque root handle;
 * no test marker or structurally copied conversion acquires authority. */
export const pendingRealRootScenario = Effect.fn("PendingIndex.realRootScenario")(
  function* (input: Readonly<{ attempt: LogicalDocumentAttempt; observation: ApplicationDocumentObservation;
    creationTime: AppCreationTimeV1; scopeId: ScopeId; snapshotCommitSeq: CommitSeq }>) {
    const error = (reason: string) => new Error(reason);
    const expected = Result.getOrThrow(inspectLogicalRealWriteAttempt(input.attempt, error));
    expect(expected).toEqual({ measure: 1.0000000596046448, other: null });
    const handle = createJournalAttemptOwner().createAttemptHandle();
    const pins = Object.freeze({ attempt: handle, scopeId: input.scopeId,
      snapshotCommitSeq: input.snapshotCommitSeq, attemptFence: "neutral-real-root-owner" });
    const root = yield* Effect.acquireRelease(Effect.sync(() => makeLogicalDocumentRootEvaluator(pins,
      { identities: 4, workingBytes: 1_048_576 })), owner => Effect.sync(owner.close));
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing issued neutral REAL root");
    Result.getOrThrow(root.observePoint("measure", input.observation, { kind: "missing" }));
    const pending = Result.getOrThrow(observeLogicalDocumentRootRow(state, {
      tableId: input.observation.tableId, tableName: "measure", rowId: input.observation.rowId,
      documentId: input.observation.documentId, base: null, current: null,
      creationTime: input.creationTime, attempts: [],
    }));
    Result.getOrThrow(acceptLogicalDocumentRootWrite(state, pending, input.attempt, failure => failure));
    const retained = state.attempts[0];
    if (retained === undefined) throw new Error("Accepted native REAL attempt disappeared");
    expect(Result.getOrThrow(inspectLogicalRealWriteAttempt(retained, error))).toEqual(expected);
    const names = new Map([[input.attempt.tableId, "measure"]]);
    const live = yield* projectLogicalCommerceActivity(names, { attempts: state.attempts,
      lifecycle: [], observedRows: [], relationalReads: [], setNull: [], referenceReplacements: [] });
    expect(live.mutations).toMatchObject([{ ordinal: 0, realNormalization: expected, after: { measure: 1.0000001 } }]);
    const snapshot = root.snapshot();
    expect((yield* projectLogicalCommerceActivity(names, snapshot)).mutations).toEqual(live.mutations);
    const closed = Result.getOrThrow(takeLogicalDocumentRootSnapshot(root));
    const transferred = borrowClosedLogicalDocumentRoot(closed, root, handle);
    if (transferred === undefined) throw new Error("Missing actual closed REAL root transfer");
    expect((yield* projectLogicalCommerceActivity(names, transferred.graph)).mutations).toEqual(live.mutations);
    expect(attachLogicalDocumentRootEvaluator(root, pins)).toBeNull();
  },
);
