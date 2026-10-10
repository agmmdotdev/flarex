import { eq } from "drizzle-orm";
import {
  MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
  MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
  MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
  MAX_COMMIT_READ_DOCUMENTS_V1,
  MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
  MAX_COMMIT_WRITE_OPERATIONS_V1,
  MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
} from "flarex-protocol/commit-protocol";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { expect, it, afterAll, beforeAll, describe } from "vitest";
import type { SessionJournalPointOperationV1 } from "../../../src/execution/journal/api";
import {
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournals,
} from "../../../src/database/schema";
import type {
  PointMutationSessionAnchorV1,
} from "../../../src/execution/session/contracts";
import {
  prepareSessionJournalSeal as prepareSeal,
  runSessionJournalPointOperation as runPointOperation,
} from "../../support/effectTestRuntime";
import {
  type JournalScenario,
  syscallSequence,
  documentId,
  requireSeededDocumentId,
} from "./journalTestSupport";
import {
  createSessionJournalStorePGliteFixture,
  type SessionJournalStorePGliteFixture,
} from "./journalFixture";

interface LimitCase {
  readonly dimension:
    | "readDocuments"
    | "readSemanticBytes"
    | "pointReadDependencies"
    | "writeOperations"
    | "writeSemanticBytes"
    | "materialWriteEventEvidenceBytes";
  readonly column:
    | "read_documents"
    | "read_semantic_bytes"
    | "point_dependency_count"
    | "write_operations"
    | "write_semantic_bytes"
    | "material_write_event_evidence_bytes";
  readonly maximum: number;
  readonly seedDocument: boolean;
  readonly operation: (
    scenario: JournalScenario,
    sequence: bigint,
  ) => SessionJournalPointOperationV1;
}

function getSeededOperation(
  scenario: JournalScenario,
  sequence: bigint,
): SessionJournalPointOperationV1 {
  return Object.freeze({
    kind: "get",
    syscallSequence: syscallSequence(sequence),
    documentId: requireSeededDocumentId(scenario),
  });
}

function getMissingOperation(
  scenario: JournalScenario,
  sequence: bigint,
): SessionJournalPointOperationV1 {
  return Object.freeze({
    kind: "get",
    syscallSequence: syscallSequence(sequence),
    documentId: documentId(scenario.tableId, 301),
  });
}

function insertOperation(
  _scenario: JournalScenario,
  sequence: bigint,
): SessionJournalPointOperationV1 {
  return Object.freeze({
    kind: "insert",
    syscallSequence: syscallSequence(sequence),
    fields: { name: "limit" },
  });
}

