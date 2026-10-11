import { Cause, Effect, Encoding, Exit, Result, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import * as protocolRoot from "../src/index";
import * as commitProtocolLeaf from "flarex-protocol/commit-protocol";
import {
  COMMIT_ENVELOPE_FORMAT_V1,
  COMMIT_PROTOCOL_EXECUTION_LIMITS_V1,
  COMMIT_PROTOCOL_OPERATIONAL_LIMITS_V1,
  CanonicalSessionJournalBase64UrlV1Schema,
  ApplicationActivationSequenceV1Schema,
  ApplicationActiveHeadSha256HexV1Schema,
  CommitDocumentSemanticBytesV1Schema,
  CommitEnvelopeV1Schema,
  CommitFinalSyscallSequenceV1Schema,
  CommitMaterialWriteEventEvidenceBytesV1Schema,
  CommitProtocolV1Error,
  CommitReadDocumentsV1Schema,
  CommitReadSemanticBytesV1Schema,
  CommitSyscallSequenceV1Schema,
  AdmittedParticipantOperationSchema,
  authenticatedGeneratedInsertionsResult,
  GeneratedInsertionIntentsSchema,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1,
  MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1,
  MAX_COMMIT_RELATION_READ_SYSCALLS_V1,
  MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
  MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_RESULT_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
  MetadataSequenceSchema,
  FiniteMetadataConflictSchema,
  SESSION_JOURNAL_FORMAT,
  SuccessfulResultSha256HexV1Schema,
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
  readIssuedCanonicalSuccessfulResultV1,
  decodeCanonicalSessionJournalEffect,
  decodeCommitEnvelopeV1Effect,
  makeCommitEnvelopeV1Effect,
  measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result,
  normalizeLogicalIndexRangeReadDependenciesV1Result,
  requireStoredForSessionAttemptCommitEnvelopeV1Effect,
  verifySuccessfulResultEvidenceV1Effect,
  type CanonicalSessionJournal,
  type CanonicalSuccessfulResultV1,
  type CommitEnvelopeV1,
  type CommitProtocolV1Issue,
  type LogicalAppWriteV1,
  type LogicalReadDependencyV1,
  type SessionJournal,
} from "../src/commit-protocol";
import {
  decodeAppDocumentIdV1,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
  type AppDocumentIdV1,
} from "../src/app-document-id";
import { AppCreationTimeV1Schema } from "../src/app-document";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "../src/catalog";
import { decodeAppIndexPhysicalSpecSha256HexV1 } from "../src/index-definition";
import type { JsonObject } from "../src/json";
import {
  decodeOrderedIndexBoundHexV1,
  decodeOrderedIndexKeyBytesHexV1,
  decodeOrderedIndexKeyCodecVersion,
} from "../src/ordered-index";
import { CommitSeqSchema } from "../src/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  decodeTransactionSessionIdV1,
} from "../src/transaction-session";
import { FLAREX_VALUE_CODEC_VERSION_V1, isCanonicalFlarexRuntimeObjectV1 } from "../src/value";

const SESSION_ID = decodeTransactionSessionIdV1(
  "018f22e2-58cc-7b2a-91d8-f3f3401a0874",
);
const ATTEMPT_FENCE = TransactionAttemptFenceSchema.make(7n);
const DOCUMENT_A = documentId(1);
const DOCUMENT_B = documentId(2);
const encodeCommitEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

