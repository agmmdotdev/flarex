import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";

import * as protocolRoot from "../src/index";
import * as commitProtocolLeaf from "flarex-protocol/commit-protocol";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  COMMIT_PROTOCOL_EXECUTION_LIMITS_V1,
  COMMIT_PROTOCOL_OPERATIONAL_LIMITS_V1,
  CanonicalSessionJournalBase64UrlV1Schema,
  CommitDocumentSemanticBytesV1Schema,
  CommitEnvelopeV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  CommitProtocolV1Error,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  SESSION_JOURNAL_FORMAT_V1,
  SuccessfulResultSha256HexV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
  decodeCanonicalSessionJournalV1Effect,
  decodeCommitEnvelopeV1Effect,
  inspectInlineUntrustedJournalIntegrityV1Effect,
  makeCommitEnvelopeV1Effect,
  requireStoredForSessionAttemptCommitEnvelopeV1Effect,
  verifySuccessfulResultEvidenceV1Effect,
  type CanonicalSessionJournalV1,
  type CanonicalSuccessfulResultV1,
  type CommitEnvelopeV1,
  type CommitProtocolV1Issue,
  type LogicalAppWriteV1,
  type LogicalReadDependencyV1,
  type SessionJournalV1,
} from "../src/commit-protocol";
import {
  decodeAppDocumentIdV1,
  type AppDocumentIdV1,
} from "../src/app-document-id";
import { AppCreationTimeV1Schema } from "../src/app-document";
import type { JsonObject } from "../src/json";
import { CommitSeqSchema } from "../src/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  decodeTransactionSessionIdV1,
} from "../src/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "../src/value";