function patchWithRemovalFields(
  fieldCount: number,
  totalFieldBytes: number,
  name: string,
): Readonly<Record<string, string | undefined>> {
  const prefixes = removalFieldPrefixes(fieldCount);
  const minimumBytes = prefixes.reduce(
    (total, prefix) => total + prefix.length,
    0,
  );
  const capacityBytes = prefixes.reduce(
    (total, prefix) => total + 1_024 - prefix.length,
    minimumBytes,
  );
  if (totalFieldBytes < minimumBytes || totalFieldBytes > capacityBytes) {
    throw new Error("Requested removal-field bytes are outside capacity.");
  }
  let remainingPadding = totalFieldBytes - minimumBytes;
  const patch: Record<string, string | undefined> = { name };
  for (const prefix of prefixes) {
    const padding = Math.min(1_024 - prefix.length, remainingPadding);
    remainingPadding -= padding;
    Object.defineProperty(patch, `${prefix}${"x".repeat(padding)}`, {
      value: undefined,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  if (remainingPadding !== 0) {
    throw new Error("Removal-field byte distribution was incomplete.");
  }
  return patch;
}

function removalFieldCapacityBytes(fieldCount: number): number {
  return removalFieldPrefixes(fieldCount).reduce(
    (total) => total + 1_024,
    0,
  );
}

function removalFieldPrefixes(fieldCount: number): ReadonlyArray<string> {
  return Array.from(
    { length: fieldCount },
    (_, index) => `r${index.toString(36).padStart(6, "0")}_`,
  );
}

describe("Journal operation limits (PGlite)", () => {
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

  it("turns each first operation beyond an exact execution ceiling into one sticky durable failure", async () => {
    const cases: ReadonlyArray<LimitCase> = [
      {
        dimension: "readDocuments",
        column: "read_documents",
        maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
        seedDocument: true,
        operation: getSeededOperation,
      },
      {
        dimension: "readSemanticBytes",
        column: "read_semantic_bytes",
        maximum: MAX_COMMIT_READ_SEMANTIC_BYTES_V1,
        seedDocument: true,
        operation: getSeededOperation,
      },
      {
        dimension: "pointReadDependencies",
        column: "point_dependency_count",
        maximum: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
        seedDocument: false,
        operation: getMissingOperation,
      },
      {
        dimension: "writeOperations",
        column: "write_operations",
        maximum: MAX_COMMIT_WRITE_OPERATIONS_V1,
        seedDocument: false,
        operation: insertOperation,
      },
      {
        dimension: "writeSemanticBytes",
        column: "write_semantic_bytes",
        maximum: MAX_COMMIT_WRITE_SEMANTIC_BYTES_V1,
        seedDocument: false,
        operation: insertOperation,
      },
      {
        dimension: "materialWriteEventEvidenceBytes",
        column: "material_write_event_evidence_bytes",
        maximum: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
        seedDocument: false,
        operation: insertOperation,
      },
    ];

    for (const limit of cases) {
      const current = await scenario(`limit_${limit.dimension}`, {
        ...(limit.seedDocument
          ? { seedFields: { name: "limit" } }
          : {}),
      });
      await persistence.query(
        `
          update fx_system_tx_journal
          set ${limit.column} = $2
          where session_id = $1
        `,
        [current.anchor.sessionId, limit.maximum],
      );

      const first = await runPointOperation(current.store, current.table,
        limit.operation(current, 1n),
      );
      expect(first).toMatchObject({
        kind: "rejected",
        delivery: "executed",
        issue: {
          reason: "limitExceeded",
          dimension: limit.dimension,
          maximum: limit.maximum,
        },
      });
      if (first.kind !== "rejected" ||
        first.issue.reason !== "limitExceeded") {
        throw new Error(`Expected ${limit.dimension} limit failure.`);
      }
      expect(first.issue.observed).toBeGreaterThan(limit.maximum);
      if (
        limit.dimension === "readDocuments" ||
        limit.dimension === "pointReadDependencies" ||
        limit.dimension === "writeOperations"
      ) {
        expect(first.issue.observed).toBe(limit.maximum + 1);
      }

      await expect(runPointOperation(current.store, current.table,
        limit.operation(current, 2n),
      )).resolves.toMatchObject({
        kind: "rejected",
        delivery: "sticky",
        issue: {
          reason: "limitExceeded",
          dimension: limit.dimension,
          observed: first.issue.observed,
          maximum: limit.maximum,
        },
      });
      expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
        state: "failed",
        last_syscall_sequence: "1",
        failure_dimension: limit.dimension,
        [limit.column]: limit.maximum,
      });
      expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
        receipts: 1,
        points: 0,
        events: 0,
      });
    }
  });

  it("rejects sticky limit receipts that contradict the failed journal root", async () => {
    const corruptOutcomes = [
      {
        name: "dimension",
        outcome: {
          kind: "error",
          reason: "limitExceeded",
          dimension: "pointReadDependencies",
          observed: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1 + 1,
          maximum: MAX_COMMIT_POINT_READ_DEPENDENCIES_V1,
        },
      },
      {
        name: "maximum",
        outcome: {
          kind: "error",
          reason: "limitExceeded",
          dimension: "readDocuments",
          observed: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
          maximum: MAX_COMMIT_READ_DOCUMENTS_V1 - 1,
        },
      },
      {
        name: "observation",
        outcome: {
          kind: "error",
          reason: "limitExceeded",
          dimension: "readDocuments",
          observed: MAX_COMMIT_READ_DOCUMENTS_V1,
          maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
        },
      },
    ] as const;

    for (const corrupt of corruptOutcomes) {
      const current = await scenario(`sticky_receipt_${corrupt.name}`, {
        seedFields: { name: "limit" },
      });
      const documentId = requireSeededDocumentId(current);
      const failedRequest = Object.freeze({
        kind: "get",
        syscallSequence: syscallSequence(1n),
        documentId,
      } satisfies SessionJournalPointOperationV1);
      await persistence.query(
        `
          update fx_system_tx_journal
          set read_documents = $2
          where session_id = $1
        `,
        [current.anchor.sessionId, MAX_COMMIT_READ_DOCUMENTS_V1],
      );
      await expect(runPointOperation(current.store, current.table,
        failedRequest,
      )).resolves.toMatchObject({
        kind: "rejected",
        issue: {
          reason: "limitExceeded",
          dimension: "readDocuments",
        },
      });

      await replaceLatestOutcomeEvidence(
        current.anchor.sessionId,
        corrupt.outcome,
      );

      await expect(runPointOperation(current.store, current.table,
        failedRequest,
      )).rejects.toMatchObject({
        reason: "failedJournalReceiptInvalid",
      });
      await expect(runPointOperation(current.store, current.table, {
        kind: "get",
        syscallSequence: syscallSequence(2n),
        documentId,
      })).rejects.toMatchObject({
        reason: "failedJournalReceiptInvalid",
      });
    }
  });

  it("rejects a limit receipt attached to an open root during replay and seal", async () => {
    const current = await scenario("open_root_limit_receipt");
    const request = Object.freeze({
      kind: "get",
      syscallSequence: syscallSequence(1n),
      documentId: documentId(current.tableId, 401),
    } satisfies SessionJournalPointOperationV1);
    await expect(runPointOperation(current.store, current.table,
      request,
    )).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "missing" },
    });
    const [beforeReceipt] = await persistence.drizzle.select()
      .from(fxSystemTransactionJournalReceipts)
      .where(eq(fxSystemTransactionJournalReceipts.sessionId,
        current.anchor.sessionId));
    const [beforeRoot] = await persistence.drizzle.select()
      .from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId,
        current.anchor.sessionId));
    if (beforeReceipt === undefined || beforeRoot === undefined) {
      throw new Error("Missing open-root receipt evidence");
    }
    await replaceLatestOutcomeEvidence(current.anchor.sessionId, {
      kind: "error",
      reason: "limitExceeded",
      dimension: "readDocuments",
      observed: MAX_COMMIT_READ_DOCUMENTS_V1 + 1,
      maximum: MAX_COMMIT_READ_DOCUMENTS_V1,
    });
    const [changedReceipt] = await persistence.drizzle.select()
      .from(fxSystemTransactionJournalReceipts)
      .where(eq(fxSystemTransactionJournalReceipts.sessionId,
        current.anchor.sessionId));
    if (changedReceipt === undefined) throw new Error("Missing changed receipt evidence");
    // Keep accounting self-consistent so replay and seal reach the state/receipt
    // contradiction rather than stopping at the earlier byte-counter check.
    await persistence.drizzle.update(fxSystemTransactionJournals).set({
      receiptEvidenceBytes: beforeRoot.receiptEvidenceBytes -
        beforeReceipt.outcomeBytes.byteLength + changedReceipt.outcomeBytes.byteLength,
    }).where(eq(fxSystemTransactionJournals.sessionId,
      current.anchor.sessionId));

    await expect(runPointOperation(current.store, current.table,
      request,
    )).rejects.toMatchObject({ reason: "journalReceiptStateMismatch" });
    await expect(prepareSeal(current.store, current.attempt)).rejects
      .toMatchObject({ reason: "journalReceiptStateMismatch" });
  });

  it("stops remove-heavy writes at the cumulative receipt cap before mutating an event", async () => {
    // The retained request and outcome history reaches its independent 64 MiB
    // bound before these writes can fill the material-event budget. The seeded
    // +1 material case below preserves that independent boundary witness.
    const current = await scenario("event_evidence_receipt_cap", {
      seedFields: { name: "zero" },
    });
    const documentId = requireSeededDocumentId(current);
    let completed = 0;
    let refused: SessionJournalPointOperationV1 | undefined;
    let overlayBeforeRefusal: string | undefined;
    for (let index = 1; index <= 64; index += 1) {
      const request = Object.freeze({
        kind: "patch",
        syscallSequence: syscallSequence(BigInt(index)),
        documentId,
        patch: patchWithRemovalFields(
          1_023,
          removalFieldCapacityBytes(1_023),
          `v${index.toString().padStart(3, "0")}`,
        ),
      } satisfies SessionJournalPointOperationV1);
      const overlayBefore = index === 1 ? undefined :
        await pointOverlayJson(current.anchor.sessionId);
      const result = await runPointOperation(current.store, current.table, request);
      if (result.kind === "rejected") {
        expect(result).toMatchObject({ delivery: "executed", issue: {
          reason: "limitExceeded", dimension: "receiptEvidenceBytes",
          maximum: MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
        } });
        refused = request;
        overlayBeforeRefusal = overlayBefore;
        break;
      }
      expect(result.kind).toBe("completed");
      completed += 1;
    }
    if (refused === undefined || overlayBeforeRefusal === undefined) {
      throw new Error("Expected the retained receipt budget to stop the writes");
    }
    const roots = await persistence.drizzle.select()
      .from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId,
        current.anchor.sessionId));
    expect(roots[0]).toMatchObject({ state: "failed",
      failureDimension: "receiptEvidenceBytes", writeOperations: completed });
    expect(roots[0]?.materialWriteEventEvidenceBytes).toBeLessThan(
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
    );
    expect(roots[0]?.receiptEvidenceBytes).toBeGreaterThan(
      MAX_COMMIT_CANONICAL_EVIDENCE_BYTES_V1,
    );
    expect(roots[0]?.receiptEvidenceBytes).toBeLessThanOrEqual(
      MAX_COMMIT_FAILED_RECEIPT_EVIDENCE_BYTES_V1,
    );
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: completed + 1, points: 1, events: completed,
    });
    expect(await pointOverlayJson(current.anchor.sessionId)).toBe(overlayBeforeRefusal);
    await expect(runPointOperation(current.store, current.table, refused))
      .resolves.toMatchObject({ kind: "rejected", delivery: "replayed",
        issue: { reason: "limitExceeded", dimension: "receiptEvidenceBytes" } });
  }, 180_000);

  it("sticks an exact +1 remove-heavy event failure without mutating its point or event rows", async () => {
    const current = await scenario("event_evidence_plus_one", {
      seedFields: { name: "zero" },
    });
    const documentId = requireSeededDocumentId(current);
    const removalFieldCount = 1_023;
    const removalFieldBytes = removalFieldCapacityBytes(removalFieldCount);
    await expect(runPointOperation(current.store, current.table, {
      kind: "patch",
      syscallSequence: syscallSequence(1n),
      documentId,
      patch: patchWithRemovalFields(
        removalFieldCount,
        removalFieldBytes,
        "v001",
      ),
    })).resolves.toMatchObject({ kind: "completed" });
    const [eventBytes] = await eventEvidenceByteLengths(
      current.anchor.sessionId,
    );
    if (eventBytes === undefined) throw new Error("Missing probe event.");
    const seededCounter =
      MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 - eventBytes + 1;
    await persistence.query(
      `
        update fx_system_tx_journal
        set material_write_event_evidence_bytes = $2
        where session_id = $1
      `,
      [current.anchor.sessionId, seededCounter],
    );
    const overlayBefore = await pointOverlayJson(current.anchor.sessionId);
    const secondRequest = Object.freeze({
      kind: "patch",
      syscallSequence: syscallSequence(2n),
      documentId,
      patch: patchWithRemovalFields(
        removalFieldCount,
        removalFieldBytes,
        "v002",
      ),
    } satisfies SessionJournalPointOperationV1);

    await expect(
      runPointOperation(current.store, current.table, secondRequest),
    ).resolves.toEqual({
      kind: "rejected",
      delivery: "executed",
      issue: {
        reason: "limitExceeded",
        dimension: "materialWriteEventEvidenceBytes",
        observed: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 + 1,
        maximum: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1,
      },
    });
    expect(await journalRoot(current.anchor.sessionId)).toMatchObject({
      state: "failed",
      last_syscall_sequence: "2",
      material_write_event_evidence_bytes: seededCounter,
      failure_dimension: "materialWriteEventEvidenceBytes",
    });
    expect(await journalCounts(current.anchor.sessionId)).toMatchObject({
      receipts: 2,
      points: 1,
      events: 1,
    });
    expect(await pointOverlayJson(current.anchor.sessionId)).toBe(
      overlayBefore,
    );
    await expect(
      runPointOperation(current.store, current.table, secondRequest),
    ).resolves.toMatchObject({
      kind: "rejected",
      delivery: "replayed",
      issue: {
        reason: "limitExceeded",
        dimension: "materialWriteEventEvidenceBytes",
        observed: MAX_COMMIT_MATERIAL_WRITE_EVENT_EVIDENCE_BYTES_V1 + 1,
      },
    });
  }, 60_000);

  async function replaceLatestOutcomeEvidence<
    Outcome extends Readonly<{ readonly kind: string }>,
  >(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
    outcome: Outcome,
  ): Promise<void> {
    const evidence = await canonicalizeFlarexValueV1(outcome);
    await persistence.query(
      `
        update fx_system_tx_journal_receipt
        set outcome_bytes = $2,
            outcome_sha256 = $3,
            outcome_kind = $4
        where session_id = $1
      `,
      [sessionId, evidence.canonicalBytes, evidence.sha256, outcome.kind],
    );
  }

  async function pointOverlayJson(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<string> {
    const result = await persistence.query<{ overlay_json: string }>(
      `
        select overlay_value_json::text as overlay_json
        from fx_system_tx_journal_point
        where session_id = $1
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1) {
      throw new Error("Expected exactly one journal point row.");
    }
    return row.overlay_json;
  }
});
