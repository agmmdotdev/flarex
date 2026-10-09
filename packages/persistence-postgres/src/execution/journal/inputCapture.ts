import type {
  SessionJournalPointOperationKindV1,
  SessionJournalIndexedQueryOperationV1,
  SessionJournalRelationIncomingOperationV1,
  SessionJournalPointOperationV1,
  OpenSessionJournalAttemptInput,
} from "./contracts";
import { InvalidSessionJournalInputV1Error } from "./errors";
import type {
  SessionJournalAttemptStateV1,
  PinnedPointTableStateV1,
  PinnedDeveloperIndexStateV1,
  PinnedApplicationRelationReadState,
} from "./state";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Result } from "effect";
import { requireAppDocumentIdentityV1ForTableResult } from "flarex-protocol/app-document-id";
import { MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1 } from "flarex-protocol/commit-protocol";
import type { LogicalPatchFieldV1 } from "flarex-protocol/commit-protocol";
import { RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1 } from "flarex-protocol/internal/application-schema-binding";
import { isJsonObject } from "flarex-protocol/json";
import type { JsonObject } from "flarex-protocol/json";
import {
  FlarexValueCodecV1Error,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  isCanonicalFlarexRuntimeObjectV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";
import { hasExactOwnDataKeys } from "../../values/exactOwnDataKeys";
import type { PointMutationSessionAttemptSelectorV1 } from "../transactionSessionActivation";
import {
  decodeCommitSyscallSequenceResult,
  decodeTransactionSessionIdResult,
  decodeTransactionAttemptFenceResult,
  decodeSnapshotTokenResult,
  decodeCatalogSchemaVersionIdResult,
  decodeOrderedIndexBoundHexV1Result,
  decodeExecutionClaimOwnerResult,
  decodeExecutionClaimFenceResult,
} from "./codecs";
import type {
  SessionJournalStoredRequest,
  SessionJournalStoredPointRequest,
} from "./codecs";

export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function captureAttemptStateResult(
  input: OpenSessionJournalAttemptInput,
): Result.Result<
  SessionJournalAttemptStateV1,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const selectorInput = yield* readOpenAttemptInput(() => input.selector);
    const deploymentId = yield* readOpenAttemptInput(
      () => selectorInput.deploymentId,
    );
    const scopeId = yield* readOpenAttemptInput(() => selectorInput.scopeId);
    const sessionIdInput = yield* readOpenAttemptInput(
      () => selectorInput.sessionId,
    );
    const sessionId = yield* decodeTransactionSessionIdResult(
      sessionIdInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const attemptFenceInput = yield* readOpenAttemptInput(
      () => selectorInput.attemptFence,
    );
    const attemptFence = yield* decodeTransactionAttemptFenceResult(
      attemptFenceInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const selector = Object.freeze({
      deploymentId,
      scopeId,
      sessionId,
      attemptFence,
    } satisfies PointMutationSessionAttemptSelectorV1);
    const snapshotTokenInput = yield* readOpenAttemptInput(
      () => input.snapshotToken,
    );
    const snapshotScopeId = yield* readOpenAttemptInput(
      () => snapshotTokenInput.scopeId,
    );
    const snapshotEpoch = yield* readOpenAttemptInput(
      () => snapshotTokenInput.epoch,
    );
    const snapshotCommitSeq = yield* readOpenAttemptInput(
      () => snapshotTokenInput.commitSeq,
    );
    const snapshotToken = Object.freeze(
      yield* decodeSnapshotTokenResult({
        scopeId: snapshotScopeId,
        epoch: snapshotEpoch,
        commitSeq: snapshotCommitSeq,
      }).pipe(Result.mapError(invalidAttemptPins)),
    );
    if (snapshotToken.scopeId !== selector.scopeId) {
      return yield* Result.fail(
        invalidAttemptPins(
          new Error("Snapshot scope does not match the attempt selector."),
        ),
      );
    }
    const schemaVersionIdInput = yield* readOpenAttemptInput(
      () => input.schemaVersionId,
    );
    const schemaVersionId = yield* decodeCatalogSchemaVersionIdResult(
      schemaVersionIdInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const executionClaimInput = yield* readOpenAttemptInput(
      () => input.executionClaim,
    );
    const claimOwnerInput = yield* readOpenAttemptInput(
      () => executionClaimInput.claimOwner,
    );
    const claimFenceInput = yield* readOpenAttemptInput(
      () => executionClaimInput.claimFence,
    );
    const claimOwner = yield* decodeExecutionClaimOwnerResult(
      claimOwnerInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const claimFence = yield* decodeExecutionClaimFenceResult(
      claimFenceInput,
    ).pipe(Result.mapError(invalidAttemptPins));
    const executionProfile = yield* readOpenAttemptInput(
      () => input.executionProfile ?? "durableOperations",
    );
    if (
      executionProfile !== "durableOperations" &&
      executionProfile !== "finiteRoot"
    ) {
      return yield* Result.fail(
        invalidAttemptPins(new Error("Unknown journal execution profile.")),
      );
    }
    return Object.freeze({
      selector,
      snapshotToken,
      schemaVersionId,
      executionClaim: Object.freeze({ claimOwner, claimFence }),
      executionProfile,
    });
  });
}

function readOpenAttemptInput<A>(
  read: () => A,
): Result.Result<A, InvalidSessionJournalInputV1Error> {
  return Result.try({
    try: read,
    catch: invalidAttemptPins,
  });
}

function invalidAttemptPins(cause: unknown): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation: "openAttempt",
    reason: "invalidAttemptPins",
    cause,
  });
}