const SESSION_ID = decodeTransactionSessionIdV1(
  "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);
const ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(7n);
const DOCUMENT_A = documentId(1);
const DOCUMENT_B = documentId(2);
const encodeCommitEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describe("commit protocol C02", () => {
  it("pins canonical journal bytes and digest with result evidence outside the journal", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 2n,
        readDependencies: [presentDependency(DOCUMENT_A, 4n)],
        readDocuments: 1,
        readSemanticBytes: 128,
        writes: [patchWrite(2n, DOCUMENT_B, [
          { kind: "remove", field: "obsolete" },
          { kind: "set", field: "name", valueJson: "Ada" },
        ], 256)],
      }),
    ));

    expect(canonical.canonicalText).toBe(
      `{"finalSyscallSequence":"2","format":"${SESSION_JOURNAL_FORMAT_V1}",` +
      '"protocolVersion":1,"readDependencies":[{' +
      `"documentId":"${DOCUMENT_A}","kind":"appRowPoint",` +
      '"observed":{"kind":"present","revisionCommitSeq":"4"}}],' +
      '"readUsage":{"documentsRead":1,"semanticBytesRead":128},' +
      '"valueCodecVersion":1,"writes":[{"changes":[' +
      '{"field":"name","kind":"set","valueJson":"Ada"},' +
      '{"field":"obsolete","kind":"remove"}],' +
      `"documentId":"${DOCUMENT_B}","kind":"patch",` +
      '"resultingDocumentSemanticBytes":256,"syscallSequence":"2"}]}',
    );
    expect(canonical.sha256Hex).toBe(
      "c7a2943641a9ed1df5e8418378a035f518a69529d1eb3e937d442482217f0429",
    );
    expect(canonical.journal).not.toHaveProperty("successfulResult");

    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    const envelope = await runEffect(makeCommitEnvelopeV1Effect(
      storedEnvelope(canonical, result),
    ));
    expect(envelope.successfulResult).toEqual(result.evidence);
    expect(envelope.journal).toEqual({ kind: "storedForSessionAttempt" });
  });

  it("canonicalizes dependency, write, and patch permutations identically", async () => {
    const first = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 3n,
        readDependencies: [
          missingDependency(DOCUMENT_B),
          presentDependency(DOCUMENT_A, 9n),
        ],
        writes: [
          deleteWrite(3n, DOCUMENT_B),
          patchWrite(2n, DOCUMENT_A, [
            { kind: "remove", field: "z" },
            { kind: "set", field: "a", valueJson: 1 },
          ], 200),
        ],
      }),
    ));
    const second = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 3n,
        readDependencies: [
          presentDependency(DOCUMENT_A, 9n),
          missingDependency(DOCUMENT_B),
        ],
        writes: [
          patchWrite(2n, DOCUMENT_A, [
            { kind: "set", field: "a", valueJson: 1 },
            { kind: "remove", field: "z" },
          ], 200),
          deleteWrite(3n, DOCUMENT_B),
        ],
      }),
    ));

    expect(first.canonicalBytes).toEqual(second.canonicalBytes);
    expect(first.sha256Hex).toBe(second.sha256Hex);
  });

  it("binds insert creation time into stable canonical journal evidence", async () => {
    const first = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 1n,
        writes: [insertWrite(
          1n,
          DOCUMENT_A,
          { z: "last", a: 1 },
          128,
          1_700_000_000_000.25,
        )],
      }),
    ));
    const reordered = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 1n,
        writes: [insertWrite(
          1n,
          DOCUMENT_A,
          { a: 1, z: "last" },
          128,
          1_700_000_000_000.25,
        )],
      }),
    ));
    const differentCreationTime = await runEffect(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        writes: [insertWrite(
          1n,
          DOCUMENT_A,
          { a: 1, z: "last" },
          128,
          1_700_000_000_001.25,
        )],
      })),
    );

    expect(first.canonicalBytes).toEqual(reordered.canonicalBytes);
    expect(first.sha256Hex).toBe(reordered.sha256Hex);
    expect(first.canonicalText).toContain(
      '"creationTime":1700000000000.25',
    );
    expect(differentCreationTime.sha256Hex).not.toBe(first.sha256Hex);
  });

  it("does not eagerly manufacture inline carriage for stored evidence", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({ finalSyscallSequence: 0n }),
    ));
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect(null),
    );

    expect(canonical).not.toHaveProperty("inlineUntrustedBase64Url");

    const stored = await runEffect(makeCommitEnvelopeV1Effect(
      storedEnvelope(canonical, result),
    ));
    expect(stored.journal).toEqual({ kind: "storedForSessionAttempt" });
    expect(stored.journal).not.toHaveProperty("canonicalJournalBase64Url");
  });

  it("round-trips canonical evidence and returns defensive bytes", async () => {
    const mutableFields = { name: "before" };
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 1n,
        writes: [insertWrite(1n, DOCUMENT_A, mutableFields, 128)],
      }),
    ));
    mutableFields.name = "after";

    const exposed = canonical.canonicalBytes;
    exposed.fill(0);
    const decoded = await runEffect(decodeCanonicalSessionJournalV1Effect({
      canonicalBytes: canonical.canonicalBytes,
      expectedSha256Hex: canonical.sha256Hex,
    }));

    expect(decoded.journal.writes[0]).toMatchObject({
      kind: "insert",
      fieldsValueJson: { name: "before" },
    });
    expect(decoded.canonicalBytes).not.toEqual(exposed);
    expect(Object.isFrozen(decoded.journal)).toBe(true);
    expect(Object.isFrozen(decoded.journal.writes)).toBe(true);
  });

  it("rejects noncanonical bytes, digest mismatch, versions, and authority fields", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({ finalSyscallSequence: 0n }),
    ));
    const nonCanonical = new TextEncoder().encode(`${canonical.canonicalText}\n`);
    const nonCanonicalFailure = await runFailure(
      decodeCanonicalSessionJournalV1Effect({
        canonicalBytes: nonCanonical,
        expectedSha256Hex: canonical.sha256Hex,
      }),
    );
    expect(nonCanonicalFailure.issue).toEqual({
      reason: "nonCanonical",
      component: "journal",
    });

    const digestFailure = await runFailure(
      decodeCanonicalSessionJournalV1Effect({
        canonicalBytes: canonical.canonicalBytes,
        expectedSha256Hex: "0".repeat(64),
      }),
    );
    expect(digestFailure.issue).toEqual({
      reason: "digestMismatch",
      component: "journal",
    });

    const versionFailure = await runFailure(
      canonicalizeSessionJournalV1Effect({
        ...sessionJournal({ finalSyscallSequence: 0n }),
        protocolVersion: 2,
      }),
    );
    expect(versionFailure.issue).toMatchObject({
      reason: "unsupportedVersion",
      component: "journal",
      field: "protocolVersion",
    });

    const authorityFailure = await runFailure(
      canonicalizeSessionJournalV1Effect({
        ...sessionJournal({ finalSyscallSequence: 0n }),
        scopeId: "scope_018f22e2-58cc-7b2a-91d8-f3f3401a0874",
      }),
    );
    expect(authorityFailure.issue).toEqual({
      reason: "invalidSchema",
      component: "journal",
    });
  });

  it("preserves present, missing, tombstone, set, and remove semantics", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 3n,
        readDependencies: [
          presentDependency(DOCUMENT_A, 5n),
          tombstoneDependency(DOCUMENT_B, 7n),
          missingDependency(documentId(3)),
        ],
        writes: [patchWrite(3n, DOCUMENT_A, [
          { kind: "remove", field: "gone" },
          { kind: "set", field: "kept", valueJson: { nested: true } },
        ], 512)],
      }),
    ));

    expect(canonical.journal.readDependencies.map(item => item.observed)).toEqual([
      { kind: "present", revisionCommitSeq: CommitSeqSchema.make(5n) },
      {
        kind: "missing",
        basis: {
          kind: "tombstone",
          revisionCommitSeq: CommitSeqSchema.make(7n),
        },
      },
      { kind: "missing", basis: { kind: "noVisibleRevision" } },
    ]);
    expect(canonical.journal.writes[0]).toMatchObject({
      kind: "patch",
      changes: [
        { kind: "remove", field: "gone" },
        { kind: "set", field: "kept", valueJson: { nested: true } },
      ],
    });
  });

  it("rejects duplicate or forged logical evidence and developer system fields", async () => {
    const duplicateDependency = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          missingDependency(DOCUMENT_A),
          missingDependency(DOCUMENT_A),
        ],
      })),
    );
    expect(duplicateDependency.issue).toMatchObject({
      reason: "duplicateReadDependency",
      documentId: DOCUMENT_A,
    });

    const duplicateSequence = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        writes: [
          deleteWrite(1n, DOCUMENT_A),
          deleteWrite(1n, DOCUMENT_B),
        ],
      })),
    );
    expect(duplicateSequence.issue).toMatchObject({
      reason: "duplicateWriteSequence",
    });

    const duplicatePatch = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        writes: [patchWrite(1n, DOCUMENT_A, [
          { kind: "set", field: "name", valueJson: "one" },
          { kind: "remove", field: "name" },
        ], 64)],
      })),
    );
    expect(duplicatePatch.issue).toMatchObject({
      reason: "duplicatePatchField",
      field: "name",
    });

    const systemField = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        writes: [insertWrite(1n, DOCUMENT_A, { _id: DOCUMENT_A }, 64)],
      })),
    );
    expect(systemField.issue).toMatchObject({
      reason: "developerAuthoredSystemField",
      field: "_id",
    });

    const physicalWrite = {
      ...deleteWrite(1n, DOCUMENT_A),
      sql: "delete from app_rows",
    };
    const physicalFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        writes: [physicalWrite],
      })),
    );
    expect(physicalFailure.issue).toEqual({
      reason: "invalidSchema",
      component: "journal",
    });

    const pollutedPrototype = Object.fromEntries(
      Array.from({ length: 1_025 }, (_, index) => [`inherited${index}`, true]),
    );
    const inheritedTraversalFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(Object.assign(
        Object.create(pollutedPrototype),
        sessionJournal(),
      )),
    );
    expect(inheritedTraversalFailure.issue).toEqual({
      reason: "invalidSchema",
      component: "journal",
    });
  });

  it("ports the exact Convex execution limits without a syscall or lease limit", async () => {
    expect(COMMIT_PROTOCOL_EXECUTION_LIMITS_V1).toEqual({
      readDocuments: 32_000,
      readSemanticBytes: 16_777_216,
      pointReadDependencies: 4_096,
      writeOperations: 16_000,
      writeSemanticBytes: 16_777_216,
      resultSemanticBytes: 16_777_216,
    });
    expect(COMMIT_PROTOCOL_EXECUTION_LIMITS_V1).not.toHaveProperty("syscalls");
    expect(COMMIT_PROTOCOL_EXECUTION_LIMITS_V1).not.toHaveProperty("lease");
    expect(COMMIT_PROTOCOL_EXECUTION_LIMITS_V1).not.toHaveProperty("scannedRows");
    expect(COMMIT_PROTOCOL_EXECUTION_LIMITS_V1).not.toHaveProperty(
      "materialWriteEventEvidenceBytes",
    );
    expect(COMMIT_PROTOCOL_OPERATIONAL_LIMITS_V1).toEqual({
      canonicalEvidenceBytes: 67_108_864,
      materialWriteEventEvidenceBytes: 67_108_864,
    });
    expect(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1).toBe(
      67_108_864,
    );
    expect(CommitMaterialWriteEventEvidenceBytesV1Schema.make(0)).toBe(0);
    expect(CommitMaterialWriteEventEvidenceBytesV1Schema.make(
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
    )).toBe(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1);
    for (const invalid of [-1, 0.5, 67_108_865]) {
      expect(() =>
        CommitMaterialWriteEventEvidenceBytesV1Schema.make(invalid)
      ).toThrow();
    }
    const operationalIssue = {
      reason: "limitExceeded",
      dimension: "materialWriteEventEvidenceBytes",
      observed: 67_108_865,
      maximum: 67_108_864,
    } satisfies CommitProtocolV1Issue;
    expect(operationalIssue.dimension).toBe(
      "materialWriteEventEvidenceBytes",
    );

    const exactDependencies = Array.from(
      { length: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 },
      (_, index) => missingDependency(documentId(index + 1)),
    );
    await expect(runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: exactDependencies,
      }),
    ))).resolves.toBeDefined();
    const dependencyFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          ...exactDependencies,
          missingDependency(documentId(MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1)),
        ],
      })),
    );
    expect(dependencyFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "pointReadDependencies",
      observed: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1,
    });

    const exactWrites = Array.from(
      { length: MAX_COMMIT_WRITE_OPERATIONS_V1 },
      (_, index) => deleteWrite(BigInt(index + 1), documentId(index + 1)),
    );
    await expect(runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({
        finalSyscallSequence: BigInt(MAX_COMMIT_WRITE_OPERATIONS_V1),
        writes: exactWrites,
      }),
    ))).resolves.toBeDefined();
    const writeCountFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: BigInt(MAX_COMMIT_WRITE_OPERATIONS_V1 + 1),
        writes: [
          ...exactWrites,
          deleteWrite(
            BigInt(MAX_COMMIT_WRITE_OPERATIONS_V1 + 1),
            documentId(MAX_COMMIT_WRITE_OPERATIONS_V1 + 1),
          ),
        ],
      })),
    );
    expect(writeCountFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "writeOperations",
      observed: MAX_COMMIT_WRITE_OPERATIONS_V1 + 1,
    });
  }, 60_000);

  it("recomputes write bytes and bounds trusted C03 read usage", async () => {
    const oversizedWrites = Array.from({ length: 17 }, (_, index) =>
      insertWrite(
        BigInt(index + 1),
        documentId(index + 1),
        {},
        1 << 20,
      )
    );
    const writeBytesFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 17n,
        writes: oversizedWrites,
      })),
    );
    expect(writeBytesFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "writeSemanticBytes",
      observed: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1 + (1 << 20),
      maximum: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
    });

    const readUsageFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 1n,
        readDocuments: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
      })),
    );
    expect(readUsageFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "readDocuments",
    });

    const zeroSequenceReadBytesFailure = await runFailure(
      canonicalizeSessionJournalV1Effect(sessionJournal({
        finalSyscallSequence: 0n,
        readSemanticBytes: 1,
      })),
    );
    expect(zeroSequenceReadBytesFailure.issue).toEqual({
      reason: "sequenceMismatch",
    });
  });

  it("recomputes and verifies successful-result semantic and digest evidence", async () => {
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true, value: 42n }),
    );
    const verified = await runEffect(
      verifySuccessfulResultEvidenceV1Effect(result.evidence),
    );
    expect(verified.valueJson).toEqual(result.valueJson);
    expect(verified.canonicalBytes).toEqual(result.canonicalBytes);

    const digestFailure = await runFailure(
      verifySuccessfulResultEvidenceV1Effect({
        ...result.evidence,
        sha256Hex: SuccessfulResultSha256HexV1Schema.make("0".repeat(64)),
      }),
    );
    expect(digestFailure.issue).toEqual({
      reason: "digestMismatch",
      component: "successfulResult",
    });

    const oversizedResult = new ArrayBuffer(
      MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1 + 1,
    );
    const limitFailure = await runFailure(
      canonicalizeSuccessfulResultV1Effect(oversizedResult),
    );
    expect(limitFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "resultSemanticBytes",
      maximum: MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
    });
  });

  it("keeps inline carriage explicitly untrusted and operationally dormant", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({ finalSyscallSequence: 0n }),
    ));
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect("done"),
    );
    const inline = await runEffect(makeCommitEnvelopeV1Effect(
      inlineEnvelope(canonical, result),
    ));

    expect(inline.journal.kind).toBe("inlineUntrusted");
    const integrityOnly = await runEffect(
      inspectInlineUntrustedJournalIntegrityV1Effect(inline),
    );
    expect(integrityOnly.sha256Hex).toBe(canonical.sha256Hex);

    const dormant = await runFailure(
      requireStoredForSessionAttemptCommitEnvelopeV1Effect(inline),
    );
    expect(dormant.issue).toEqual({
      reason: "inlineJournalCarriageDormant",
    });

    const sequenceMismatch = await runFailure(
      inspectInlineUntrustedJournalIntegrityV1Effect({
        ...inline,
        finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n),
      }),
    );
    expect(sequenceMismatch.issue).toEqual({ reason: "sequenceMismatch" });
  });

  it("accepts only locator-free stored carriage and keeps the leaf out of the root barrel", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalV1Effect(
      sessionJournal({ finalSyscallSequence: 0n }),
    ));
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect(null),
    );
    const stored = await runEffect(makeCommitEnvelopeV1Effect(
      storedEnvelope(canonical, result),
    ));
    const operational = await runEffect(
      requireStoredForSessionAttemptCommitEnvelopeV1Effect(stored),
    );
    expect(operational.journal).toEqual({ kind: "storedForSessionAttempt" });

    const encoded = encodeCommitEnvelope(stored);
    const locatorFailure = await runFailure(decodeCommitEnvelopeV1Effect({
      ...encoded,
      journal: {
        kind: "storedForSessionAttempt",
        locator: "caller-selected-key",
      },
    }));
    expect(locatorFailure.issue).toEqual({
      reason: "invalidSchema",
      component: "envelope",
    });

    expect(commitProtocolLeaf.SessionJournalV1Schema).toBeDefined();
    expect("SessionJournalV1Schema" in protocolRoot).toBe(false);
    expect("PreparedCommitV1" in commitProtocolLeaf).toBe(false);
  });
});

