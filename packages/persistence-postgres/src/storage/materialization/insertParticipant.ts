import { Clock, Data, Effect, Option, Result } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import type { BoundedRequestLifetime, BoundedRequestContext } from "../../execution/preparation/boundedRequestLifetime";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { requireLogicalApplicationSourceAdmission, type LogicalApplicationSourceAdmission } from "../documents/logicalDocuments/applicationAdmission";
import type { LogicalDocumentWrite } from "../documents/logicalDocuments/model";
import type { PreparedPointCommitRowIntentV1 } from "./model";

export class ApplicationCommandError extends Data.TaggedError("ApplicationCommandError")<{
  readonly reason: "invalidAuthority" | "invalidInput" | "documentInvalid" | "limitExceeded" | "closed" | "rollbackOnly" | "deadlineExceeded" | "overlappingOperation" | "borrowedSettlement";
  readonly cause?: unknown;
}> {}
export const applicationCommandError = (reason: ApplicationCommandError["reason"], cause?: unknown) =>
  new ApplicationCommandError({ reason, ...(cause === undefined ? {} : { cause }) });
declare const closureBrand: unique symbol;
export interface ApplicationInsertClosure { readonly [closureBrand]: true }
const closures = new WeakMap<object, { readonly owner: object; readonly changes: readonly PreparedPointCommitRowIntentV1[] }>();

/** Selected logical Application source owns this single-table insert capability. */
export const makeSourceApplicationInsertParticipant = Effect.fn("ApplicationCommand.makeSourceParticipant")(function* (
  admission: LogicalApplicationSourceAdmission, tx: FlarexMetadataTransaction,
  lifetime: BoundedRequestLifetime<ApplicationCommandError>, transactionId: string, tableName: string,
) {
  const state = yield* requireLogicalApplicationSourceAdmission(admission, tx).pipe(
    Effect.mapError(cause => applicationCommandError("invalidAuthority", cause)));
  const table = state.tables.find(candidate => candidate.localName === tableName);
  if (table === undefined) return yield* Effect.fail(applicationCommandError("invalidAuthority"));
  const requireAdmission = requireLogicalApplicationSourceAdmission(admission, tx).pipe(
    Effect.asVoid, Effect.mapError(cause => applicationCommandError("invalidAuthority", cause)));
  return yield* makeInsertParticipant(lifetime, transactionId, tableName, table.tableId, requireAdmission, write =>
    Effect.gen(function* () {
      yield* Effect.fromResult(state.validate(write)).pipe(Effect.mapError(cause =>
        applicationCommandError(cause.reason === "documentInvalid" ? "documentInvalid" : "invalidAuthority", cause)));
    }));
});

const makeInsertParticipant = Effect.fn("ApplicationCommand.makeInsert")((
  lifetime: BoundedRequestLifetime<ApplicationCommandError>, transactionId: string,
  tableName: string, tableId: CatalogTableId,
  requireAdmission: Effect.Effect<void, ApplicationCommandError>,
  validate: (write: LogicalDocumentWrite) => Effect.Effect<void, ApplicationCommandError>,
) => Effect.sync(() => {
  const owner = Object.freeze({});
  const changes: PreparedPointCommitRowIntentV1[] = [];
  let closed = false;
  const insert = Effect.fn("ApplicationCommand.insert")((context: BoundedRequestContext, fields: unknown) => lifetime.operation(context, transactionId, "write", Effect.gen(function* () {
    yield* requireAdmission;
    if (closed || changes.length !== 0) return yield* Effect.fail(applicationCommandError("closed"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(fields, 65_536, applicationCommandError));
    if (!isJsonObject(captured.value) || Object.keys(captured.value).some(key => key.startsWith("_"))) return yield* Effect.fail(applicationCommandError("documentInvalid"));
    const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(crypto.getRandomValues(new Uint8Array(16))).pipe(Result.mapError(cause => applicationCommandError("invalidInput", cause))));
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const creationTime = AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis);
    const document = yield* canonicalizeFlarexValueV1Effect({ ...captured.value, _id: documentId, _creationTime: creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => applicationCommandError("documentInvalid", cause)));
    if (document.canonicalBytes.byteLength > 65_536) return yield* Effect.fail(applicationCommandError("limitExceeded"));
    yield* validate({ operation: "insert", tableName, tableId, documentId, creationTime, document });
    yield* lifetime.fromResult(lifetime.charge(captured.bytes + document.canonicalBytes.byteLength + 128));
    changes.push(Object.freeze({ kind: "live", documentId, tableId, rowId, creationTime, document,
      dependency: { kind: "appRowPoint", documentId, observed: { kind: "missing", basis: { kind: "noVisibleRevision" } } } } satisfies PreparedPointCommitRowIntentV1));
    return documentId;
  })));
  const readPending = Effect.fn("ApplicationCommand.readPending")((context: BoundedRequestContext) => lifetime.operation(context, transactionId, "read", Effect.gen(function* () {
    yield* requireAdmission;
    if (closed) return yield* Effect.fail(applicationCommandError("closed"));
    const row = changes[0];
    if (row?.kind !== "live") return Option.none<JsonObject>();
    const value = yield* Effect.fromResult(capturePrivateJsonData(row.document.value, 65_536, applicationCommandError));
    if (!isJsonObject(value.value)) return yield* Effect.fail(applicationCommandError("documentInvalid"));
    yield* lifetime.fromResult(lifetime.charge(value.bytes));
    return Option.some(value.value);
  })));
  const close = Effect.fn("ApplicationCommand.close")(function* () {
    yield* requireAdmission;
    if (closed || !lifetime.isClosing() || changes.length !== 1) return yield* Effect.fail(applicationCommandError("invalidAuthority"));
    closed = true;
    // SAFETY: the registry authenticates the exact owner and its sealed contribution.
    const closure = Object.freeze({}) as ApplicationInsertClosure;
    closures.set(closure, { owner, changes: Object.freeze(changes.slice()) });
    return closure;
  });
  const consume = Effect.fn("ApplicationCommand.consume")(function* (closure: ApplicationInsertClosure) {
    yield* requireAdmission;
    const value = closures.get(closure);
    if (value?.owner !== owner || !lifetime.isClosing()) return yield* Effect.fail(applicationCommandError("invalidAuthority"));
    closures.delete(closure);
    return value.changes;
  });
  return Object.freeze({ insert, readPending, close, consume });
}));