export function captureStoredRequestResult(
  table: PinnedPointTableStateV1,
  operation: SessionJournalPointOperationV1,
): Result.Result<
  SessionJournalStoredPointRequest,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    // Preserve the compatibility boundary's observable caller-access order:
    // syscall sequence first, then the discriminant used to classify failure.
    const syscallSequenceInput = yield* Result.try({
      try: () => operation.syscallSequence,
      catch: (cause) => invalidPointOperation(operation.kind, cause),
    });
    const syscallSequence = yield* decodeCommitSyscallSequenceResult(
      syscallSequenceInput,
    ).pipe(
      Result.mapError((cause) => invalidPointOperation(operation.kind, cause)),
    );
    const capturedOperation =
      yield* capturePointOperationInputResult(operation);
    switch (capturedOperation.kind) {
      case "get": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(
          Result.mapError((cause) =>
            invalidPointOperation(capturedOperation.source.kind, cause),
          ),
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "get",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
        });
      }
      case "insert": {
        const fields = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.fields,
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "insert",
          syscallSequence,
          tableId: table.tableId,
          fieldsValueJson: yield* captureDeveloperFieldsValueJsonResult(
            fields,
            capturedOperation.source,
          ),
        });
      }
      case "patch": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(
          Result.mapError((cause) =>
            invalidPointOperation(capturedOperation.source.kind, cause),
          ),
        );
        const patch = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.patch,
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "patch",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
          changes: yield* capturePatchChangesResult(
            patch,
            capturedOperation.source,
          ),
        });
      }
      case "replace": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(
          Result.mapError((cause) =>
            invalidPointOperation(capturedOperation.source.kind, cause),
          ),
        );
        const fields = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.fields,
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "replace",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
          fieldsValueJson: yield* captureDeveloperFieldsValueJsonResult(
            fields,
            capturedOperation.source,
          ),
        });
      }
      case "delete": {
        const documentId = yield* readPointOperationInput(
          capturedOperation.source,
          () => capturedOperation.source.documentId,
        );
        const identity = yield* requireAppDocumentIdentityV1ForTableResult(
          documentId,
          table.tableId,
        ).pipe(
          Result.mapError((cause) =>
            invalidPointOperation(capturedOperation.source.kind, cause),
          ),
        );
        return Object.freeze({
          format: "flarex.session-journal-syscall",
          codecVersion: 2,
          kind: "delete",
          syscallSequence,
          tableId: table.tableId,
          documentId: identity.id,
        });
      }
    }
  });
}

