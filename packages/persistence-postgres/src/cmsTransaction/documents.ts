import { Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { AppCreationTimeV1Schema, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { canonicalizeFlarexValueV1Effect, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { readBoundedCurrentAppRowsInTransactionEffect, InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type AppRowRevisionV1 } from "../appRows";
import { deriveApplicationSyscallValidator, validateApplicationRevisionSyscallDocumentInTransactionV1 } from "../applicationRevisionSyscallValidatorV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result } from "../appUniqueConstraintCommitV1";
import { capturePrivateJsonData } from "../privateJsonData";
import type { PointCommitDependencyV1 } from "../pointCommitTransaction";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import { cmsError, cmsLimits, CmsTransactionError, type CmsRequestContext, type CmsPresentedTransactionId } from "./model";
import type { CmsRequestLifetime } from "./lifetime";

interface PendingDocument {
  readonly tableId: CatalogTableId;
  readonly tableName: string;
  readonly rowId: AppRowIdHexV1;
  readonly documentId: AppDocumentIdV1;
  readonly base: AppRowRevisionV1 | null;
  readonly creationTime: AppCreationTimeV1;
  current: CanonicalFlarexValueV1 | null;
  readonly attempts: number[];
}
export type CmsFinalDocumentChange = PointCommitDependencyV1 & (
  | Readonly<{ kind: "live"; creationTime: AppCreationTimeV1; document: CanonicalFlarexValueV1 }>
  | Readonly<{ kind: "deleted" }>
);
export interface CmsDocumentAttempt {
  readonly ordinal: number;
  readonly documentId: AppDocumentIdV1;
  readonly operation: "insert" | "patch" | "replace" | "delete";
}
export interface CmsClosedDocuments {
  readonly admission: CmsAdmission;
  readonly lifetime: CmsRequestLifetime;
  readonly pendingDeletions: CmsPendingDeletions;
  readonly changes: readonly CmsFinalDocumentChange[];
  readonly attempts: readonly CmsDocumentAttempt[];
  readonly noFinalRows: readonly AppDocumentIdV1[];
}
declare const closureBrand: unique symbol;
export interface CmsDocumentClosure { readonly [closureBrand]: true }
const closures = new WeakMap<object, CmsClosedDocuments>();
declare const pendingDeletionsBrand: unique symbol;
export interface CmsPendingDeletions { readonly [pendingDeletionsBrand]: true }
const deletionSets = new WeakMap<object, Readonly<{
  admission: CmsAdmission;
  lifetime: CmsRequestLifetime;
  rows: ReadonlyMap<AppDocumentIdV1, PendingDocument>;
}>>();

/** Only the document owner can attest a still-pending collection deletion. No SQL is issued. */
export const requireCmsPendingDeletion = Effect.fn("CmsDocuments.requirePendingDeletion")(function* (
  token: CmsPendingDeletions, admission: CmsAdmission, lifetime: CmsRequestLifetime, documentId: string,
) {
  const state = deletionSets.get(token);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime) return yield* Effect.fail(cmsError("invalidAuthority"));
  const admitted = yield* requireCmsAdmission(admission);
  const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(documentId).pipe(Result.mapError(cause => cmsError("invalidInput", cause))));
  const row = state.rows.get(identity.id);
  if (row === undefined || row.current !== null || row.attempts.length === 0) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  const collection = admitted.configuration.tables.find(table => table.logicalTableName === row.tableName);
  if (collection === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
  return Object.freeze({ documentId: row.documentId, tableName: row.tableName, collectionSlug: collection.collectionSlug });
});

/** Only a closed, internally derived set can enter Application materialization. */
export const consumeCmsDocumentClosure = Effect.fn("CmsDocuments.consumeClosure")(function* (
  closure: CmsDocumentClosure,
  admission: CmsAdmission,
  lifetime: CmsRequestLifetime,
) {
  const state = closures.get(closure);
  if (state === undefined || state.admission !== admission || state.lifetime !== lifetime || !lifetime.isClosing()) {
    return yield* Effect.fail(cmsError("invalidAuthority"));
  }
  yield* requireCmsAdmission(admission);
  closures.delete(closure);
  return state;
});

export interface CmsDocuments {
  readonly get: (context: CmsRequestContext, id: CmsPresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<JsonObject | null, CmsTransactionError>;
  readonly getMany: (context: CmsRequestContext, id: CmsPresentedTransactionId, tableName: string,
    documentIds: readonly string[]) => Effect.Effect<readonly (JsonObject | null)[], CmsTransactionError>;
  readonly find: (context: CmsRequestContext, id: CmsPresentedTransactionId, tableName: string,
    query: Readonly<{ where: JsonObject; offset: number; limit: number }>) => Effect.Effect<Readonly<{ docs: readonly JsonObject[]; total: number }>, CmsTransactionError>;
  readonly insert: (context: CmsRequestContext, id: CmsPresentedTransactionId, tableName: string, fields: unknown) => Effect.Effect<JsonObject, CmsTransactionError>;
  readonly patch: (context: CmsRequestContext, id: CmsPresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, CmsTransactionError>;
  readonly replace: (context: CmsRequestContext, id: CmsPresentedTransactionId, documentId: string, fields: unknown, tableName?: string) => Effect.Effect<JsonObject, CmsTransactionError>;
  readonly delete: (context: CmsRequestContext, id: CmsPresentedTransactionId, documentId: string, tableName?: string) => Effect.Effect<void, CmsTransactionError>;
}

export interface CmsDocumentReadTestHooks {
  readonly beforeRead?: (selection: "point" | "batch" | "scan") => Effect.Effect<void, CmsTransactionError>;
  readonly observeQuery?: Parameters<typeof readBoundedCurrentAppRowsInTransactionEffect>[2];
}

export const makeCmsDocuments = Effect.fn("CmsDocuments.make")(function* (
  admission: CmsAdmission,
  lifetime: CmsRequestLifetime,
  creationTime: AppCreationTimeV1,
  uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  testHooks?: CmsDocumentReadTestHooks,
) {
  const state = yield* requireCmsAdmission(admission);
  const validator = yield* deriveApplicationSyscallValidator({ scopeId: state.authority.scopeId,
    schemaVersionId: state.schema.schemaVersionId, schemaManifest: state.schema.manifest });
  const managed = new Set(state.frame.payloadContent?.tables.map(table => table.tableId));
  const tables = state.schema.tables.filter(table => managed.has(table.tableId.toString()));
  const rows = new Map<AppDocumentIdV1, PendingDocument>();
  // SAFETY: this owner alone registers the live working set; the handle conveys no rows.
  const pendingDeletions = Object.freeze({}) as CmsPendingDeletions;
  deletionSets.set(pendingDeletions, Object.freeze({ admission, lifetime, rows }));
  const scanned = new Set<CatalogTableId>();
  const attempts: CmsDocumentAttempt[] = [];
  let inserted = 0;
  let closed = false;
  const tableForName = (name: string) => {
    const table = tables.find(candidate => candidate.logicalName === name);
    return table === undefined ? Result.fail(cmsError("invalidAuthority")) : Result.succeed(table);
  };
  const tableForId = (id: CatalogTableId) => {
    const table = tables.find(candidate => candidate.tableId === id);
    return table === undefined ? Result.fail(cmsError("invalidAuthority")) : Result.succeed(table);
  };
  const charge = (bytes: number) => Effect.fromResult(lifetime.charge(bytes));
  const captureFields = (input: unknown) => Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, Math.min(cmsLimits.documentBytes, lifetime.remainingBytes()), cmsError);
    if (!isJsonObject(captured.value) || Object.keys(captured.value).some(key => key.startsWith("_"))) {
      return yield* Result.fail(cmsError("documentInvalid"));
    }
    yield* lifetime.charge(captured.bytes);
    return captured.value;
  });
  const output = (document: CanonicalFlarexValueV1, returned = false): Result.Result<JsonObject, CmsTransactionError> =>
    capturePrivateJsonData(document.value, cmsLimits.documentBytes, cmsError).pipe(
      Result.flatMap(captured => Result.gen(function* () {
        if (!isJsonObject(captured.value)) return yield* Result.fail(cmsError("storedCorruption"));
        if (returned) yield* lifetime.charge(captured.bytes);
        return captured.value;
      })),
    );
  const readBase = Effect.fn("CmsDocuments.readBase")(function* (tableId: CatalogTableId, rowId?: AppRowIdHexV1, rowIds?: readonly AppRowIdHexV1[]) {
    yield* requireCmsAdmission(admission, state.tx);
    if (closed) return yield* Effect.fail(cmsError("closed"));
    const table = yield* Effect.fromResult(tableForId(tableId));
    if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead(rowIds !== undefined ? "batch" : rowId !== undefined ? "point" : "scan");
    const loaded = yield* readBoundedCurrentAppRowsInTransactionEffect(state.tx, {
      scopeId: state.authority.scopeId, tableId, snapshotCommitSeq: state.clock.lastCommitSeq,
      maximumIdentities: rowIds === undefined ? cmsLimits.identities : cmsLimits.identities - rows.size, maximumDocumentBytes: cmsLimits.documentBytes,
      maximumTotalValueBytes: lifetime.remainingBytes(), ...(rowId === undefined ? {} : { rowId }),
      ...(rowIds === undefined ? {} : { rowIds }),
    }, testHooks?.observeQuery).pipe(Effect.mapError(cause => cmsError(cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
      ? "limitExceeded" : cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause)));
    for (const base of loaded) {
      const documentId = appDocumentIdV1FromRowIdentity(base);
      if (rows.has(documentId)) continue;
      if (rows.size >= cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
      yield* charge(128 + (base.kind === "live" ? base.document.canonicalBytes.byteLength : 0));
      rows.set(documentId, { tableId, tableName: table.logicalName, rowId: base.rowId, documentId, base,
        creationTime: base.creationTime, current: base.kind === "live" ? base.document : null, attempts: [] });
    }
    if (rowId === undefined && rowIds === undefined) scanned.add(tableId);
  });
  const locate = Effect.fn("CmsDocuments.locate")(function* (inputId: string, tableName?: string) {
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(inputId).pipe(Result.mapError(cause => cmsError("invalidInput", cause))));
    yield* Effect.fromResult(tableForId(identity.tableId));
    if (tableName !== undefined && (yield* Effect.fromResult(tableForName(tableName))).tableId !== identity.tableId) {
      return yield* Effect.fail(cmsError("invalidInput"));
    }
    if (!rows.has(identity.id) && !scanned.has(identity.tableId)) yield* readBase(identity.tableId, identity.rowId);
    return { identity, pending: rows.get(identity.id) };
  });
  const ensureUnique = Effect.fn("CmsDocuments.validateUnique")(function* (pending: PendingDocument, document: CanonicalFlarexValueV1) {
    const definitions = uniqueDefinitions.filter(definition => definition.tableId === pending.tableId);
    if (definitions.length === 0) return;
    if (!scanned.has(pending.tableId)) yield* readBase(pending.tableId);
    for (const definition of definitions) {
      const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
        .pipe(Result.mapError(cause => cmsError("documentInvalid", cause))));
      if (projected.canonical.kind !== "claim") continue;
      for (const other of rows.values()) {
        if (other.tableId !== pending.tableId || other.documentId === pending.documentId || other.current === null) continue;
        const existing = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, other.current)
          .pipe(Result.mapError(cause => cmsError("storedCorruption", cause))));
        if (existing.canonical.kind === "claim" && existing.canonical.localeKey === projected.canonical.localeKey &&
          existing.canonical.encodedKey === projected.canonical.encodedKey) return yield* Effect.fail(new CmsTransactionError({
            reason: "uniqueConflict", uniqueConstraint: Object.freeze({ tableName: pending.tableName,
              orderedFields: Object.freeze([...definition.physicalSpec.orderedFields]) }),
          }));
      }
    }
  });
  const recordAttempt = (pending: PendingDocument, operation: CmsDocumentAttempt["operation"]) => {
    const attempt = Object.freeze({ ordinal: attempts.length, documentId: pending.documentId, operation });
    return lifetime.charge(128).pipe(Result.map(() => {
      pending.attempts.push(attempt.ordinal);
      attempts.push(attempt);
    }));
  };
  const write = Effect.fn("CmsDocuments.validateWrite")(function* (pending: PendingDocument, fields: JsonObject,
    operation: "insert" | "patch" | "replace") {
    const document = yield* canonicalizeFlarexValueV1Effect({ ...fields, _id: pending.documentId, _creationTime: pending.creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => cmsError("documentInvalid", cause)));
    if (document.canonicalBytes.byteLength > cmsLimits.documentBytes) return yield* Effect.fail(cmsError("limitExceeded"));
    yield* validateApplicationRevisionSyscallDocumentInTransactionV1(validator, state.tx, {
      anchor: { scopeId: state.authority.scopeId }, executionPin: { schemaVersionId: state.schema.schemaVersionId }, scopeClock: state.clock,
    }, { operation, tableName: pending.tableName, tableId: pending.tableId, documentId: pending.documentId,
      creationTime: pending.creationTime, document }).pipe(Effect.mapError(cause => cmsError("documentInvalid", cause)));
    yield* ensureUnique(pending, document);
    if (!rows.has(pending.documentId) && rows.size >= cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
    yield* charge(document.canonicalBytes.byteLength);
    yield* Effect.fromResult(recordAttempt(pending, operation));
    pending.current = document;
    rows.set(pending.documentId, pending);
    return yield* Effect.fromResult(output(document, true));
  });
  const get: CmsDocuments["get"] = Effect.fn("CmsDocuments.get")((context, id, documentId, tableName) =>
    lifetime.operation(context, id, "read", locate(documentId, tableName).pipe(Effect.flatMap(({ pending }) =>
      pending?.current == null ? Effect.succeed(null) : Effect.fromResult(output(pending.current, true))))));
  const getMany: CmsDocuments["getMany"] = Effect.fn("CmsDocuments.getMany")((context, id, tableName, input) =>
    lifetime.operation(context, id, "read", Effect.gen(function* () {
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), cmsError));
      yield* charge(captured.bytes);
      if (!Array.isArray(captured.value) || captured.value.length > cmsLimits.pageRows) return yield* Effect.fail(cmsError("limitExceeded"));
      const table = yield* Effect.fromResult(tableForName(tableName));
      const identities = yield* Effect.forEach(captured.value, value => Effect.fromResult(decodeAppDocumentIdentityV1Result(value)
        .pipe(Result.mapError(cause => cmsError("invalidInput", cause)))));
      if (identities.some(identity => identity.tableId !== table.tableId) || new Set(identities.map(identity => identity.id)).size !== identities.length) {
        return yield* Effect.fail(cmsError("invalidInput"));
      }
      const missing = identities.filter(identity => !rows.has(identity.id));
      if (!scanned.has(table.tableId) && rows.size + missing.length > cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
      if (!scanned.has(table.tableId) && missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(identity => identity.rowId));
      return Object.freeze(yield* Effect.forEach(identities, identity => {
        const pending = rows.get(identity.id);
        return pending?.current == null ? Effect.succeed(null) : Effect.fromResult(output(pending.current, true));
      }));
    })));
  const insert: CmsDocuments["insert"] = Effect.fn("CmsDocuments.insert")((context, id, tableName, input) =>
    lifetime.operation(context, id, "write", Effect.gen(function* () {
      const table = yield* Effect.fromResult(tableForName(tableName));
      const fields = yield* Effect.fromResult(captureFields(input));
      if (rows.size >= cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
      yield* charge(128);
      const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(crypto.getRandomValues(new Uint8Array(16)))
        .pipe(Result.mapError(cause => cmsError("resourceFailure", cause))));
      const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
      const existing = yield* locate(documentId);
      if (existing.pending !== undefined) return yield* Effect.fail(cmsError("uniqueConflict"));
      const time = AppCreationTimeV1Schema.make(creationTime + inserted++);
      return yield* write({ tableId: table.tableId, tableName, rowId, documentId, base: null,
        creationTime: time, current: null, attempts: [] }, fields, "insert");
    })));
  const edit = Effect.fn("CmsDocuments.edit")((context: CmsRequestContext, id: CmsPresentedTransactionId,
    documentId: string, input: unknown, operation: "patch" | "replace", tableName?: string) => lifetime.operation(context, id, "write", Effect.gen(function* () {
      const fields = yield* Effect.fromResult(captureFields(input));
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(cmsError("documentMissing"));
      const previous = yield* Effect.fromResult(output(pending.current));
      const { _id: _documentId, _creationTime: _created, ...developerFields } = previous;
      return yield* write(pending, operation === "patch" ? { ...developerFields, ...fields } : fields, operation);
    })));
  const remove: CmsDocuments["delete"] = Effect.fn("CmsDocuments.delete")((context, id, documentId, tableName) =>
    lifetime.operation(context, id, "write", Effect.gen(function* () {
      const { pending } = yield* locate(documentId, tableName);
      if (pending?.current == null) return yield* Effect.fail(cmsError("documentMissing"));
      yield* Effect.fromResult(recordAttempt(pending, "delete"));
      pending.current = null;
    })));
  const find: CmsDocuments["find"] = Effect.fn("CmsDocuments.find")((context, id, tableName, input) =>
    lifetime.operation(context, id, "read", Effect.gen(function* () {
      const query = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), cmsError));
      yield* charge(query.bytes);
      if (!isJsonObject(query.value) || query.value.where === undefined || !isJsonObject(query.value.where) || Object.keys(query.value).toSorted().join() !== "limit,offset,where" ||
        typeof query.value.limit !== "number" || !Number.isSafeInteger(query.value.limit) || query.value.limit < 1 || query.value.limit > cmsLimits.pageRows ||
        typeof query.value.offset !== "number" || !Number.isSafeInteger(query.value.offset) || query.value.offset < 0 ||
        Object.values(query.value.where).some(value => value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
        return yield* Effect.fail(cmsError("invalidInput"));
      }
      const table = yield* Effect.fromResult(tableForName(tableName));
      if (query.value.where._id !== undefined) {
        const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(query.value.where._id).pipe(
          Result.mapError(cause => cmsError("invalidInput", cause))));
        if (identity.tableId !== table.tableId) return yield* Effect.fail(cmsError("invalidInput"));
      }
      if (!scanned.has(table.tableId)) yield* readBase(table.tableId);
      const predicate = Object.entries(query.value.where);
      const matched: { id: AppDocumentIdV1; document: CanonicalFlarexValueV1 }[] = [];
      for (const row of rows.values()) {
        if (row.tableId !== table.tableId || row.current === null) continue;
        const document = row.current.value;
        if (!isNonArrayRecord(document)) return yield* Effect.fail(cmsError("storedCorruption"));
        if (predicate.every(([field, expected]) => Object.hasOwn(document, field) && document[field] === expected)) matched.push({ id: row.documentId, document: row.current });
      }
      matched.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const docs = yield* Effect.forEach(matched.slice(query.value.offset, query.value.offset + query.value.limit), row => Effect.fromResult(output(row.document, true)));
      return Object.freeze({ docs: Object.freeze(docs), total: matched.length });
    })));
  const close = Effect.fn("CmsDocuments.close")(function* (): Effect.fn.Return<CmsDocumentClosure, CmsTransactionError> {
    if (closed || !lifetime.isClosing()) return yield* Effect.fail(cmsError("invalidAuthority"));
    closed = true;
    const changes: CmsFinalDocumentChange[] = [];
    const noFinalRows: AppDocumentIdV1[] = [];
    for (const row of rows.values()) {
      if (row.attempts.length === 0) continue;
      if (row.base === null && row.current === null) { noFinalRows.push(row.documentId); continue; }
      const observed: PointCommitDependencyV1["dependency"]["observed"] = row.base?.kind === "live"
        ? { kind: "present", revisionCommitSeq: row.base.commitSeq }
        : { kind: "missing", basis: { kind: "noVisibleRevision" } };
      const dependency: PointCommitDependencyV1 = { documentId: row.documentId, tableId: row.tableId, rowId: row.rowId,
        dependency: { kind: "appRowPoint", documentId: row.documentId, observed } };
      changes.push(Object.freeze(row.current === null ? { ...dependency, kind: "deleted" } :
        { ...dependency, kind: "live", creationTime: row.creationTime, document: row.current }));
    }
    changes.sort((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId));
    noFinalRows.sort();
    // SAFETY: only this owner derives and registers the full attempted set.
    const closure = Object.freeze({}) as CmsDocumentClosure;
    closures.set(closure, Object.freeze({ admission, lifetime, pendingDeletions, changes: Object.freeze(changes),
      attempts: Object.freeze([...attempts]), noFinalRows: Object.freeze(noFinalRows) }));
    return closure;
  });
  const documents = Object.freeze({ get, getMany, find, insert, delete: remove,
    patch: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "patch", tableName),
    replace: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "replace", tableName) } satisfies CmsDocuments);
  return Object.freeze({ documents, close, pendingDeletions });
});
