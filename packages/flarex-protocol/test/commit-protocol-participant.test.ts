import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  CommitFinalSyscallSequenceV1Schema,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  SESSION_JOURNAL_FORMAT,
  canonicalizeSessionJournalEffect,
  verifyParticipantPointCorrelationEffect,
  type AdmittedParticipantOperation,
  type ParticipantPointCorrelation,
  type SessionJournal,
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

function operation(sequence = 1n): AdmittedParticipantOperation {
  return {
    syscallSequence: CommitSyscallSequenceV1Schema.make(sequence),
    participant: "native-product",
    method: "update",
    profileRevision: "f".repeat(64),
    admissionBundleSha256Hex: "c".repeat(64),
    requestSha256Hex: "d".repeat(64),
    resultSha256Hex: "e".repeat(64),
    sourceContributions: [{ sourceKey: "native-product-source",
      sourceSha256Hex: "a".repeat(64),
      bindingHead: { sequence: "1", sha256: "b".repeat(64) },
      sourceBindingSha256Hex: "c".repeat(64), methods: ["update"],
      effects: [], dependencyEvidence }],
    eventIntents: [],
  };
}

function withEffects(value: AdmittedParticipantOperation,
  effects: AdmittedParticipantOperation["sourceContributions"][number]["effects"]): AdmittedParticipantOperation {
  return { ...value, sourceContributions: [{ ...value.sourceContributions[0]!, effects }] };
}

function journal(operations: readonly AdmittedParticipantOperation[],
  options: { readonly writes?: SessionJournal["writes"] } = {}): SessionJournal {
  return {
    format: SESSION_JOURNAL_FORMAT,
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

function point(overlayValueJson: ParticipantPointCorrelation["overlayValueJson"] = updated,
): ParticipantPointCorrelation {
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

describe("session journal participant correlation", () => {
  it("accepts an admitted read-only operation without inventing a point write", async () => {
    const canonical = await Effect.runPromise(
      canonicalizeSessionJournalEffect(journal([operation()])),
    );
    await expect(Effect.runPromise(verifyParticipantPointCorrelationEffect(
      canonical.journal, [],
    ))).resolves.toEqual({ effectCount: 0, writeSemanticBytes: 0 });
  });

  it("rejects an Application and participant write to the same document", async () => {
    const admitted = withEffects(operation(2n), [insert]);
    const canonical = await Effect.runPromise(canonicalizeSessionJournalEffect(journal(
      [admitted],
      { writes: [{ kind: "delete", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), documentId }] },
    )));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationEffect(
      canonical.journal, [point(created)],
    ))).rejects.toBeDefined();
  });

  it("rejects a participant effect whose document belongs to another table", async () => {
    await expect(Effect.runPromise(canonicalizeSessionJournalEffect(journal([
      withEffects(operation(), [{ ...insert, tableId: decodeCatalogTableId(2) }]),
    ])))).rejects.toBeDefined();
  });

  it("rejects a changed intermediate before value and a changed final overlay", async () => {
    const admitted = withEffects(operation(), [insert, patch]);
    const canonical = await Effect.runPromise(canonicalizeSessionJournalEffect(journal([admitted])));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationEffect(
      canonical.journal, [point(created)],
    ))).rejects.toBeDefined();

    const altered = withEffects(operation(), [insert, { ...patch, before: updated }]);
    const alteredCanonical = await Effect.runPromise(canonicalizeSessionJournalEffect(journal([altered])));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationEffect(
      alteredCanonical.journal, [point()],
    ))).rejects.toBeDefined();
  });

  it("rejects duplicate effect ordinals and duplicate participant sequences", async () => {
    await expect(Effect.runPromise(canonicalizeSessionJournalEffect(journal([
      withEffects(operation(), [insert, { ...patch, effectOrdinal: 0 }]),
    ])))).rejects.toBeDefined();
    await expect(Effect.runPromise(canonicalizeSessionJournalEffect(journal([
      operation(), operation(),
    ])))).rejects.toBeDefined();
  });

  it("accepts an ordered insert and patch against the final pending point", async () => {
    const canonical = await Effect.runPromise(canonicalizeSessionJournalEffect(journal([
      withEffects(operation(), [insert, patch]),
    ])));
    await expect(Effect.runPromise(verifyParticipantPointCorrelationEffect(
      canonical.journal, [point()],
    ))).resolves.toMatchObject({ effectCount: 2 });
  });

  it("preserves three ordered source contributions with interleaved global effects", async () => {
    const pricingTable = decodeCatalogTableId(2);
    const linkTable = decodeCatalogTableId(3);
    const pricingId = decodeAppDocumentIdV1("2:00000000-0000-0000-0000-000000000002");
    const linkId = decodeAppDocumentIdV1("3:00000000-0000-0000-0000-000000000003");
    const pricing = { _id: pricingId, _creationTime: 1000, amount: 42 };
    const link = { _id: linkId, _creationTime: 1000, productId: documentId, pricingId };
    const base = operation();
    const sources = [
      { ...base.sourceContributions[0]!, effects: [{ ...insert, effectOrdinal: 0 },
        { ...patch, effectOrdinal: 3 }] },
      { ...base.sourceContributions[0]!, sourceKey: "native-pricing-source",
        sourceSha256Hex: "1".repeat(64), sourceBindingSha256Hex: "2".repeat(64),
        methods: ["price"], effects: [{ effectOrdinal: 1, tableId: pricingTable,
          documentId: pricingId, operation: "insert" as const, before: null, after: pricing }] },
      { ...base.sourceContributions[0]!, sourceKey: "native-link-source",
        sourceSha256Hex: "3".repeat(64), sourceBindingSha256Hex: "4".repeat(64),
        methods: ["link"], effects: [{ effectOrdinal: 2, tableId: linkTable,
          documentId: linkId, operation: "insert" as const, before: null, after: link }] },
    ];
    const admitted = { ...base, sourceContributions: sources,
      eventIntents: [{ sourceKey: "native-pricing-source", intent: { name: "price.created" } },
        { sourceKey: null, intent: { name: "workflow.completed" } }] };
    const canonical = await Effect.runPromise(canonicalizeSessionJournalEffect(journal([admitted])));
    expect(canonical.journal.participantOperations[0]?.sourceContributions.map(source => source.sourceKey))
      .toEqual(["native-product-source", "native-pricing-source", "native-link-source"]);
    await expect(Effect.runPromise(verifyParticipantPointCorrelationEffect(canonical.journal, [
      point(),
      { documentId: pricingId, tableId: pricingTable,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
        overlayKind: "live", overlayValueJson: pricing },
      { documentId: linkId, tableId: linkTable,
        observed: { kind: "missing", basis: { kind: "noVisibleRevision" } },
        overlayKind: "live", overlayValueJson: link },
    ]))).resolves.toMatchObject({ effectCount: 4 });
    await expect(Effect.runPromise(canonicalizeSessionJournalEffect(journal([{
      ...admitted, sourceContributions: [sources[1]!, sources[0]!, sources[2]!],
    }])))).resolves.toHaveProperty("journal");
    await expect(Effect.runPromise(canonicalizeSessionJournalEffect(journal([{
      ...admitted, sourceContributions: [{ ...sources[0]!, effects: [patch, insert] }, sources[1]!, sources[2]!],
    }])))).rejects.toBeDefined();
    await expect(Effect.runPromise(canonicalizeSessionJournalEffect(journal([{
      ...admitted, eventIntents: [{ sourceKey: "unknown", intent: { name: "forged" } }],
    }])))).rejects.toBeDefined();
  });
});