function sessionJournal(options: {
  readonly finalSyscallSequence?: bigint;
  readonly readDependencies?: ReadonlyArray<LogicalReadDependencyV1>;
  readonly readDocuments?: number;
  readonly readSemanticBytes?: number;
  readonly writes?: ReadonlyArray<LogicalAppWriteV1>;
} = {}): SessionJournalV1 {
  return {
    format: SESSION_JOURNAL_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    finalSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(
      options.finalSyscallSequence ?? 0n,
    ),
    readDependencies: options.readDependencies ?? [],
    readUsage: {
      documentsRead: CommitReadDocumentsV1Schema.make(
        options.readDocuments ?? 0,
      ),
      semanticBytesRead: CommitReadSemanticBytesV1Schema.make(
        options.readSemanticBytes ?? 0,
      ),
    },
    writes: options.writes ?? [],
  } satisfies SessionJournalV1;
}

function presentDependency(
  documentIdValue: AppDocumentIdV1,
  revisionCommitSeq: bigint,
): LogicalReadDependencyV1 {
  return {
    kind: "appRowPoint",
    documentId: documentIdValue,
    observed: {
      kind: "present",
      revisionCommitSeq: CommitSeqSchema.make(revisionCommitSeq),
    },
  };
}

function missingDependency(
  documentIdValue: AppDocumentIdV1,
): LogicalReadDependencyV1 {
  return {
    kind: "appRowPoint",
    documentId: documentIdValue,
    observed: {
      kind: "missing",
      basis: { kind: "noVisibleRevision" },
    },
  };
}

