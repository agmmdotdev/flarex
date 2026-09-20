import { Effect, Option, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { AppCreationTimeV1Schema, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult, decodeAppDocumentIdentityV1Result,
  type AppDocumentIdV1, type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { CommitSeq } from "flarex-protocol/storage-authority";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { canonicalizeFlarexValueV1Effect, type CanonicalFlarexValueV1 } from "flarex-protocol/value";
import { readBoundedCurrentAppRowsInTransactionEffect, InvalidAppRowReadInputError, AppRowReadPersistenceError,
  type AppRowRevisionV1 } from "../appRows";
import { deriveApplicationSyscallValidator, validateApplicationRevisionSyscallDocumentInTransactionV1 } from "../applicationRevisionSyscallValidatorV1";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
import { lowerCanonicalAppUniqueConstraintV1Result, type LoweredCanonicalAppUniqueConstraintV1 } from "../appUniqueConstraintCommitV1";
import { readAppUniqueKeySlotInTransactionEffect, AppUniqueKeyPersistenceError, AppUniqueKeyHashError } from "../appUniqueKeys";
import type { AppUniqueConstraintIdV1, AppUniqueKeyProjectionV1 } from "../appUniqueKeyContract";
import { capturePrivateJsonData } from "../privateJsonData";
import type { PointCommitDependencyV1 } from "../pointCommitTransaction";
import type { ApplicationDocumentObservation } from "../applicationDocumentMaterialization/model";
import { requireCmsAdmission, type CmsAdmission } from "./admission";
import { cmsError, cmsLimits, CmsTransactionError, type CmsRequestContext, type CmsPresentedTransactionId } from "./model";
import type { CmsRequestLifetime } from "./lifetime";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { lowerAppDeveloperIndexKeyV1 } from "../appDeveloperIndexCommitV1";
import { readCmsIndexRange, type CmsIndexRead } from "./indexReads";
import { decodeCmsFindQuery, isCmsRange, selectCmsIndex, cmsQueryMatches } from "./query";
const uniqueReadKey = (definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1) =>
  projected.canonical.kind === "claim"
    ? JSON.stringify([definition.uniqueConstraintDefinitionId, projected.canonical.localeKey, projected.canonical.encodedKey])
    : null;

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
export type CmsFinalDocumentChange = ApplicationDocumentObservation & (
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
  readonly dependencies: readonly ApplicationDocumentObservation[];
  readonly scans: readonly Readonly<{ tableId: CatalogTableId; frontier: CommitSeq | null }>[];
  readonly uniqueReads: readonly CmsUniqueRead[];
  readonly indexReads: readonly CmsIndexRead[];
}
export interface CmsUniqueRead {
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly key: AppUniqueKeyProjectionV1;
  readonly owner: Readonly<{ tableId: CatalogTableId; rowId: AppRowIdHexV1 }> | null;
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
  readonly beforeRead?: (selection: "point" | "batch" | "scan" | "index") => Effect.Effect<void, CmsTransactionError>;
  readonly observeQuery?: Parameters<typeof readBoundedCurrentAppRowsInTransactionEffect>[2];
  readonly observeIndexQuery?: Parameters<typeof readCmsIndexRange>[3];
}

export const makeCmsDocuments = Effect.fn("CmsDocuments.make")(function* (
  admission: CmsAdmission,
  lifetime: CmsRequestLifetime,
  creationTime: AppCreationTimeV1,
  uniqueDefinitions: readonly LocatedAppUniqueConstraintDefinitionV1[],
  indexDefinitions: readonly LocatedAppIndexDefinitionV1[],
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
  const scanned = new Map<CatalogTableId, CommitSeq>();
  const dependencies = new Map<AppDocumentIdV1, ApplicationDocumentObservation>();
  const scans = new Map<CatalogTableId, CommitSeq | null>();
  const uniqueReads = new Map<string, CmsUniqueRead>();
  const indexReads = new Map<string, CmsIndexRead>();
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
  const observe = Effect.fn("CmsDocuments.observe")(function* (
    tableId: CatalogTableId, rowId: AppRowIdHexV1, base: AppRowRevisionV1 | null,
    readAt = scanned.get(tableId) ?? state.clock.lastCommitSeq,
  ) {
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    if (dependencies.has(documentId)) return;
    if (dependencies.size >= cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
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
    const capture = yield* readBoundedCurrentAppRowsInTransactionEffect(state.tx, {
      scopeId: state.authority.scopeId, tableId, minimumCommitSeq: state.clock.lastCommitSeq,
      maximumIdentities: rowIds === undefined ? cmsLimits.identities : cmsLimits.identities - dependencies.size, maximumDocumentBytes: cmsLimits.documentBytes,
      maximumTotalValueBytes: lifetime.remainingBytes(), ...(rowId === undefined ? {} : { rowId }),
      ...(rowIds === undefined ? {} : { rowIds }),
    }, testHooks?.observeQuery).pipe(Effect.mapError(cause => cmsError(cause instanceof InvalidAppRowReadInputError && cause.issue.reason === "rowLimitExceeded"
      ? "limitExceeded" : cause instanceof AppRowReadPersistenceError ? "statementFailure" : "storedCorruption", cause)));
    const loaded = capture.rows;
    for (const base of loaded) {
      const documentId = appDocumentIdV1FromRowIdentity(base);
      const alreadyObserved = dependencies.has(documentId);
      yield* observe(tableId, base.rowId, base, capture.commitSeq);
      // A later scan must not replace a cached absence with a newly committed
      // row. Settlement detects the conflicting dependency; reads stay repeatable.
      if (alreadyObserved || rows.has(documentId)) continue;
      if (rows.size >= cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
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
  const locate = Effect.fn("CmsDocuments.locate")(function* (inputId: string, tableName?: string) {
    const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(inputId).pipe(Result.mapError(cause => cmsError("invalidInput", cause))));
    yield* Effect.fromResult(tableForId(identity.tableId));
    if (tableName !== undefined && (yield* Effect.fromResult(tableForName(tableName))).tableId !== identity.tableId) {
      return yield* Effect.fail(cmsError("invalidInput"));
    }
    if (!dependencies.has(identity.id) && !scanned.has(identity.tableId)) yield* readBase(identity.tableId, identity.rowId);
    if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
    return { identity, pending: rows.get(identity.id) };
  });
  const locateUnique = Effect.fn("CmsDocuments.locateUnique")(function* (
    definition: LocatedAppUniqueConstraintDefinitionV1, projected: LoweredCanonicalAppUniqueConstraintV1,
  ) {
    const readKey = uniqueReadKey(definition, projected);
    if (projected.canonical.kind !== "claim" || readKey === null) return null;
    const cached = uniqueReads.get(readKey);
    if (cached !== undefined) return cached.owner === null ? null : appDocumentIdV1FromRowIdentity(cached.owner);
    const slot = yield* readAppUniqueKeySlotInTransactionEffect(state.tx, { scopeId: state.authority.scopeId,
      constraintId: definition.uniqueConstraintDefinitionId, key: projected.projection }).pipe(Effect.mapError(cause =>
      cmsError(cause instanceof AppUniqueKeyPersistenceError ? "statementFailure" : cause instanceof AppUniqueKeyHashError ? "resourceFailure" : "storedCorruption", cause)));
    if (Option.isSome(slot)) {
      const owner = slot.value;
      if (owner.tableId !== definition.tableId) return yield* Effect.fail(cmsError("storedCorruption"));
      const { pending: owned } = yield* locate(appDocumentIdV1FromRowIdentity(owner));
      // Slot and owner revision were captured together. A cached or later row
      // capture can differ legitimately under concurrent publication.
      if (owned?.base?.commitSeq !== owner.ownerCommitSeq) return yield* Effect.fail(cmsError("writeConflict"));
      if (owned.base.kind !== "live") return yield* Effect.fail(cmsError("storedCorruption"));
      const base = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, owned.base.document)
        .pipe(Result.mapError(cause => cmsError("storedCorruption", cause))));
      if (base.canonical.kind !== "claim" || base.canonical.localeKey !== projected.canonical.localeKey ||
        base.canonical.encodedKey !== projected.canonical.encodedKey) return yield* Effect.fail(cmsError("storedCorruption"));
    }
    const ownerId = Option.isNone(slot) ? null : appDocumentIdV1FromRowIdentity(slot.value);
    yield* charge(128 + projected.canonical.canonicalKeyBytes.byteLength);
    uniqueReads.set(readKey, Object.freeze({ constraintId: definition.uniqueConstraintDefinitionId,
      key: projected.projection, owner: Option.isNone(slot) ? null : Object.freeze({ tableId: slot.value.tableId, rowId: slot.value.rowId }) }));
    return ownerId;
  });
  const ensureUnique = Effect.fn("CmsDocuments.validateUnique")(function* (pending: PendingDocument, document: CanonicalFlarexValueV1) {
    for (const definition of uniqueDefinitions) {
      if (definition.tableId !== pending.tableId) continue;
      const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
        .pipe(Result.mapError(cause => cmsError("documentInvalid", cause))));
      if (projected.canonical.kind !== "claim") continue;
      yield* locateUnique(definition, projected);
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
      const missing = identities.filter(identity => !dependencies.has(identity.id));
      if (!scanned.has(table.tableId) && dependencies.size + missing.length > cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
      if (!scanned.has(table.tableId) && missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(identity => identity.rowId));
      for (const identity of missing) if (!dependencies.has(identity.id)) yield* observe(identity.tableId, identity.rowId, null);
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
      const captured = yield* Effect.fromResult(capturePrivateJsonData(input, lifetime.remainingBytes(), cmsError));
      yield* charge(captured.bytes);
      const query = yield* Effect.fromResult(decodeCmsFindQuery(captured.value).pipe(Result.mapError(cause => cmsError("invalidInput", cause))));
      const table = yield* Effect.fromResult(tableForName(tableName));
      let candidates: Iterable<PendingDocument> = rows.values();
      if (query.where._id !== undefined) {
        const identity = yield* Effect.fromResult(decodeAppDocumentIdentityV1Result(query.where._id).pipe(
          Result.mapError(cause => cmsError("invalidInput", cause))));
        if (identity.tableId !== table.tableId) return yield* Effect.fail(cmsError("invalidInput"));
        const { pending } = yield* locate(identity.id, tableName);
        candidates = pending === undefined ? [] : [pending];
      } else {
        const where = query.where;
        const definition = uniqueDefinitions.find(candidate => candidate.tableId === table.tableId &&
          candidate.physicalSpec.orderedFields.every(field => !field.includes(".") && Object.hasOwn(where, field) && !isCmsRange(where[field])));
        if (definition === undefined) {
          const selected = yield* Effect.fromResult(selectCmsIndex(indexDefinitions, table.tableId, where));
          if (Option.isNone(selected)) {
            if (Object.values(where).some(isCmsRange)) return yield* Effect.fail(cmsError("invalidInput"));
            if (!scanned.has(table.tableId)) yield* readBase(table.tableId);
            candidates = rows.values();
          } else if (!scanned.has(table.tableId) || indexReads.has(selected.value.identity)) {
            const selection = selected.value;
            let read = indexReads.get(selection.identity);
            if (read === undefined) {
              if (testHooks?.beforeRead !== undefined) yield* testHooks.beforeRead("index");
              const entries = yield* readCmsIndexRange(state.tx, state.authority.scopeId, selection, testHooks?.observeIndexQuery);
              yield* charge(128 + entries.reduce((bytes, entry) => bytes + 128 + entry.encodedKey.length / 2, 0));
              if (entries.some(entry => entry.tableId !== table.tableId) || new Set(entries.map(entry => entry.rowId)).size !== entries.length) {
                return yield* Effect.fail(cmsError("storedCorruption"));
              }
              const missing = entries.filter(entry => !dependencies.has(appDocumentIdV1FromRowIdentity(entry)));
              if (!scanned.has(table.tableId) && missing.length > 0) yield* readBase(table.tableId, undefined, missing.map(entry => entry.rowId));
              for (const entry of entries) {
                const { pending } = yield* locate(appDocumentIdV1FromRowIdentity(entry));
                if (pending?.base?.kind !== "live" || pending.base.commitSeq < entry.commitSeq) return yield* Effect.fail(cmsError("writeConflict"));
                const encoded = yield* Effect.fromResult(lowerAppDeveloperIndexKeyV1(selection.definition, pending.base.document, pending.base.creationTime)
                  .pipe(Result.mapError(cause => cmsError("storedCorruption", cause))));
                if (encoded !== entry.encodedKey) return yield* Effect.fail(cmsError("writeConflict"));
              }
              read = Object.freeze({ definition: selection.definition, bounds: selection.bounds, entries });
              indexReads.set(selection.identity, read);
            }
            const members = new Set(read.entries.map(entry => appDocumentIdV1FromRowIdentity(entry)));
            candidates = [...rows.values()].filter(row => row.tableId === table.tableId && (members.has(row.documentId) || row.attempts.length > 0));
          }
        } else {
          const document = yield* canonicalizeFlarexValueV1Effect(where, "appDocument")
            .pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
          const projected = yield* Effect.fromResult(lowerCanonicalAppUniqueConstraintV1Result(definition, document)
            .pipe(Result.mapError(cause => cmsError("invalidInput", cause))));
          const readKey = uniqueReadKey(definition, projected);
          if (readKey === null) return yield* Effect.fail(cmsError("invalidInput"));
          // An earlier key observation survives later scans. Otherwise a prior
          // scan already owns this key's committed view. Local edits apply to both.
          if (!scanned.has(table.tableId) || uniqueReads.has(readKey)) {
            const ownerId = yield* locateUnique(definition, projected);
            candidates = [...rows.values()].filter(row => row.tableId === table.tableId &&
              (row.documentId === ownerId || row.attempts.length > 0));
          }
        }
      }
      const matched: { id: AppDocumentIdV1; document: CanonicalFlarexValueV1 }[] = [];
      for (const row of candidates) {
        if (row.tableId !== table.tableId || row.current === null) continue;
        const document = row.current.value;
        if (!isNonArrayRecord(document)) return yield* Effect.fail(cmsError("storedCorruption"));
        if (yield* Effect.fromResult(cmsQueryMatches(document, query.where))) matched.push({ id: row.documentId, document: row.current });
      }
      matched.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
      const docs = yield* Effect.forEach(matched.slice(query.offset, query.offset + query.limit), row => Effect.fromResult(output(row.document, true)));
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
      const dependency = dependencies.get(row.documentId);
      if (dependency === undefined) return yield* Effect.fail(cmsError("storedCorruption"));
      changes.push(Object.freeze(row.current === null ? { ...dependency, kind: "deleted" } :
        { ...dependency, kind: "live", creationTime: row.creationTime, document: row.current }));
    }
    changes.sort((left, right) => left.tableId - right.tableId || left.rowId.localeCompare(right.rowId));
    noFinalRows.sort();
    // SAFETY: only this owner derives and registers the full attempted set.
    const closure = Object.freeze({}) as CmsDocumentClosure;
    closures.set(closure, Object.freeze({ admission, lifetime, pendingDeletions, changes: Object.freeze(changes),
      attempts: Object.freeze([...attempts]), noFinalRows: Object.freeze(noFinalRows),
      dependencies: Object.freeze([...dependencies.values()].toSorted((a, b) => a.tableId - b.tableId || a.rowId.localeCompare(b.rowId))),
      scans: Object.freeze([...scans].map(([tableId, frontier]) => Object.freeze({ tableId, frontier }))),
      uniqueReads: Object.freeze([...uniqueReads.values()]), indexReads: Object.freeze([...indexReads.values()]) }));
    return closure;
  });
  const documents = Object.freeze({ get, getMany, find, insert, delete: remove,
    patch: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "patch", tableName),
    replace: (context, id, documentId, fields, tableName) => edit(context, id, documentId, fields, "replace", tableName) } satisfies CmsDocuments);
  return Object.freeze({ documents, close, pendingDeletions });
});