export function captureIndexedQueryRequestResult(
  index: PinnedDeveloperIndexStateV1,
  operation: SessionJournalIndexedQueryOperationV1,
): Result.Result<
  Extract<SessionJournalStoredRequest, { readonly kind: "indexRange" }>,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const syscallSequence = yield* Result.try({
      try: () => operation.syscallSequence,
      catch: (cause) => invalidIndexedQueryOperation(cause),
    }).pipe(
      Result.flatMap(decodeCommitSyscallSequenceResult),
      Result.mapError(invalidIndexedQueryOperation),
    );
    const bounds = yield* Result.try({
      try: () => operation.bounds,
      catch: (cause) => invalidIndexedQueryOperation(cause),
    });
    if (!isNonArrayRecord(bounds)) {
      return yield* Result.fail(
        invalidIndexedQueryOperation(
          new Error("Indexed query bounds must be an object."),
        ),
      );
    }
    const capturedBounds = yield* Result.try({
      try: () => ({
        startInclusive: bounds.startInclusive,
        endExclusive: bounds.endExclusive,
      }),
      catch: (cause) => invalidIndexedQueryOperation(cause),
    });
    const startInclusive =
      capturedBounds.startInclusive === undefined
        ? null
        : yield* decodeOrderedIndexBoundHexV1Result(
            capturedBounds.startInclusive,
          ).pipe(Result.mapError(invalidIndexedQueryOperation));
    const endExclusive =
      capturedBounds.endExclusive === undefined
        ? null
        : yield* decodeOrderedIndexBoundHexV1Result(
            capturedBounds.endExclusive,
          ).pipe(Result.mapError(invalidIndexedQueryOperation));
    if (
      startInclusive !== null &&
      endExclusive !== null &&
      compareUtf16Strings(startInclusive, endExclusive) >= 0
    ) {
      return yield* Result.fail(
        invalidIndexedQueryOperation(
          new Error("Indexed query bounds must describe a non-empty interval."),
        ),
      );
    }
    const limit = yield* Result.try({
      try: () => operation.limit,
      catch: (cause) => invalidIndexedQueryOperation(cause),
    });
    if (
      !isPositiveSafeInteger(limit) ||
      limit > MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(
        invalidIndexedQueryOperation(
          new Error(
            `Indexed query limit must be between 1 and ${MAX_COMMIT_INDEXED_QUERY_PAGE_SIZE_V1}.`,
          ),
        ),
      );
    }
    return Object.freeze({
      format: "flarex.session-journal-syscall" as const,
      codecVersion: 2 as const,
      kind: "indexRange" as const,
      syscallSequence,
      tableId: index.tableId,
      logicalIndexId: index.logicalIndexId,
      indexDefinitionId: index.definition.indexDefinitionId,
      startInclusive,
      endExclusive,
      limit,
    });
  });
}

