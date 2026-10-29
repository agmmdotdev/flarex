import { Data, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { decodeAppDocumentIdV1, type AppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { OrderedIndexBoundHexV1Schema, type OrderedIndexBoundsV1 } from "flarex-protocol/ordered-index";
import type { SessionJournalPointOperationV1, SessionJournalIndexedQueryOperationV1 } from "./contracts";

/** Strict unknown executor/RPC input. Typed persistence capture remains distinct. */
export class UnsupportedPointMutationJournalOperationV1Error
  extends Data.TaggedError(
    "UnsupportedPointMutationJournalOperationV1Error",
  )<{
    readonly reason:
      | "notPlainObject"
      | "invalidKind"
      | "unexpectedFields"
      | "invalidFieldShape"
      | "invalidSequence";
    readonly operationKind?: unknown;
    readonly cause?: unknown;
  }> {}


const decodeSyscallSequence = Schema.decodeUnknownSync(Schema.toType(CommitSyscallSequenceV1Schema));
const decodeSyscallSequenceResult = Schema.decodeUnknownResult(Schema.toType(CommitSyscallSequenceV1Schema));
const decodeOrderedIndexBoundResult = Schema.decodeUnknownResult(OrderedIndexBoundHexV1Schema);
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isNonArrayRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function decodeIndexedQueryOperationResult(
  input: unknown,
): Result.Result<
  SessionJournalIndexedQueryOperationV1,
  UnsupportedPointMutationJournalOperationV1Error
> {
  return Result.gen(function* () {
    const record = yield* Result.try({
      try: () => isPlainRecord(input) ? input : null,
      catch: (cause) => indexedOperationFieldError(undefined, cause),
    });
    if (record === null) {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "notPlainObject",
        }),
      );
    }
    const kind = yield* readIndexedDataPropertyResult(record, "kind");
    if (kind !== "indexRange") {
      return yield* Result.fail(
        new UnsupportedPointMutationJournalOperationV1Error({
          reason: "invalidKind",
          operationKind: kind,
        }),
      );
    }
    const captured = yield* Result.try({
      try: () => {
        const expectedFields = new Set([
          "kind",
          "syscallSequence",
          "bounds",
          "limit",
        ]);
        const actualFields = Reflect.ownKeys(record);
        if (
          actualFields.length !== expectedFields.size ||
          actualFields.some((field) =>
            typeof field !== "string" || !expectedFields.has(field))
        ) {
          throw new UnsupportedPointMutationJournalOperationV1Error({
            reason: "unexpectedFields",
            operationKind: kind,
          });
        }
        const boundsInput = readDataProperty(record, "bounds");
        const boundsRecord = isPlainRecord(boundsInput) ? boundsInput : null;
        if (boundsRecord === null) throw new Error("Invalid bounds.");
        const boundsKeys = Reflect.ownKeys(boundsRecord);
        if (boundsKeys.some((field) =>
          field !== "startInclusive" && field !== "endExclusive")) {
          throw new Error("Invalid bounds fields.");
        }
        return Object.freeze({
          syscallSequenceInput: readDataProperty(record, "syscallSequence"),
          start: Object.hasOwn(boundsRecord, "startInclusive")
            ? readDataProperty(boundsRecord, "startInclusive")
            : undefined,
          end: Object.hasOwn(boundsRecord, "endExclusive")
            ? readDataProperty(boundsRecord, "endExclusive")
            : undefined,
          limit: readDataProperty(record, "limit"),
        });
      },
      catch: (cause) => cause instanceof UnsupportedPointMutationJournalOperationV1Error
        ? cause
        : indexedOperationFieldError(kind, cause),
    });
    const syscallSequence = yield* decodeSyscallSequenceResult(
      captured.syscallSequenceInput,
    ).pipe(Result.mapError((cause) => indexedOperationFieldError(kind, cause)));
    const start = captured.start === undefined
      ? undefined
      : yield* decodeOrderedIndexBoundResult(captured.start).pipe(
          Result.mapError((cause) => indexedOperationFieldError(kind, cause)),
        );
    const end = captured.end === undefined
      ? undefined
      : yield* decodeOrderedIndexBoundResult(captured.end).pipe(
          Result.mapError((cause) => indexedOperationFieldError(kind, cause)),
        );
    if (!Number.isSafeInteger(captured.limit) || Number(captured.limit) <= 0) {
      return yield* Result.fail(indexedOperationFieldError(kind));
    }
    const bounds: OrderedIndexBoundsV1 = Object.freeze({
      ...(start === undefined ? {} : { startInclusive: start }),
      ...(end === undefined ? {} : { endExclusive: end }),
    });
    return Object.freeze({
      kind,
      syscallSequence,
      bounds,
      limit: Number(captured.limit),
    });
  });
}

