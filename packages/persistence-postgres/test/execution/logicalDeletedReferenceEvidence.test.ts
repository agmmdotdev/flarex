import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { AppCreationTimeV1Schema, canonicalizeAppDocumentV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { CommitSeqSchema, ScopeIdSchema } from "flarex-protocol/storage-authority";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import type { SessionJournalAttempt } from "../../src/execution/journal/api";
import { makeLogicalDocumentRootEvaluator, attachLogicalDocumentRootEvaluator } from "../../src/storage/documents/logicalDocuments/rootEvaluator";
import { issueLogicalDeletedReferenceEvidence, hasLogicalDeletedReferenceEvidence, rebaseLogicalDeletedReferenceEvidence,
  captureLogicalInsertionGraph } from "../../src/storage/documents/logicalDocuments/insertionOrder";
import { detachLogicalDocumentChanges } from "../../src/storage/documents/logicalDocuments/detachChanges";
import { validateLogicalDocumentChanges } from "../../src/storage/documents/logicalDocuments/contribution";
import { runEffect } from "../support/effectTestRuntime";

it("retains exact causal ordinals and preimages through detachment, recreation and call-local rebasing", () =>
  runEffect(Effect.gen(function* () {
    const scopeId = ScopeIdSchema.make("scope_91000000-0000-4000-8000-000000000142"), snapshotCommitSeq = CommitSeqSchema.make(1n);
    // SAFETY: this neutral issuer fixture does not invoke a durable journal.
    const attempt = Object.freeze({}) as SessionJournalAttempt;
    const pins = { attempt, scopeId, snapshotCommitSeq, attemptFence: "1" };
    const root = makeLogicalDocumentRootEvaluator(pins, { identities: 8, workingBytes: 64_000 });
    const sourceTableId = CatalogTableIdSchema.make(1), targetTableId = CatalogTableIdSchema.make(2);
    const sourceRow = decodeAppRowIdHexV1("00000000000000000000000000000142"), targetRow = decodeAppRowIdHexV1("00000000000000000000000000000143");
    const sourceId = appDocumentIdV1FromRowIdentity({ tableId: sourceTableId, rowId: sourceRow });
    const targetId = appDocumentIdV1FromRowIdentity({ tableId: targetTableId, rowId: targetRow });
    const creationTime = AppCreationTimeV1Schema.make(1);
    const sourceBefore = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId: sourceTableId, rowId: sourceRow, creationTime,
      fields: { id: "source", parent_id: "parent", updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null } }));
    const sourceAfter = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId: sourceTableId, rowId: sourceRow, creationTime,
      fields: { id: "source", parent_id: null, updated_at: "2020-01-01T00:00:00.000Z", deleted_at: null } }));
    const parent = yield* Effect.promise(() => canonicalizeAppDocumentV1({ tableId: targetTableId, rowId: targetRow, creationTime, fields: { id: "parent" } }));
    const point = (tableId: typeof sourceTableId, rowId: typeof sourceRow, documentId: typeof sourceId) => ({ documentId, tableId, rowId, readAt: snapshotCommitSeq,
      dependency: { kind: "appRowPoint" as const, documentId, observed: { kind: "missing" as const, basis: { kind: "noVisibleRevision" as const } } } });
    const sourcePoint = point(sourceTableId, sourceRow, sourceId), targetPoint = point(targetTableId, targetRow, targetId);
    const state = attachLogicalDocumentRootEvaluator(root, pins);
    if (state === null) throw new Error("Missing actual root issuer state");
    try {
      yield* Effect.fromResult(root.observePoint("parent", targetPoint, { kind: "missing" }));
      yield* Effect.fromResult(root.observePoint("source", sourcePoint, { kind: "missing" }));
      yield* Effect.fromResult(root.writePoint("parent", targetPoint, { kind: "live", creationTime, document: parent }, "insert"));
      yield* Effect.fromResult(root.writePoint("source", sourcePoint, { kind: "live", creationTime, document: sourceBefore }, "insert"));
      yield* Effect.fromResult(root.writePoint("parent", targetPoint, { kind: "deleted" }, "delete"));
      yield* Effect.fromResult(root.writePoint("parent", targetPoint, { kind: "live", creationTime, document: parent }, "insert"));
      yield* Effect.fromResult(root.writePoint("parent", targetPoint, { kind: "deleted" }, "delete"));
      yield* Effect.fromResult(root.writePoint("source", sourcePoint, { kind: "live", creationTime, document: sourceAfter }, "patch"));
      const patch = state.attempts[5], deleted = state.attempts[4];
      if (patch?.before === null || patch?.before === undefined || patch.after === null || deleted?.before === null || deleted?.before === undefined)
        throw new Error("Missing actual patch and deletion preimages");
      const cause = { sourceColumn: "parent_id", targetTableId, targetColumn: "id", targetKey: "parent", targetDeleteOrdinal: 4 };
      const issuedRoot = root.snapshot().insertionRoot;
      if (issuedRoot === undefined) throw new Error("Missing actual root namespace");
      const evidence = yield* Effect.fromResult(issueLogicalDeletedReferenceEvidence(issuedRoot, scopeId,
        { ordinal: patch.ordinal, tableId: patch.tableId, documentId: patch.documentId, before: patch.before, after: patch.after },
        cause, { documentId: deleted.documentId, before: deleted.before }));
      state.attempts[5] = Object.freeze({ ...patch, deletedReference: Object.freeze(cause), deletedReferenceEvidence: evidence });
      // Final target presence is valid: native compensation never relinks a
      // previously detached child merely because it recreates the same ID.
      yield* Effect.fromResult(root.writePoint("parent", targetPoint, { kind: "live", creationTime, document: parent }, "insert"));
      const graph = root.snapshot(), detached = detachLogicalDocumentChanges(graph), issued = detached.attempts[5];
      if (issued === undefined || graph.insertionRoot === undefined) throw new Error("Missing detached actual causal patch");
      const validate = (candidate: typeof graph, selectedScope = scopeId) => validateLogicalDocumentChanges({
        // SAFETY: this fixture has no SQL dependencies; no database method is invoked.
        tx: {} as FlarexMetadataTransaction, scopeId: selectedScope, tables: new Set([sourceTableId, targetTableId]),
        maximumIndexEntries: 8, error: reason => new Error(reason), detachDeletedReferences: true,
      }, candidate);
      yield* validate(detached);
      expect(hasLogicalDeletedReferenceEvidence(scopeId, graph.insertionRoot, issued, detached.attempts[4])).toBe(true);
      const shifted = rebaseLogicalDeletedReferenceEvidence(evidence, 4);
      if (shifted === undefined) throw new Error("Missing authentic rebased proof");
      expect(hasLogicalDeletedReferenceEvidence(scopeId, graph.insertionRoot, { ...issued, ordinal: 1,
        deletedReference: { ...cause, targetDeleteOrdinal: 0 }, deletedReferenceEvidence: shifted }, detached.attempts[4])).toBe(true);
      expect(rebaseLogicalDeletedReferenceEvidence(evidence, 5)).toBeUndefined();
      const { deletedReferenceEvidence: _removedEvidence, ...withoutEvidence } = issued;
      const forged = [
        { ...issued, deletedReference: { ...cause, targetDeleteOrdinal: 2 } },
        { ...issued, ordinal: 6 },
        { ...issued, deletedReference: { ...cause, sourceColumn: "id" } },
        { ...issued, deletedReferenceEvidence: structuredClone(evidence) },
        withoutEvidence,
      ];
      for (const patch of forged) {
        const candidate = captureLogicalInsertionGraph({ ...detached, attempts: detached.attempts.map((attempt, index) => index === 5 ? patch : attempt) }, graph.insertionRoot);
        expect(yield* Effect.result(validate(candidate))).toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
      }
      expect(yield* Effect.result(validate(detached, ScopeIdSchema.make("scope_91000000-0000-4000-8000-000000000143"))))
        .toMatchObject({ _tag: "Failure", failure: { message: "invalidAuthority" } });
      const missingSelection = yield* Effect.result(validateLogicalDocumentChanges({
        // SAFETY: as above, there are no SQL dependencies.
        tx: {} as FlarexMetadataTransaction, scopeId, tables: new Set([sourceTableId, targetTableId]), maximumIndexEntries: 8,
        error: reason => new Error(reason),
      }, detached));
      expect(Result.isFailure(missingSelection)).toBe(true);
    } finally { root.close(); }
  })));
