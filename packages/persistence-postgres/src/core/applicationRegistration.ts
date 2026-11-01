import { Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { CoreProgramIdentitySchema, CoreTransactionError, type CoreApplicationRegistration,
  type CoreApplicationRegistrationMetadata, type CoreError, type CoreProgramDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError } from "./contracts";
import { captureCoreObject } from "./document";
import { CORE_BUILTIN_TABLE_NUMBERS, PROGRAMS, SCHEMAS, TABLES, programKey, type CoreRegistry } from "./registry";
import { CoreSchemaError, type CoreSchemaDefinition } from "./schemaTypes";
import { serializeCoreSchema } from "./schemaJson";
import type { CoreSchemaSelection } from "./schemaRegistry";
import type { CoreTransactionInternals } from "./transaction";

const Digest = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{64}$/.test(value) ? undefined : "Expected a SHA-256 digest"));
const Uuid = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  ? undefined : "Expected a lowercase UUID"));
const Identity = Schema.Struct({ deploymentId: Schema.NonEmptyString, scopeUuid: Uuid, epochUuid: Uuid,
  sourceArtifactRootSha256: Digest, sourcePackageHash: Digest, analyzerIdentity: Digest, analyzerPolicyIdentity: Schema.NonEmptyString,
  compatibilityDate: Schema.String.check(Schema.makeFilter(value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? undefined : "Expected a compatibility date")),
  generation: Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value > 0 ? undefined : "Expected a positive safe generation")) });
const Proof = Schema.Struct({ format: Schema.Literal("flarex.core.application-registration"), version: Schema.Literal(1),
  identity: Identity, schemaHash: Digest, candidateHash: Schema.optionalKey(Digest),
  programs: Schema.Array(Schema.Struct({ identity: CoreProgramIdentitySchema, metadataHash: Digest })) });
type RegistrationProof = typeof Proof.Type;
const decodeIdentity = Schema.decodeUnknownResult(Identity);
const decodeProgramIdentity = Schema.decodeUnknownResult(CoreProgramIdentitySchema);
const decodeProof = Schema.decodeUnknownResult(Schema.fromJsonString(Proof), { onExcessProperty: "error" });
type RegistrationReadContext = Pick<CoreTransactionInternals, "registry" | "schemaRegistry" | "namespace" | "addIndexRead">;
const utf8 = new TextEncoder();
const text = new TextDecoder("utf-8", { fatal: true });
const invalid = (cause?: unknown) => new CoreTransactionError({ reason: "invalidValue", ...(cause === undefined ? {} : { cause }) });
const corrupt = (cause?: unknown) => new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
const refuse = (message: string) => new CoreSchemaError({ reason: "unsupportedCapability", message });
const sha256 = makeLivePrivateSha256V1<CoreError>({ invalidBudget: () => invalid(), invalidBytes: () => invalid(),
  inputBytesExceeded: () => invalid(), unavailable: () => new CoreSchemaError({ reason: "hashFailure", message: "Application registration digest unavailable" }),
  nativeRejected: cause => new CoreSchemaError({ reason: "hashFailure", message: "Application registration digest rejected", cause }),
  invalidDigestOutput: () => new Error("Application registration digest invariant") });
const hash = Effect.fn("CoreApplicationRegistration.hash")(function* (bytes: Uint8Array) {
  return encodeBytesToLowercaseHex(yield* sha256(bytes, { maximumInputBytes: Math.max(1, bytes.byteLength) }));
});

