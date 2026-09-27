import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  CommitFinalSyscallSequenceV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT_V2,
  canonicalizeSessionJournalV2Effect,
  verifyParticipantPointCorrelationV2Effect,
  type AdmittedParticipantOperationV1,
  type ParticipantPointCorrelationV2,
  type SessionJournalV2,
} from "../src/commit-protocol";
import { decodeAppDocumentIdV1 } from "../src/app-document-id";
import { decodeCatalogTableId } from "../src/catalog";
import { CommitSeqSchema } from "../src/storage-authority";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1 } from "../src/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "../src/value";

const documentId = decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000001");
const tableId = decodeCatalogTableId(1);
const created = { _id: documentId, _creationTime: 1000, title: "first" };
const updated = { _id: documentId, _creationTime: 1000, title: "second" };
const dependencyEvidence = {
  format: "flarex.logical-participant-evidence",
  version: 1,
  indexRanges: [],
  indexPages: [],
  uniqueReads: [],
};

function operation(sequence = 1n): AdmittedParticipantOperationV1 {
  return {
    syscallSequence: CommitSyscallSequenceV1Schema.make(sequence),
    participant: "native-product",
    method: "update",
    sourceKey: "native-product-source",
    sourceSha256Hex: "a".repeat(64),
    bindingHead: { sequence: "1", sha256: "b".repeat(64) },
    participantBindingSha256Hex: "c".repeat(64),
    requestSha256Hex: "d".repeat(64),
    resultSha256Hex: "e".repeat(64),
    effects: [],
    dependencyEvidence,
    eventIntents: [],
  };
}

function journal(operations: readonly AdmittedParticipantOperationV1[],
  options: { readonly writes?: SessionJournalV2["writes"] } = {}): SessionJournalV2 {
  return {
    format: SESSION_JOURNAL_FORMAT_V2,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(2n),
    readDependencies: [],
    readUsage: {
      documentsRead: CommitReadDocumentsV1Schema.make(0),
      semanticBytesRead: CommitReadSemanticBytesV1Schema.make(0),
    },
    writes: options.writes ?? [],
    operationUsage: { receiptEvidenceBytes: 0, participantWorkBytes: 0,
      participantWorkCalls: 0 },
    participantOperations: operations,
  };
}

function point(overlayValueJson: ParticipantPointCorrelationV2["overlayValueJson"] = updated,
): ParticipantPointCorrelationV2 {
  return {
    documentId,
    tableId,
    observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
    overlayKind: "live",
    overlayValueJson,
  };
}

const insert = {
  effectOrdinal: 0,
  tableId,
  documentId,
  operation: "insert" as const,
  before: null,
  after: created,
};
const patch = {
  effectOrdinal: 1,
  tableId,
  documentId,
  operation: "patch" as const,
  before: created,
  after: updated,
};

describe("session journal V2 participant correlation", () => {
  it("accepts an admitted read-only operation without inventing a point write", async () => {
    const canonical = await Effect.runPromise(
      canonicalizeSessionJournalV2Effect(journal([operation()])),
    );
    await expect(Effect.runPromise(verifyParticipantPointCorrelationV2Effect(
      canonical.journal, [],
    ))).resolves.toEqual({ effectCount: 0, writeSemanticBytes: 0 });
  });

  it("rejects an Application and participant write to the same document", async () => {
    const admitted = { ...operation(2n), effects: [insert] };
    const canonical = await Effect.runPromise(canonicalizeSessionJournalV2Effect(journal(
      [admitted],
      { writes: [{ kind: "delete", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId }] },
    )));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationV2Effect(
      canonical.journal, [point(created)],
    ))).rejects.toBeDefined();
  });

  it("rejects a participant effect whose document belongs to another table", async () => {
    await expect(Effect.runPromise(canonicalizeSessionJournalV2Effect(journal([
      { ...operation(), effects: [{ ...insert, tableId: decodeCatalogTableId(2) }] },
    ])))).rejects.toBeDefined();
  });

  it("rejects a changed intermediate before value and a changed final overlay", async () => {
    const admitted = { ...operation(), effects: [insert, patch] };
    const canonical = await Effect.runPromise(canonicalizeSessionJournalV2Effect(journal([admitted])));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationV2Effect(
      canonical.journal, [point(created)],
    ))).rejects.toBeDefined();

    const altered = { ...operation(), effects: [insert, { ...patch, before: updated }] };
    const alteredCanonical = await Effect.runPromise(canonicalizeSessionJournalV2Effect(journal([altered])));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationV2Effect(
      alteredCanonical.journal, [point()],
    ))).rejects.toBeDefined();
  });

  it("rejects duplicate effect ordinals and duplicate participant sequences", async () => {
    await expect(Effect.runPromise(canonicalizeSessionJournalV2Effect(journal([
      { ...operation(), effects: [insert, { ...patch, effectOrdinal: 0 }] },
    ])))).rejects.toBeDefined();
    await expect(Effect.runPromise(canonicalizeSessionJournalV2Effect(journal([
      operation(), operation(),
    ])))).rejects.toBeDefined();
  });

  it("accepts an ordered insert and patch against the final pending point", async () => {
    const canonical = await Effect.runPromise(canonicalizeSessionJournalV2Effect(journal([
      { ...operation(), effects: [insert, patch] },
    ])));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationV2Effect(
      canonical.journal, [point()],
    ))).resolves.toMatchObject({ effectCount: 2 });
  });
});
