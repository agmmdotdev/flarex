import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import * as appRows from "../src/appRows";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type { CatalogSchemaVersionId, SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { ApplicationRevisionSyscallDocumentValidationV1Error } from "../src/applicationRevisionSyscallValidatorV1";
import { fxSystemTransactionJournals, fxSystemTransactionJournalReceipts } from "../src/schema";
import type { SessionJournalStorePersistence, SessionJournalAttempt, PinnedPointTableV1 } from "../src/sessionJournalStore";
import type { PointMutationSessionAnchorV1 } from "../src/transactionSessionActivation";
import { issueSetupSeededSyscallValidatorProofV1 } from "./applicationRevisionSyscallValidatorTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

/** Rejected pre-stage documents preserve earlier accepted work in the real issuer. */
export async function finiteDocumentValidationScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  current: Readonly<{ store: SessionJournalStorePersistence; attempt: SessionJournalAttempt;
    table: PinnedPointTableV1; anchor: PointMutationSessionAnchorV1;
    schemaVersionId: CatalogSchemaVersionId; schemaManifest: SchemaManifestAppSchemaV1;
    seededDocumentId?: AppDocumentIdV1 | null }>,
) {
  const validator = issueSetupSeededSyscallValidatorProofV1({ scopeId: current.anchor.scopeId,
    schemaVersionId: current.schemaVersionId, schemaManifest: current.schemaManifest });
  const run = (operation: Parameters<SessionJournalStorePersistence["runPointOperationEffect"]>[1]) =>
    runEffect(current.store.runPointOperationEffect(current.table, operation, validator));
  const reject = async (operation: Parameters<SessionJournalStorePersistence["runPointOperationEffect"]>[1]) => {
    expect(await runEffectFailure(current.store.runPointOperationEffect(current.table, operation, validator)))
      .toBeInstanceOf(ApplicationRevisionSyscallDocumentValidationV1Error);
  };
  const first = await run({ kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: "earlier" } });
  if (first.kind !== "completed" || first.outcome.kind !== "inserted") throw new Error("Missing first insert");
  await reject({ kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n), fields: { name: 42 } });
  const second = await run({ kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n), fields: { name: "later" } });
  if (second.kind !== "completed" || second.outcome.kind !== "inserted") throw new Error("Missing second insert");
  if (!isCanonicalFlarexRuntimeObjectV1(first.outcome.document) ||
    !isCanonicalFlarexRuntimeObjectV1(second.outcome.document)) throw new Error("Missing inserted documents");
  const firstTime = decodeAppCreationTimeV1(first.outcome.document._creationTime);
  const secondTime = decodeAppCreationTimeV1(second.outcome.document._creationTime);
  // One representable cursor step, despite the rejected intervening insert.
  expect(secondTime).toBe(firstTime + 2 ** (Math.floor(Math.log2(firstTime)) - 52));
  await reject({ kind: "patch", syscallSequence: CommitSyscallSequenceV1Schema.make(3n), documentId: first.outcome.documentId, patch: { name: 42 } });
  expect(await run({ kind: "patch", syscallSequence: CommitSyscallSequenceV1Schema.make(3n), documentId: first.outcome.documentId, patch: { name: "retained" } }))
    .toMatchObject({ kind: "completed", outcome: { kind: "unit", operation: "patch" } });
  await reject({ kind: "replace", syscallSequence: CommitSyscallSequenceV1Schema.make(4n), documentId: first.outcome.documentId, fields: { name: 42 } });
  expect(await run({ kind: "get", syscallSequence: CommitSyscallSequenceV1Schema.make(4n), documentId: first.outcome.documentId }))
    .toMatchObject({ kind: "completed", outcome: { kind: "present", document: { name: "retained" } } });
  if (current.seededDocumentId != null) {
    // The SQL transaction boundary runs its own Effect interpreter. Observe the
    // actual snapshot-read owner, preserving its implementation and result.
    const reads = vi.spyOn(appRows, "getAppRowAtSnapshotInTransactionEffect");
    try {
    const sequence = CommitSyscallSequenceV1Schema.make(5n);
    for (const operation of [
      { kind: "patch" as const, syscallSequence: sequence, documentId: current.seededDocumentId, patch: { name: 42 } },
      { kind: "replace" as const, syscallSequence: sequence, documentId: current.seededDocumentId, fields: { name: 42 } },
    ]) expect(await runEffectFailure(current.store.runPointOperationEffect(current.table, operation, validator)))
      .toBeInstanceOf(ApplicationRevisionSyscallDocumentValidationV1Error);
    expect(await runEffect(current.store.runPointOperationEffect(current.table,
      { kind: "get", syscallSequence: sequence, documentId: current.seededDocumentId }, validator)))
      .toMatchObject({ kind: "completed", outcome: { kind: "present", document: { name: "persisted" } } });
    expect(reads).toHaveBeenCalledTimes(3);
    } finally { reads.mockRestore(); }
  }
  const roots = await persistence.drizzle.select().from(fxSystemTransactionJournals)
    .where(eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId));
  const hasSeed = current.seededDocumentId != null;
  expect(roots[0]).toMatchObject({ lastSyscallSequence: hasSeed ? 5n : 4n,
    writeOperations: 3, pointDependencyCount: hasSeed ? 3 : 2, readDocuments: hasSeed ? 3 : 2 });
  expect(await persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
    .where(eq(fxSystemTransactionJournalReceipts.sessionId, current.anchor.sessionId))).toHaveLength(hasSeed ? 5 : 4);
}
