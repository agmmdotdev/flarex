import {
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  canonicalizeSessionJournalEffect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import { expect, it, vi, afterAll, beforeAll, describe } from "vitest";
import { Cause, Effect, Exit } from "effect";
import {
  SessionJournalStorageCorruptionV1Error,
  type SessionJournalPointOperationV1,
} from "../../../src/execution/journal/api";
import { sessionJournalReceiptScenario } from "./sessionJournalReceiptScenario";
import { verifyJournalEventEvidence } from "./journalEvidenceScenario";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "../../support/effectTestRuntime";
import {
  SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
} from "../../application/revision/applicationRevisionSyscallValidatorTestSupport";
import {
  syscallSequence,
  documentId,
  requireSeededDocumentId,
  requireInsertedDocumentId,
  uuidSequence,
} from "./journalTestSupport";
import {
  createSessionJournalStorePGliteFixture,
  type SessionJournalStorePGliteFixture,
} from "./journalFixture";

describe("Journal receipt evidence (PGlite)", () => {
  let fixture: SessionJournalStorePGliteFixture;
  let persistence: SessionJournalStorePGliteFixture["persistence"];
  let scenario: SessionJournalStorePGliteFixture["scenario"];
  let journalCounts: SessionJournalStorePGliteFixture["journalCounts"];
  let journalRoot: SessionJournalStorePGliteFixture["journalRoot"];
  let eventEvidenceByteLengths: SessionJournalStorePGliteFixture["eventEvidenceByteLengths"];

  beforeAll(async () => {
    fixture = await createSessionJournalStorePGliteFixture();
    ({ persistence, scenario, journalCounts, journalRoot, eventEvidenceByteLengths } = fixture);
  });

  afterAll(async () => {
    await fixture?.close();
  });

  it("rolls back a receipt upsert with its root and material writes", async () => {
    await sessionJournalReceiptScenario(persistence, await scenario("receipt_upsert"));
  });

  it("retains every accepted receipt for exact replay and mismatch checks", async () => {
    const current = await scenario("latest_receipt");
    const firstDocumentId = documentId(current.tableId, 101);
    const secondDocumentId = documentId(current.tableId, 102);
    const firstRequest = Object.freeze({
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: firstDocumentId,
    } satisfies SessionJournalPointOperationV1);

    await expect(
      runEffect(current.store.runPointOperationEffect(
        current.table,
        firstRequest,
        SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
      )),
    ).resolves.toEqual({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "missing", document: null },
    });
    await expect(
      runPointOperation(current.store, current.table, firstRequest),
    ).resolves.toEqual({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "missing", document: null },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "sequenceRejected",
      issue: { reason: "requestMismatch", syscallSequence: 1n },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(3n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "sequenceRejected",
      issue: { reason: "sequenceGap", actual: 3n, expectedNext: 2n },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "completed",
      delivery: "executed",
      outcome: { kind: "missing" },
    });
    await expect(
      runPointOperation(current.store, current.table, firstRequest),
    ).resolves.toMatchObject({
      kind: "completed",
      delivery: "replayed",
      outcome: { kind: "missing", document: null },
    });
    await expect(runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: secondDocumentId,
    })).resolves.toMatchObject({
      kind: "sequenceRejected",
      issue: { reason: "requestMismatch", syscallSequence: 1n },
    });

    const counts = await journalCounts(current.anchor.sessionId);
    expect(counts).toMatchObject({ roots: 1, receipts: 2, points: 2 });
    const receipt = await persistence.query<{
      last_syscall_sequence: string;
      operation_kind: string;
    }>(
      `
        select last_syscall_sequence::text, operation_kind
        from fx_system_tx_journal_receipt
        where session_id = $1
        order by last_syscall_sequence
      `,
      [current.anchor.sessionId],
    );
    expect(receipt.rows).toEqual([
      { last_syscall_sequence: "1", operation_kind: "get" },
      { last_syscall_sequence: "2", operation_kind: "get" },
    ]);
  });

  it("recomputes detached event evidence during seal preparation", async () => {
    const current = await scenario("event_evidence_seal_recompute", {
      randomUuid: uuidSequence(
        "86000000-0000-4000-8000-000000000099",
      ),
    });
    await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "recompute" },
    });
    const [eventBytes] = await eventEvidenceByteLengths(
      current.anchor.sessionId,
    );
    if (eventBytes === undefined) throw new Error("Missing event evidence.");
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      material_write_event_evidence_bytes: eventBytes,
    });
    await expect(prepareSeal(current.store, current.attempt)).resolves.toBeDefined();

    await persistence.query(
      `
        update fx_system_tx_journal
        set material_write_event_evidence_bytes =
          material_write_event_evidence_bytes + 1
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    await expect(prepareSeal(current.store, current.attempt)).rejects.toMatchObject({
      reason: "materialWriteEventEvidenceBytesMismatch",
    });
  });

  it("authenticates canonical write bytes and scalar metadata without a JSON mirror", async () => {
    await verifyJournalEventEvidence(persistence, await scenario("canonical_event_only"));
  });

  it("maps malformed receipt, overlay, and write evidence at their Effect adapters", async () => {
    const invalidDigest = new Uint8Array(32);
    const receipt = await scenario("seal_invalid_receipt_evidence");
    await runPointOperation(receipt.store, receipt.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(receipt.tableId, 402),
    });
    await persistence.query(
      `
        update fx_system_tx_journal_receipt
        set request_sha256 = $2
        where session_id = $1
      `,
      [receipt.anchor.sessionId, invalidDigest],
    );
    await expect(runFailure(receipt.store.prepareSealEffect(
      receipt.attempt,
    ))).resolves.toMatchObject({
      reason: "latestReceiptEvidenceInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);

    const overlay = await scenario("seal_invalid_overlay_evidence");
    await runPointOperation(overlay.store, overlay.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "overlay" },
    });
    await persistence.query(
      `
        update fx_system_tx_journal_point
        set overlay_value_sha256 = $2
        where session_id = $1
      `,
      [overlay.anchor.sessionId, invalidDigest],
    );
    await expect(runFailure(overlay.store.prepareSealEffect(
      overlay.attempt,
    ))).resolves.toMatchObject({
      reason: "liveOverlaySemanticBytesMismatch",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);

    const write = await scenario("seal_invalid_write_evidence");
    await runPointOperation(write.store, write.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "write" },
    });
    await persistence.query(
      `
        update fx_system_tx_journal_write_event
        set event_sha256 = $2
        where session_id = $1
      `,
      [write.anchor.sessionId, invalidDigest],
    );
    await expect(runFailure(write.store.prepareSealEffect(
      write.attempt,
    ))).resolves.toMatchObject({
      reason: "logicalWriteEventInvalid",
    } satisfies Partial<SessionJournalStorageCorruptionV1Error>);
  });

  it("preserves an unexpected evidence-hashing rejection as a defect", async () => {
    const current = await scenario("seal_evidence_hash_defect");
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 403),
    });
    const defect = new Error("seal evidence hashing unavailable");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
      .mockRejectedValue(defect);
    try {
      const exit = await Effect.runPromiseExit(
        current.store.prepareSealEffect(current.attempt),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.reasons).toHaveLength(1);
        const reason = exit.cause.reasons[0];
        expect(reason !== undefined && Cause.isDieReason(reason)).toBe(true);
        if (reason !== undefined && Cause.isDieReason(reason)) {
          expect(reason.defect).toBe(defect);
        }
      }
    } finally {
      digest.mockRestore();
    }
  });

  it("collects only max+1 child rows and rejects cardinality before decoding corrupt evidence", async () => {
    const excessPoints = await scenario("seal_excess_points");
    await persistence.query(
      `
        insert into fx_system_tx_journal_point (
          scope_uuid,
          session_id,
          attempt_fence,
          table_id,
          row_id,
          dependency_kind,
          dependency_revision_commit_seq,
          overlay_kind,
          overlay_creation_time,
          overlay_value_codec_version,
          overlay_value_json,
          overlay_value_bytes,
          overlay_value_sha256,
          overlay_semantic_bytes,
          created_at,
          updated_at
        )
        select root.scope_uuid,
               root.session_id,
               root.attempt_fence,
               $2,
               decode(lpad(to_hex(series.value), 32, '0'), 'hex'),
               'missing_no_visible_revision',
               null,
               'none',
               null,
               null,
               null,
               null,
               null,
               null,
               root.created_at,
               root.updated_at
        from fx_system_tx_journal root
        cross join generate_series(1, $3) as series(value)
        where root.session_id = $1
      `,
      [
        excessPoints.anchor.sessionId,
        excessPoints.tableId,
        MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1,
      ],
    );
    await expect(
      prepareSeal(excessPoints.store, excessPoints.attempt),
    ).rejects.toMatchObject({ reason: "pointDependencyCountMismatch" });

    const excessEvents = await scenario("seal_excess_events");
    await persistence.query(
      `
        insert into fx_system_tx_journal_write_event (
          scope_uuid,
          session_id,
          attempt_fence,
          syscall_sequence,
          write_kind,
          event_codec_version,
          event_bytes,
          event_sha256,
          created_at
        )
        select root.scope_uuid,
               root.session_id,
               root.attempt_fence,
               series.value,
               'delete',
               2,
               decode('00', 'hex'),
               decode(repeat('00', 32), 'hex'),
               root.created_at
        from fx_system_tx_journal root
        cross join generate_series(1, $2) as series(value)
        where root.session_id = $1
      `,
      [excessEvents.anchor.sessionId, MAX_COMMIT_WRITE_OPERATIONS_V1 + 1],
    );
    await expect(
      prepareSeal(excessEvents.store, excessEvents.attempt),
    ).rejects.toMatchObject({ reason: "writeOperationCountMismatch" });
  }, 60_000);

  it("cascades exact-attempt child evidence when the journal root is reclaimed", async () => {
    const current = await scenario("cleanup_cascade", {
      randomUuid: uuidSequence(
        "86000000-0000-4000-8000-000000000001",
      ),
    });
    const inserted = await runPointOperation(current.store, current.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "temporary" },
    });
    const documentId = requireInsertedDocumentId(inserted);
    await runPointOperation(current.store, current.table, {
      kind: "get",
      syscallSequence: syscallSequence(2n),
      documentId,
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      roots: 1,
      receipts: 2,
      points: 1,
      events: 1,
      sessions: 1,
    });

    await persistence.query(
      `delete from fx_system_tx_journal where session_id = $1`,
      [current.anchor.sessionId],
    );
    expect(await journalCounts(current.anchor.sessionId)).toEqual({
      roots: 0,
      receipts: 0,
      points: 0,
      events: 0,
      sessions: 1,
    });
  });

  it("makes every nullable journal CHECK branch and event-byte bound fail closed", async () => {
    const sealed = await scenario("nullable_checks_sealed", {
      randomUuid: uuidSequence(
        "88000000-0000-4000-8000-000000000001",
      ),
    });
    await runPointOperation(sealed.store, sealed.table, {
      kind: "insert",
      syscallSequence: syscallSequence(1n),
      fields: { name: "sealed" },
    });
    const prepared = await prepareSeal(sealed.store, sealed.attempt);
    const canonicalJournal = await runEffect(
      canonicalizeSessionJournalEffect(prepared.journal),
    );
    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await completeSeal(sealed.store,
      prepared.preparation,
      canonicalJournal,
      successfulResult,
    );

    const sealedNullableColumns = [
      "sealed_journal_bytes",
      "sealed_journal_sha256",
      "sealed_result_value_codec_version",
      "sealed_result_semantic_bytes",
      "sealed_result_bytes",
      "sealed_result_sha256",
      "sealed_at",
    ] as const;
    for (const column of sealedNullableColumns) {
      await expect(persistence.query(
        `update fx_system_tx_journal set ${column} = null where session_id = $1`,
        [sealed.anchor.sessionId],
      )).rejects.toThrow();
    }

    const point = await scenario("nullable_checks_point", {
      seedFields: { name: "point" },
    });
    await runPointOperation(point.store, point.table, {
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: requireSeededDocumentId(point),
    });
    await expect(persistence.query(
      `
        update fx_system_tx_journal_point
        set dependency_revision_commit_seq = null
        where session_id = $1
          and dependency_kind = 'present'
      `,
      [point.anchor.sessionId],
    )).rejects.toThrow();
    await runPointOperation(point.store, point.table, {
      kind: "patch",
      syscallSequence: syscallSequence(2n),
      documentId: requireSeededDocumentId(point),
      patch: { name: "live-overlay" },
    });
    await persistence.query(
      `
        update fx_system_tx_journal_point
        set dependency_kind = 'missing_tombstone',
            dependency_revision_commit_seq = 1
        where session_id = $1
      `,
      [point.anchor.sessionId],
    );
    await expect(persistence.query(
      `
        update fx_system_tx_journal_point
        set dependency_revision_commit_seq = null
        where session_id = $1
          and dependency_kind = 'missing_tombstone'
      `,
      [point.anchor.sessionId],
    )).rejects.toThrow();

    const liveOverlayColumns = [
      "overlay_creation_time",
      "overlay_value_codec_version",
      "overlay_value_json",
      "overlay_value_bytes",
      "overlay_value_sha256",
      "overlay_semantic_bytes",
    ] as const;
    for (const column of liveOverlayColumns) {
      await expect(persistence.query(
        `
          update fx_system_tx_journal_point
          set ${column} = null
          where session_id = $1 and overlay_kind = 'live'
        `,
        [point.anchor.sessionId],
      )).rejects.toThrow();
    }

    const bounds = await scenario("event_evidence_sql_bounds");
    await expect(persistence.query(
      `
        update fx_system_tx_journal
        set material_write_event_evidence_bytes = $2
        where session_id = $1
      `,
      [
        bounds.anchor.sessionId,
        MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
      ],
    )).resolves.toBeDefined();
    for (const invalid of [
      -1,
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 + 1,
    ]) {
      await expect(persistence.query(
        `
          update fx_system_tx_journal
          set material_write_event_evidence_bytes = $2
          where session_id = $1
        `,
        [bounds.anchor.sessionId, invalid],
      )).rejects.toThrow();
    }
  });


});
