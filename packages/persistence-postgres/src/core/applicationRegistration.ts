import { Effect, Option, Result, Schema } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { decodeDocumentValue, encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { incrementIndexKeyPrefix } from "flarex-protocol/index-range";
import { CoreApplicationSourcePinSchema, CoreProgramIdentitySchema, CoreTransactionError, type CoreApplicationRegistration,
  type CoreApplicationRegistrationMetadata, type CoreError, type CoreProgramDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError } from "./contracts";
import type { CoreApplicationDeploymentRecord } from "./applicationDeploymentTypes";
import { captureCoreObject } from "./document";
import { CORE_BUILTIN_TABLE_NUMBERS, PROGRAMS, SCHEMAS, TABLES, programKey, type CoreRegistry } from "./registry";
import { CoreSchemaError, type CoreSchemaDefinition } from "./schemaTypes";
import { serializeCoreSchema } from "./schemaJson";
import type { CoreSchemaSelection } from "./schemaRegistry";
import type { CoreTransactionInternals } from "./transaction";

const Digest = CoreApplicationSourcePinSchema.fields.sourceArtifactRootSha256;
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
export type RegistrationReadContext = Pick<CoreTransactionInternals, "registry" | "schemaRegistry" | "namespace" | "addIndexRead">;
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

/** Own the complete immutable program closure before lifecycle I/O. */
export function captureCoreApplicationPrograms(input: readonly CoreProgramDefinition[]): Result.Result<readonly CoreProgramDefinition[], CoreError> {
  return Result.gen(function* () {
    const programs: CoreProgramDefinition[] = [], paths = new Set<string>();
    for (const program of input) {
      const captured = yield* decodeProgramIdentity(program.identity).pipe(Result.mapError(invalid));
      if (paths.has(captured.functionPath)) return yield* Result.fail(invalid());
      paths.add(captured.functionPath);
      const metadata = (yield* captureCoreObject(program.metadata, true).pipe(Result.mapError(invalid))).value;
      programs.push(Object.freeze({ identity: Object.freeze(captured), metadata }));
    }
    programs.sort((a, b) => compareUtf16Strings(a.identity.functionPath, b.identity.functionPath));
    return Object.freeze(programs);
  });
}

/** Own the expected complete publication before crossing any asynchronous boundary. */
export function captureCoreApplicationRegistration(input: CoreApplicationRegistration): Result.Result<CoreApplicationRegistration, CoreError> {
  return Result.gen(function* () {
    const identity = yield* decodeIdentity(input).pipe(Result.mapError(invalid));
    const programs = yield* captureCoreApplicationPrograms(input.programs);
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

/** Authenticate immutable source evidence independently of mutable schema lifecycle. */
export const readCoreApplicationDeploymentEvidence = Effect.fn("CoreApplicationRegistration.candidateEvidence")(function* (
  record: CoreApplicationDeploymentRecord, selected: CoreSchemaSelection,
) {
  const encoded = record.value.proof, candidate = record.value.metadata;
  const proof = yield* Effect.fromResult(decodeProof(encoded).pipe(Result.mapError(corrupt)));
  let metadata: DocumentObject = Object.freeze({});
  if (candidate !== undefined) {
    metadata = (yield* Effect.fromResult(decodeDocumentValue(utf8.encode(candidate)).pipe(Result.mapError(corrupt),
      Result.flatMap(value => captureCoreObject(value, true).pipe(Result.mapError(corrupt)))))).value;
    const bytes = yield* Effect.fromResult(encodeDocumentValue(metadata).pipe(Result.mapError(corrupt)));
    if (proof.candidateHash === undefined || text.decode(bytes) !== candidate || (yield* hash(bytes)) !== proof.candidateHash)
      return yield* corrupt();
  } else if (proof.candidateHash !== undefined) return yield* corrupt();
  if ((yield* hash(utf8.encode(yield* Effect.fromResult(serializeCoreSchema(selected.schema))))) !== proof.schemaHash)
    return yield* corrupt();
  const paths = new Set<string>();
  for (const program of proof.programs) {
    if (paths.has(program.identity.functionPath)) return yield* corrupt();
    paths.add(program.identity.functionPath);
  }
  const registration = Object.freeze({ ...proof.identity, candidateId: record.value.candidateId,
    programs: Object.freeze(proof.programs.map(program => Object.freeze({ identity: Object.freeze({ ...program.identity }) }))),
  });
  return Object.freeze({ registration, metadata, proof });
});

/** Full catalog dependencies include absence and hidden/deleting metadata. */
function trackCatalog(context: RegistrationReadContext, name: typeof TABLES | typeof PROGRAMS): Result.Result<void, CoreError> {
  const index = context.registry.table(name)?.definition.indexes.find(candidate => candidate.name === "by_id");
  if (index === undefined) return Result.fail(corrupt());
  context.addIndexRead(index.ref.id, { start: null, end: null });
  return Result.succeed(undefined);
}

/** Complete publication/emptiness checks consume every revision and head,
 * including an empty closure and authority metadata in the same catalog. */
export function trackCoreApplicationPrograms(context: RegistrationReadContext): Result.Result<void, CoreError> {
  return trackCatalog(context, PROGRAMS);
}

function trackApplicationCatalogKind(context: RegistrationReadContext, kind: "applicationDeployment" | "activeApplication"):
Result.Result<void, CoreError> {
  return Result.gen(function* () {
    const index = context.registry.table(PROGRAMS)?.definition.indexes.find(candidate => candidate.name === "by_identity");
    if (index === undefined) return yield* Result.fail(corrupt());
    const start = yield* encodeIndexValue(kind).pipe(Result.mapError(corrupt));
    context.addIndexRead(index.ref.id, { start, end: incrementIndexKeyPrefix(start) });
  });
}

export const liveCoreApplicationSchemas = (context: RegistrationReadContext): Result.Result<readonly CoreSchemaSelection[], CoreError> => Result.gen(function* () {
  yield* trackCatalog(context, TABLES);
  const entries: CoreSchemaSelection[] = [];
  for (const record of context.registry.tables.values()) {
    const table = record.definition;
    if (table.name !== SCHEMAS) continue;
    const index = table.indexes.find(candidate => candidate.name === "by_state");
    if (index === undefined) return yield* Result.fail(corrupt());
    for (const state of ["active", "pending", "validated"] as const) {
      const selected = yield* context.schemaRegistry.getByState(table.namespace, state, index.ref,
        (id, interval) => context.addIndexRead(id, interval));
      if (Option.isSome(selected)) {
        if (table.namespace !== null) return yield* Result.fail(refuse("Application registration has a foreign live schema"));
        entries.push(selected.value);
      }
    }
  }
  return entries;
});
const retainedTables = (context: RegistrationReadContext) => [...context.registry.tables.values()].map(record => record.definition)
  .filter(table => !CORE_BUILTIN_TABLE_NUMBERS.has(table.name) || table.nativePolicy !== undefined);

export function requireCoreApplicationTables(context: RegistrationReadContext, schema: CoreSchemaDefinition): Result.Result<readonly CoreTableDefinition[], CoreError> {
  const tables = retainedTables(context);
  if (tables.some(table => table.namespace !== null || table.state !== "active" || table.nativePolicy !== undefined)
    || schema.tables.some(declaration => !tables.some(table => table.name === declaration.tableName)))
    return Result.fail(refuse("Application registration requires its declared ordinary active tables"));
  return Result.succeed(tables);
}

/** Read and authenticate exactly the current heads while retaining original revisions. */
export const readCoreApplicationRegistration = Effect.fn("CoreApplicationRegistration.read")(function* (
  context: RegistrationReadContext, record: CoreApplicationDeploymentRecord, selected: CoreSchemaSelection,
) {
  const evidence = yield* readCoreApplicationDeploymentEvidence(record, selected);
  if (context.registry.heads.size !== evidence.proof.programs.length)
    return yield* refuse("Application registration program closure differs from its stored proof");
  const programs: CoreProgramDefinition[] = [];
  for (const expected of evidence.proof.programs) {
    const program = context.registry.program(expected.identity), head = context.registry.head(expected.identity.functionPath);
    if (program === undefined || head === undefined || programKey(head.identity) !== programKey(expected.identity))
      return yield* refuse("Application registration program identity differs from its stored proof");
    programs.push(program.definition);
  }
  const registration = yield* Effect.fromResult(captureCoreApplicationRegistration({ ...evidence.proof.identity, programs,
    ...(record.value.metadata === undefined ? {} : { candidateMetadata: evidence.metadata }) }).pipe(Result.mapError(corrupt)));
  if ((yield* coreApplicationRegistrationProof(registration, selected.schema)) !== record.value.proof)
    return yield* refuse("Application registration schema or program metadata differs from its stored proof");
  yield* Effect.fromResult(requireCoreApplicationTables(context, selected.schema));
  return evidence.registration;
});

export const readActiveCoreApplicationRegistration = Effect.fn("CoreApplicationRegistration.readActive")(function* (context: RegistrationReadContext,
  checked: WeakMap<CoreRegistry, CoreApplicationRegistrationMetadata>) {
  const pointer = context.registry.activeApplication;
  if (pointer === undefined) {
    yield* Effect.fromResult(trackApplicationCatalogKind(context, "activeApplication"));
    yield* Effect.fromResult(trackApplicationCatalogKind(context, "applicationDeployment"));
    if ([...context.registry.applicationDeployments.values()].some(record => record.value.state === "activated"))
      return yield* corrupt("Activated Application deployment is missing its active pointer");
    return Option.none<CoreApplicationRegistrationMetadata>();
  }
  yield* Effect.fromResult(trackCoreApplicationPrograms(context));
  const live = yield* Effect.fromResult(liveCoreApplicationSchemas(context));
  const record = context.registry.applicationDeployments.get(pointer.candidateId);
  const active = live.find(schema => schema.metadata.state.state === "active");
  if (context.namespace !== null || record?.value.state !== "activated" || record.value.activatedAt === undefined
    || active === undefined || active.id !== record.value.schemaId || live.some(schema => schema.metadata.native !== undefined))
    return yield* corrupt();
  const previous = checked.get(context.registry);
  if (previous !== undefined) return Option.some(previous);
  const metadata = yield* readCoreApplicationRegistration(context, record, active);
  checked.set(context.registry, metadata);
  return Option.some(metadata);
});

/** Registered source publication is available only through its atomic deployment owner. */
export const guardCoreUnregisteredLifecycle = Effect.fn("CoreApplicationRegistration.guardUnregistered")(function* (context: RegistrationReadContext) {
  yield* Effect.fromResult(trackApplicationCatalogKind(context, "applicationDeployment"));
  yield* Effect.fromResult(trackApplicationCatalogKind(context, "activeApplication"));
  if (context.registry.applicationDeployments.size !== 0 || context.registry.activeApplication !== undefined)
    return yield* refuse("Registered Application lifecycle requires a deployment candidate");
});