/** Own the expected complete publication before crossing any asynchronous boundary. */
export function captureCoreApplicationRegistration(input: CoreApplicationRegistration): Result.Result<CoreApplicationRegistration, CoreError> {
  return Result.gen(function* () {
    const identity = yield* decodeIdentity(input).pipe(Result.mapError(invalid));
    const programs: CoreProgramDefinition[] = [], paths = new Set<string>();
    for (const program of input.programs) {
      const captured = yield* decodeProgramIdentity(program.identity).pipe(Result.mapError(invalid));
      if (paths.has(captured.functionPath)) return yield* Result.fail(invalid());
      paths.add(captured.functionPath);
      const metadata = (yield* captureCoreObject(program.metadata, true).pipe(Result.mapError(invalid))).value;
      programs.push(Object.freeze({ identity: Object.freeze(captured), metadata }));
    }
    programs.sort((a, b) => compareUtf16Strings(a.identity.functionPath, b.identity.functionPath));
    const candidate = input.candidateMetadata === undefined ? undefined
      : (yield* captureCoreObject(input.candidateMetadata, true).pipe(Result.mapError(invalid))).value;
    return Object.freeze({ ...identity, programs: Object.freeze(programs),
      ...(candidate === undefined ? {} : { candidateMetadata: candidate }) });
  });
}

export const coreApplicationRegistrationProof = Effect.fn("CoreApplicationRegistration.proof")(function* (
  registration: CoreApplicationRegistration, schema: CoreSchemaDefinition,
) {
  const identity = yield* Effect.fromResult(decodeIdentity(registration).pipe(Result.mapError(invalid)));
  const schemaHash = yield* hash(utf8.encode(yield* Effect.fromResult(serializeCoreSchema(schema))));
  const programs: RegistrationProof["programs"][number][] = [];
  for (const program of registration.programs) programs.push({ identity: program.identity,
    metadataHash: yield* hash(yield* Effect.fromResult(encodeDocumentValue(program.metadata).pipe(Result.mapError(invalid)))) });
  programs.sort((a, b) => compareUtf16Strings(a.identity.functionPath, b.identity.functionPath));
  const candidateHash = registration.candidateMetadata === undefined ? undefined
    : yield* hash(yield* Effect.fromResult(encodeDocumentValue(registration.candidateMetadata).pipe(Result.mapError(invalid))));
  return encodeCanonicalJson({ format: "flarex.core.application-registration", version: 1, identity, schemaHash, programs,
    ...(candidateHash === undefined ? {} : { candidateHash }) },
    issue => { throw new Error("Captured application registration invariant", { cause: issue }); });
});

export function encodeCoreApplicationCandidateMetadata(registration: CoreApplicationRegistration): Result.Result<string | undefined, CoreError> {
  return registration.candidateMetadata === undefined ? Result.succeed(undefined)
    : encodeDocumentValue(registration.candidateMetadata).pipe(Result.mapError(invalid), Result.map(bytes => text.decode(bytes)));
}

/** Detached producer evidence; its complete canonical bytes are bound by the registration proof. */
export const readCoreApplicationCandidateEvidence = Effect.fn("CoreApplicationRegistration.candidateEvidence")(function* (
  selected: CoreSchemaSelection,
) {
  const encoded = selected.metadata.applicationRegistration;
  const candidate = selected.metadata.applicationCandidate;
  if (encoded === undefined || candidate === undefined) return Option.none<Readonly<{
    registration: CoreApplicationRegistrationMetadata; metadata: DocumentObject;
  }>>();
  const proof = yield* Effect.fromResult(decodeProof(encoded).pipe(Result.mapError(corrupt)));
  const metadata = (yield* Effect.fromResult(decodeDocumentValue(utf8.encode(candidate)).pipe(Result.mapError(corrupt),
    Result.flatMap(value => captureCoreObject(value, true).pipe(Result.mapError(corrupt)))))).value;
  const bytes = yield* Effect.fromResult(encodeDocumentValue(metadata).pipe(Result.mapError(corrupt)));
  if (proof.candidateHash === undefined || text.decode(bytes) !== candidate || (yield* hash(bytes)) !== proof.candidateHash
    || (yield* hash(utf8.encode(yield* Effect.fromResult(serializeCoreSchema(selected.schema))))) !== proof.schemaHash)
    return yield* corrupt();
  const registration = Object.freeze({ ...proof.identity,
    candidateProposal: Object.freeze({ namespace: null, id: selected.id }),
    programs: Object.freeze(proof.programs.map(program => Object.freeze({ identity: Object.freeze({ ...program.identity }) }))),
  });
  return Option.some(Object.freeze({ registration, metadata }));
});

