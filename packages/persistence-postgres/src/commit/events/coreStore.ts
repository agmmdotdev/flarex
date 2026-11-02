import { Cause, Effect, Option, Result, Schema } from "effect";
import type { DocumentObject } from "flarex-protocol/document-value";
import { encodeCanonicalJson, type JsonObject } from "flarex-protocol/json";
import { snapshotDecodedProtocolPlainData } from "flarex-protocol/internal/decoded-protocol-snapshot";
import { MAX_PERSISTED_SIGNED_INT64_V1 } from "flarex-protocol/storage-authority";
import { CoreNativeBudgetError, CoreNativeForeignKeyError, CoreNativeQueryError, CoreNativeReferenceError, CoreNativeUniqueConflict,
  CoreNativeReferencePlanError, CoreQueryInputError, CoreTransactionError, type CoreDatabase, type CoreError, type CoreNativeBinding, type CoreNativeOperations } from "../../core/api";
import { CorePersistenceError } from "../../core/contracts";
import { CoreSchemaError } from "../../core/schemaTypes";
import { CORE_TRANSACTION_REFERENCE_LIMITS } from "../../core/accounting";
import { captureCoreObject } from "../../core/document";
import { coreNativeRelationalRow } from "../../core/nativeRelationalQuery";
import { coreNativeRelationalRows, sameCoreNativeIdentity, type CoreNativeDefinition } from "../../core/nativePolicy";
import { CoreNativeRootRequestEvidenceSchema, type CoreNativeRootRequestEvidence } from "../../core/nativeRootRequest";
import { capturePrivateCanonicalValue } from "../../installation/frameworkSchema/privateCanonicalValue";
import { observeExecution } from "../../execution/diagnostics/operation";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { commitEventsDigest } from "./digest";
import { EventEnvelope, EventName, EventRevision, EventSubscriber, CommitEventSubscriberFailure,
  commitEventLimits, eventError, type CommitEventError, type CommittedEvent, type CommitEventMessage, type CommitEventSubscriber } from "./model";
import { CORE_NATIVE_EVENT_READ, CORE_NATIVE_EVENT_WRITE, coreNativeEventLimits, coreNativeEventStorage,
  captureCoreNativeEventPolicy, matchesCoreNativeEventPolicy } from "./coreDefinition";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const FamilyId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/));
const Ordinal = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: commitEventLimits.messages - 1 }));
const Count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: commitEventLimits.messages }));
const Instant = Schema.String.check(Schema.makeFilter(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
  ? undefined : "Expected a canonical finite instant"));
const Code = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9._-]{1,128}$/));
const Family = Schema.Struct({ id: FamilyId, event_count: Count, event_sha256: Schema.NullOr(EventRevision) }).annotate(strict);
const RootBoundFamily = Schema.Struct({ ...Family.fields, root_request: Schema.String }).annotate(strict);
const EnvelopeRow = Schema.Struct({ id: Schema.NonEmptyString, family_id: FamilyId, ordinal: Ordinal, envelope: EventEnvelope }).annotate(strict);
const StageInput = Schema.Struct({
  values: Schema.Array(EventEnvelope).check(Schema.isMaxLength(commitEventLimits.messages)), sha256: Schema.NullOr(EventRevision),
  ordinals: Schema.optionalKey(Schema.Array(Ordinal).check(Schema.isMaxLength(commitEventLimits.messages))), capturedCount: Schema.optionalKey(Count),
}).annotate(strict);
const SettlementFailure = Schema.NullOr(Schema.Struct({ retryable: Schema.Boolean, code: Code }).annotate(strict));
const Fence = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,18})$/), Schema.makeFilter(value =>
  BigInt(value) <= MAX_PERSISTED_SIGNED_INT64_V1 ? undefined : "Fence exceeds signed int64"));
