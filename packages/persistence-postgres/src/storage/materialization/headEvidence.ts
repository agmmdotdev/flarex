import {
  MAX_PERSISTED_SIGNED_INT64_V1,
  CommitSeqSchema,
  type ReplacementScopeIdV1,
  type CommitSeq,
} from "flarex-protocol/storage-authority";
import {
  Schema,
  Result,
} from "effect";
import {
  AppCreationTimeV1Schema,
} from "flarex-protocol/app-document";
import type {
  PointCommitDependencyV1,
  LoadedPointCommitHeadV1,
} from "./model";
import {
  type PointCommitCorruptionV1Error,
  corruption,
} from "../../commit/point/errors";
import {
  isNonArrayRecord,
} from "@flarex/utils/records";
import {
  decodeStoredAppRowInsertionOrderResult,
  type AppRowIdentityV1,
} from "../documents/appRows";
import {
  isNonNegativeSafeInteger,
} from "@flarex/utils/numbers";

const MAX_SIGNED_COMMIT_SEQ = MAX_PERSISTED_SIGNED_INT64_V1;

const MAX_SIGNED_COMMIT_SEQ_TEXT_LENGTH =
  MAX_SIGNED_COMMIT_SEQ.toString().length;

export const decodePointCommitCreationTimeResult = Schema.decodeUnknownResult(
  Schema.toType(AppCreationTimeV1Schema),
);

export const decodePointCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);

export function decodePointCommitHeadResult(
  raw: unknown,
  expectedOrdinal: number,
  dependency: PointCommitDependencyV1 | undefined,
  scopeId: ReplacementScopeIdV1,
  lastCommitSeq: CommitSeq,
): Result.Result<LoadedPointCommitHeadV1, PointCommitCorruptionV1Error> {
  if (dependency === undefined || !isNonArrayRecord(raw)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return Result.gen(function* () {
    const ordinal = yield* parseNonNegativeIntegerTextResult(raw.ordinalText);
    const pointerCommitSeq = yield* parseNullableCommitSeqTextResult(
      raw.pointerCommitSeqText,
    );
    const latestCommitSeq = yield* parseNullableCommitSeqTextResult(
      raw.latestCommitSeqText,
    );
    if (
      ordinal !== expectedOrdinal ||
      (pointerCommitSeq === null) !== (latestCommitSeq === null) ||
      pointerCommitSeq !== latestCommitSeq
    ) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const identity = freezeRowIdentity(dependency, scopeId);
    if (latestCommitSeq === null) {
      if (
        raw.latestIsTombstone !== null ||
        raw.latestCreationTimeText !== null || raw.latestInsertionCommitSeqText !== null || raw.latestInsertionAttemptOrdinalText !== null
      ) {
        return yield* Result.fail(corruption("rowHeadInvalid"));
      }
      return Object.freeze({
        head: Object.freeze({ kind: "missing", identity }),
        creationTime: null,
      });
    }
    if (
      latestCommitSeq > lastCommitSeq ||
      typeof raw.latestIsTombstone !== "boolean" ||
      typeof raw.latestCreationTimeText !== "string"
    ) {
      return yield* Result.fail(corruption("rowHeadInvalid"));
    }
    const creationTime = yield* decodePointCommitCreationTimeResult(
      Number(raw.latestCreationTimeText),
    ).pipe(Result.mapError(() => corruption("rowHeadInvalid")));
    const insertionOrder = yield* decodeStoredAppRowInsertionOrderResult(identity, latestCommitSeq,
      { get commitSeq() { return raw.latestInsertionCommitSeqText; }, get attemptOrdinal() { return raw.latestInsertionAttemptOrdinalText; } }, true)
      .pipe(Result.mapError(() => corruption("rowHeadInvalid")));
    return Object.freeze({
      head: Object.freeze({
        kind: raw.latestIsTombstone ? "tombstone" : "live",
        identity,
        revisionCommitSeq: latestCommitSeq,
      }),
      creationTime,
      ...(insertionOrder === undefined ? {} : { insertionOrder }),
    });
  });
}

export function freezeRowIdentity(
  input: Pick<PointCommitDependencyV1, "tableId" | "rowId">,
  scopeId: ReplacementScopeIdV1,
): Readonly<AppRowIdentityV1> {
  return Object.freeze({
    scopeId,
    tableId: input.tableId,
    rowId: input.rowId,
  });
}

export function parseNonNegativeIntegerTextResult(
  value: unknown,
): Result.Result<number, PointCommitCorruptionV1Error> {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  const parsed = Number(value);
  if (!isNonNegativeSafeInteger(parsed)) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return Result.succeed(parsed);
}

export function parseNullableCommitSeqTextResult(
  value: unknown,
): Result.Result<CommitSeq | null, PointCommitCorruptionV1Error> {
  if (value === null) return Result.succeed(null);
  if (
    typeof value !== "string" ||
    value.length > MAX_SIGNED_COMMIT_SEQ_TEXT_LENGTH ||
    !/^[1-9][0-9]*$/.test(value)
  ) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SIGNED_COMMIT_SEQ) {
    return Result.fail(corruption("rowHeadInvalid"));
  }
  return decodePointCommitSeqResult(parsed).pipe(
    Result.mapError(() => corruption("rowHeadInvalid")),
  );
}