/** Dependencies cover absence, hidden/deleting tables and all program revisions, including a zero-table schema. */
function trackCatalog(context: RegistrationReadContext): Result.Result<void, CoreError> {
  for (const name of [TABLES, PROGRAMS]) {
    const index = context.registry.table(name)?.definition.indexes.find(candidate => candidate.name === "by_id");
    if (index === undefined) return Result.fail(corrupt());
    context.addIndexRead(index.ref.id, { start: null, end: null });
  }
  return Result.succeed(undefined);
}
export const liveCoreApplicationSchemas = (context: RegistrationReadContext): Result.Result<readonly CoreSchemaSelection[], CoreError> => Result.gen(function* () {
  yield* trackCatalog(context);
  const entries: CoreSchemaSelection[] = [];
  for (const record of context.registry.tables.values()) {
    const table = record.definition;
    if (table.name !== SCHEMAS) continue;
    const index = table.indexes.find(candidate => candidate.name === "by_state");
    if (index === undefined) return yield* Result.fail(corrupt());
    for (const state of ["active", "pending", "validated"] as const) {
      const selected = yield* context.schemaRegistry.getByState(table.namespace, state, index.ref,
        (id, interval) => context.addIndexRead(id, interval));
      if (Option.isSome(selected)) entries.push(selected.value);
    }
  }
  return entries;
});
const retainedTables = (context: RegistrationReadContext) => [...context.registry.tables.values()].map(record => record.definition)
  .filter(table => !CORE_BUILTIN_TABLE_NUMBERS.has(table.name) || table.nativePolicy !== undefined);

export function requireCoreApplicationTables(context: RegistrationReadContext, schema: CoreSchemaDefinition): Result.Result<readonly CoreTableDefinition[], CoreError> {
  const tables = retainedTables(context);
  if (tables.length !== schema.tables.length || tables.some(table => table.namespace !== null || table.state !== "active"
    || table.nativePolicy !== undefined || !schema.tables.some(declaration => declaration.tableName === table.name)))
    return Result.fail(refuse("Application registration requires exactly its declared ordinary active tables"));
  return Result.succeed(tables);
}

/** Read back the actual complete persisted closure; a caller digest never authenticates a publication. */
export const readCoreApplicationRegistration = Effect.fn("CoreApplicationRegistration.read")(function* (
  context: RegistrationReadContext, selected: CoreSchemaSelection,
) {
  const encoded = selected.metadata.applicationRegistration;
  if (encoded === undefined) return yield* corrupt();
  const proof = yield* Effect.fromResult(decodeProof(encoded).pipe(Result.mapError(corrupt)));
  const programs: CoreProgramDefinition[] = [];
  if (context.registry.programs.size !== proof.programs.length || context.registry.heads.size !== proof.programs.length)
    return yield* refuse("Application registration program closure differs from its stored proof");
  for (const expected of proof.programs) {
    const record = context.registry.program(expected.identity), head = context.registry.head(expected.identity.functionPath);
    if (record === undefined || head === undefined || programKey(head.identity) !== programKey(expected.identity))
      return yield* refuse("Application registration program identity differs from its stored proof");
    programs.push(record.definition);
  }
  const candidate = yield* readCoreApplicationCandidateEvidence(selected);
  const registration = yield* Effect.fromResult(captureCoreApplicationRegistration({ ...proof.identity, programs,
    ...(Option.isNone(candidate) ? {} : { candidateMetadata: candidate.value.metadata }) }).pipe(Result.mapError(corrupt)));
  if ((yield* coreApplicationRegistrationProof(registration, selected.schema)) !== encoded)
    return yield* refuse("Application registration schema or program metadata differs from its stored proof");
  yield* Effect.fromResult(requireCoreApplicationTables(context, selected.schema));
  return registration;
});