const Delivery = Schema.Struct({ id: Schema.NonEmptyString, family_id: FamilyId, ordinal: Ordinal,
  subscriber_id: EventName, handler_revision: EventRevision, state: Schema.Literals(["pending", "claimed", "delivered", "failed"]),
  attempts: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: commitEventLimits.attempts })), fence: Fence,
  owner: Schema.NullOr(Schema.String.check(Schema.isLengthBetween(1, 128))), lease_expires_at: Schema.NullOr(Instant),
  next_attempt_at: Instant, settled_at: Schema.NullOr(Instant), failure_code: Schema.NullOr(Code),
}).annotate(strict).check(Schema.makeFilter(row => {
  const terminal = row.state === "delivered" || row.state === "failed";
  return (terminal ? row.settled_at !== null : row.settled_at === null)
    && (row.state === "claimed" ? row.attempts > 0 && row.owner !== null && row.lease_expires_at !== null
      : row.owner === null && row.lease_expires_at === null) ? undefined : "Inconsistent delivery lifecycle";
}));
type Delivery = typeof Delivery.Type;
const decodeFamily = Schema.decodeUnknownResult(Family, { onExcessProperty: "error" });
const decodeRootBoundFamily = Schema.decodeUnknownResult(RootBoundFamily, { onExcessProperty: "error" });
const decodePackedRootRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(CoreNativeRootRequestEvidenceSchema));
const decodeEnvelopeRow = Schema.decodeUnknownResult(EnvelopeRow, { onExcessProperty: "error" });
const decodeDelivery = Schema.decodeUnknownResult(Delivery, { onExcessProperty: "error" });
const decodeEnvelope = Schema.decodeUnknownResult(EventEnvelope, { onExcessProperty: "error" });
const decodeStageInput = Schema.decodeUnknownResult(StageInput, { onExcessProperty: "error" });
const decodeSettlementFailure = Schema.decodeUnknownResult(SettlementFailure);
const decodeId = Schema.decodeUnknownResult(FamilyId);
const decodeSubscribers = Schema.decodeUnknownResult(Schema.Array(EventSubscriber).check(Schema.isMaxLength(commitEventLimits.subscribers)), { onExcessProperty: "error" });
const ordinalId = (familyId: string, ordinal: number) => `${familyId}/${String(ordinal).padStart(4, "0")}`;
const deliveryId = (familyId: string, ordinal: number, subscriber: string) => `${ordinalId(familyId, ordinal)}/${subscriber}`;
const corrupt = (cause?: unknown) => eventError("storedCorruption", cause);
const fromStored = <A>(result: Result.Result<A, unknown>) => Effect.fromResult(result.pipe(Result.mapError(corrupt)));
const coreFailure = (failure: CoreError): CommitEventError => {
  if (failure instanceof CorePersistenceError)
    return eventError(failure.reason === "corruptData" ? "storedCorruption" : "resourceFailure", failure);
  if (failure instanceof CoreNativeBudgetError) return eventError(failure.reason === "limitExceeded" ? "limitExceeded"
    : failure.reason === "unexpectedFailure" ? "resourceFailure" : "invalidAuthority", failure);
  if (failure instanceof CoreNativeReferencePlanError) return eventError("invalidAuthority", failure);
  if (failure instanceof CoreNativeUniqueConflict || failure instanceof CoreNativeQueryError || failure instanceof CoreQueryInputError
    || failure instanceof CoreNativeReferenceError || failure instanceof CoreNativeForeignKeyError) return eventError("invalidInput", failure);
  if (failure instanceof CoreSchemaError) return eventError(failure.reason === "hashFailure" ? "resourceFailure" : "invalidAuthority", failure);
  switch (failure.reason) {
    case "capacity": case "tooManyTables": return eventError("limitExceeded", failure);
    case "closed": case "authorityRevoked": case "readonly": case "foreignClaim": case "foreignFinalization":
    case "missingTable": case "missingIndex": case "indexUnavailable": case "programUnavailable": return eventError("invalidAuthority", failure);
    case "invalidValue": case "documentValidation": case "invalidDocumentId": case "missingDocument":
    case "documentExists": case "documentDeleted": case "requestMismatch": return eventError("invalidInput", failure);
    case "admissionExpired": case "unavailable": return eventError("resourceFailure", failure);
    // The existing event-store channel has no retryable conflict verdict.
    // Preserve the exact Core cause; do not add a second retry owner.
    case "conflict": case "inflight": return eventError("statementFailure", failure);
  }
};
const core = <A>(work: Effect.Effect<A, CoreError>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, coreFailure))));

function tables(definition: CoreNativeDefinition) {
  const family = definition.tables.find(table => table.privateEvent?.role === "family");
  const envelope = definition.tables.find(table => table.privateEvent?.role === "envelope");
  const delivery = definition.tables.find(table => table.privateEvent?.role === "delivery");
  return family === undefined || envelope === undefined || delivery === undefined || definition.tables.length !== 3
    ? Result.fail(eventError("invalidAuthority")) : Result.succeed({ family, envelope, delivery });
}
const row = (document: DocumentObject) => coreNativeRelationalRow(document).pipe(Result.mapError(corrupt));

export interface CoreNativeEventFamilyInput {
  readonly values: readonly CommittedEvent[];
  readonly sha256: string | null;
  readonly ordinals?: readonly number[];
  readonly capturedCount?: number;
}

