import { Result } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import type { CanonicalFlarexValueV1 } from "flarex-protocol/value";
import type { JsonObject } from "flarex-protocol/json";
import type { LogicalDocumentFailure } from "./model";
import { inspectLogicalRelationalRealNormalization, isLogicalRelationalCanonicalCopy } from "./relationalRows";

interface WriteAttempt {
  readonly ordinal: number;
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly documentId: AppDocumentIdV1;
  readonly operation: "insert" | "patch" | "replace" | "delete";
  readonly before: CanonicalFlarexValueV1 | null;
  readonly after: CanonicalFlarexValueV1 | null;
}
interface WriteEvidence {
  readonly attempt: WriteAttempt;
  readonly fields: JsonObject;
}
const writes = new WeakMap<WriteAttempt, WriteEvidence>();
const sameBytes = (left: Uint8Array | null, right: CanonicalFlarexValueV1 | null) =>
  left === null ? right === null : right !== null && compareBytesLexicographically(left, right.canonicalBytes) === 0;

/** The canonical detachment owner preserves an existing verdict, including a
 * corrupt one that must fail later inspection. Copying cannot grant evidence
 * to an original attempt that never held it. No acceptance happens here. */
export function retainDetachedLogicalRealWriteAttempt(original: WriteAttempt, detached: WriteAttempt): void {
  const captured = writes.get(original);
  if (captured !== undefined && Object.isFrozen(detached) && detached.ordinal === original.ordinal &&
    detached.tableId === original.tableId && detached.tableName === original.tableName && detached.documentId === original.documentId &&
    detached.operation === original.operation && isLogicalRelationalCanonicalCopy(original.before, detached.before) &&
    isLogicalRelationalCanonicalCopy(original.after, detached.after))
    writes.set(detached, Object.freeze({ ...captured, attempt: detached }));
}

/** Only the successful working-set write owner calls this after validation and
 * resource charges. Capturing a conversion alone never grants attempt evidence. */
export function captureLogicalRealWriteAttempt<Failure>(attempt: WriteAttempt, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    if (attempt.after === null) return;
    const fields = yield* inspectLogicalRelationalRealNormalization(attempt.after, error);
    if (fields === undefined) return;
    if (!Object.isFrozen(attempt) || attempt.operation === "delete") return yield* Result.fail(error("invalidAuthority"));
    if (attempt.before !== null) yield* inspectLogicalRelationalRealNormalization(attempt.before, error);
    writes.set(attempt, Object.freeze({ attempt, fields }));
  });
}

/** A copied/mutated REAL attempt cannot borrow the original conversion merely
 * by pointing at a genuine converted document. No storage capability escapes. */
export function inspectLogicalRealWriteAttempt<Failure>(attempt: WriteAttempt,
  error: LogicalDocumentFailure<Failure>): Result.Result<JsonObject | undefined, Failure> {
  return Result.gen(function* () {
    const fields = attempt.after === null ? undefined : yield* inspectLogicalRelationalRealNormalization(attempt.after, error);
    const captured = writes.get(attempt);
    if (fields === undefined && captured === undefined) return undefined;
    if (attempt.before !== null) yield* inspectLogicalRelationalRealNormalization(attempt.before, error);
    if (captured === undefined || fields !== captured.fields || captured.attempt !== attempt)
      return yield* Result.fail(error("storedCorruption"));
    return fields;
  });
}

/** Only the original owner can retain evidence while making its immutable
 * cursor or detached canonical view. Ordinal rebasing is explicit and exact. */
export function retainLogicalRealWriteAttempt<Failure>(original: WriteAttempt, projected: WriteAttempt,
  offset: number, error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    const fields = yield* inspectLogicalRealWriteAttempt(original, error);
    if (fields === undefined) return;
    if (!Number.isSafeInteger(offset) || offset < 0 || original.ordinal < offset || projected.ordinal !== original.ordinal - offset ||
      projected.tableId !== original.tableId || projected.tableName !== original.tableName || projected.documentId !== original.documentId ||
      projected.operation !== original.operation || !sameBytes(original.before?.canonicalBytes ?? null, projected.before) ||
      !sameBytes(original.after?.canonicalBytes ?? null, projected.after) ||
      !isLogicalRelationalCanonicalCopy(original.before, projected.before) || !isLogicalRelationalCanonicalCopy(original.after, projected.after))
      return yield* Result.fail(error("storedCorruption"));
    yield* captureLogicalRealWriteAttempt(projected, error);
    if (writes.get(projected)?.fields !== fields) return yield* Result.fail(error("storedCorruption"));
  });
}