function tombstoneDependency(
  documentIdValue: AppDocumentIdV1,
  revisionCommitSeq: bigint,
): LogicalReadDependencyV1 {
  return {
    kind: "appRowPoint",
    documentId: documentIdValue,
    observed: {
      kind: "missing",
      basis: {
        kind: "tombstone",
        revisionCommitSeq: CommitSeqSchema.make(revisionCommitSeq),
      },
    },
  };
}

function insertWrite(
  syscallSequence: bigint,
  documentIdValue: AppDocumentIdV1,
  fieldsValueJson: JsonObject,
  resultingDocumentSemanticBytes: number,
  creationTime = 1_700_000_000_000,
): LogicalAppWriteV1 {
  return {
    kind: "insert",
    syscallSequence: CommitSyscallSequenceV1Schema.make(syscallSequence),
    documentId: documentIdValue,
    creationTime: AppCreationTimeV1Schema.make(creationTime),
    fieldsValueJson,
    resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema.make(
      resultingDocumentSemanticBytes,
    ),
  };
}

function patchWrite(
  syscallSequence: bigint,
  documentIdValue: AppDocumentIdV1,
  changes: Extract<LogicalAppWriteV1, { readonly kind: "patch" }>["changes"],
  resultingDocumentSemanticBytes: number,
): LogicalAppWriteV1 {
  return {
    kind: "patch",
    syscallSequence: CommitSyscallSequenceV1Schema.make(syscallSequence),
    documentId: documentIdValue,
    changes,
    resultingDocumentSemanticBytes: CommitDocumentSemanticBytesV1Schema.make(
      resultingDocumentSemanticBytes,
    ),
  };
}