type RootEventAuthority = Pick<CoreDatabase, "readNativeRootRequestEvidence">;
type RootEventPolicy = Result.Result.Success<ReturnType<typeof captureCoreNativeEventPolicy>>;
interface PreparedRootFamily {
  readonly id: string;
  readonly request: CoreNativeRootRequestEvidence;
  readonly packedRequest: string;
  readonly retainedBytes: number;
  readonly policy: RootEventPolicy;
}
const preparedRootFamilies = new WeakMap<CoreNativeOperations, Readonly<{ authority: RootEventAuthority;
  definition: CoreNativeDefinition; family: PreparedRootFamily }>>();
const canonicalRootRequest = (evidence: CoreNativeRootRequestEvidence) => encodeCanonicalJson(evidence,
  issue => { throw new Error("Native root request evidence lost its canonical owner", { cause: issue }); });

export const coreNativeRootEventFamilyId = Effect.fn("CoreNativeEvents.rootFamilyId")(function* (
  evidence: CoreNativeRootRequestEvidence,
) {
  const identity = yield* capturePrivateCanonicalValue({ format: "flarex.native-root-event-family", version: 1,
    scopeUuid: evidence.source.scopeUuid, epochUuid: evidence.source.epochUuid, rootHash: evidence.root.definitionHash,
    key: evidence.key, requestHash: evidence.requestHash }, 4096,
  { invalidInput: () => eventError("invalidAuthority"), hashFailure: cause => eventError("resourceFailure", cause) });
  return identity.sha256Hex;
});

/** Run before native callbacks. The exact metadata commitment and maximum
 * header are retained/charged once, within the existing native document cap. */
export const prepareCoreRootCommitEventFamily = Effect.fn("CoreNativeEvents.prepareRootFamily")(function* (
  authority: RootEventAuthority, operations: CoreNativeOperations, definition: CoreNativeDefinition,
): Effect.fn.Return<PreparedRootFamily, CommitEventError> {
  const storage = yield* Effect.fromResult(coreNativeEventStorage(definition));
  if (storage.mode !== "rootBound") return yield* eventError("invalidAuthority");
  const request = yield* core(authority.readNativeRootRequestEvidence(operations));
  if (!sameCoreNativeIdentity(request.source, definition.identity)) return yield* eventError("invalidAuthority");
  const previous = preparedRootFamilies.get(operations);
  if (previous?.authority === authority && previous.definition === definition) return previous.family;
  const policy = snapshotDecodedProtocolPlainData(yield* Effect.fromResult(captureCoreNativeEventPolicy(request.frame.contract.events)));
  const id = yield* coreNativeRootEventFamilyId(request);
  const packedRequest = canonicalRootRequest(request);
  const selected = yield* Effect.fromResult(tables(definition));
  if (definition.source.definition.kind !== "relational" || definition.source.definition.schema.capabilities.length !== 0
    || definition.source.definition.schema.tables.some(table => table.columns.some(column => column.default.kind !== "none")))
    return yield* eventError("invalidAuthority");
  const header = { id, event_count: commitEventLimits.messages, event_sha256: "f".repeat(64), root_request: packedRequest };
  const rowPolicy = coreNativeRelationalRows(definition, selected.family.name);
  if (rowPolicy === undefined || rowPolicy.table.columns.some(column => !Object.hasOwn(header, column.identity.columnId)))
    return yield* eventError("invalidAuthority");
  yield* core(Effect.fromResult(rowPolicy.rows.validate(header, "documentInvalid")));
  // Source v6 IDs have at most37 characters. This is size reservation, not ID
  // allocation; real generated system fields remain owned by Core.insert.
  const measured = yield* Effect.fromResult(captureCoreObject({ ...header, _id: "x".repeat(37), _creationTime: 1 }, true)
    .pipe(Result.mapError(cause => eventError("invalidInput", cause))));
  if (measured.semanticSizeBytes > coreNativeEventLimits.maxDocumentBytes || measured.nestingDepth > 16)
    return yield* eventError("limitExceeded");
  const family = Object.freeze({ id, request, packedRequest, retainedBytes: new TextEncoder().encode(packedRequest).byteLength, policy });
  preparedRootFamilies.set(operations, Object.freeze({ authority, definition, family }));
  return family;
});

/** The host consumes its authentic sealed Commerce closure before calling this
 * trusted storage seam. All input is captured before hashing or the first write.
 * Publication densely numbers the surviving values, matching the old publisher. */