describe("commit protocol C02", () => {
  it("preserves retained participant bytes without inferring insertion origin", async () => {
    for (const version of [1, 2]) {
      const operation = insertionOperation({ format: "flarex.logical-participant-evidence", version,
        indexRanges: [], indexPages: [], uniqueReads: [],
        ...(version === 2 ? { metadataWatermark: "0", metadataDependencies: [] } : {}) });
      const canonical = await runEffect(canonicalizeSessionJournalEffect({
        ...sessionJournal({ finalSyscallSequence: 1n, readDependencies: [missingDependency(DOCUMENT_A)] }),
        participantOperations: [operation],
      }));
      const restored = await runEffect(decodeCanonicalSessionJournalEffect({
        canonicalBytes: canonical.canonicalBytes, expectedSha256Hex: canonical.sha256Hex,
      }));
      const intents = Result.getOrThrow(authenticatedGeneratedInsertionsResult(restored.journal.participantOperations));
      expect(intents.size).toBe(0);
      expect(restored.journal.readDependencies).toEqual([missingDependency(DOCUMENT_A)]);
      const repeated = await runEffect(canonicalizeSessionJournalEffect(restored.journal));
      expect(repeated.canonicalBytes).toEqual(canonical.canonicalBytes);
      expect(repeated.sha256Hex).toBe(canonical.sha256Hex);
      expect(repeated.canonicalText).not.toContain('"generatedInsertions"');
    }
  });

  it("correlates explicit insertion intent while retaining an independent same-ID read", async () => {
    const identity = decodeAppDocumentIdentityV1(DOCUMENT_A);
    const intent = { documentId: DOCUMENT_A, tableId: identity.tableId, rowId: identity.rowId, effectOrdinal: 0 };
    const operation = insertionOperation({ generatedInsertions: [intent] });
    const journal = await runEffect(canonicalizeSessionJournalEffect({
      ...sessionJournal({ finalSyscallSequence: 1n, readDependencies: [missingDependency(DOCUMENT_A)] }),
      participantOperations: [operation],
    }));
    const intents = Result.getOrThrow(authenticatedGeneratedInsertionsResult(journal.journal.participantOperations));
    expect([...intents.values()]).toEqual([{ ...intent,
      origin: { syscallSequence: 1n, sourceBindingSha256Hex: "a".repeat(64) } }]);
    expect(journal.journal.readDependencies).toEqual([missingDependency(DOCUMENT_A)]);
  });

  it("refuses mismatched insertion identity, event ordinal, duplicate origin and overflow", () => {
    const identity = decodeAppDocumentIdentityV1(DOCUMENT_A);
    const intent = { documentId: DOCUMENT_A, tableId: identity.tableId, rowId: identity.rowId, effectOrdinal: 0 };
    expect(authenticatedGeneratedInsertionsResult([insertionOperation({ generatedInsertions: [intent] })]))
      .toMatchObject({ _tag: "Success" });
    for (const generatedInsertions of [
      [{ ...intent, tableId: decodeCatalogTableId(2) }],
      [{ ...intent, rowId: decodeAppDocumentIdentityV1(DOCUMENT_B).rowId }],
      [{ ...intent, effectOrdinal: 1 }], [intent, intent],
    ]) {
      expect(authenticatedGeneratedInsertionsResult([insertionOperation({ generatedInsertions })]))
        .toMatchObject({ _tag: "Failure", failure: { issue: { reason: "invalidSchema", component: "journal" } } });
    }
    expect(Schema.decodeUnknownResult(GeneratedInsertionIntentsSchema)(
      Array.from({ length: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1 }, () => intent),
    )).toMatchObject({ _tag: "Failure" });
  });

  it("retains canonical consumed metadata at syscall zero only with a finite reservation", async () => {
    const dependency = { kind: "metadata", namespace: "binding", ownerKey: "medusa.product",
      contractKey: '["accessFamily","product","ordered","title"]',
      capturedWatermark: Schema.decodeUnknownSync(MetadataSequenceSchema)("7"), observed: { kind: "missing" } } as const;
    const journal = { ...sessionJournal({ finalSyscallSequence: 0n, readDependencies: [dependency, dependency] }),
      finiteMetadataReservationSha256Hex: "a".repeat(64) };
    const canonical = await runEffect(canonicalizeSessionJournalEffect(journal));
    expect(canonical.journal.readDependencies).toEqual([dependency]);
    expect(canonical.canonicalText).toContain('"capturedWatermark":"7"');
    expect((await runEffect(decodeCanonicalSessionJournalEffect({ canonicalBytes: canonical.canonicalBytes,
      expectedSha256Hex: canonical.sha256Hex }))).journal.readDependencies).toEqual([dependency]);
    expect(await runEffect(Effect.result(canonicalizeSessionJournalEffect(sessionJournal({
      finalSyscallSequence: 0n, readDependencies: [dependency],
    }))))).toMatchObject({ _tag: "Failure" });
    expect(await runEffect(Effect.result(canonicalizeSessionJournalEffect({ ...journal,
      readDependencies: [dependency, { ...dependency, observed: { kind: "present", semanticSha256Hex: "b".repeat(64) } }],
    })))).toMatchObject({ _tag: "Failure" });
  });
  it("requires a strict, advancing metadata conflict witness independently of data sequences", () => {
    const witness = { kind: "metadata", namespace: "application", ownerKey: "application", contractKey: '["function","users:create"]',
      capturedMetadataWatermark: "5", lastChangedMetadataSequence: "6" };
    expect(Schema.decodeUnknownResult(FiniteMetadataConflictSchema)(witness)).toMatchObject({ _tag: "Success" });
    expect(Schema.decodeUnknownResult(FiniteMetadataConflictSchema)({ ...witness, lastChangedMetadataSequence: "5" }))
      .toMatchObject({ _tag: "Failure" });
    expect(Schema.decodeUnknownResult(FiniteMetadataConflictSchema)({ ...witness, unexpected: true }))
      .toMatchObject({ _tag: "Failure" });
  });
  it("pins canonical journal bytes and digest with result evidence outside the journal", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
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
      `{"finalSyscallSequence":"2","format":"${SESSION_JOURNAL_FORMAT}",` +
      '"operationUsage":{"participantWorkBytes":0,"participantWorkCalls":0,' +
      '"receiptEvidenceBytes":0},' +
      '"participantOperations":[],"protocolVersion":1,"readDependencies":[{' +
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
      "c7bc3855b347844b0a1d15d347e8d46eb8d99f4d2dc2e19f80e74b4992cbce1d",
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
    const first = await runEffect(canonicalizeSessionJournalEffect(
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
    const second = await runEffect(canonicalizeSessionJournalEffect(
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

  it("pins, merges, measures, validates, and bounds indexed-range evidence", async () => {
    const range = indexRangeDependency({
      lower: {
        kind: "key",
        encodedKey: decodeOrderedIndexBoundHexV1("10"),
        inclusive: true,
      },
      upper: {
        kind: "position",
        encodedKey: decodeOrderedIndexKeyBytesHexV1("20"),
        rowId: decodeAppDocumentIdentityV1(DOCUMENT_A).rowId,
        inclusive: true,
      },
    });
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [range],
      }),
    ));
    const rangeCanonicalText =
      '{"direction":"asc","indexDefinitionId":1,"keyCodecVersion":1,' +
      '"kind":"appIndexRange","lower":{"encodedKey":"10",' +
      '"inclusive":true,"kind":"key"},"physicalSpecSha256Hex":' +
      `"${"1".repeat(64)}","tableId":1,"upper":` +
      '{"encodedKey":"20","inclusive":true,"kind":"position",' +
      '"rowId":"00000000000000000000000000000001"}}';
    expect(canonical.canonicalText).toBe(
      '{"finalSyscallSequence":"1","format":"flarex.session-journal",' +
      '"operationUsage":{"participantWorkBytes":0,"participantWorkCalls":0,' +
      '"receiptEvidenceBytes":0},' +
      '"participantOperations":[],"protocolVersion":1,"readDependencies":[' + rangeCanonicalText +
      '],"readUsage":{"documentsRead":0,"semanticBytesRead":0},' +
      '"valueCodecVersion":1,"writes":[]}',
    );
    expect(canonical.sha256Hex).toBe(
      "e62abc84e8782241bc20c9be56bbe1eda9897afddb061f4f43840f379bded2d9",
    );

    const measured = measureLogicalIndexRangeReadDependencyEvidenceBytesV1Result(
      range,
    );
    expect(Result.getOrThrow(measured)).toBe(
      new TextEncoder().encode(rangeCanonicalText).byteLength,
    );

    const merged = Result.getOrThrow(
      normalizeLogicalIndexRangeReadDependenciesV1Result([
        range,
        indexRangeDependency({
          lower: {
            kind: "key",
            encodedKey: decodeOrderedIndexBoundHexV1("20"),
            inclusive: true,
          },
          upper: {
            kind: "key",
            encodedKey: decodeOrderedIndexBoundHexV1("30"),
            inclusive: false,
          },
        }),
      ]),
    );
    expect(merged).toEqual([{
      ...range,
      upper: {
        kind: "key",
        encodedKey: decodeOrderedIndexBoundHexV1("30"),
        inclusive: false,
      },
    }]);

    const invalid = normalizeLogicalIndexRangeReadDependenciesV1Result([
      indexRangeDependency({
        lower: {
          kind: "key",
          encodedKey: decodeOrderedIndexBoundHexV1("20"),
          inclusive: true,
        },
        upper: {
          kind: "key",
          encodedKey: decodeOrderedIndexBoundHexV1("10"),
          inclusive: false,
        },
      }),
    ]);
    expect(Result.isFailure(invalid)).toBe(true);
    if (Result.isSuccess(invalid)) throw new Error("expected invalid range");
    expect(invalid.failure.issue).toMatchObject({
      reason: "invalidIndexRangeDependency",
    });

    const overLimit = await runFailure(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: Array.from(
          { length: MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1 },
          (_, index) => indexRangeDependency({
            indexDefinitionId: index + 1,
          }),
        ),
      }),
    ));
    expect(overLimit.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "indexRangeReadDependencies",
      observed: MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 + 1,
    });

    const maximumLowerBound = decodeOrderedIndexBoundHexV1(
      "00".repeat(2_049),
    );
    const maximumUpperBound = decodeOrderedIndexBoundHexV1(
      "ff".repeat(2_049),
    );
    const evidenceFailure = await runFailure(
      canonicalizeSessionJournalEffect(sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: Array.from(
          { length: MAX_COMMIT_INDEX_RANGE_READ_DEPENDENCIES_V1 },
          (_, index) => indexRangeDependency({
            indexDefinitionId: index + 1,
            lower: {
              kind: "key",
              encodedKey: maximumLowerBound,
              inclusive: true,
            },
            upper: {
              kind: "key",
              encodedKey: maximumUpperBound,
              inclusive: false,
            },
          }),
        ),
      })),
    );
    expect(evidenceFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "indexRangeDependencyEvidenceBytes",
      maximum: MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
    });
    if (evidenceFailure.issue.reason === "limitExceeded") {
      expect(evidenceFailure.issue.observed).toBeGreaterThan(
        MAX_COMMIT_INDEX_RANGE_DEPENDENCY_EVIDENCE_BYTES_V1,
      );
    }
  });

  it("canonicalizes and bounds exact incoming relation dependencies", async () => {
    const relationA = relationIncomingDependency(2, 2, 9n);
    const relationB = relationIncomingDependency(1, 3, 0n);
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [relationA, relationB],
      }),
    ));

    expect(canonical.journal.readDependencies).toEqual([
      relationB,
      relationA,
    ]);

    const coalesced = await runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          relationIncomingDependency(1, 3, 0n),
          relationIncomingDependency(1, 3, 0n),
        ],
      }),
    ));
    expect(coalesced.journal.readDependencies).toEqual([
      relationIncomingDependency(1, 3, 0n),
    ]);

    const conflicting = await runFailure(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          relationIncomingDependency(1, 3, 0n),
          relationIncomingDependency(1, 3, 7n),
        ],
      }),
    ));
    expect(conflicting.issue).toEqual({
      reason: "conflictingApplicationRelationReadDependency",
      edgeDefinitionId: decodeCatalogEdgeDefinitionId(1),
      targetRowId: decodeAppRowIdHexV1(
        "00000000000000000000000000000003",
      ),
    });

    const conflictingSelection = await runFailure(
      canonicalizeSessionJournalEffect(sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          relationIncomingDependency(1, 3, 0n),
          relationIncomingDependency(2, 4, 0n, {
            activationSequence: 18n,
          }),
        ],
      })),
    );
    expect(conflictingSelection.issue).toEqual({
      reason: "conflictingApplicationRelationActiveSelection",
      edgeDefinitionId: decodeCatalogEdgeDefinitionId(2),
      targetRowId: decodeAppRowIdHexV1(
        "00000000000000000000000000000004",
      ),
    });

    const conflictingSelectionDigest = await runFailure(
      canonicalizeSessionJournalEffect(sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          relationIncomingDependency(1, 3, 0n),
          relationIncomingDependency(1, 3, 0n, {
            activeHeadSha256Hex: "cd".repeat(32),
          }),
        ],
      })),
    );
    expect(conflictingSelectionDigest.issue).toEqual({
      reason: "conflictingApplicationRelationReadDependency",
      edgeDefinitionId: decodeCatalogEdgeDefinitionId(1),
      targetRowId: decodeAppRowIdHexV1(
        "00000000000000000000000000000003",
      ),
    });

    const completeRelationDependency = relationIncomingDependency(1, 3, 0n);
    const {
      activationSequence: _omittedActivationSequence,
      ...missingSelectionDependency
    } = completeRelationDependency;
    const missingSelection = await runFailure(
      canonicalizeSessionJournalEffect({
        ...sessionJournal({ finalSyscallSequence: 1n }),
        readDependencies: [missingSelectionDependency],
      }),
    );
    expect(missingSelection.issue).toEqual({
      reason: "invalidSchema",
      component: "journal",
    });

    const malformedSelection = await runFailure(
      canonicalizeSessionJournalEffect({
        ...sessionJournal({ finalSyscallSequence: 1n }),
        readDependencies: [{
          ...completeRelationDependency,
          activeHeadSha256Hex: "ab".repeat(31),
        }],
      }),
    );
    expect(malformedSelection.issue).toEqual({
      reason: "invalidSchema",
      component: "journal",
    });

    const overLimit = await runFailure(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: Array.from(
          { length: MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1 },
          (_, index) => relationIncomingDependency(index + 1, 1, 0n),
        ),
      }),
    ));
    expect(overLimit.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "relationReadDependencies",
      observed: MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1 + 1,
    });
  });

  it("binds insert creation time into stable canonical journal evidence", async () => {
    const first = await runEffect(canonicalizeSessionJournalEffect(
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
    const reordered = await runEffect(canonicalizeSessionJournalEffect(
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
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
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        writes: [insertWrite(1n, DOCUMENT_A, mutableFields, 128)],
      }),
    ));
    mutableFields.name = "after";

    const exposed = canonical.canonicalBytes;
    exposed.fill(0);
    const decoded = await runEffect(decodeCanonicalSessionJournalEffect({
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
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({ finalSyscallSequence: 0n }),
    ));
    const nonCanonical = new TextEncoder().encode(`${canonical.canonicalText}\n`);
    const nonCanonicalFailure = await runFailure(
      decodeCanonicalSessionJournalEffect({
        canonicalBytes: nonCanonical,
        expectedSha256Hex: canonical.sha256Hex,
      }),
    );
    expect(nonCanonicalFailure.issue).toEqual({
      reason: "nonCanonical",
      component: "journal",
    });

    const digestFailure = await runFailure(
      decodeCanonicalSessionJournalEffect({
        canonicalBytes: canonical.canonicalBytes,
        expectedSha256Hex: "0".repeat(64),
      }),
    );
    expect(digestFailure.issue).toEqual({
      reason: "digestMismatch",
      component: "journal",
    });

    const versionFailure = await runFailure(
      canonicalizeSessionJournalEffect({
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
      canonicalizeSessionJournalEffect({
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
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
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

    expect(canonical.journal.readDependencies.map((item) => {
      if (item.kind !== "appRowPoint") {
        throw new Error("Expected only point dependencies in this fixture.");
      }
      return item.observed;
    })).toEqual([
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(Object.assign(
        Object.create(pollutedPrototype),
        sessionJournal(),
      )),
    );
    expect(inheritedTraversalFailure.issue).toEqual({
      reason: "invalidSchema",
      component: "journal",
    });
  });

  it("keeps Convex execution limits and adds bounded private indexed reads", async () => {
    expect(COMMIT_PROTOCOL_EXECUTION_LIMITS_V1).toEqual({
      readDocuments: 32_000,
      readSemanticBytes: 16_777_216,
      pointReadDependencies: 4_096,
      indexedQuerySyscalls: 32,
      indexedQueryPageSize: 128,
      indexRangeReadDependencies: 32,
      relationReadSyscalls: 128,
      relationReadDependencies: 128,
      relationBaseOccurrences: 4_096,
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
      indexRangeDependencyEvidenceBytes: 262_144,
      materialWriteEventEvidenceBytes: 67_108_864,
      receiptEvidenceBytes: 67_108_864,
    });
    expect(MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1).toBe(
      67_108_864,
    );
    expect(MAX_COMMIT_RELATION_READ_SYSCALLS_V1).toBe(128);
    expect(MAX_COMMIT_RELATION_READ_DEPENDENCIES_V1).toBe(128);
    expect(MAX_COMMIT_RELATION_BASE_OCCURRENCES_V1).toBe(4_096);
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
    await expect(runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: 1n,
        readDependencies: [
          ...exactDependencies,
          indexRangeDependency(),
        ],
      }),
    ))).resolves.toBeDefined();
    const dependencyFailure = await runFailure(
      canonicalizeSessionJournalEffect(sessionJournal({
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
    await expect(runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({
        finalSyscallSequence: BigInt(MAX_COMMIT_WRITE_OPERATIONS_V1),
        writes: exactWrites,
      }),
    ))).resolves.toBeDefined();
    const writeCountFailure = await runFailure(
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(sessionJournal({
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
      canonicalizeSessionJournalEffect(sessionJournal({
        finalSyscallSequence: 1n,
        readDocuments: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
      })),
    );
    expect(readUsageFailure.issue).toMatchObject({
      reason: "limitExceeded",
      dimension: "readDocuments",
    });

    const zeroSequenceReadBytesFailure = await runFailure(
      canonicalizeSessionJournalEffect(sessionJournal({
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

    const base64UrlFailure = await runFailure(
      verifySuccessfulResultEvidenceV1Effect({
        ...result.evidence,
        canonicalValueBase64Url: "AB",
      }),
    );
    expect(base64UrlFailure.issue).toEqual({
      reason: "invalidBase64Url",
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
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
      sessionJournal({ finalSyscallSequence: 0n }),
    ));
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect("done"),
    );
    const inline = await runEffect(makeCommitEnvelopeV1Effect(
      inlineEnvelope(canonical, result),
    ));

    expect(inline.journal.kind).toBe("inlineUntrusted");
    const dormant = await runFailure(
      requireStoredForSessionAttemptCommitEnvelopeV1Effect(inline),
    );
    expect(dormant.issue).toEqual({
      reason: "inlineJournalCarriageDormant",
    });

  });

  it("accepts only locator-free stored carriage and keeps the leaf out of the root barrel", async () => {
    const canonical = await runEffect(canonicalizeSessionJournalEffect(
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

    expect(commitProtocolLeaf.SessionJournalSchema).toBeDefined();
    expect("SessionJournalSchema" in protocolRoot).toBe(false);
    expect("PreparedCommitV1" in commitProtocolLeaf).toBe(false);
  });
});

function insertionOperation(dependencyEvidence: JsonObject) {
  return Schema.decodeUnknownSync(AdmittedParticipantOperationSchema)({
    syscallSequence: "1", participant: "fixture.participant", method: "insert",
    profileRevision: "b".repeat(64), admissionBundleSha256Hex: "c".repeat(64),
    requestSha256Hex: "d".repeat(64), resultSha256Hex: "e".repeat(64), eventIntents: [],
    sourceContributions: [{ sourceKey: "fixture.source", sourceSha256Hex: "f".repeat(64),
      sourceBindingSha256Hex: "a".repeat(64), bindingHead: { sequence: "1", sha256: "1".repeat(64) },
      methods: ["insert"], dependencyEvidence,
      effects: [{ effectOrdinal: 0, tableId: 1, documentId: DOCUMENT_A, operation: "insert", before: null,
        after: { _id: DOCUMENT_A, _creationTime: 1, name: "inserted" } }],
    }],
  });
}

function sessionJournal(options: {
  readonly finalSyscallSequence?: bigint;
  readonly readDependencies?: ReadonlyArray<LogicalReadDependencyV1>;
  readonly readDocuments?: number;
  readonly readSemanticBytes?: number;
  readonly writes?: ReadonlyArray<LogicalAppWriteV1>;
} = {}): SessionJournal {
  return {
    format: SESSION_JOURNAL_FORMAT,
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
    operationUsage: { receiptEvidenceBytes: 0, participantWorkBytes: 0,
      participantWorkCalls: 0 },
    participantOperations: [],
  } satisfies SessionJournal;
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

function indexRangeDependency(options: {
  readonly indexDefinitionId?: number;
  readonly lower?: Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appIndexRange" }
  >["lower"];
  readonly upper?: Extract<
    LogicalReadDependencyV1,
    { readonly kind: "appIndexRange" }
  >["upper"];
} = {}): Extract<
  LogicalReadDependencyV1,
  { readonly kind: "appIndexRange" }
> {
  return {
    kind: "appIndexRange",
    tableId: decodeCatalogTableId(1),
    indexDefinitionId: decodeCatalogIndexDefinitionId(
      options.indexDefinitionId ?? 1,
    ),
    keyCodecVersion: decodeOrderedIndexKeyCodecVersion(1),
    physicalSpecSha256Hex:
      decodeAppIndexPhysicalSpecSha256HexV1("1".repeat(64)),
    direction: "asc",
    lower: options.lower ?? null,
    upper: options.upper ?? null,
  };
}

function relationIncomingDependency(
  edgeDefinitionId: number,
  targetRowId: number,
  observedAdjacencyVersion: bigint,
  activeSelection: Readonly<{
    readonly activationSequence?: bigint;
    readonly activeHeadSha256Hex?: string;
  }> = {},
): Extract<
  LogicalReadDependencyV1,
  { readonly kind: "appRelationIncoming" }
> {
  return {
    kind: "appRelationIncoming",
    edgeDefinitionId: decodeCatalogEdgeDefinitionId(edgeDefinitionId),
    targetRowId: decodeAppRowIdHexV1(
      targetRowId.toString(16).padStart(32, "0"),
    ),
    observedAdjacencyVersion: CommitSeqSchema.make(observedAdjacencyVersion),
    activationSequence: ApplicationActivationSequenceV1Schema.make(
      activeSelection.activationSequence ?? 17n,
    ),
    activeHeadSha256Hex: ApplicationActiveHeadSha256HexV1Schema.make(
      activeSelection.activeHeadSha256Hex ?? "ab".repeat(32),
    ),
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
  journal: CanonicalSessionJournal,
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
  journal: CanonicalSessionJournal,
  result: CanonicalSuccessfulResultV1,
): CommitEnvelopeV1 {
  return {
    ...storedEnvelope(journal, result),
    journal: {
      kind: "inlineUntrusted",
      canonicalJournalBase64Url: CanonicalSessionJournalBase64UrlV1Schema.make(
        Encoding.encodeBase64Url(journal.canonicalBytes),
      ),
    },
  };
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


describe("issued successful result handoff", () => {
  it("retains exact canonical bytes while rejecting lookalike issuance and detached mutations", async () => {
    const input = { nested: { name: "original" } };
    const result = await Effect.runPromise(canonicalizeSuccessfulResultV1Effect(input));
    const originalBytes = result.canonicalBytes;
    const originalEvidence = result.evidence;
    const issued = readIssuedCanonicalSuccessfulResultV1(result);
    expect(issued?.result).toBe(result);
    expect(issued?.value).toEqual(input);
    expect(issued?.value).toBe(issued?.value);
    input.nested.name = "changed";
    result.canonicalBytes.fill(0);
    expect(result.valueJson).toEqual({ nested: { name: "original" } });
    expect(result.canonicalBytes).toEqual(originalBytes);
    expect(result.evidence).toEqual(originalEvidence);
    expect(readIssuedCanonicalSuccessfulResultV1({ ...result })).toBeUndefined();
    const detached = structuredClone(result);
    expect(readIssuedCanonicalSuccessfulResultV1(detached)).toBeUndefined();
    const verified = await Effect.runPromise(verifySuccessfulResultEvidenceV1Effect(detached.evidence));
    expect(verified.canonicalBytes).toEqual(originalBytes);
    expect(verified.evidence).toEqual(originalEvidence);
    Reflect.set(detached.evidence, "sha256Hex", "0".repeat(64));
    await expect(Effect.runPromise(verifySuccessfulResultEvidenceV1Effect(detached.evidence))).rejects.toMatchObject({
      issue: { reason: "digestMismatch", component: "successfulResult" },
    });
  });

  it("preserves the runtime value domain and never exposes retained binary leaves", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const result = await runEffect(canonicalizeSuccessfulResultV1Effect({
      bigint: 42n, bytes, nested: [{ bytes }], nan: NaN,
      negativeZero: -0, negativeInfinity: -Infinity, positiveInfinity: Infinity,
      immutable: { label: "retained" },
    }));
    const issued = readIssuedCanonicalSuccessfulResultV1(result);
    if (issued === undefined) throw new Error("Expected exact successful-result issuance");
    const first = issued.value;
    if (!isCanonicalFlarexRuntimeObjectV1(first) || !(first.bytes instanceof ArrayBuffer) ||
      !Array.isArray(first.nested) || !isCanonicalFlarexRuntimeObjectV1(first.nested[0]) ||
      !(first.nested[0].bytes instanceof ArrayBuffer)) throw new Error("Expected the canonical binary-bearing runtime tree");
    expect(first.bigint).toBe(42n);
    expect(Number.isNaN(first.nan)).toBe(true);
    expect(Object.is(first.negativeZero, -0)).toBe(true);
    expect(first.negativeInfinity).toBe(-Infinity);
    expect(first.positiveInfinity).toBe(Infinity);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.nested)).toBe(true);
    expect(Reflect.set(first, "bigint", 0n)).toBe(false);
    const originalBytes = result.canonicalBytes;
    new Uint8Array(bytes).fill(4);
    new Uint8Array(first.bytes).fill(5);
    new Uint8Array(first.nested[0].bytes).fill(6);
    result.canonicalBytes.fill(7);
    const second = issued.value;
    if (!isCanonicalFlarexRuntimeObjectV1(second) || !(second.bytes instanceof ArrayBuffer) ||
      !Array.isArray(second.nested) || !isCanonicalFlarexRuntimeObjectV1(second.nested[0]) ||
      !(second.nested[0].bytes instanceof ArrayBuffer)) throw new Error("Expected a second detached runtime tree");
    expect(new Uint8Array(second.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(second.nested[0].bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(second.bytes).not.toBe(first.bytes);
    expect(second.immutable).toBe(first.immutable);
    expect(result.canonicalBytes).toEqual(originalBytes);
    expect(result).not.toHaveProperty("value");
    expect(readIssuedCanonicalSuccessfulResultV1(Object.freeze({ ...result }))).toBeUndefined();
    expect(readIssuedCanonicalSuccessfulResultV1(structuredClone(issued))).toBeUndefined();

    const foreign = structuredClone(result);
    const restored = await runEffect(verifySuccessfulResultEvidenceV1Effect(foreign.evidence));
    const restoredIssued = readIssuedCanonicalSuccessfulResultV1(restored);
    const restoredValue = restoredIssued?.value;
    if (restoredValue === undefined || !isCanonicalFlarexRuntimeObjectV1(restoredValue) || !(restoredValue.bytes instanceof ArrayBuffer))
      throw new Error("Expected a fully verified foreign runtime tree");
    new Uint8Array(restoredValue.bytes).fill(8);
    const restoredAgain = restoredIssued?.value;
    if (restoredAgain === undefined || !isCanonicalFlarexRuntimeObjectV1(restoredAgain) || !(restoredAgain.bytes instanceof ArrayBuffer))
      throw new Error("Expected a second fully verified foreign runtime tree");
    expect(new Uint8Array(restoredAgain.bytes)).toEqual(new Uint8Array([1, 2, 3]));
    expect(readIssuedCanonicalSuccessfulResultV1(foreign)).toBeUndefined();
  });

  it("refuses an unsupported foreign version before inspecting its value body", async () => {
    let bodyReads = 0;
    const foreign = {
      valueCodecVersion: 2,
      get canonicalValueBase64Url() { bodyReads++; throw new Error("Later body must remain untouched"); },
      sha256Hex: "0".repeat(64),
    };
    const failure = await runFailure(verifySuccessfulResultEvidenceV1Effect(foreign));
    expect(failure.issue).toMatchObject({ reason: "unsupportedVersion", component: "successfulResult", field: "valueCodecVersion" });
    expect(bodyReads).toBe(0);
    expect(readIssuedCanonicalSuccessfulResultV1(foreign)).toBeUndefined();
  });

  it("preserves unexpected hashing defects without issuing a successful runtime projection", async () => {
    const defect = new Error("Unexpected successful-result hashing defect");
    const digest = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(defect);
    try {
      const exit = await Effect.runPromiseExit(canonicalizeSuccessfulResultV1Effect({ value: 42n }));
      if (Exit.isSuccess(exit)) throw new Error("Expected the original hash defect");
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(defect);
    } finally { digest.mockRestore(); }
  });
});
