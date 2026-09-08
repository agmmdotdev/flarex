import { Clock, Data, Effect, Option, Result } from "effect";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appDocumentIdV1FromRowIdentity, appRowIdHexV1FromBytesResult } from "flarex-protocol/app-document-id";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { deriveApplicationSyscallValidator, validateApplicationRevisionSyscallDocumentInTransactionV1 } from "../applicationRevisionSyscallValidatorV1";
import type { ApplicationRelationSchemaAuthority } from "../applicationRelationSchemaAuthority";
import type { BoundedRequestLifetime, BoundedRequestContext } from "../boundedRequestLifetime";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { TrustedScopeAuthority } from "../scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scopeClock";
import { capturePrivateJsonData } from "../privateJsonData";
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

/** The trusted composition root supplies authenticated schema/transaction state.
 * Callers receive only one Application-owned table's insert/read capability. */
export const makeApplicationInsertParticipant = Effect.fn("ApplicationCommand.makeParticipant")(function* (
  state: { readonly tx: FlarexMetadataTransaction; readonly authority: TrustedScopeAuthority; readonly clock: ScopeClockRecord; readonly schema: ApplicationRelationSchemaAuthority },
  lifetime: BoundedRequestLifetime<ApplicationCommandError>, transactionId: string, tableName: string,
) {
  const table = state.schema.tables.find(candidate => candidate.logicalName === tableName);
  if (table === undefined || !state.schema.writePolicy?.writePolicies.some(policy => policy.tableId === table.tableId && policy.owner === "application"))
    return yield* Effect.fail(applicationCommandError("invalidAuthority"));
  const validator = yield* deriveApplicationSyscallValidator({ scopeId: state.authority.scopeId, schemaVersionId: state.schema.schemaVersionId, schemaManifest: state.schema.manifest })
    .pipe(Effect.mapError(cause => applicationCommandError("invalidAuthority", cause)));
  const owner = Object.freeze({});
  const changes: PreparedPointCommitRowIntentV1[] = [];
  let closed = false;
  const insert = Effect.fn("ApplicationCommand.insert")((context: BoundedRequestContext, fields: unknown) => lifetime.operation(context, transactionId, "write", Effect.gen(function* () {
    if (closed || changes.length !== 0) return yield* Effect.fail(applicationCommandError("closed"));
    const captured = yield* Effect.fromResult(capturePrivateJsonData(fields, 65_536, applicationCommandError));
    if (!isJsonObject(captured.value) || Object.keys(captured.value).some(key => key.startsWith("_"))) return yield* Effect.fail(applicationCommandError("documentInvalid"));
    const rowId = yield* Effect.fromResult(appRowIdHexV1FromBytesResult(crypto.getRandomValues(new Uint8Array(16))).pipe(Result.mapError(cause => applicationCommandError("invalidInput", cause))));
    const documentId = appDocumentIdV1FromRowIdentity({ tableId: table.tableId, rowId });
    const creationTime = AppCreationTimeV1Schema.make(yield* Clock.currentTimeMillis);
    const document = yield* canonicalizeFlarexValueV1Effect({ ...captured.value, _id: documentId, _creationTime: creationTime }, "appDocument")
      .pipe(Effect.mapError(cause => applicationCommandError("documentInvalid", cause)));
    if (document.canonicalBytes.byteLength > 65_536) return yield* Effect.fail(applicationCommandError("limitExceeded"));
    yield* validateApplicationRevisionSyscallDocumentInTransactionV1(validator, state.tx, {
      anchor: { scopeId: state.authority.scopeId }, executionPin: { schemaVersionId: state.schema.schemaVersionId }, scopeClock: state.clock,
    }, { operation: "insert", tableName, tableId: table.tableId, documentId, creationTime, document })
      .pipe(Effect.mapError(cause => applicationCommandError("documentInvalid", cause)));
    yield* Effect.fromResult(lifetime.charge(captured.bytes + document.canonicalBytes.byteLength + 128));
    changes.push(Object.freeze({ kind: "live", documentId, tableId: table.tableId, rowId, creationTime, document,
      dependency: { kind: "appRowPoint", documentId, observed: { kind: "missing", basis: { kind: "noVisibleRevision" } } } } satisfies PreparedPointCommitRowIntentV1));
    return documentId;
  })));
  const readPending = Effect.fn("ApplicationCommand.readPending")((context: BoundedRequestContext) => lifetime.operation(context, transactionId, "read", Effect.gen(function* () {
    if (closed) return yield* Effect.fail(applicationCommandError("closed"));
    const row = changes[0];
    if (row?.kind !== "live") return Option.none<JsonObject>();
    const value = yield* Effect.fromResult(capturePrivateJsonData(row.document.value, 65_536, applicationCommandError));
    if (!isJsonObject(value.value)) return yield* Effect.fail(applicationCommandError("documentInvalid"));
    yield* Effect.fromResult(lifetime.charge(value.bytes));
    return Option.some(value.value);
  })));
  const close = Effect.fn("ApplicationCommand.close")(function* () {
    if (closed || !lifetime.isClosing() || changes.length !== 1) return yield* Effect.fail(applicationCommandError("invalidAuthority"));
    closed = true;
    // SAFETY: the registry authenticates the exact owner and its sealed contribution.
    const closure = Object.freeze({}) as ApplicationInsertClosure;
    closures.set(closure, { owner, changes: Object.freeze(changes.slice()) });
    return closure;
  });
  const consume = Effect.fn("ApplicationCommand.consume")(function* (closure: ApplicationInsertClosure) {
    const value = closures.get(closure);
    if (value?.owner !== owner || !lifetime.isClosing()) return yield* Effect.fail(applicationCommandError("invalidAuthority"));
    closures.delete(closure);
    return value.changes;
  });
  return Object.freeze({ insert, readPending, close, consume });
});
