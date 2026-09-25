import { Effect, Option, Result, Schema } from "effect";
import { eq, sql } from "drizzle-orm";
import { isNonArrayRecord } from "@flarex/utils/records";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { AppCreationTimeV1Schema, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import { canonicalizeFlarexValueV1Effect, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { readBoundedCurrentAppRowsInTransactionEffect, InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type AppRowRevisionV1 } from "../appRows";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result, type LoweredCanonicalAppUniqueConstraintV1 } from "../appUniqueConstraintCommitV1";
import { readAppUniqueKeySlotInTransactionEffect, AppUniqueKeyPersistenceError, AppUniqueKeyHashError } from "../appUniqueKeys";
import type { AppUniqueConstraintIdV1, AppUniqueKeyProjectionV1 } from "../appUniqueKeyContract";
import { capturePrivateJsonData } from "../privateJsonData";
import type { PointCommitDependencyV1 } from "../pointCommitTransaction";
import type { ApplicationDocumentObservation } from "../applicationDocumentMaterialization/model";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../appDeveloperIndexCommitV1";
import { readLogicalIndexRange, readLogicalIndexPage, type LogicalIndexRead, type LogicalIndexPageRead } from "./indexReads";
import type { AppIndexRangeCursorV1 } from "../appIndexEntries";
import { decodeLogicalFindQuery, isLogicalRange, selectLogicalIndex, selectLogicalPageIndex, logicalQueryMatches, type LogicalWhere } from "./query";
import { compileLogicalRelationalRead } from "./relationalQuery";
import { decodeLogicalAggregate, sumLogicalRows } from "./aggregate";
import { relationalTextIdentity } from "./relationalRows";
import { prepareLogicalRelationalRows } from "./relationalRows";
import { prepareLogicalRelationalForeignKeys } from "./relationalForeignKeys";
import { runDrizzleStatementEffect } from "../drizzleStatementEffect";
import { databaseTimestampFromUnknown } from "../databaseTimestamp";
import { fxSystemScopeClocks } from "../schema";
import type { BoundedRequestContext, PresentedTransactionId, BoundedRequestLifetime } from "../boundedRequestLifetime";
import type { LogicalDocumentWorkingSetInput, LogicalRelationalStore } from "./model";
const decodeRelationalChange = Schema.decodeUnknownResult(Schema.Literals(["insert", "upsert", "update", "delete", "softDelete", "restore"]));
const uniqueReadKey = (definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1) =>
  projected.kind === "claim"
    ? JSON.stringify([definition.uniqueConstraintDefinitionId, projected.localeKey, projected.encodedKey])
    : null;

interface PendingDocument {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly rowId: AppRowIdHexV1;
  readonly documentId: AppDocumentIdV1;
  readonly base: AppRowRevisionV1 | null;
  readonly creationTime: AppCreationTimeV1;
  current: CanonicalFlarexValueV1 | null;
  deletedValue?: CanonicalFlarexValueV1;
  readonly attempts: number[];
}
export type LogicalDocumentChange = ApplicationDocumentObservation & (
  | Readonly<{ kind: "live"; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }>
  | Readonly<{ kind: "deleted" }>
);
export interface LogicalDocumentAttempt {
  readonly ordinal: number;
  readonly documentId: AppDocumentIdV1;
  readonly operation: "insert" | "patch" | "replace" | "delete";
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly before: CanonicalFlarexValueV1 | null;
  readonly after: CanonicalFlarexValueV1 | null;
}
export interface LogicalRelationalLifecycleObservation {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly key: Readonly<Record<string, string>>;
  readonly operation: "softDelete" | "restore";
  readonly beforeDeletedAt: string | null;
  readonly afterDeletedAt: string | null;
  readonly attemptOrdinal: number | null;
  /** Captured at an unchanged restore, before a later call can change the row. */
  readonly rowAtOperation: JsonObject | null;
}
/** Final pending rows already observed within this working set. Canonical
 * values are immutable; their point/index dependencies settle with changes. */
export interface LogicalDocumentObservedRow {
  readonly documentId: AppDocumentIdV1;
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly value: JsonObject;
}
export interface LogicalDocumentChanges {
  readonly changes: readonly LogicalDocumentChange[];
  readonly attempts: readonly LogicalDocumentAttempt[];
  readonly lifecycle: readonly LogicalRelationalLifecycleObservation[];
  readonly observedRows: readonly LogicalDocumentObservedRow[];
  readonly noFinalRows: readonly AppDocumentIdV1[];
  readonly dependencies: readonly ApplicationDocumentObservation[];
  readonly scans: readonly Readonly<{ tableId: CatalogTableId; frontier: CommitSeq | null }>[];
  readonly uniqueReads: readonly LogicalUniqueRead[];
  readonly indexReads: readonly LogicalIndexRead[];
  readonly pageReads: readonly LogicalIndexPageRead[];
  readonly setNull: readonly LogicalSetNullIntent[];
  readonly referenceReplacements: readonly LogicalReferenceReplacementIntent[];
}
/** A sealed command decision; affected rows are selected only by the trusted
 * settlement owner after publication exclusion. */
export interface LogicalSetNullIntent {
  readonly sourceTableId: CatalogTableId;
  readonly sourceColumn: string;
  readonly targetTableId: CatalogTableId;
  readonly targetColumn: string;
  readonly targetKey: string;
}
/** The framework chooses one root and desired keys. Core selects and lowers
 * the complete affected set after publication exclusion. */
export interface LogicalReferenceReplacementIntent extends LogicalSetNullIntent {
  readonly desiredKeys: readonly string[];
}
export interface LogicalUniqueRead {
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly key: AppUniqueKeyProjectionV1;
  readonly owner: Readonly<{ tableId: CatalogTableId; rowId: AppRowIdHexV1 }> | null;
}
export interface LogicalDocuments<Failure> {
  readonly get: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<JsonObject | null, Failure>;
  readonly getMany: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    documentIds: readonly string[]) => Effect.Effect<readonly (JsonObject | null)[], Failure>;
  readonly find: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string,
    query: Readonly<{ where: JsonObject; offset: number; limit: number }>) => Effect.Effect<Readonly<{ docs: readonly JsonObject[]; total: number }>, Failure>;
  readonly insert: (context: BoundedRequestContext, id: PresentedTransactionId, tableName: string, fields: unknown) => Effect.Effect<JsonObject, Failure>;
  readonly patch: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, Failure>;
  readonly replace: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, Failure>;
  readonly delete: (context: BoundedRequestContext, id: PresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<void, Failure>;
}

export interface LogicalDocumentReadTestHooks<Failure> {
  readonly beforeRead?: (selection: "point" | "batch" | "scan" | "index") => Effect.Effect<void, Failure>;
  readonly observeQuery?: Parameters<typeof readBoundedCurrentAppRowsInTransactionEffect>[2];
  readonly observeIndexQuery?: Parameters<typeof readLogicalIndexRange>[5];
}

/** One pending document/index/constraint working set for a trusted relational
 * profile. Native execution, schema validation and settlement stay with their owners. */
