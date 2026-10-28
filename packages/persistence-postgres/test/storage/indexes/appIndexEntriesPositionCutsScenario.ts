import { Result } from "effect";
import { expect } from "vitest";
import { decodeOrderedIndexBoundHexV1 } from "flarex-protocol/ordered-index";
import { CommitSeqSchema, type ScopeId } from "flarex-protocol/storage-authority";
import {
  prepareAppIndexSnapshotReadResult,
  scanAppIndexAtSnapshotInTransactionEffect,
  type AppIndexEntryTransaction,
  type AppIndexRangeCursorV1,
  type ScanAppIndexAtSnapshotV1Input,
} from "../../../src/storage/indexes/appIndexEntries";
import type { LocatedAppIndexDefinitionV1 } from "../../../src/storage/indexes/appIndexDefinitions";
import { runEffect } from "../../support/effectTestRuntime";

/** Shared owner assertions; callers seed through their genuine row/index owners. */
export async function verifySnapshotIndexPositionCuts(
  tx: AppIndexEntryTransaction,
  fixture: Readonly<{ scopeId: ScopeId; definition: LocatedAppIndexDefinitionV1; removeMiddle: () => Promise<void> }>,
): Promise<Readonly<{ middle: AppIndexRangeCursorV1; last: AppIndexRangeCursorV1 }>> {
  const input: ScanAppIndexAtSnapshotV1Input = {
    scopeId: fixture.scopeId, definition: fixture.definition, bounds: {}, snapshotCommitSeq: CommitSeqSchema.make(1n), limit: 10,
  };
  const read = (cuts: Partial<ScanAppIndexAtSnapshotV1Input>) =>
    runEffect(scanAppIndexAtSnapshotInTransactionEffect(tx, { ...input, ...cuts }));
  const initial = await read({});
  expect(initial.entries).toHaveLength(3);
  const [first, middle, last] = initial.entries;
  if (first === undefined || middle === undefined || last === undefined) throw new Error("Expected three seeded memberships");
  expect(new Set(initial.entries.map(entry => entry.encodedKey)).size).toBe(1);
  const cursor = (position: AppIndexRangeCursorV1): AppIndexRangeCursorV1 => ({ encodedKey: position.encodedKey, rowId: position.rowId });
  const a = cursor(first), b = cursor(middle), c = cursor(last);
  const identities = (page: Awaited<ReturnType<typeof read>>) => page.entries.map(entry => entry.rowId);
  expect(identities(await read({ lower: { position: b, inclusive: true } }))).toEqual([b.rowId, c.rowId]);
  expect(identities(await read({ lower: { position: b, inclusive: false } }))).toEqual([c.rowId]);
  expect(identities(await read({ upper: { position: b, inclusive: true } }))).toEqual([a.rowId, b.rowId]);
  expect(identities(await read({ upper: { position: b, inclusive: false } }))).toEqual([a.rowId]);
  expect(identities(await read({ lower: { position: b, inclusive: true }, upper: { position: b, inclusive: true } })))
    .toEqual([b.rowId]);
  expect(identities(await read({ lower: { position: b, inclusive: false }, upper: { position: b, inclusive: true } })))
    .toEqual([]);
  expect(identities(await read({ lower: { position: b, inclusive: true }, upper: { position: b, inclusive: false } })))
    .toEqual([]);
  const keyBound = decodeOrderedIndexBoundHexV1(b.encodedKey);
  expect(identities(await read({ bounds: { startInclusive: keyBound, endExclusive: keyBound },
    lower: { position: a, inclusive: true }, upper: { position: c, inclusive: true } }))).toEqual([]);

  const page = await read({ lower: { position: b, inclusive: true }, upper: { position: c, inclusive: true }, limit: 1 });
  expect(identities(page)).toEqual([b.rowId]);
  expect(page.isDone).toBe(false);
  expect(page.continueCursor).toEqual(b);
  const continuation = await read({ after: b, upper: { position: c, inclusive: true }, limit: 1 });
  expect(identities(continuation)).toEqual([c.rowId]);
  expect(continuation.isDone).toBe(true);
  expect(continuation.continueCursor).toBeNull();
  const boundedEnd = await read({ upper: { position: b, inclusive: false }, limit: 1 });
  expect(identities(boundedEnd)).toEqual([a.rowId]);
  expect(boundedEnd.isDone).toBe(true);

  const mutable = { position: { ...b }, inclusive: true };
  const captured = Result.getOrThrow(prepareAppIndexSnapshotReadResult({ ...input, lower: mutable }));
  mutable.position.rowId = a.rowId;
  mutable.inclusive = false;
  expect(captured.lower?.position.rowId).toBe(b.rowId);
  expect(captured.lower?.inclusive).toBe(true);
  const legacy = Result.getOrThrow(prepareAppIndexSnapshotReadResult({ ...input, after: b }));
  expect(legacy.lower?.position.rowId).toBe(b.rowId);
  expect(legacy.lower?.inclusive).toBe(false);
  for (const cuts of [
    { after: b, lower: { position: b, inclusive: false } },
    { lower: { position: c, inclusive: true }, upper: { position: a, inclusive: true } },
  ]) {
    const refused = prepareAppIndexSnapshotReadResult({ ...input, ...cuts });
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) expect(refused.failure.issue).toBe("after" in cuts ? "invalidCursor" : "invalidBounds");
  }
  for (const invalid of ["true", 1, null, undefined]) {
    const malformed = { position: b, inclusive: true };
    Reflect.set(malformed, "inclusive", invalid);
    const refused = prepareAppIndexSnapshotReadResult({ ...input, upper: malformed });
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) expect(refused.failure.issue).toBe("invalidCursor");
  }
  const malformedPosition = { position: b, inclusive: false };
  Reflect.set(malformedPosition, "position", { encodedKey: b.encodedKey, rowId: "bad-row" });
  const invalidCursor = prepareAppIndexSnapshotReadResult({ ...input, lower: malformedPosition });
  expect(Result.isFailure(invalidCursor)).toBe(true);
  if (Result.isFailure(invalidCursor)) expect(invalidCursor.failure.issue).toBe("invalidCursor");

  await fixture.removeMiddle();
  expect(identities(await read({ lower: { position: b, inclusive: true }, upper: { position: b, inclusive: true } })))
    .toEqual([b.rowId]);
  const afterTombstone = await read({ snapshotCommitSeq: CommitSeqSchema.make(2n), lower: { position: b, inclusive: true } });
  expect(identities(afterTombstone)).toEqual([c.rowId]);
  return { middle: b, last: c };
}