function deleteWrite(
  syscallSequence: bigint,
  documentIdValue: AppDocumentIdV1,
): LogicalAppWriteV1 {
  return {
    kind: "delete",
    syscallSequence: CommitSyscallSequenceV1Schema.make(syscallSequence),
    documentId: documentIdValue,
  };
}

function storedEnvelope(
  journal: CanonicalSessionJournalV1,
  result: CanonicalSuccessfulResultV1,
): CommitEnvelopeV1 {
  return {
    format: COMMIT_ENVELOPE_FORMAT_V1,
    protocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
    sessionId: SESSION_ID,
    attemptFence: ATTEMPT_FENCE,
    finalSyscallSequence: journal.journal.finalSyscallSequence,
    journal: { kind: "storedForSessionAttempt" },
    journalSha256Hex: journal.sha256Hex,
    successfulResult: result.evidence,
  };
}

function inlineEnvelope(
  journal: CanonicalSessionJournalV1,
  result: CanonicalSuccessfulResultV1,
): CommitEnvelopeV1 {
  return {
    ...storedEnvelope(journal, result),
    journal: {
      kind: "inlineUntrusted",
      canonicalJournalBase64Url: CanonicalSessionJournalBase64UrlV1Schema.make(
        base64UrlFromBytes(journal.canonicalBytes),
      ),
    },
  };
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function documentId(index: number): AppDocumentIdV1 {
  const suffix = index.toString(16).padStart(12, "0");
  return decodeAppDocumentIdV1(
    `1:00000000-0000-0000-0000-${suffix}`,
  );
}

function runEffect<A>(
  effect: Effect.Effect<A, CommitProtocolV1Error>,
): Promise<A> {
  return Effect.runPromise(effect);
}

function runFailure<A>(
  effect: Effect.Effect<A, CommitProtocolV1Error>,
): Promise<CommitProtocolV1Error> {
  return Effect.runPromise(Effect.flip(effect));
}