function readIndexedDataPropertyResult(
  input: Readonly<Record<string, unknown>>,
  field: string,
): Result.Result<unknown, UnsupportedPointMutationJournalOperationV1Error> {
  return Result.try({
    try: () => readDataProperty(input, field),
    catch: (cause) => indexedOperationFieldError(undefined, cause),
  });
}

function indexedOperationFieldError(
  operationKind?: unknown,
  cause?: unknown,
): UnsupportedPointMutationJournalOperationV1Error {
  return new UnsupportedPointMutationJournalOperationV1Error({
    reason: "invalidFieldShape",
    ...(operationKind === undefined ? {} : { operationKind }),
    ...(cause === undefined ? {} : { cause }),
  });
}

export function decodePointOperation(input: unknown): SessionJournalPointOperationV1 {
  if (!isPlainRecord(input)) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "notPlainObject",
    });
  }
  const kind = readDataProperty(input, "kind");
  if (
    kind !== "get" &&
    kind !== "insert" &&
    kind !== "patch" &&
    kind !== "replace" &&
    kind !== "delete"
  ) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidKind",
      operationKind: kind,
    });
  }
  const expectedFields = fieldsForOperation(kind);
  const actualFields = Reflect.ownKeys(input);
  if (
    actualFields.length !== expectedFields.size ||
    actualFields.some((field) =>
      typeof field !== "string" || !expectedFields.has(field))
  ) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "unexpectedFields",
      operationKind: kind,
    });
  }
  let syscallSequence: SessionJournalPointOperationV1["syscallSequence"];
  try {
    syscallSequence = decodeSyscallSequence(
      readDataProperty(input, "syscallSequence"),
    );
  } catch (cause) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidSequence",
      operationKind: kind,
      cause,
    });
  }
  switch (kind) {
    case "get":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
      });
    case "insert":
      return Object.freeze({
        kind,
        syscallSequence,
        fields: readDataProperty(input, "fields"),
      });
    case "patch":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
        patch: readDataProperty(input, "patch"),
      });
    case "replace":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
        fields: readDataProperty(input, "fields"),
      });
    case "delete":
      return Object.freeze({
        kind,
        syscallSequence,
        documentId: decodeOperationDocumentId(input, kind),
      });
  }
}

function decodeOperationDocumentId(
  input: Readonly<Record<string, unknown>>,
  operationKind: SessionJournalPointOperationV1["kind"],
): AppDocumentIdV1 {
  try {
    return decodeAppDocumentIdV1(readDataProperty(input, "documentId"));
  } catch (cause) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidFieldShape",
      operationKind,
      cause,
    });
  }
}

function fieldsForOperation(
  kind: SessionJournalPointOperationV1["kind"],
): ReadonlySet<string> {
  switch (kind) {
    case "get":
    case "delete":
      return new Set(["kind", "syscallSequence", "documentId"]);
    case "insert":
      return new Set(["kind", "syscallSequence", "fields"]);
    case "patch":
      return new Set(["kind", "syscallSequence", "documentId", "patch"]);
    case "replace":
      return new Set(["kind", "syscallSequence", "documentId", "fields"]);
  }
}

function readDataProperty(
  input: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !("value" in descriptor)
  ) {
    throw new UnsupportedPointMutationJournalOperationV1Error({
      reason: "invalidFieldShape",
    });
  }
  return descriptor.value;
}