export const stageCoreCommitEventFamily = Effect.fn("CoreNativeEvents.stageFamily")(function* (
  operations: CoreNativeOperations, definition: CoreNativeDefinition, familyId: string,
  input: CoreNativeEventFamilyInput, unixTime: number, rootAuthority?: RootEventAuthority,
) {
  const captured = capturePrivateJsonData(input, commitEventLimits.totalBytes + 131_072, eventError);
  const capture = yield* Effect.fromResult(captured);
  const envelope = yield* Effect.fromResult(decodeStageInput(capture.value).pipe(Result.mapError(cause => eventError("invalidInput", cause))));
  yield* Effect.fromResult(decodeId(familyId).pipe(Result.mapError(cause => eventError("invalidInput", cause))));
  const selected = yield* Effect.fromResult(tables(definition));
  const storage = yield* Effect.fromResult(coreNativeEventStorage(definition));
  const rootFamily = storage.mode === "rootBound"
    ? rootAuthority === undefined ? yield* eventError("invalidAuthority")
      : yield* prepareCoreRootCommitEventFamily(rootAuthority, operations, definition) : undefined;
  const policy = storage.mode === "fixed" ? storage.policy : rootFamily?.policy;
  if (policy === undefined || rootFamily !== undefined && rootFamily.id !== familyId) return yield* eventError("invalidAuthority");
  if (definition.source.definition.kind !== "relational" || definition.source.definition.schema.capabilities.length !== 0
    || definition.source.definition.schema.tables.some(table => table.columns.some(column => column.default.kind !== "none")))
    return yield* eventError("invalidAuthority");
  if (!Number.isFinite(unixTime) || !Number.isFinite(new Date(unixTime).getTime())) return yield* eventError("invalidInput");
  if (envelope.ordinals !== undefined && (envelope.ordinals.length !== envelope.values.length
    || envelope.ordinals.some((ordinal, index) => ordinal >= (envelope.capturedCount ?? envelope.values.length)
      || index > 0 && ordinal <= (envelope.ordinals?.[index - 1] ?? -1)))) return yield* eventError("invalidInput");
  const values: CommittedEvent[] = [];
  for (const value of envelope.values) {
    // StageInput already decoded the detached family. Retain each event's
    // independent byte/capture check before policy validation and hashing.
    yield* Effect.fromResult(capturePrivateJsonData(value, commitEventLimits.bytes, eventError));
    if (!matchesCoreNativeEventPolicy(policy, value) || new Set(value.subscribers.map(subscriber => subscriber.id)).size !== value.subscribers.length
      || rootFamily !== undefined && value.group !== rootFamily.request.key)
      return yield* eventError("invalidAuthority");
    values.push(snapshotDecodedProtocolPlainData(value));
  }
  const digest = values.length === 0 ? null : yield* commitEventsDigest(values);
  if (digest !== envelope.sha256) return yield* eventError("invalidInput");
  if (values.length === 0) return;
  const now = new Date(unixTime).toISOString();
  const deliveries: JsonObject[] = [];
  for (const [ordinal, event] of values.entries()) for (const subscriber of event.subscribers) deliveries.push({
    id: deliveryId(familyId, ordinal, subscriber.id), family_id: familyId, ordinal, subscriber_id: subscriber.id,
    handler_revision: subscriber.revision, state: "pending", attempts: 0, fence: "0", owner: null, lease_expires_at: null,
    next_attempt_at: now, settled_at: null, failure_code: null,
  });
  const records = [
    { phase: "family", table: selected.family, rows: [{ id: familyId, event_count: values.length, event_sha256: digest,
      ...(rootFamily === undefined ? {} : { root_request: rootFamily.packedRequest }) }] },
    { phase: "envelopes", table: selected.envelope, rows: values.map((event, ordinal) => ({
      id: ordinalId(familyId, ordinal), family_id: familyId, ordinal, envelope: event,
    })) },
    { phase: "deliveries", table: selected.delivery, rows: deliveries },
  ];
  // Core owns these complete private records: there are no native managed
  // defaults or ORM merge decisions. Validate the whole family before its first
  // insertion, then retain ordinary Core insert's schema, unique slots, metadata,
  // generated IDs, accounting and accepted-prefix integrity checks.
  for (const group of records) {
    const rowPolicy = coreNativeRelationalRows(definition, group.table.name);
    if (rowPolicy === undefined) return yield* eventError("invalidAuthority");
    for (const record of group.rows) {
      if (rowPolicy.table.columns.some(column => !Object.hasOwn(record, column.identity.columnId))) return yield* eventError("invalidInput");
      yield* core(Effect.fromResult(rowPolicy.rows.validate(record, "documentInvalid")));
    }
  }
  for (const group of records) yield* observeExecution(`CoreNativeEvents.stage/${group.phase}`, Effect.gen(function* () {
    for (const record of group.rows) yield* core(operations.insert(group.table.name, record));
  }));
});