export function captureApplicationRelationIncomingRequestResult(
  relation: PinnedApplicationRelationReadState,
  operation: SessionJournalRelationIncomingOperationV1,
): Result.Result<
  Extract<
    SessionJournalStoredRequest,
    {
      readonly kind: "relationIncoming";
    }
  >,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const exactOperation = yield* Result.try({
      try: () =>
        hasExactOwnDataKeys(operation, [
          "kind",
          "syscallSequence",
          "targetDocumentId",
          "limit",
        ]),
      catch: invalidApplicationRelationOperation,
    });
    if (!exactOperation) {
      return yield* Result.fail(
        invalidApplicationRelationOperation(
          new Error("Incoming relation operation has an unsupported shape."),
        ),
      );
    }
    const captured = yield* Result.try({
      try: () => ({
        syscallSequence: operation.syscallSequence,
        kind: operation.kind,
        targetDocumentId: operation.targetDocumentId,
        limit: operation.limit,
      }),
      catch: invalidApplicationRelationOperation,
    });
    if (captured.kind !== "relationIncoming") {
      return yield* Result.fail(
        invalidApplicationRelationOperation(
          new Error("Expected an incoming relation read operation."),
        ),
      );
    }
    const syscallSequence = yield* decodeCommitSyscallSequenceResult(
      captured.syscallSequence,
    ).pipe(Result.mapError(invalidApplicationRelationOperation));
    const definition = relation.resolved.definition;
    const target = yield* requireAppDocumentIdentityV1ForTableResult(
      captured.targetDocumentId,
      definition.binding.targetTableId,
    ).pipe(Result.mapError(invalidApplicationRelationOperation));
    if (
      !isPositiveSafeInteger(captured.limit) ||
      captured.limit > RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1
    ) {
      return yield* Result.fail(
        invalidApplicationRelationOperation(
          new Error(
            `Incoming relation limit must be between 1 and ${RELATION_INCOMING_PAGE_MAXIMUM_IDENTITIES_V1}.`,
          ),
        ),
      );
    }
    return Object.freeze({
      format: "flarex.session-journal-syscall" as const,
      codecVersion: 2 as const,
      kind: "relationIncoming" as const,
      syscallSequence,
      relationId: definition.binding.relationId,
      edgeDefinitionId: definition.edge.edgeDefinitionId,
      sourceTableId: definition.binding.sourceTableId,
      targetTableId: definition.binding.targetTableId,
      targetRowId: target.rowId,
      limit: captured.limit,
    });
  });
}

function invalidApplicationRelationOperation(
  cause: unknown,
): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation: "relationIncoming",
    reason: "invalidOperation",
    cause,
  });
}

function invalidIndexedQueryOperation(
  cause: unknown,
): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation: "indexRange",
    reason: "invalidOperation",
    cause,
  });
}

type CapturedPointOperationInputV1 = {
  readonly [Kind in SessionJournalPointOperationKindV1]: Readonly<{
    readonly kind: Kind;
    readonly source: Extract<SessionJournalPointOperationV1, { kind: Kind }>;
  }>;
}[SessionJournalPointOperationKindV1];

function capturePointOperationInputResult(
  operation: SessionJournalPointOperationV1,
): Result.Result<
  CapturedPointOperationInputV1,
  InvalidSessionJournalInputV1Error
> {
  return Result.try({
    try: () => {
      const operationKind = operation.kind;
      switch (operationKind) {
        case "get":
          return { kind: operationKind, source: operation };
        case "insert":
          return { kind: operationKind, source: operation };
        case "patch":
          return { kind: operationKind, source: operation };
        case "replace":
          return { kind: operationKind, source: operation };
        case "delete":
          return { kind: operationKind, source: operation };
      }
    },
    catch: (cause) => invalidPointOperation(operation.kind, cause),
  });
}

function readPointOperationInput<A>(
  operation: SessionJournalPointOperationV1,
  read: () => A,
): Result.Result<A, InvalidSessionJournalInputV1Error> {
  return Result.try({
    try: read,
    catch: (cause) => invalidPointOperation(operation.kind, cause),
  });
}

function invalidPointOperation(
  operation: SessionJournalPointOperationKindV1,
  cause: unknown,
): InvalidSessionJournalInputV1Error {
  return new InvalidSessionJournalInputV1Error({
    operation,
    reason: "invalidOperation",
    cause,
  });
}

/**
 * Temporary compatibility seam for the protocol's throwing value normalizer.
 * Delete this adapter when Value Codec V1 exposes its Result-native decoder.
 */
function normalizePointOperationValueResult(
  input: unknown,
  profile: "appDocument" | "generalValue",
  operation: SessionJournalPointOperationV1,
): Result.Result<
  ReturnType<typeof normalizeFlarexValueV1>,
  InvalidSessionJournalInputV1Error
> {
  return Result.try({
    try: () => normalizeFlarexValueV1(input, profile),
    catch: (cause) => {
      if (cause instanceof FlarexValueCodecV1Error) {
        return invalidPointOperation(operation.kind, cause);
      }
      throw cause;
    },
  });
}