export const makeLogicalDocumentWorkingSet = Effect.fn("LogicalDocuments.make")(function* <Failure>(
  configuration: LogicalDocumentWorkingSetInput<Failure>,
  creationTime: AppCreationTimeV1,
  uniqueInput: readonly LocatedAppUniqueConstraintDefinitionV1[],
  indexInput: readonly LocatedAppIndexDefinitionV1[],
  testHooks?: LogicalDocumentReadTestHooks<Failure>,
) {
  const state = Object.freeze({ ...configuration, limits: Object.freeze({ ...configuration.limits }),
    relationalCapabilities: configuration.relationalCapabilities === undefined ? undefined : Object.freeze(structuredClone(configuration.relationalCapabilities)),
    tables: Object.freeze(configuration.tables.map(table => Object.freeze({ ...table,
      ...(table.relational === undefined ? {} : { relational: structuredClone(table.relational) }) }))) });
  const uniqueDefinitions = Object.freeze([...uniqueInput]);
  const indexDefinitions = Object.freeze([...indexInput]);
  yield* state.requireAdmission;
  const foreignKeys = yield* Effect.fromResult(prepareLogicalRelationalForeignKeys(state.tables, state.error));
  for (const foreignKey of foreignKeys) {
    const reverse = yield* Effect.fromResult(selectLogicalIndex(indexDefinitions, foreignKey.source.tableId,
      { [foreignKey.source.column]: "" }, state.error));
    const target = yield* Effect.fromResult(selectLogicalIndex(indexDefinitions, foreignKey.target.tableId,
      { [foreignKey.target.column]: "" }, state.error));
    if (Option.isNone(reverse) || Option.isNone(target)) return yield* Effect.fail(state.error("invalidInput"));
  }
  const { lifetime, tables, limits, error } = state;
  const transactionTime = yield* Effect.cached(Effect.gen(function* () {
    const result = yield* runDrizzleStatementEffect(state.tx.select({ timestamp: sql<unknown>`current_timestamp` })
      .from(fxSystemScopeClocks).where(eq(fxSystemScopeClocks.scopeId, state.scopeId)), cause => error("statementFailure", cause));
    const value = databaseTimestampFromUnknown(result[0]?.timestamp);
    if (value === null) return yield* Effect.fail(error("storedCorruption"));
    return value.toISOString();
  }));
  const rows = new Map<AppDocumentIdV1, PendingDocument>();
  const setNull: LogicalSetNullIntent[] = [];
  const referenceReplacements: LogicalReferenceReplacementIntent[] = [];
  const runOperation: BoundedRequestLifetime<Failure>["operation"] = (context, id, mode, work) =>
    lifetime.operation(context, id, mode, state.requireAdmission.pipe(Effect.flatMap(() =>
      closed ? Effect.fail(error("closed")) : setNull.length > 0 || referenceReplacements.length > 0
        ? Effect.fail(error("invalidAuthority")) : work)));
  const requirePendingDeletion = Effect.fn("LogicalDocuments.requirePendingDeletion")(function* (documentId: string) {
    yield* state.requireAdmission;
    if (setNull.length > 0 || referenceReplacements.length > 0) return yield* Effect.fail(error("invalidAuthority"));
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId).pipe(Result.mapError(cause => error("invalidInput", cause))));
    const row = rows.get(identity.id);
    if (row === undefined || row.current !== null || row.attempts.length === 0) return yield* Effect.fail(error("invalidAuthority"));
    return Object.freeze({ documentId: row.documentId, tableName: row.tableName });
  });
  const scanned = new Map<CatalogTableId, CommitSeq>();
  const dependencies = new Map<AppDocumentIdV1, ApplicationDocumentObservation>();
  const scans = new Map<CatalogTableId, CommitSeq | null>();
  const uniqueReads = new Map<string, LogicalUniqueRead>();
  const indexReads = new Map<string, LogicalIndexRead>();
  const pageReads: LogicalIndexPageRead[] = [];
  const attempts: LogicalDocumentAttempt[] = [];
  const lifecycle: LogicalRelationalLifecycleObservation[] = [];
  let inserted = 0;
  let closed = false;
  const tableForName = (name: string) => {
    const table = tables.find(candidate => candidate.logicalName === name);
    return table === undefined ? Result.fail(error("invalidAuthority")) : Result.succeed(table);
  };
  const tableForId = (id: CatalogTableId) => {
    const table = tables.find(candidate => candidate.tableId === id);
    return table === undefined ? Result.fail(error("invalidAuthority")) : Result.succeed(table);
  };
  const charge = (bytes: number) => Effect.fromResult(lifetime.charge(bytes));
  const observe = Effect.fn("LogicalDocuments.observe")(function* (
    tableId: CatalogTableId, rowId: AppRowIdHexV1, base: AppRowRevisionV1 | null,
    readAt = scanned.get(tableId) ?? state.clock.lastCommitSeq,
  ) {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    if (dependencies.has(documentId)) return;
    if (dependencies.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
    yield* charge(128);
    const observed: PointCommitDependencyV1["dependency"]["observed"] = base?.kind === "live"
      ? Object.freeze({ kind: "present", revisionCommitSeq: base.commitSeq })
      : Object.freeze({ kind: "missing", basis: base === null
        ? Object.freeze({ kind: "noVisibleRevision" })
        : Object.freeze({ kind: "tombstone", revisionCommitSeq: base.commitSeq }) });
    dependencies.set(documentId, Object.freeze({ documentId, tableId, rowId, readAt,
      dependency: Object.freeze({ kind: "appRowPoint", documentId, observed }) }));
  });
  const captureFields = (input: unknown) => Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, Math.min(limits.documentBytes, lifetime.remainingBytes()), error);
    if (!isJsonObject(captured.value) || Object.keys(captured.value).some(key => key.startsWith("_"))) {
      return yield* Result.fail(error("documentInvalid"));
    }
    yield* lifetime.charge(captured.bytes);
    return captured.value;
  });
  const output = (document: CanonicalFlarexValueV1, returned = false): Result.Result<JsonObject, Failure> =>
    capturePrivateJsonData(document.value, limits.documentBytes, error).pipe(
      Result.flatMap(captured => Result.gen(function* () {
        if (!isJsonObject(captured.value)) return yield* Result.fail(error("storedCorruption"));
        if (returned) yield* lifetime.charge(captured.bytes);
        return captured.value;
      })),
    );
  const readBase = Effect.fn("LogicalDocuments.readBase")(function* (tableId: CatalogTableId, rowId?: AppRowIdHexV1, rowIds?: readonly AppRowIdHexV1[]) {
    yield* state.requireAdmission;
    if (closed) return yield* Effect.fail(error("closed"));
    const table = yield* Effect.fromResult(tableForId(tableId));
    if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead(rowIds !== undefined ? "batch" : rowId !== undefined ? "point" : "scan");
    const capture = yield* readBoundedCurrentAppRowsInTransactionEffect(state.tx, {
      scopeId: state.scopeId, tableId, minimumCommitSeq: state.clock.lastCommitSeq,
      maximumIdentities: rowIds === undefined ? limits.identities : limits.identities - dependencies.size, maximumDocumentBytes: limits.documentBytes,
      maximumTotalValueBytes: lifetime.remainingBytes(), ...(rowId === undefined ? {} : { rowId }),
      ...(rowIds === undefined ? {} : { rowIds }),
    }, testHooks?.observeQuery).pipe(Effect.mapError(cause => error(cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
      ? "limitExceeded" : cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause)));
    const loaded = capture.rows;
    for (const base of loaded) {
      const documentId = appDocumentIdV1FromRowIdentity(base);
      const alreadyObserved = dependencies.has(documentId);
      yield* observe(tableId, base.rowId, base, capture.commitSeq);
      // A later scan must not replace a cached absence with a newly committed
      // row. Settlement detects the conflicting dependency; reads stay repeatable.
      if (alreadyObserved || rows.has(documentId)) continue;
      if (rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
      yield* charge(128 + (base.kind === "live" ? base.document.canonicalBytes.byteLength : 0));
      rows.set(documentId, { tableId, tableName: table.logicalName, rowId: base.rowId, documentId, base,
        creationTime: base.creationTime, current: base.kind === "live" ? base.document : null, attempts: [] });
    }
    for (const selected of rowIds ?? (rowId === undefined ? [] : [rowId])) {
      if (!dependencies.has(appDocumentIdV1FromRowIdentity({ tableId, rowId: selected }))) {
        yield* observe(tableId, selected, null, capture.commitSeq);
      }
    }
    if (rowId === undefined && rowIds === undefined) {
      let frontier: CommitSeq | null = null;
      for (const base of loaded) if (frontier === null || base.commitSeq > frontier) frontier = base.commitSeq;
      yield* charge(64);
      scans.set(tableId, frontier);
      scanned.set(tableId, capture.commitSeq);
    }
  });
  const locate = Effect.fn("LogicalDocuments.locate")(function* (inputId: string, tableName?: string) {
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(inputId).pipe(Result.mapError(cause => error("invalidInput", cause))));
    yield* Effect.fromResult(tableForId(identity.tableId));
    if (tableName !== undefined && (yield* Effect.fromResult(tableForName(tableName))).tableId !== identity.tableId) {
      return yield* Effect.fail(error("invalidInput"));
    }
    if (!dependencies.has(identity.id) && !scanned.has(identity.tableId)) yield* readBase(identity.tableId, identity.rowId);
    if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
    return { identity, pending: rows.get(identity.id) };
  });
  const locateUnique = Effect.fn("LogicalDocuments.locateUnique")(function* (
    definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1,
  ) {
    const readKey = uniqueReadKey(definition, projected);
    if (projected.kind !== "claim" || readKey === null) return null;
    const cached = uniqueReads.get(readKey);
    if (cached !== undefined) return cached.owner === null ? null : appDocumentIdV1FromRowIdentity(cached.owner);
    const slot = yield* readAppUniqueKeySlotInTransactionEffect(state.tx, { scopeId: state.scopeId,
      constraintId: definition.uniqueConstraintDefinitionId, key: projected.projection }).pipe(Effect.mapError(cause =>
      error(cause instanceof AppUniqueKeyPersistenceError ? "statementFailure" : cause instanceof AppUniqueKeyHashError ? "resourceFailure" : "storedCorruption", cause)));
    if (Option.isSome(slot)) {
      const owner = slot.value;
      if (owner.tableId !== definition.tableId) return yield* Effect.fail(error("storedCorruption"));
      const { pending: owned } = yield* locate(appDocumentIdV1FromRowIdentity(owner));
      // Slot and owner revision were captured together. A cached or later row
      // capture can differ legitimately under concurrent publication.
      if (owned?.base?.commitSeq !== owner.ownerCommitSeq) return yield* Effect.fail(error("writeConflict"));
      if (owned.base.kind !== "live") return yield* Effect.fail(error("storedCorruption"));
      const base = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, owned.base.document)
        .pipe(Result.mapError(cause => error("storedCorruption", cause))));
      if (base.kind !== "claim" || base.localeKey !== projected.localeKey ||
        base.encodedKey !== projected.encodedKey) return yield* Effect.fail(error("storedCorruption"));
    }
    const ownerId = Option.isNone(slot) ? null : appDocumentIdV1FromRowIdentity(slot.value);
    yield* charge(128 + projected.canonicalKeyBytes.byteLength);
    uniqueReads.set(readKey, Object.freeze({ constraintId: definition.uniqueConstraintDefinitionId,
      key: projected.projection, owner: Option.isNone(slot) ? null : Object.freeze({ tableId: slot.value.tableId, rowId: slot.value.rowId }) }));
    return ownerId;
  });
  const ensureUnique = Effect.fn("LogicalDocuments.validateUnique")(function* (pending: PendingDocument, document: CanonicalFlarexValueV1) {
    for (const definition of uniqueDefinitions) {
      if (definition.tableId !== pending.tableId) continue;
      const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
        .pipe(Result.mapError(cause => error("documentInvalid", cause))));
      if (projected.kind !== "claim") continue;
      yield* locateUnique(definition, projected);
      for (const other of rows.values()) {
        if (other.tableId !== pending.tableId || other.documentId === pending.documentId || other.current === null) continue;
        const existing = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, other.current)
          .pipe(Result.mapError(cause => error("storedCorruption", cause))));
        if (existing.kind === "claim" && existing.localeKey === projected.localeKey &&
          existing.encodedKey === projected.encodedKey) return yield* Effect.fail(state.uniqueConflict(Object.freeze({ tableName: pending.tableName,
            orderedFields: Object.freeze([...definition.physicalSpec.orderedFields]) })));
      }
    }
  });
  const recordAttempt = (pending: PendingDocument, operation: LogicalDocumentAttempt["operation"],
    after: CanonicalFlarexValueV1 | null) => {
    const attempt = Object.freeze({ ordinal: attempts.length, documentId: pending.documentId, operation,
      tableId: pending.tableId, tableName: pending.tableName, before: pending.current, after });
    return lifetime.charge(128).pipe(Result.map(() => {
      pending.attempts.push(attempt.ordinal);
      attempts.push(attempt);
    }));
  };
  const write = Effect.fn("LogicalDocuments.validateWrite")(function* (pending: PendingDocument, fields: JsonObject,
    operation: "insert" | "patch" | "replace") {
    const document = yield* canonicalizeFlarexValueV1Effect({ ...fields, _id: pending.documentId, _creationTime: pending.creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => error("documentInvalid", cause)));
    if (document.canonicalBytes.byteLength > limits.documentBytes) return yield* Effect.fail(error("limitExceeded"));
    yield* state.validateDocument({ operation, tableName: pending.tableName, tableId: pending.tableId, documentId: pending.documentId,
      creationTime: pending.creationTime, document });
    yield* ensureUnique(pending, document);
    if (!rows.has(pending.documentId) && rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
    yield* charge(document.canonicalBytes.byteLength);
    yield* Effect.fromResult(recordAttempt(pending, operation, document));
    pending.current = document;
    rows.set(pending.documentId, pending);
    return yield* Effect.fromResult(output(document, true));
  });
  const get: LogicalDocuments<Failure>["get"] = Effect.fn("LogicalDocuments.get")((context, id, documentId, tableName) =>
    runOperation(context, id, "read", locate(documentId, tableName).pipe(Effect.flatMap(({ pending }) =>
      pending?.current == null ? Effect.succeed(null) : Effect.fromResult(output(pending.current, true))))));
  const getMany: LogicalDocuments<Failure>["getMany"] = Effect.fn("LogicalDocuments.getMany")((context, id, tableName, input) =>
    runOperation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      if (!Array.isArray(captured.value) || captured.value.length > limits.pageRows) return yield* Effect.fail(error("limitExceeded"));
      const table = yield* Effect.fromResult(tableForName(tableName));
      const identities = yield* Effect.forEach(captured.value, value => Effect.fromResult(decodeAppDocumentIdentityV1Result(value)
        .pipe(Result.mapError(cause => error("invalidInput", cause)))));
      if (identities.some(identity => identity.tableId !== table.tableId) || new Set(identities.map(identity => identity.id)).size !== identities.length) {
        return yield* Effect.fail(error("invalidInput"));
      }
      const missing = identities.filter(identity => !dependencies.has(identity.id));
      if (!scanned.has(table.tableId) && dependencies.size + missing.length > limits.identities) return yield* Effect.fail(error("limitExceeded"));
      if (!scanned.has(table.tableId) && missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(identity => identity.rowId));
      for (const identity of missing) if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
      return Object.freeze(yield* Effect.forEach(identities, identity => {
        const pending = rows.get(identity.id);
        return pending?.current == null ? Effect.succeed(null) : Effect.fromResult(output(pending.current, true));
      }));
    })));
  const insertRecord = Effect.fn("LogicalDocuments.insertRecord")(function* (tableName: string, input: unknown) {
      const table = yield* Effect.fromResult(tableForName(tableName));
      const fields = yield* Effect.fromResult(captureFields(input));
      if (rows.size >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
      yield* charge(128);
      const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(crypto.getRandomValues(new Uint8Array(16)))
        .pipe(Result.mapError(cause => error("resourceFailure", cause))));
      const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
      const existing = yield* locate(documentId);
      if (existing.pending !== undefined) return yield* Effect.fail(error("uniqueConflict"));
      const time = AppCreationTimeV1Schema.make(creationTime + inserted++);
      return yield* write({ tableId: table.tableId, tableName, rowId, documentId, base: null,
        creationTime: time, current: null, attempts: [] }, fields, "insert");
    });
  const insert: LogicalDocuments<Failure>["insert"] = Effect.fn("LogicalDocuments.insert")((context, id, tableName, input) =>
    runOperation(context, id, "write", insertRecord(tableName, input)));
  const edit = Effect.fn("LogicalDocuments.edit")((context: BoundedRequestContext, id: PresentedTransactionId,
    documentId: string, input: unknown, operation: "patch" | "replace", tableName?: string) => runOperation(context, id, "write", Effect.gen(function* () {
      const fields = yield* Effect.fromResult(captureFields(input));
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(error("documentMissing"));
      const previous = yield* Effect.fromResult(output(pending.current));
      const { _id: _documentId, _creationTime: _created, ...developerFields } = previous;
      return yield* write(pending, operation === "patch" ? { ...developerFields, ...fields } : fields, operation);
    })));
  const remove: LogicalDocuments<Failure>["delete"] = Effect.fn("LogicalDocuments.delete")((context, id, documentId, tableName) =>
    runOperation(context, id, "write", Effect.gen(function* () {
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(error("documentMissing"));
      yield* Effect.fromResult(recordAttempt(pending, "delete", null));
      pending.deletedValue = pending.current;
      pending.current = null;
    })));
  const selectCandidates = Effect.fn("LogicalDocuments.selectCandidates")(function* (tableName: string, where: LogicalWhere, indexedOnly = false) {
    const table = yield* Effect.fromResult(tableForName(tableName));
    let candidates: Iterable<PendingDocument> = rows.values();
    if (where._id !== undefined) {
      const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(where._id).pipe(
        Result.mapError(cause => error("invalidInput", cause))));
      if (identity.tableId !== table.tableId) return yield* Effect.fail(error("invalidInput"));
      const { pending } = yield* locate(identity.id, tableName);
      candidates = pending === undefined ? [] : [pending];
    } else {
      const definition = uniqueDefinitions.find(candidate => candidate.tableId === table.tableId &&
        candidate.physicalSpec.predicate === undefined &&
        !(candidate.physicalSpec.nullsDistinct === true && candidate.physicalSpec.orderedFields.some(field => where[field] === null)) &&
        candidate.physicalSpec.orderedFields.every(field => !field.includes(".") && Object.hasOwn(where, field) && !isLogicalRange(where[field])));
      if (definition === undefined) {
        const selected = yield* Effect.fromResult(selectLogicalIndex(indexDefinitions, table.tableId, where, error));
        if (Option.isNone(selected)) {
            if (indexedOnly || Object.values(where).some(isLogicalRange)) return yield* Effect.fail(error("invalidInput"));
          if (!scanned.has(table.tableId)) yield* readBase(table.tableId);
          candidates = rows.values();
        } else if (!scanned.has(table.tableId) || indexReads.has(selected.value.identity)) {
          const selection = selected.value;
          let read = indexReads.get(selection.identity);
          if (read === undefined) {
            if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
            const entries = yield* readLogicalIndexRange(state.tx, state.scopeId, selection, limits.identities, error, testHooks?.observeIndexQuery);
            yield* charge(128 + entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
            if (entries.some(entry => entry.tableId !== table.tableId) || new Set(entries.map(entry => entry.rowId)).size !== entries.length) {
              return yield* Effect.fail(error("storedCorruption"));
            }
            const missing = entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
            if (!scanned.has(table.tableId) && missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(entry => entry.rowId));
            for (const entry of entries) {
              const { pending } = yield* locate(appDocumentIdV1FromRowIdentity(entry));
              if (pending?.base?.kind !== "live" || pending.base.commitSeq < entry.commitSeq) return yield* Effect.fail(error("writeConflict"));
              const encoded = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, pending.base.document, pending.base.creationTime)
                .pipe(Result.mapError(cause => error("storedCorruption", cause))));
              if (encoded !== entry.encodedKey) return yield* Effect.fail(error("writeConflict"));
            }
            read = Object.freeze({ definition: selection.definition, bounds: selection.bounds, entries });
            indexReads.set(selection.identity, read);
          }
          const members = new Set(read.entries.map(entry => appDocumentIdV1FromRowIdentity(entry)));
          candidates = [...rows.values()].filter(row => row.tableId === table.tableId && (members.has(row.documentId) || row.attempts.length > 0));
        }
      } else {
        const document = yield* canonicalizeFlarexValueV1Effect(where, "appDocument")
          .pipe(Effect.mapError(cause => error("invalidInput", cause)));
        const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
          .pipe(Result.mapError(cause => error("invalidInput", cause))));
        const readKey = uniqueReadKey(definition, projected);
        if (readKey === null) return yield* Effect.fail(error("invalidInput"));
        // An earlier key observation survives later scans. Otherwise a prior
        // scan already owns this key's committed view. Local edits apply to both.
        if (!scanned.has(table.tableId) || uniqueReads.has(readKey)) {
          const ownerId = yield* locateUnique(definition, projected);
          candidates = [...rows.values()].filter(row => row.tableId === table.tableId &&
            (row.documentId === ownerId || row.attempts.length > 0));
        }
      }
    }
    return candidates;
  });
  const find: LogicalDocuments<Failure>["find"] = Effect.fn("LogicalDocuments.find")((context, id, tableName, input) =>
    runOperation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      const query = yield* Effect.fromResult(decodeLogicalFindQuery(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause))));
      if (query.limit > limits.pageRows) return yield* Effect.fail(error("invalidInput"));
      const table = yield* Effect.fromResult(tableForName(tableName));
      const candidates = yield* selectCandidates(tableName, query.where);
      const matched: { id: AppDocumentIdV1; document: CanonicalFlarexValueV1 }[] = [];
      for (const row of candidates) {
        if (row.tableId !== table.tableId || row.current === null) continue;
        const document = row.current.value;
        if (!isNonArrayRecord(document)) return yield* Effect.fail(error("storedCorruption"));
        if (yield* Effect.fromResult(logicalQueryMatches(document, query.where, error))) matched.push({ id: row.documentId, document: row.current });
      }
      matched.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const docs = yield* Effect.forEach(matched.slice(query.offset, query.offset + query.limit), row => Effect.fromResult(output(row.document, true)));
      return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
    })));
  const readRelationalSelection = Effect.fn("LogicalDocuments.readRelationalSelection")(function* (tableName: string, input: unknown, complete = false) {
    const table = yield* Effect.fromResult(tableForName(tableName));
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* Effect.fromResult(compileLogicalRelationalRead(table.relational, state.relationalCapabilities, captured.value, limits.pageRows, error));
    if (complete && query.selections === null) return yield* Effect.fail(error("invalidInput"));
    const selected = new Map<AppDocumentIdV1, PendingDocument>();
    // A null predicate required by every Boolean branch may use an admitted
    // active-row index. Otherwise the first text identity member's range is the
    // bounded complete-set path; a page limit never turns into a table scan.
    let completeSelection: LogicalWhere = { [query.key]: { gte: "" } };
    let indexedNullAnchor = false;
    if (query.selections === null) for (const field of query.requiredNulls) {
      const candidate: LogicalWhere = { [field]: null };
      const index = yield* Effect.fromResult(selectLogicalIndex(indexDefinitions, table.tableId, candidate, error));
      if (Option.isSome(index)) { completeSelection = candidate; indexedNullAnchor = true; break; }
    }
    if (query.requiresIndexedNullAnchor && !indexedNullAnchor) return yield* Effect.fail(error("invalidInput"));
    const selections: LogicalWhere[] = query.selections === null ? [completeSelection] :
      query.selections.map(selection => ({ [selection.column]: selection.value,
        ...(selection.nullColumn === undefined ? {} : { [selection.nullColumn]: null }) }));
    for (const where of selections) for (const row of yield* selectCandidates(tableName, where, true)) {
      if (row.tableId === table.tableId && row.current !== null) selected.set(row.documentId, row);
    }
    const matched: { document: JsonObject; order: Uint8Array; documentId: AppDocumentIdV1 }[] = [];
    for (const row of selected.values()) {
      if (row.current === null) continue;
      const document = yield* Effect.fromResult(output(row.current, true));
      const inspected = yield* Effect.fromResult(query.inspect(document));
      if (inspected.matches) matched.push({ document, order: inspected.order, documentId: row.documentId });
    }
    matched.sort((left, right) => {
      const ordered = compareBytesLexicographically(left.order, right.order) * (query.direction === "asc" ? 1 : -1);
      return ordered || left.documentId.localeCompare(right.documentId);
    });
    const docs: JsonObject[] = [];
    for (const row of complete ? matched : matched.slice(query.offset, query.offset + query.limit)) {
      const projected: Record<string, Json> = {};
      for (const field of query.fields) {
        const value = row.document[field];
        if (value === undefined) return yield* Effect.fail(error("storedCorruption"));
        projected[field] = value;
      }
      const capturedOutput = yield* Effect.fromResult(capturePrivateJsonData(projected, limits.documentBytes, error));
      yield* charge(capturedOutput.bytes);
      docs.push(projected);
    }
    return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
  });
  const relationalFind = Effect.fn("LogicalDocuments.relationalFind")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => runOperation(context, id, "read", readRelationalSelection(tableName, input)));

  const relationalPage = Effect.fn("LogicalDocuments.relationalPage")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => runOperation(context, id, "read", Effect.gen(function* () {
    const table = yield* Effect.fromResult(tableForName(tableName));
    if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* Effect.fromResult(compileLogicalRelationalRead(table.relational, state.relationalCapabilities, captured.value, limits.pageRows, error));
    if (query.direction !== "asc" || query.selections !== null && query.selections.length > 1)
      return yield* Effect.fail(error("invalidInput"));
    if (query.offset >= limits.identities) return yield* Effect.fail(error("limitExceeded"));
    if (query.selections?.length === 0) return Object.freeze({ rows: Object.freeze([]), hasMore: false });
    const selected = yield* Effect.fromResult(selectLogicalPageIndex(indexDefinitions, table.tableId,
      query.orderColumn, query.selections?.[0], query.requiredNulls, error));
    if (Option.isNone(selected)) return yield* Effect.fail(error("invalidInput"));
    const selection = selected.value;
    type Member = { row: PendingDocument; key: string; document: JsonObject };
    const matched = new Map<AppDocumentIdV1, Member>();

    const add = Effect.fn("LogicalDocuments.pageMember")(function* (row: PendingDocument) {
      if (row.current === null) return;
      const key = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, row.current, row.creationTime)
        .pipe(Result.mapError(cause => error("storedCorruption", cause))));
      if (key === null || selection.bounds.startInclusive !== undefined && String(key) < String(selection.bounds.startInclusive) ||
        selection.bounds.endExclusive !== undefined && String(key) >= String(selection.bounds.endExclusive)) return;
      const document = yield* Effect.fromResult(output(row.current, true));
      const inspected = yield* Effect.fromResult(query.inspect(document));
      if (inspected.matches) matched.set(row.documentId, { row, key, document });
    });
    let examined = 0;
    for (const row of rows.values()) if (row.tableId === table.tableId && row.attempts.length > 0) {
      if (++examined > limits.identities) return yield* Effect.fail(error("limitExceeded"));
      yield* charge(64);
      yield* add(row);
    }
    const needed = query.offset + query.limit + 1;
    let after: AppIndexRangeCursorV1 | undefined;
    let result: Member[] = [];
    while (true) {
      const remaining = limits.identities - examined;
      if (remaining < 1) return yield* Effect.fail(error("limitExceeded"));
      // Batch residual filtering while charging the actual hidden lookahead.
      const limit = Math.min(Math.max(16, needed - matched.size), remaining);
      if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
      const page = yield* readLogicalIndexPage(state.tx, state.scopeId, { ...selection, ...(after === undefined ? {} : { after }) },
        limit, error, testHooks?.observeIndexQuery);
      examined += page.entries.length + (page.isDone ? 0 : 1);
      if (examined > limits.identities) return yield* Effect.fail(error("limitExceeded"));
      yield* charge(128 + page.entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
      const read = Object.freeze({ ...selection, ...(after === undefined ? {} : { after: Object.freeze({ ...after }) }),
        entries: page.entries, isDone: page.isDone });
      pageReads.push(read);
      if (page.entries.some(entry => entry.tableId !== table.tableId)) return yield* Effect.fail(error("storedCorruption"));
      const missing = page.entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
      if (missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(entry => entry.rowId));
      for (const entry of page.entries) {
        const { pending } = yield* locate(appDocumentIdV1FromRowIdentity(entry), tableName);
        if (pending?.base?.kind !== "live" || pending.base.commitSeq < entry.commitSeq) return yield* Effect.fail(error("writeConflict"));
        const baseKey = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, pending.base.document, pending.base.creationTime)
          .pipe(Result.mapError(cause => error("storedCorruption", cause))));
        if (baseKey !== entry.encodedKey) return yield* Effect.fail(error("writeConflict"));
        if (pending.attempts.length === 0) yield* add(pending);
      }
      result = [...matched.values()].toSorted((left, right) => comparePagePosition({ key: left.key, rowId: left.row.rowId }, { key: right.key, rowId: right.row.rowId }));
      const frontier = result[needed - 1], witness = page.entries[page.entries.length - 1];
      // A pending-only frontier still requires a committed successor or EOF.
      // Each captured window includes that witness, protecting its negative gap.
      if (page.isDone || frontier !== undefined && witness !== undefined &&
        comparePagePosition({ key: frontier.key, rowId: frontier.row.rowId }, { key: witness.encodedKey, rowId: witness.rowId }) <= 0) break;
      if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
      after = page.continueCursor;
    }
    const projected: JsonObject[] = [];
    for (const member of result.slice(query.offset, query.offset + query.limit)) {
      const row: Record<string, Json> = {};
      for (const field of query.fields) {
        const value = member.document[field];
        if (value === undefined) return yield* Effect.fail(error("storedCorruption"));
        row[field] = value;
      }
      const capturedRow = yield* Effect.fromResult(capturePrivateJsonData(row, limits.documentBytes, error));
      yield* charge(capturedRow.bytes);
      projected.push(row);
    }
    return Object.freeze({ rows: Object.freeze(projected), hasMore: result.length > query.offset + query.limit });
  })));
  const relationalAggregate = Effect.fn("LogicalDocuments.relationalAggregate")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, input: unknown) => runOperation(context, id, "read", Effect.gen(function* () {
    const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
    yield* charge(captured.bytes);
    const query = yield* Effect.fromResult(decodeLogicalAggregate(captured.value).pipe(Result.mapError(cause => error("invalidInput", cause))));
    const table = yield* Effect.fromResult(tableForName(tableName));
    if (table.relational === undefined) return yield* Effect.fail(error("invalidAuthority"));
    const key = (yield* Effect.fromResult(relationalTextIdentity(table.relational, error)))[0];
    if (key === undefined) return yield* Effect.fail(error("invalidInput"));
    if (query.sum !== undefined) {
      const column = table.relational.columns.find(candidate => candidate.identity.columnId === query.sum);
      if (column?.type !== "numeric" && column?.type !== "integer") return yield* Effect.fail(error("invalidInput"));
    }
    const result = yield* readRelationalSelection(tableName, { predicate: query.predicate, order: { column: key, direction: "asc" } }, true);
    return Object.freeze({ count: result.total, ...(query.sum === undefined ? {} : {
      sum: yield* Effect.fromResult(sumLogicalRows(result.docs, query.sum, error)),
    }) });
  })));
  const relationalChange = Effect.fn("LogicalDocuments.relationalChange")((context: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string, operation: "insert" | "upsert" | "update" | "delete" | "softDelete" | "restore", input: unknown) =>
    runOperation(context, id, "write", Effect.gen(function* () {
      yield* Effect.fromResult(decodeRelationalChange(operation).pipe(Result.mapError(cause => error("invalidInput", cause))));
      const table = yield* Effect.fromResult(tableForName(tableName));
      if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      const policy = yield* Effect.fromResult(prepareLogicalRelationalRows(table.relational, state.relationalCapabilities, error));
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), error));
      yield* charge(captured.bytes);
      if (!Array.isArray(captured.value)) return yield* Effect.fail(error("invalidInput"));
      if (captured.value.length > limits.identities) return yield* Effect.fail(error("limitExceeded"));
      const rowsByKey = new Map<string, Readonly<{ identity: Record<string, string>; row: JsonObject }>>();
      for (const item of captured.value) {
        const singleKey = policy.keyColumns.length === 1 ? policy.keyColumns[0] : undefined;
        const row = operation === "delete" || operation === "softDelete" || operation === "restore" ?
          typeof item === "string" && singleKey !== undefined ? { [singleKey]: item } : item : item;
        if (!isJsonObject(row)) return yield* Effect.fail(error("invalidInput"));
        yield* Effect.fromResult(policy.validateInput(row));
        if ((operation === "delete" || operation === "softDelete" || operation === "restore") &&
          (Object.keys(row).length !== policy.keyColumns.length || Object.keys(row).some(name => !policy.keyColumns.some(column => column === name))))
          return yield* Effect.fail(error("invalidInput"));
        const identity: Record<string, string> = {};
        for (const column of policy.keyColumns) {
          const value = row[column];
          if (typeof value !== "string" || value.length === 0) return yield* Effect.fail(error("invalidInput"));
          identity[column] = value;
        }
        const key = JSON.stringify(policy.keyColumns.map(column => identity[column]));
        if (rowsByKey.has(key)) return yield* Effect.fail(error("invalidInput"));
        rowsByKey.set(key, { identity, row });
      }
      const result: JsonObject[] = [];
      const observeLifecycle = Effect.fn("LogicalDocuments.observeLifecycle")(function* (
        key: Record<string, string>, lifecycleOperation: "softDelete" | "restore", before: JsonObject, after: JsonObject,
        attemptOrdinal: number | null,
      ) {
        const deletedAt = policy.deletedAt;
        if (deletedAt === undefined) return yield* Effect.fail(error("invalidAuthority"));
        const previous = before[deletedAt], next = after[deletedAt];
        if ((previous !== null && typeof previous !== "string") || (next !== null && typeof next !== "string") ||
          (lifecycleOperation === "restore" ? next !== null : next === null)) return yield* Effect.fail(error("storedCorruption"));
        const capturedRow = attemptOrdinal === null
          ? yield* Effect.fromResult(capturePrivateJsonData(after, lifetime.remainingBytes(), error)) : null;
        const rowAtOperation = capturedRow?.value ?? null;
        if (rowAtOperation !== null && !isJsonObject(rowAtOperation)) return yield* Effect.fail(error("storedCorruption"));
        yield* charge(128 + tableName.length + JSON.stringify(key).length + (previous?.length ?? 0) + (next?.length ?? 0)
          + (capturedRow?.bytes ?? 0));
        lifecycle.push(Object.freeze({ tableId: table.tableId, tableName, key: Object.freeze({ ...key }), operation: lifecycleOperation,
          beforeDeletedAt: previous, afterDeletedAt: next, attemptOrdinal, rowAtOperation }));
      });
      for (const { identity, row: inputRow } of rowsByKey.values()) {
        let pending: PendingDocument | undefined;
        for (const candidate of yield* selectCandidates(tableName, identity, true)) {
          const current = candidate.current?.value;
          if (candidate.tableId !== table.tableId || !isNonArrayRecord(current) ||
            !policy.keyColumns.every(column => current[column] === identity[column])) continue;
          if (pending !== undefined) return yield* Effect.fail(error("storedCorruption"));
          pending = candidate;
        }
        if (pending === undefined && (operation === "update" || operation === "delete" || operation === "softDelete" || operation === "restore")) continue;
        if (pending !== undefined && operation === "insert") return yield* Effect.fail(error("uniqueConflict"));
        const prior = pending?.current == null ? null : yield* Effect.fromResult(output(pending.current));
        const previous = prior === null ? null : Object.fromEntries(Object.entries(prior).filter(([name]) => name !== "_id" && name !== "_creationTime"));
        if (previous !== null) yield* Effect.fromResult(policy.validate(previous, "storedCorruption"));
        if (operation === "delete") {
          if (pending === undefined || previous === null || pending.current === null) return yield* Effect.fail(error("storedCorruption"));
          yield* Effect.fromResult(recordAttempt(pending, "delete", null));
          pending.deletedValue = pending.current;
          pending.current = null;
          result.push(previous);
          continue;
        }
        let supplied = inputRow;
        // Native relational upsert reactivates a soft-deleted row on key
        // conflict. Keep that behavior with the shared logical row owner.
        if (operation === "upsert" && previous !== null && policy.deletedAt !== undefined)
          supplied = { ...inputRow, [policy.deletedAt]: null };
        if (operation === "softDelete" || operation === "restore") {
          if (policy.deletedAt === undefined || previous === null) return yield* Effect.fail(error("invalidInput"));
          supplied = { ...inputRow, [policy.deletedAt]: operation === "restore" ? null : yield* transactionTime };
          if (operation === "restore" && previous[policy.deletedAt] === null) {
            yield* observeLifecycle(identity, operation, previous, previous, null);
            result.push(previous); continue;
          }
        }
        const fields = yield* Effect.fromResult(policy.normalize(supplied, previous, yield* transactionTime));
        const written = pending === undefined ? yield* insertRecord(tableName, fields) : yield* write(pending, fields, "patch");
        const { _id: _internalId, _creationTime: _internalTime, ...native } = written;
        if ((operation === "softDelete" || operation === "restore") && previous !== null)
          yield* observeLifecycle(identity, operation, previous, native, attempts.length - 1);
        result.push(native);
      }
      const returned = yield* Effect.fromResult(capturePrivateJsonData(result, lifetime.remainingBytes(), error));
      yield* charge(returned.bytes);
      return Object.freeze(result);
    })));
  const validateRelationalReferences = Effect.fn("LogicalDocuments.validateRelationalReferences")(function* () {
    if (foreignKeys.length === 0) return;
    // A deleted or rekeyed parent may expose untouched children. A replacement
    // parent with the same key satisfies the final reference and must not
    // cascade those children. Every reverse observation is indexed and bounded.
    const removed: { tableId: CatalogTableId; column: string; key: string }[] = [];
    const appendKeys = (row: PendingDocument, value: unknown) => Result.gen(function* () {
      if (!isNonArrayRecord(value)) return yield* Result.fail(error("storedCorruption"));
      for (const foreignKey of foreignKeys) {
        if (foreignKey.target.tableId !== row.tableId) continue;
        const key = value[foreignKey.target.column];
        if (typeof key !== "string") return yield* Result.fail(error("storedCorruption"));
        removed.push({ tableId: row.tableId, column: foreignKey.target.column, key });
      }
    });
    for (const row of rows.values()) {
      if (row.attempts.length === 0 || row.current !== null) continue;
      if (row.base?.kind === "live") yield* Effect.fromResult(appendKeys(row, row.base.document.value));
      if (row.deletedValue !== undefined) yield* Effect.fromResult(appendKeys(row, row.deletedValue.value));
    }
    const checkRemoved = Effect.fn("LogicalDocuments.checkRemovedRelationalKeys")(function* (cascade: boolean) {
      const checked = new Set<string>();
      for (let position = 0; position < removed.length; position++) {
        const entry = removed[position];
        if (entry === undefined) continue;
        const key = JSON.stringify([entry.tableId, entry.column, entry.key]);
        if (checked.has(key)) continue;
        checked.add(key);
        for (const foreignKey of foreignKeys) {
          if (foreignKey.target.tableId !== entry.tableId || foreignKey.target.column !== entry.column) continue;
          let replacement = false;
          for (const target of yield* selectCandidates(foreignKey.target.name,
            { [foreignKey.target.column]: entry.key }, true)) {
            if (target.tableId !== foreignKey.target.tableId || target.current === null) continue;
            const value = target.current.value;
            if (!isNonArrayRecord(value)) return yield* Effect.fail(error("storedCorruption"));
            if (value[foreignKey.target.column] === entry.key) replacement = true;
          }
          if (replacement) continue;
          if (setNull.some(intent => intent.sourceTableId === foreignKey.source.tableId &&
            intent.sourceColumn === foreignKey.source.column && intent.targetTableId === entry.tableId &&
            intent.targetColumn === entry.column && intent.targetKey === entry.key)) continue;
          for (const child of yield* selectCandidates(foreignKey.source.name,
            { [foreignKey.source.column]: entry.key }, true)) {
            if (child.tableId !== foreignKey.source.tableId || child.current === null) continue;
            const value = child.current.value;
            if (!isNonArrayRecord(value)) return yield* Effect.fail(error("storedCorruption"));
            if (value[foreignKey.source.column] !== entry.key) continue;
            if (!cascade || foreignKey.onDelete !== "cascade") return yield* Effect.fail(error("documentInvalid"));
            yield* Effect.fromResult(recordAttempt(child, "delete", null));
            child.deletedValue = child.current;
            child.current = null;
            if (child.base?.kind === "live") yield* Effect.fromResult(appendKeys(child, child.base.document.value));
            yield* Effect.fromResult(appendKeys(child, value));
          }
        }
      }
    });
    yield* checkRemoved(true);
    // Native onUpdate is restrict/noAction: only surviving rekeys are checked.
    // A row deleted by a cascade above has already followed onDelete policy.
    removed.length = 0;
    for (const row of rows.values()) {
      if (row.attempts.length === 0 || row.base?.kind !== "live" || row.current === null) continue;
      const before = row.base.document.value;
      const after = row.current.value;
      if (!isNonArrayRecord(before) || !isNonArrayRecord(after)) return yield* Effect.fail(error("storedCorruption"));
      for (const foreignKey of foreignKeys) {
        if (foreignKey.target.tableId !== row.tableId || before[foreignKey.target.column] === after[foreignKey.target.column]) continue;
        const key = before[foreignKey.target.column];
        if (typeof key !== "string") return yield* Effect.fail(error("storedCorruption"));
        removed.push({ tableId: row.tableId, column: foreignKey.target.column, key });
      }
    }
    yield* checkRemoved(false);
    // Resolve against final pending rows, so parent and child inserts may be
    // issued in either order. A unique-slot or indexed observation is retained
    // for revalidation under the publication exclusion.
    for (const child of rows.values()) {
      if (child.attempts.length === 0 || child.current === null) continue;
      const value = child.current.value;
      if (!isNonArrayRecord(value)) return yield* Effect.fail(error("storedCorruption"));
      for (const foreignKey of foreignKeys) {
        if (foreignKey.source.tableId !== child.tableId) continue;
        const reference = value[foreignKey.source.column];
        if (reference === null) continue;
        if (typeof reference !== "string") return yield* Effect.fail(error("storedCorruption"));
        let found = false;
        for (const target of yield* selectCandidates(foreignKey.target.name, { [foreignKey.target.column]: reference }, true)) {
          if (target.tableId !== foreignKey.target.tableId || target.current === null) continue;
          const targetValue = target.current.value;
          if (!isNonArrayRecord(targetValue)) return yield* Effect.fail(error("storedCorruption"));
          if (targetValue[foreignKey.target.column] === reference) found = true;
        }
        if (!found) return yield* Effect.fail(error("documentInvalid"));
      }
    }
  });
  const planSetNull = Effect.fn("LogicalDocuments.planSetNull")((context: BoundedRequestContext,
    id: PresentedTransactionId, intent: LogicalSetNullIntent) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      yield* state.requireAdmission;
      if (closed || setNull.length >= 16 || referenceReplacements.length !== 0)
        return yield* Effect.fail(error(closed ? "closed" : setNull.length >= 16 ? "limitExceeded" : "invalidAuthority"));
      const foreignKey = foreignKeys.find(key => key.source.tableId === intent.sourceTableId &&
        key.source.column === intent.sourceColumn && key.target.tableId === intent.targetTableId &&
        key.target.column === intent.targetColumn && key.source.nullable && key.onDelete === "noAction");
      if (foreignKey === undefined || typeof intent.targetKey !== "string" ||
        setNull.some(prior => prior.sourceTableId === intent.sourceTableId && prior.sourceColumn === intent.sourceColumn &&
          prior.targetTableId === intent.targetTableId && prior.targetColumn === intent.targetColumn &&
          prior.targetKey === intent.targetKey)) return yield* Effect.fail(error("invalidAuthority"));
      const roots = [...rows.values()].filter(row => row.tableId === intent.targetTableId && row.base?.kind === "live" &&
        row.current === null && row.deletedValue !== undefined && isJsonObject(row.deletedValue.valueJson) &&
        row.deletedValue.valueJson[intent.targetColumn] === intent.targetKey);
      if (roots.length !== 1 || [...rows.values()].some(row => row.tableId === intent.sourceTableId &&
        ((row.base?.kind === "live" && isJsonObject(row.base.document.valueJson) &&
          row.base.document.valueJson[intent.sourceColumn] === intent.targetKey) ||
          (row.current !== null && isJsonObject(row.current.valueJson) &&
            row.current.valueJson[intent.sourceColumn] === intent.targetKey))))
        return yield* Effect.fail(error("invalidAuthority"));
      yield* Effect.fromResult(lifetime.charge(128 + intent.targetKey.length * 2));
      setNull.push(Object.freeze({ sourceTableId: intent.sourceTableId, sourceColumn: intent.sourceColumn,
        targetTableId: intent.targetTableId, targetColumn: intent.targetColumn, targetKey: intent.targetKey }));
    })));
  const planReferenceReplacement = Effect.fn("LogicalDocuments.planReferenceReplacement")((context: BoundedRequestContext,
    id: PresentedTransactionId, intent: LogicalReferenceReplacementIntent) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      yield* state.requireAdmission;
      if (closed || setNull.length !== 0 || referenceReplacements.length !== 0)
        return yield* Effect.fail(error(closed ? "closed" : "invalidAuthority"));
      const foreignKey = foreignKeys.find(key => key.source.tableId === intent.sourceTableId &&
        key.source.column === intent.sourceColumn && key.target.tableId === intent.targetTableId &&
        key.target.column === intent.targetColumn && key.source.nullable && key.onDelete === "noAction");
      if (foreignKey === undefined || typeof intent.targetKey !== "string" || !Array.isArray(intent.desiredKeys) ||
        intent.desiredKeys.length > 256 || intent.desiredKeys.some(key => typeof key !== "string" || key.length === 0))
        return yield* Effect.fail(error("invalidInput"));
      const roots = [...rows.values()].filter(row => row.tableId === intent.targetTableId && row.base?.kind === "live" && row.current !== null &&
        row.attempts.length > 0 && isJsonObject(row.current.valueJson) &&
        row.current.valueJson[intent.targetColumn] === intent.targetKey);
      const source = yield* Effect.fromResult(tableForId(intent.sourceTableId));
      if (roots.length !== 1 || source.relational === undefined || source.relational.keys.some(key =>
        key.columns.some(column => column.columnId === intent.sourceColumn)))
        return yield* Effect.fail(error("invalidAuthority"));
      const desiredKeys = Object.freeze([...new Set(intent.desiredKeys)]);
      yield* Effect.fromResult(lifetime.charge(128 + intent.targetKey.length * 2 +
        desiredKeys.reduce((bytes, key) => bytes + 32 + key.length * 2, 0)));
      referenceReplacements.push(Object.freeze({ sourceTableId: intent.sourceTableId,
        sourceColumn: intent.sourceColumn, targetTableId: intent.targetTableId,
        targetColumn: intent.targetColumn, targetKey: intent.targetKey, desiredKeys }));
    })));
  const activitySnapshot = Effect.fn("LogicalDocuments.activitySnapshot")(function* () {
    if (closed) return yield* Effect.fail(error("closed"));
    const observedRows: LogicalDocumentObservedRow[] = [];
    for (const row of rows.values()) {
      if (row.current === null) continue;
      const value = row.current.valueJson;
      if (!isJsonObject(value) || !dependencies.has(row.documentId)) return yield* Effect.fail(error("storedCorruption"));
      observedRows.push(Object.freeze({ documentId: row.documentId, tableId: row.tableId,
        tableName: row.tableName, value }));
    }
    observedRows.sort((left, right) => left.tableId - right.tableId || left.documentId.localeCompare(right.documentId));
    return Object.freeze({ attempts: Object.freeze([...attempts]), lifecycle: Object.freeze([...lifecycle]),
      observedRows: Object.freeze(observedRows), setNull: Object.freeze([...setNull]),
      referenceReplacements: Object.freeze([...referenceReplacements]) });
  });
  const close = Effect.fn("LogicalDocuments.close")(function* (): Effect.fn.Return<LogicalDocumentChanges, Failure> {
    if (closed || !lifetime.isClosing()) return yield* Effect.fail(error("invalidAuthority"));
    yield* state.requireAdmission;
    yield* validateRelationalReferences();
    const activity = yield* activitySnapshot();
    closed = true;
    const changes: LogicalDocumentChange[] = [];
    const noFinalRows: AppDocumentIdV1[] = [];
    for (const row of rows.values()) {
      if (row.attempts.length === 0) continue;
      if (row.base === null && row.current === null) { noFinalRows.push(row.documentId); continue; }
      const dependency = dependencies.get(row.documentId);
      if (dependency === undefined) return yield* Effect.fail(error("storedCorruption"));
      changes.push(Object.freeze(row.current === null ? { ...dependency, kind: "deleted" } :
        { ...dependency, kind: "live", creationTime: row.creationTime, document: row.current }));
    }
    changes.sort((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId));
    noFinalRows.sort();
    return Object.freeze({ ...activity, changes: Object.freeze(changes),
      noFinalRows: Object.freeze(noFinalRows),
      dependencies: Object.freeze([...dependencies.values()].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))),
      scans: Object.freeze([...scans].map(([tableId, frontier]) => Object.freeze({ tableId, frontier }))),
      uniqueReads: Object.freeze([...uniqueReads.values()]), indexReads: Object.freeze([...indexReads.values()]), pageReads: Object.freeze([...pageReads]) });
  });
  const documents = Object.freeze({ get, getMany, find, insert, delete: remove,
    patch: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "patch", tableName),
    replace: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "replace", tableName) } satisfies LogicalDocuments<Failure>);
  const relationalTable = Effect.fn("LogicalDocuments.relationalTable")((manager: BoundedRequestContext,
    id: PresentedTransactionId, tableName: string) => runOperation(manager, id, "read", Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableForName(tableName));
      if (table.relational === undefined || state.relationalCapabilities === undefined) return yield* Effect.fail(error("invalidAuthority"));
      return Object.freeze({
        find: (context, query) => relationalFind(context, id, tableName, query).pipe(Effect.map(result => result.docs)),
        findPage: (context, query) => relationalPage(context, id, tableName, query),
        count: (context, query) => relationalFind(context, id, tableName, query).pipe(Effect.map(result => result.total)),
        aggregate: (context, query) => relationalAggregate(context, id, tableName, query),
        write: (context, mode, inputRows) => relationalChange(context, id, tableName, mode, inputRows),
        delete: (context, keys) => relationalChange(context, id, tableName, "delete", keys),
        lifecycle: (context, operation, keys) => relationalChange(context, id, tableName, operation, keys),
      } satisfies LogicalRelationalStore<Failure>);
    })));
  return Object.freeze({ documents, relationalFind, relationalPage, relationalAggregate, relationalChange, relationalTable, planSetNull, planReferenceReplacement, close, requirePendingDeletion, activitySnapshot,
    activityCursor: () => Object.freeze({ attempts: attempts.length, lifecycle: lifecycle.length,
      setNull: setNull.length, referenceReplacements: referenceReplacements.length }),
    attemptCount: () => attempts.length, lifecycleCount: () => lifecycle.length });
});

const comparePagePosition = (left: Readonly<{ key: string; rowId: string }>, right: Readonly<{ key: string; rowId: string }>) =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : left.rowId < right.rowId ? -1 : left.rowId > right.rowId ? 1 : 0;