/** Runs in the existing settling admin transaction, before submission creates user tables. */
export const guardCoreApplicationRegistration = Effect.fn("CoreApplicationRegistration.guard")(function* (
  context: CoreTransactionInternals, input: Readonly<{ registration?: CoreApplicationRegistration; schema?: CoreSchemaDefinition;
    proposalId?: string; publication?: readonly CoreProgramDefinition[]; mode: "prepare" | "activate" | "publish";
    native?: boolean }>, assertEmpty: (table: CoreTableDefinition) => Effect.Effect<void, CoreError>,
) {
  const live = yield* Effect.fromResult(liveCoreApplicationSchemas(context));
  const tagged = live.filter(entry => entry.metadata.applicationRegistration !== undefined);
  if (input.registration === undefined) {
    if (tagged.length !== 0) return yield* refuse("Application schema lifecycle requires its complete registration proof");
    return undefined;
  }
  if (context.namespace !== null || input.native || input.schema === undefined)
    return yield* refuse("Application registration requires an ordinary default-namespace schema");
  const proof = yield* coreApplicationRegistrationProof(input.registration, input.schema);
  if (input.publication !== undefined) {
    const actual = yield* Effect.fromResult(captureCoreApplicationRegistration({ ...input.registration, programs: input.publication }));
    if ((yield* coreApplicationRegistrationProof(actual, input.schema)) !== proof)
      return yield* refuse("Application registration must publish its complete expected program identities and metadata");
  }
  if (live.length === 0) {
    if (input.mode !== "prepare" || retainedTables(context).length !== 0 || context.registry.programs.size !== 0 || context.registry.heads.size !== 0)
      return yield* refuse("Fresh application registration requires an unused database");
    return proof;
  }
  const existing = live[0];
  if (live.length !== 1 || existing === undefined || existing.metadata.applicationRegistration !== proof
    || existing.metadata.native !== undefined || existing.metadata.schema !== (yield* Effect.fromResult(serializeCoreSchema(input.schema)))
    || input.proposalId !== undefined && existing.id !== input.proposalId)
    return yield* refuse("Application registration cannot adopt or replace another schema or source");
  const tables = yield* Effect.fromResult(requireCoreApplicationTables(context, input.schema));
  if (existing.metadata.state.state === "active") {
    yield* readCoreApplicationRegistration(context, existing);
  } else {
    if (input.mode === "publish" || context.registry.programs.size !== 0 || context.registry.heads.size !== 0)
      return yield* refuse("Pending application registration cannot contain published programs");
    for (const table of tables) yield* assertEmpty(table);
  }
  return proof;
});

export const readActiveCoreApplicationRegistration = Effect.fn("CoreApplicationRegistration.readActive")(function* (context: RegistrationReadContext,
  checked: WeakMap<CoreRegistry, CoreApplicationRegistrationMetadata>) {
  const live = yield* Effect.fromResult(liveCoreApplicationSchemas(context));
  const active = live.find(entry => entry.metadata.state.state === "active" && entry.metadata.applicationRegistration !== undefined);
  if (active === undefined) return Option.none<CoreApplicationRegistrationMetadata>();
  if (live.length !== 1 || context.namespace !== null) return yield* refuse("Application registration has a foreign live schema");
  // Dependencies above are recorded on every operation, including memo hits.
  // Only successful validation of the complete immutable registry is reusable.
  const previous = checked.get(context.registry);
  if (previous !== undefined) return Option.some(previous);
  const registration = yield* readCoreApplicationRegistration(context, active);
  const { programs, candidateMetadata, ...identity } = registration;
  const metadata = Object.freeze({ ...identity, programs: Object.freeze(programs.map(program => Object.freeze({
    identity: Object.freeze({ ...program.identity }),
  }))), ...(candidateMetadata === undefined ? {} : { candidateProposal: Object.freeze({ namespace: context.namespace, id: active.id }) }) });
  checked.set(context.registry, metadata);
  return Option.some(metadata);
});
