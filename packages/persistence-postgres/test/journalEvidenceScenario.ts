import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import {
  CommitFinalSyscallSequenceV1Schema,
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import { isJsonObject } from "flarex-protocol/json";
import {
  canonicalizeFlarexValueJsonV1,
  decodeCanonicalFlarexValueEvidenceV1,
} from "flarex-protocol/value";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { fxSystemTransactionJournals, fxSystemTransactionJournalWriteEvents } from "../src/schema";
import type {
  PinnedPointTableV1,
  SessionJournalAttemptV1,
  SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import type { PointMutationSessionAnchorV1 } from "../src/transactionSessionActivation";
import {
  completeSessionJournalSeal, prepareSessionJournalSeal, runEffect,
  runEffectFailure, runSessionJournalPointOperation,
} from "./effectTestRuntime";

type Database = PGliteFlarexPersistence | PostgresFlarexPersistence;
interface Scenario {
  readonly store: SessionJournalStorePersistenceV1;
  readonly table: PinnedPointTableV1;
  readonly attempt: SessionJournalAttemptV1;
  readonly anchor: PointMutationSessionAnchorV1;
}

/** Exercises the real journal decoder without a persisted JSON mirror. */
export async function verifyJournalEventEvidence(database: Database, current: Scenario): Promise<void> {
  await runSessionJournalPointOperation(current.store, current.table, {
    kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    fields: { name: "canonical event" },
  });
  const where = eq(fxSystemTransactionJournalWriteEvents.sessionId, current.anchor.sessionId);
  const [original] = await database.drizzle.select().from(fxSystemTransactionJournalWriteEvents).where(where);
  if (original === undefined) throw new Error("Missing inserted journal event.");
  const canonical = await decodeCanonicalFlarexValueEvidenceV1({
    canonicalBytes: original.eventBytes, sha256: original.eventSha256,
  });
  if (!isJsonObject(canonical.valueJson)) throw new Error("Expected logical write object.");
  const excess = await canonicalizeFlarexValueJsonV1({ ...canonical.valueJson, unexpected: true });
  const whitespace = new Uint8Array([...original.eventBytes, 32]);
  const mutations: ReadonlyArray<Partial<typeof fxSystemTransactionJournalWriteEvents.$inferInsert>> = [
    { eventBytes: whitespace, eventSha256: new Uint8Array(createHash("sha256").update(whitespace).digest()) },
    { eventBytes: excess.canonicalBytes, eventSha256: excess.sha256 },
    { writeKind: "delete" },
    { syscallSequence: CommitSyscallSequenceV1Schema.make(2n) },
  ];
  for (const mutation of mutations) {
    await database.drizzle.update(fxSystemTransactionJournalWriteEvents).set({
      eventBytes: original.eventBytes, eventSha256: original.eventSha256,
      writeKind: original.writeKind, syscallSequence: original.syscallSequence, ...mutation,
    }).where(where);
    expect(await runEffectFailure(current.store.prepareSealEffect(current.attempt)))
      .toMatchObject({ reason: "logicalWriteEventInvalid" });
    const [root] = await database.drizzle.select().from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId));
    expect(root?.state).toBe("open");
  }
  await database.drizzle.update(fxSystemTransactionJournalWriteEvents).set({
    eventBytes: original.eventBytes, eventSha256: original.eventSha256,
    writeKind: original.writeKind, syscallSequence: original.syscallSequence,
  }).where(where);
  await expect(prepareSessionJournalSeal(current.store, current.attempt)).resolves.toBeDefined();
}

/** The surviving root counter remains bound to previously prepared sealed evidence. */
export async function verifyJournalSealSequence(database: Database, current: Scenario): Promise<void> {
  const prepared = await prepareSessionJournalSeal(current.store, current.attempt);
  const journal = await runEffect(canonicalizeSessionJournalV1Effect(prepared.journal));
  const result = await runEffect(canonicalizeSuccessfulResultV1Effect(null));
  const envelope = await completeSessionJournalSeal(current.store, prepared.preparation, journal, result);
  const replay = await prepareSessionJournalSeal(current.store, current.attempt);
  const where = eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId);
  await database.drizzle.update(fxSystemTransactionJournals).set({ lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(1n) }).where(where);
  expect(await runEffectFailure(current.store.completeSealEffect(replay.preparation, journal, result)))
    .toMatchObject({ reason: "sealedEvidenceMismatch" });
  await database.drizzle.update(fxSystemTransactionJournals).set({ lastSyscallSequence: CommitFinalSyscallSequenceV1Schema.make(0n) }).where(where);
  const restored = await prepareSessionJournalSeal(current.store, current.attempt);
  await expect(completeSessionJournalSeal(current.store, restored.preparation, journal, result))
    .resolves.toEqual(envelope);
}
