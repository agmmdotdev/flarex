import { Effect, Exit, Scope } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import * as appRows from "../../../src/storage/documents/appRows";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { isCanonicalFlarexRuntimeObjectV1 } from "flarex-protocol/value";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type { CatalogSchemaVersionId, SchemaManifestAppSchemaV1 } from "flarex-protocol/schema-manifest";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import {
  ApplicationRevisionSyscallDocumentValidationV1Error,
} from "../../../src/application/revision/applicationRevisionSyscallValidatorErrors";
import {
  fxSystemTransactionJournals,
  fxSystemTransactionJournalReceipts,
} from "../../../src/database/schema";
import type {
  SessionJournalStorePersistence,
  SessionJournalAttempt,
  PinnedPointTableV1,
} from "../../../src/execution/journal/api";
import type {
  PointMutationSessionAnchorV1,
} from "../../../src/execution/session/contracts";
import {
  deriveApplicationSyscallValidator,
  type ApplicationRevisionSyscallValidatorV1,
} from "../../../src/application/revision/applicationRevisionSyscallValidatorV1";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

/** Rejected pre-stage documents preserve earlier accepted work in the real issuer. */
export async function finiteDocumentValidationScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  current: Readonly<{ store: SessionJournalStorePersistence; attempt: SessionJournalAttempt;
    table: PinnedPointTableV1; anchor: PointMutationSessionAnchorV1;
    schemaVersionId: CatalogSchemaVersionId; schemaManifest: SchemaManifestAppSchemaV1;
    seededDocumentId?: AppDocumentIdV1 | null }>,
) {
  const scope = await runEffect(Scope.make());
  let retained: ApplicationRevisionSyscallValidatorV1 | undefined;
  try {
    const pins = { scopeId: current.anchor.scopeId, schemaVersionId: current.schemaVersionId,
      schemaManifest: current.schemaManifest };
    const validator = await runEffect(Scope.provide(deriveApplicationSyscallValidator(pins), scope));
    retained = validator;
    const foreignScope = await runEffect(Scope.provide(deriveApplicationSyscallValidator({ ...pins,
      scopeId: ScopeIdSchema.make(`${pins.scopeId}_foreign`) }), scope));
    const foreignSchema = await runEffect(Scope.provide(deriveApplicationSyscallValidator({ ...pins,
      schemaVersionId: CatalogSchemaVersionIdSchema.make(`${pins.schemaVersionId}_foreign`) }), scope));
    const before = await validationRows(persistence, current.anchor.sessionId);
    // SAFETY: this negative witness deliberately forges the opaque handle to test issuer refusal.
    const forged = Object.freeze({}) as ApplicationRevisionSyscallValidatorV1;
    for (const [capability, tag, reason] of [
      [Object.freeze({ ...validator }), "InvalidApplicationRevisionSyscallValidatorV1Error", "notIssued"],
      [forged, "InvalidApplicationRevisionSyscallValidatorV1Error", "notIssued"],
      [foreignScope, "ApplicationRevisionSyscallValidatorStaleV1Error", "sessionPins"],
      [foreignSchema, "ApplicationRevisionSyscallValidatorStaleV1Error", "sessionPins"],
    ] as const) {
      expect(await runEffectFailure(current.store.runPointOperationEffect(current.table, {
        kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n), fields: { name: "refused" },
      }, capability))).toMatchObject({ _tag: tag, reason });
    }
    expect(await validationRows(persistence, current.anchor.sessionId)).toEqual(before);
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
  } finally { await runEffect(Scope.close(scope, Exit.succeed(undefined))); }
  if (retained === undefined) throw new Error("Missing scoped validator");
  const beforeRevokedCall = await validationRows(persistence, current.anchor.sessionId);
  expect(await runEffectFailure(current.store.runPointOperationEffect(current.table, {
    kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(current.seededDocumentId != null ? 6n : 5n),
    fields: { name: "revoked" },
  }, retained))).toMatchObject({ _tag: "InvalidApplicationRevisionSyscallValidatorV1Error", reason: "notIssued" });
  expect(await validationRows(persistence, current.anchor.sessionId)).toEqual(beforeRevokedCall);
}

async function validationRows(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  sessionId: PointMutationSessionAnchorV1["sessionId"],
) {
  const roots = await persistence.drizzle.select().from(fxSystemTransactionJournals)
    .where(eq(fxSystemTransactionJournals.sessionId, sessionId));
  const receipts = await persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
    .where(eq(fxSystemTransactionJournalReceipts.sessionId, sessionId));
  return { roots, receipts };
}