declare const verifiedBrand: unique symbol;
export interface VerifiedCoreCommitEventFamily { readonly [verifiedBrand]: true }
declare const claimBrand: unique symbol;
export interface CoreCommitEventClaim { readonly [claimBrand]: true; readonly message: CommitEventMessage }
export interface CoreCommitEventStoreInput {
  readonly database: Pick<CoreDatabase, "readNativeBinding" | "beginNative" | "commit" | "resolveCommittedNativeRootRequest">;
  readonly binding: CoreNativeBinding;
}

/** Private native commands reacquire the authentic source on each short Core
 * operation. No raw storage, physical outbox or Product callback enters here. */
export const makeCoreCommitEventStore = Effect.fn("CoreNativeEvents.makeStore")(function* (input: CoreCommitEventStoreInput) {
  const { database, binding } = input;
  const claims = new WeakMap<object, Delivery>();
  const families = new WeakMap<object, { id: string; cursor?: string }>();
  const initial = yield* core(database.readNativeBinding(binding));
  const identity = initial.definition.identity;
  yield* Effect.fromResult(tables(initial.definition));
  yield* Effect.fromResult(coreNativeEventStorage(initial.definition));
  const transact = <A>(mode: "read" | "write", work: (operations: CoreNativeOperations, definition: CoreNativeDefinition, now: number) => Effect.Effect<A, CommitEventError>) =>
    Effect.gen(function* () {
      const metadata = yield* core(database.readNativeBinding(binding));
      if (metadata.definition.identity.definitionHash !== identity.definitionHash) return yield* eventError("invalidAuthority");
      let retainedBytes = 0;
      const chargeRetained = (bytes: number) => Effect.suspend(() => {
        retainedBytes += bytes;
        return Number.isSafeInteger(bytes) && bytes >= 0 && retainedBytes <= CORE_TRANSACTION_REFERENCE_LIMITS.systemBytesWritten
          ? Effect.void : Effect.fail(new CoreTransactionError({ reason: "capacity", cause: "Native event retained-byte budget" }));
      });
      return yield* Effect.acquireUseRelease(core(database.beginNative(binding, {
        commandName: mode === "read" ? CORE_NATIVE_EVENT_READ : CORE_NATIVE_EVENT_WRITE,
        limits: coreNativeEventLimits, chargeRetained,
        remainingBytes: () => Math.max(0, CORE_TRANSACTION_REFERENCE_LIMITS.systemBytesWritten - retainedBytes),
      })), operation => Effect.gen(function* () {
        const output = yield* work(operation.operations, metadata.definition, operation.unixTime);
        if (mode === "read") yield* core(operation.finishRead());
        else yield* core(database.commit(yield* core(operation.finalize())));
        return output;
      }), operation => operation.abort());
    });
  const family = Effect.fn("CoreNativeEvents.readFamily")(function* (operations: CoreNativeOperations, definition: CoreNativeDefinition, id: string) {
    yield* Effect.fromResult(decodeId(id).pipe(Result.mapError(cause => eventError("invalidInput", cause))));
    const selected = yield* Effect.fromResult(tables(definition));
    const storage = yield* Effect.fromResult(coreNativeEventStorage(definition));
    const headers = yield* core(operations.find(selected.family.name, { id }));
    if (headers.length !== 1 || headers[0] === undefined) return yield* corrupt();
    const header = yield* storage.mode === "fixed" ? fromStored(Result.flatMap(row(headers[0]), decodeFamily))
      : fromStored(Result.flatMap(row(headers[0]), decodeRootBoundFamily));
    if (header.id !== id) return yield* corrupt();
    let policy: RootEventPolicy;
    let requestKey: string | undefined;
    if (storage.mode === "fixed") policy = storage.policy;
    else {
      if (!("root_request" in header)) return yield* corrupt();
      const evidence = yield* decodePackedRootRequest(header.root_request).pipe(Effect.mapError(corrupt));
      if (canonicalRootRequest(evidence) !== header.root_request) return yield* corrupt();
      const committed = yield* database.resolveCommittedNativeRootRequest(evidence, binding).pipe(Effect.catchCause(cause =>
        Effect.failCause(Cause.map(cause, failure => failure instanceof CoreTransactionError
          && (failure.reason === "authorityRevoked" || failure.reason === "requestMismatch" || failure.reason === "invalidValue")
          ? corrupt(failure) : coreFailure(failure)))));
      if ((yield* coreNativeRootEventFamilyId(committed.evidence)) !== id) return yield* corrupt();
      policy = yield* Effect.fromResult(captureCoreNativeEventPolicy(committed.contract.events).pipe(Result.mapError(corrupt)));
      requestKey = committed.evidence.key;
    }
    const eventRows = yield* core(operations.find(selected.envelope.name, { family_id: id }));
    const deliveryRows = yield* core(operations.find(selected.delivery.name, { family_id: id }));
    if (eventRows.length !== header.event_count || header.event_count === 0) return yield* corrupt();
    const envelopes = yield* Effect.forEach(eventRows, document => fromStored(Result.flatMap(row(document), decodeEnvelopeRow)));
    envelopes.sort((left, right) => left.ordinal - right.ordinal);
    const events: CommittedEvent[] = [];
    const expected = new Map<string, string>();
    for (const [ordinal, event] of envelopes.entries()) {
      if (event.family_id !== id || event.ordinal !== ordinal || event.id !== ordinalId(id, ordinal)
        || !matchesCoreNativeEventPolicy(policy, event.envelope) || requestKey !== undefined && event.envelope.group !== requestKey)
        return yield* corrupt();
      const captured = yield* Effect.fromResult(capturePrivateJsonData(event.envelope, commitEventLimits.bytes, corrupt));
      const envelope = yield* fromStored(decodeEnvelope(captured.value));
      if (new Set(envelope.subscribers.map(subscriber => subscriber.id)).size !== envelope.subscribers.length) return yield* corrupt();
      for (const subscriber of envelope.subscribers) expected.set(deliveryId(id, ordinal, subscriber.id), subscriber.revision);
      events.push(snapshotDecodedProtocolPlainData(envelope));
    }
    const digest = yield* commitEventsDigest(events, "storedVerification").pipe(Effect.mapError(corrupt));
    if (digest !== header.event_sha256 || expected.size !== deliveryRows.length) return yield* corrupt();
    const deliveries = yield* Effect.forEach(deliveryRows, document => fromStored(Result.flatMap(row(document), decodeDelivery)));
    for (const delivery of deliveries) {
      if (delivery.family_id !== id || delivery.id !== deliveryId(id, delivery.ordinal, delivery.subscriber_id)
        || expected.get(delivery.id) !== delivery.handler_revision) return yield* corrupt();
      expected.delete(delivery.id);
    }
    if (expected.size !== 0) return yield* corrupt();
    deliveries.sort((left, right) => left.ordinal - right.ordinal || (left.subscriber_id < right.subscriber_id ? -1 : left.subscriber_id > right.subscriber_id ? 1 : 0));
    return { id, events: Object.freeze(events), deliveries: Object.freeze(deliveries) };
  });
  const nextFamily = Effect.fn("CoreNativeEvents.nextFamily")((after?: string) => transact("read", (operations, definition) => Effect.gen(function* () {
    if (after !== undefined) yield* Effect.fromResult(decodeId(after).pipe(Result.mapError(cause => eventError("invalidInput", cause))));
    const selected = yield* Effect.fromResult(tables(definition));
    const storage = yield* Effect.fromResult(coreNativeEventStorage(definition));
    const index = selected.family.indexes?.find(candidateIndex => candidateIndex.fields.length === 1 && candidateIndex.fields[0] === "id");
    if (index === undefined) return yield* eventError("invalidAuthority");
    const page = yield* core(operations.findPage(selected.family.name, after === undefined ? {} : { id: { gt: after } },
      { indexName: index.indexName, offset: 0, limit: 1 }));
    const document = page.documents[0];
    if (document === undefined) return Option.none<string>();
    const header = yield* storage.mode === "fixed" ? fromStored(Result.flatMap(row(document), decodeFamily))
      : fromStored(Result.flatMap(row(document), decodeRootBoundFamily));
    if (header.event_count === 0) return yield* corrupt();
    return Option.some(header.id);
  })));
  const readFamily = Effect.fn("CoreNativeEvents.family")((id: string) => transact("read", (operations, definition) => family(operations, definition, id)));
  const verifyFamily = Effect.fn("CoreNativeEvents.verifyFamily")(function* (id: string) {
    yield* readFamily(id);
    // SAFETY: only this store's WeakMap authenticates opaque family handles.
    const token = Object.freeze({}) as VerifiedCoreCommitEventFamily;
    families.set(token, { id });
    return token;
  });
  const claimVerifiedBatch = Effect.fn("CoreNativeEvents.claimBatch")(function* (token: VerifiedCoreCommitEventFamily,
    registered: readonly CommitEventSubscriber[], maximum: number) {
    const captured = capturePrivateJsonData(registered, commitEventLimits.bytes, eventError);
    const registeredInput = yield* Effect.fromResult(captured);
    const subscribers = yield* Effect.fromResult(decodeSubscribers(registeredInput.value).pipe(Result.mapError(cause => eventError("invalidInput", cause))));
    const verified = families.get(token);
    if (verified === undefined) return yield* eventError("invalidAuthority");
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > commitEventLimits.claimBatch) return yield* eventError("invalidInput");
    const result = yield* transact("write", (operations, definition, unixTime) => Effect.gen(function* () {
      const selected = yield* Effect.fromResult(tables(definition));
      const checked = yield* family(operations, definition, verified.id);
      const now = new Date(unixTime).toISOString();
      const claimed: { row: Delivery; envelope: CommittedEvent }[] = [];
      let cursor: string | undefined;
      for (const delivery of checked.deliveries) {
        if (verified.cursor !== undefined && delivery.id <= verified.cursor || !subscribers.some(subscriber =>
          subscriber.id === delivery.subscriber_id && subscriber.revision === delivery.handler_revision)
          || delivery.state === "delivered" || delivery.state === "failed" || Date.parse(delivery.next_attempt_at) > unixTime
          || delivery.state === "claimed" && Date.parse(delivery.lease_expires_at ?? "") > unixTime) continue;
        cursor = delivery.id;
        if (delivery.attempts >= commitEventLimits.attempts) {
          yield* core(operations.writeRows(selected.delivery.name, "update", [{ id: delivery.id, state: "failed", owner: null,
            lease_expires_at: null, settled_at: now, failure_code: "attempts-exhausted" }]));
          continue;
        }
        if (BigInt(delivery.fence) === MAX_PERSISTED_SIGNED_INT64_V1) return yield* corrupt();
        const updated: Delivery = { ...delivery, state: "claimed", attempts: delivery.attempts + 1, fence: String(BigInt(delivery.fence) + 1n),
          owner: crypto.randomUUID(), lease_expires_at: new Date(unixTime + commitEventLimits.leaseMs).toISOString() };
        const envelope = checked.events[delivery.ordinal];
        if (envelope === undefined) return yield* corrupt();
        yield* core(operations.writeRows(selected.delivery.name, "update", [updated]));
        claimed.push({ row: updated, envelope });
        if (claimed.length === maximum) break;
      }
      return { claimed, cursor };
    }));
    if (result.cursor !== undefined) verified.cursor = result.cursor;
    return Object.freeze(result.claimed.map(({ row: delivery, envelope }) => {
      const eventId = `${identity.scopeUuid}/${identity.epochUuid}/${delivery.family_id}/${delivery.ordinal}`;
      // SAFETY: the store registers the exact committed fence; message data
      // cannot manufacture settlement authority.
      const claim = Object.freeze({ message: Object.freeze({ eventId, deliveryId: `${eventId}/${delivery.subscriber_id}`,
        subscriber: Object.freeze({ id: delivery.subscriber_id, revision: delivery.handler_revision }), envelope }) }) as CoreCommitEventClaim;
      claims.set(claim, delivery);
      return claim;
    }));
  });
  const claimBatch = Effect.fn("CoreNativeEvents.claim")(function* (id: string, subscribers: readonly CommitEventSubscriber[], maximum: number) {
    const captured = capturePrivateJsonData(subscribers, commitEventLimits.bytes, eventError);
    const checked = yield* Effect.fromResult(captured);
    const registered = yield* Effect.fromResult(decodeSubscribers(checked.value).pipe(Result.mapError(cause => eventError("invalidInput", cause))));
    return yield* claimVerifiedBatch(yield* verifyFamily(id), registered, maximum);
  });
  const settle = Effect.fn("CoreNativeEvents.settle")(function* (token: CoreCommitEventClaim, failure?: { readonly retryable: boolean; readonly code: string }) {
    const claimedRow = claims.get(token);
    if (claimedRow === undefined) return yield* eventError("invalidAuthority");
    const capturedFailure = yield* Effect.fromResult(capturePrivateJsonData(failure === undefined ? null : failure, 1024, eventError));
    const failed = yield* Effect.fromResult(decodeSettlementFailure(capturedFailure.value)
      .pipe(Result.mapError(cause => eventError("invalidInput", cause))));
    yield* transact("write", (operations, definition, unixTime) => Effect.gen(function* () {
      const selected = yield* Effect.fromResult(tables(definition));
      const checked = yield* family(operations, definition, claimedRow.family_id);
      const current = checked.deliveries.find(delivery => delivery.id === claimedRow.id);
      if (current === undefined || current.state !== "claimed" || current.fence !== claimedRow.fence || current.owner !== claimedRow.owner
        || Date.parse(current.lease_expires_at ?? "") <= unixTime) return yield* eventError("staleClaim");
      const now = new Date(unixTime).toISOString();
      const retry = failed?.retryable === true && claimedRow.attempts < commitEventLimits.attempts;
      yield* core(operations.writeRows(selected.delivery.name, "update", [{ id: claimedRow.id,
        state: failed === null ? "delivered" : retry ? "pending" : "failed", owner: null, lease_expires_at: null,
        next_attempt_at: retry ? new Date(unixTime + Math.min(60_000, 1000 * 2 ** (claimedRow.attempts - 1))).toISOString() : now,
        settled_at: retry ? null : now, failure_code: failed?.code ?? null,
      }]));
    }));
    claims.delete(token);
  });
  return Object.freeze({ nextFamily, readFamily, verifyFamily, claimVerifiedBatch, claimBatch, settle });
});