function captureDeveloperFieldsValueJsonResult(
  input: unknown,
  operation: SessionJournalPointOperationV1,
): Result.Result<JsonObject, InvalidSessionJournalInputV1Error> {
  return Result.gen(function* () {
    const normalized = yield* normalizePointOperationValueResult(
      input,
      "appDocument",
      operation,
    );
    if (!isCanonicalFlarexRuntimeObjectV1(normalized.value)) {
      throw new Error("App-document normalization returned a non-object.");
    }
    for (const field of ["_id", "_creationTime"] as const) {
      if (Object.hasOwn(normalized.value, field)) {
        return yield* Result.fail(
          invalidPointOperation(
            operation.kind,
            new Error(`Developer fields contain reserved field ${field}.`),
          ),
        );
      }
    }
    if (!isJsonObject(normalized.valueJson)) {
      throw new Error("App-document JSON normalization returned a non-object.");
    }
    return cloneJsonObject(normalized.valueJson);
  });
}

function capturePatchChangesResult(
  input: unknown,
  operation: SessionJournalPointOperationV1,
): Result.Result<
  ReadonlyArray<LogicalPatchFieldV1>,
  InvalidSessionJournalInputV1Error
> {
  return Result.gen(function* () {
    const patch = yield* readPointOperationInput(operation, () =>
      isPlainObject(input) ? input : undefined,
    );
    if (patch === undefined) {
      return yield* Result.fail(
        invalidPointOperation(
          operation.kind,
          new Error("Patch must be a plain object."),
        ),
      );
    }
    const symbols = yield* readPointOperationInput(operation, () =>
      Object.getOwnPropertySymbols(patch),
    );
    if (symbols.length > 0) {
      return yield* Result.fail(
        invalidPointOperation(
          operation.kind,
          new Error("Patch cannot contain symbol fields."),
        ),
      );
    }
    const fields = yield* readPointOperationInput(operation, () =>
      Object.keys(patch),
    );
    fields.sort(compareUtf16Strings);
    if (fields.length > MAX_FLAREX_VALUE_OBJECT_FIELDS_V1) {
      return yield* Result.fail(
        invalidPointOperation(
          operation.kind,
          new Error(
            `Patch exceeds the ${MAX_FLAREX_VALUE_OBJECT_FIELDS_V1}-field limit.`,
          ),
        ),
      );
    }
    const changes: LogicalPatchFieldV1[] = [];
    for (const field of fields) {
      if (field === "_id" || field === "_creationTime") {
        return yield* Result.fail(
          invalidPointOperation(
            operation.kind,
            new Error(`Patch cannot modify reserved field ${field}.`),
          ),
        );
      }
      const descriptor = yield* readPointOperationInput(operation, () =>
        Object.getOwnPropertyDescriptor(patch, field),
      );
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        return yield* Result.fail(
          invalidPointOperation(
            operation.kind,
            new Error(`Patch field ${field} must be an enumerable data field.`),
          ),
        );
      }
      if (descriptor.value === undefined) {
        yield* normalizePointOperationValueResult(
          { [field]: null },
          "appDocument",
          operation,
        );
        changes.push(Object.freeze({ kind: "remove", field }));
        continue;
      }
      const fieldContainer = Object.create(null);
      Object.defineProperty(fieldContainer, field, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
      const normalized = yield* normalizePointOperationValueResult(
        fieldContainer,
        "generalValue",
        operation,
      );
      if (!isJsonObject(normalized.valueJson)) {
        throw new Error(`Patch field ${field} did not normalize as an object.`);
      }
      const valueJson = normalized.valueJson[field];
      if (valueJson === undefined) {
        throw new Error(`Patch field ${field} was lost during normalization.`);
      }
      changes.push(
        Object.freeze({
          kind: "set",
          field,
          valueJson,
        }),
      );
    }
    return Object.freeze(changes);
  });
}

function isPlainObject(
  input: unknown,
): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

export function cloneJsonObject(input: JsonObject): JsonObject {
  return structuredClone(input);
}
