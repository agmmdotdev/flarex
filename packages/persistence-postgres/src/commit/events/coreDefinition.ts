import { Effect, Result, Schema } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { isJsonObject, jsonEqual, type Json } from "flarex-protocol/json";
import { makeCoreRelationalNativeDefinition, type CoreNativeDefinition } from "../../core/nativePolicy";
import { capturePrivateJsonData } from "../../values/privateJsonData";
import { EventName, EventRevision, EventSubscriber, commitEventLimits, eventError, type CommittedEvent } from "./model";

export const CORE_NATIVE_EVENT_READ = "native-events-read";
export const CORE_NATIVE_EVENT_WRITE = "native-events-write";
export const coreNativeEventLimits = Object.freeze({ maxIdentities: 20_000, maxDocumentBytes: 131_072 });

const Contract = Schema.Struct({ name: EventName, revision: EventRevision, internal: Schema.Boolean,
  pendingCancellation: Schema.optionalKey(Schema.Literal(true)), derivedIdMetadata: Schema.optionalKey(Schema.Json) });
export const CoreNativeEventPolicySchema = Schema.Struct({ producerRevision: EventRevision,
  contracts: Schema.Array(Contract).check(Schema.isMaxLength(commitEventLimits.messages)),
  subscribers: Schema.Array(EventSubscriber).check(Schema.isMinLength(1), Schema.isMaxLength(commitEventLimits.subscribers)),
  derivedIdValidation: Schema.optionalKey(Schema.Literal("capturedOnly")),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
const decodePolicy = Schema.decodeUnknownResult(CoreNativeEventPolicySchema, { onExcessProperty: "error" });
type Policy = typeof CoreNativeEventPolicySchema.Type;
export function captureCoreNativeEventPolicy(input: unknown): Result.Result<Policy, ReturnType<typeof eventError>> {
  return decodePolicy(input).pipe(Result.mapError(cause => eventError("invalidAuthority", cause)),
    Result.flatMap(policy => new Set(policy.contracts.map(contract => contract.name)).size !== policy.contracts.length
      || new Set(policy.subscribers.map(subscriber => subscriber.id)).size !== policy.subscribers.length
      ? Result.fail(eventError("invalidAuthority")) : Result.succeed(policy)));
}
const RootBoundPolicy = Schema.Struct({ mode: Schema.Literal("rootBound"), version: Schema.Literal(1) })
  .annotate({ parseOptions: { onExcessProperty: "error" } });
const decodeRootBoundPolicy = Schema.decodeUnknownResult(RootBoundPolicy, { onExcessProperty: "error" });

/** Stable private storage keeps exact per-request policy in the committed root
 * commitment. A family never authorizes its own declared policy. */
export function coreNativeEventStorage(definition: CoreNativeDefinition): Result.Result<
  Readonly<{ mode: "fixed"; policy: Policy }> | Readonly<{ mode: "rootBound" }>, ReturnType<typeof eventError>> {
  const source = definition.source, evidence = source.evidence;
  if (source.key !== "flarex.native-events" || source.writeProfile !== "flarex.native-events" || source.owner !== "system"
    || definition.applicationRead || !isJsonObject(evidence) || evidence.kind !== "coreNativeEvents")
    return Result.fail(eventError("invalidAuthority"));
  if (Result.isSuccess(decodeRootBoundPolicy(evidence.policy))) return Result.succeed(Object.freeze({ mode: "rootBound" }));
  return coreNativeEventPolicy(definition).pipe(Result.map(policy => Object.freeze({ mode: "fixed", policy })));
}

export function coreNativeEventPolicy(definition: CoreNativeDefinition): Result.Result<Policy, ReturnType<typeof eventError>> {
  const source = definition.source, evidence = source.evidence;
  if (source.key !== "flarex.native-events" || source.writeProfile !== "flarex.native-events" || source.owner !== "system" || definition.applicationRead
    || !isJsonObject(evidence) || evidence.kind !== "coreNativeEvents")
    return Result.fail(eventError("invalidAuthority"));
  return captureCoreNativeEventPolicy(evidence.policy);
}

export function matchesCoreNativeEventPolicy(policy: Policy, envelope: CommittedEvent): boolean {
  return envelope.eligibility === undefined && envelope.producerRevision === policy.producerRevision
    && jsonEqual(envelope.subscribers, policy.subscribers) && policy.contracts.some(contract =>
      contract.name === envelope.contract && contract.revision === envelope.contractRevision && contract.internal === envelope.internal);
}

/** Optional source-owned private records; unrelated native/bootstrap frames stay
 * unchanged. The authenticated source includes exact producer and routing policy. */
export const compileCoreNativeEventDefinition = Effect.fn("CoreNativeEvents.compileDefinition")(function* (input: Readonly<{
  scopeUuid: string; epochUuid: string; policy: Json;
}>) {
  return yield* compileEventDefinition(input);
});

export const compileCoreNativeEventStorageDefinition = Effect.fn("CoreNativeEvents.compileStorageDefinition")(function* (input: Readonly<{
  scopeUuid: string; epochUuid: string;
}>) {
  return yield* compileEventDefinition({ ...input, rootBound: true, policy: { mode: "rootBound", version: 1 } });
});

const compileEventDefinition = Effect.fn("CoreNativeEvents.compileStorage")(function* (input: Readonly<{
  scopeUuid: string; epochUuid: string; policy: Json; rootBound?: true;
}>) {
  const nativeTarget = Object.freeze({ scopeUuid: input.scopeUuid, epochUuid: input.epochUuid });
  const captured = yield* Effect.fromResult(capturePrivateJsonData(input.policy, commitEventLimits.totalBytes, eventError));
  if (input.rootBound === true) yield* Effect.fromResult(decodeRootBoundPolicy(captured.value)
    .pipe(Result.mapError(cause => eventError("invalidAuthority", cause))));
  else {
    const policy = yield* Effect.fromResult(decodePolicy(captured.value).pipe(Result.mapError(cause => eventError("invalidAuthority", cause))));
    if (new Set(policy.contracts.map(contract => contract.name)).size !== policy.contracts.length
      || new Set(policy.subscribers.map(subscriber => subscriber.id)).size !== policy.subscribers.length)
      return yield* eventError("invalidAuthority");
  }
  const origin = { kind: "authored", sourceId: "core.native-events" } as const;
  const column = (columnId: string, type: "text" | "integer" | "timestamptz" | "jsonb", nullable = false) =>
    ({ columnId, type, nullable, default: { kind: "none" }, origin });
  const table = (tableId: string, columns: readonly ReturnType<typeof column>[], indexes: readonly Readonly<{ indexId: string; columns: readonly string[] }>[] = []) => ({
    tableId, origin, columns, keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }],
    indexes: indexes.map(index => ({ ...index, kind: "btree", predicate: null, origin })), constraints: [], relationships: [],
  });
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "system", lineageId: "flarex.native-events",
    tables: [table("native_event_family", [column("id", "text"), column("event_count", "integer"), column("event_sha256", "text", true),
      ...(input.rootBound === true ? [column("root_request", "text")] : [])]),
      table("native_event_envelope", [column("id", "text"), column("family_id", "text"), column("ordinal", "integer"), column("envelope", "jsonb")],
        [{ indexId: "native_event_envelope.family", columns: ["family_id", "ordinal"] }]),
      table("native_event_delivery", [column("id", "text"), column("family_id", "text"), column("ordinal", "integer"),
        column("subscriber_id", "text"), column("handler_revision", "text"), column("state", "text"), column("attempts", "integer"),
        column("fence", "text"), column("owner", "text", true), column("lease_expires_at", "timestamptz", true),
        column("next_attempt_at", "timestamptz"), column("settled_at", "timestamptz", true), column("failure_code", "text", true)],
        [{ indexId: "native_event_delivery.family", columns: ["family_id", "ordinal", "subscriber_id"] }])], capabilities: [] }));
  const provenance = { kind: "coreNativeEvents", owner: "system", version: input.rootBound === true ? 2 : 1, policy: captured.value } satisfies Json;
  const source = yield* captureLogicalSchemaSource({ key: "flarex.native-events", owner: "system", writeProfile: "flarex.native-events",
    evidence: { kind: "coreNativeEvents", provenance, policy: captured.value,
      privateEventTables: [{ localName: "native_event_family", role: "family" }, { localName: "native_event_envelope", role: "envelope" },
        { localName: "native_event_delivery", role: "delivery" }] },
    definition: { kind: "relational", schema }, bindings: schema.tables.map(schemaTable => ({ kind: "definition", localName: schemaTable.identity.tableId,
      table: { namespace: "system", logicalName: `${schema.coordinate.lineageId}/${schemaTable.identity.tableId}` } })) });
  return yield* makeCoreRelationalNativeDefinition({ ...nativeTarget, source, provenance,
    commands: [{ name: CORE_NATIVE_EVENT_READ, mode: "read" }, { name: CORE_NATIVE_EVENT_WRITE, mode: "write" }], applicationRead: false });
});