export interface CoreCommitEventHandler extends CommitEventSubscriber {
  readonly handle: (message: CommitEventMessage) => Effect.Effect<void, CommitEventSubscriberFailure>;
}
/** Explicit repair scan. Completion resets the opaque directory cursor so the
 * next scan revisits retries, absent handlers and late publication behind it. */
export const makeCoreCommitEventPump = Effect.fn("CoreNativeEvents.makePump")(function* (
  input: CoreCommitEventStoreInput, inputHandlers: readonly CoreCommitEventHandler[],
) {
  const handlers = inputHandlers.map(({ id, revision, handle }) => ({ id, revision, handle }));
  const registered = yield* Effect.fromResult(decodeSubscribers(handlers.map(({ id, revision }) => ({ id, revision })))
    .pipe(Result.mapError(cause => eventError("invalidInput", cause))));
  if (handlers.length === 0 || new Set(handlers.map(handler => `${handler.id}/${handler.revision}`)).size !== handlers.length)
    return yield* eventError("invalidInput");
  const store = yield* makeCoreCommitEventStore(input);
  let active: { id: string; token: VerifiedCoreCommitEventFamily } | undefined;
  const runNext = Effect.fn("CoreNativeEvents.runNext")(function* (after?: string) {
    const next = yield* store.nextFamily(after);
    if (Option.isNone(next)) { active = undefined; return { done: true, cursor: undefined, delivered: 0, failed: 0 }; }
    if (active?.id !== next.value) active = { id: next.value, token: yield* store.verifyFamily(next.value) };
    let delivered = 0, failed = 0;
    for (let count = 0; count < commitEventLimits.batch;) {
      const claims = yield* store.claimVerifiedBatch(active.token, registered, Math.min(commitEventLimits.claimBatch, commitEventLimits.batch - count));
      if (claims.length === 0) { active = undefined; return { done: false, cursor: next.value, delivered, failed }; }
      count += claims.length;
      for (const claim of claims) {
        const handler = handlers.find(candidate => candidate.id === claim.message.subscriber.id && candidate.revision === claim.message.subscriber.revision);
        if (handler === undefined) return yield* eventError("invalidAuthority");
        yield* Effect.suspend(() => handler.handle(claim.message)).pipe(
          Effect.timeoutOrElse({ duration: 1000, orElse: () => Effect.fail(new CommitEventSubscriberFailure({ retryable: true, code: "handler-timeout" })) }),
          Effect.matchCauseEffect({ onSuccess: () => store.settle(claim).pipe(Effect.tap(() => Effect.sync(() => { delivered++; }))),
            onFailure: (cause): Effect.Effect<void, CommitEventError | CommitEventSubscriberFailure> => {
              // Only one expected failure defines a durable retry policy. Keep
              // all other Causes intact and leave the lease recoverable.
              const [failure] = cause.reasons;
              if (cause.reasons.length !== 1 || failure === undefined || !Cause.isFailReason(failure)) return Effect.failCause(cause);
              return store.settle(claim, { retryable: failure.error.retryable, code: failure.error.code })
                .pipe(Effect.tap(() => Effect.sync(() => { failed++; })));
            } }));
      }
    }
    return { done: false, cursor: after, delivered, failed };
  });
  return Object.freeze({ runNext });
});
