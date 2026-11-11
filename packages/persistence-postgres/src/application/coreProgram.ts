import { canonicalizeApplicationManifest, canonicalizeApplicationManifestWire, type ApplicationManifest, type ApplicationManifestV1 } from "@flarex/analysis/application-analysis";
import { applicationFunctionCatalogPublicationFrameV1, applicationFunctionEntryPublicationFrameV1,
  applicationPublicationCommitmentFrameV1, applicationSchemaPublicationFrameV1 } from "@flarex/analysis/internal/application-publication-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { DocumentObject } from "flarex-protocol/document-value";
import { canonicalizeApplicationMutationExecutionAuthorityV1,
  canonicalizeApplicationMutationExecutionAuthorityWireV1,
  type CanonicalApplicationMutationExecutionAuthorityV1 } from "flarex-protocol/internal/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1, canonicalizeApplicationRuntimeTargetWireV1,
  applicationRuntimeTargetWireV1,
  type ApplicationRuntimeTargetV1 } from "flarex-protocol/internal/application-runtime-target-v1";
import { projectScopeIdUuidV1Result, ScopeEpochUuidV1Schema, ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { validateValidatorValueV1 } from "flarex-protocol/validator-engine";
import { CoreApplicationSourcePinSchema, type CoreProgramDefinition, type CoreReadTransaction } from "../core/api";
import { captureCoreObject } from "../core/document";
import { requireCoreApplicationSchemaSupport } from "./coreSchema";

export class CoreApplicationProgramError extends Data.TaggedError("CoreApplicationProgramError")<{
  readonly reason: "metadataInvalid" | "argumentsInvalid" | "hashFailure" | "unsupportedSelection";
  readonly cause?: unknown;
}> {}

interface CoreApplicationProgramBase {
  readonly validatorIdentityEncoding: 2;
  readonly definition: CoreProgramDefinition;
  readonly runtimeTarget: ApplicationRuntimeTargetV1;
  readonly manifest: ApplicationManifestV1;
  readonly compatibilityDate: string;
  readonly scopeUuid: string;
  readonly epochUuid: string;
}
export type CoreApplicationProgram = CoreApplicationProgramBase & (
  | Readonly<{ kind: "query" }>
  | Readonly<{ kind: "mutation"; executionAuthority: CanonicalApplicationMutationExecutionAuthorityV1 }>
);
export interface CoreApplicationTableBinding { readonly tableId: number; readonly logicalName: string }
const ProgramProfile = Schema.Struct({ scopeUuid: ScopeUuidV1Schema, epochUuid: ScopeEpochUuidV1Schema,
  sourceArtifactRootSha256: CoreApplicationSourcePinSchema.fields.sourceArtifactRootSha256,
  sourcePackageHash: Schema.optionalKey(CoreApplicationSourcePinSchema.fields.sourcePackageHash) });
export type CoreApplicationProgramProfile = typeof ProgramProfile.Type;
const decodeProgramProfile = Schema.decodeUnknownResult(ProgramProfile);

/** Program metadata checks scope, epoch and source root; Core admission checks the optional package pin. */
export function captureCoreApplicationProgramProfile(input: unknown): Result.Result<CoreApplicationProgramProfile, CoreApplicationProgramError> {
  return decodeProgramProfile(input).pipe(
    Result.mapError(cause => new CoreApplicationProgramError({ reason: "metadataInvalid", cause })),
    Result.map(value => Object.freeze({ ...value })),
  );
}

export function requireCoreApplicationProgramProfile(program: CoreApplicationProgram,
  expected: CoreApplicationProgramProfile): Result.Result<void, CoreApplicationProgramError> {
  return program.scopeUuid === expected.scopeUuid && program.epochUuid === expected.epochUuid
    && program.runtimeTarget.sourceArtifactRootSha256 === expected.sourceArtifactRootSha256
    ? Result.succeed(undefined) : Result.fail(new CoreApplicationProgramError({ reason: "unsupportedSelection" }));
}
type Hash = (bytes: Uint8Array) => Effect.Effect<Uint8Array, unknown>;
const utf8 = new TextEncoder();
const MetadataFields = { compatibilityDate: Schema.NonEmptyString,
  scopeUuid: ScopeUuidV1Schema, epochUuid: ScopeEpochUuidV1Schema };
const CurrentMetadataFields = { ...MetadataFields, format: Schema.Literal("flarex.core-application-program"),
  version: Schema.Literal(1), validatorIdentityEncoding: Schema.Literal(2), manifest: Schema.String };
const CurrentMetadata = Schema.Union([
  Schema.Struct({ ...CurrentMetadataFields, kind: Schema.Literal("query"), runtimeTarget: Schema.String }),
  Schema.Struct({ ...CurrentMetadataFields, kind: Schema.Literal("mutation"), executionAuthority: Schema.String }),
]);
const decodeCurrentMetadata = Schema.decodeUnknownEffect(CurrentMetadata, { onExcessProperty: "error" });
const ProducerIdentity = Schema.Struct({ scopeUuid: ScopeUuidV1Schema, epochUuid: ScopeEpochUuidV1Schema,
  compatibilityDate: Schema.NonEmptyString, generation: Schema.Int.check(Schema.makeFilter(value =>
    Number.isSafeInteger(value) && value > 0 ? undefined : "Expected a positive safe generation")) });
const invalid = (cause?: unknown) => new CoreApplicationProgramError({ reason: "metadataInvalid", cause });
const parseJson = (text: string) => Effect.try({ try: (): unknown => JSON.parse(text), catch: invalid });
const hashHex = Effect.fn("CoreApplicationProgram.hash")((hash: Hash, bytes: Uint8Array) => hash(bytes).pipe(
  Effect.mapError(cause => new CoreApplicationProgramError({ reason: "hashFailure", cause })),
  Effect.flatMap(value => value.length === 32 ? Effect.succeed(encodeBytesToLowercaseHex(value)) : Effect.fail(invalid())),
));
const frameHash = Effect.fn("CoreApplicationProgram.frameHash")((hash: Hash,
  frame: Result.Result<Uint8Array, unknown>) => Effect.fromResult(frame).pipe(
    Effect.mapError(invalid), Effect.flatMap(bytes => hashHex(hash, bytes)),
  ));

/** Actual verified Analysis output enters once at this production owner, never a fixture-local compiler. */
export const makeCoreApplicationPrograms = Effect.fn("makeCoreApplicationPrograms")(function* (input: Readonly<{
  manifest: unknown; scopeUuid: string; epochUuid: string; compatibilityDate: string; generation?: number; sha256: Hash;
}>) {
  const identity = yield* Schema.decodeUnknownEffect(ProducerIdentity)({ ...input, generation: input.generation ?? 1 }).pipe(Effect.mapError(invalid));
  const canonical = yield* Effect.fromResult(canonicalizeApplicationManifest(input.manifest)).pipe(Effect.mapError(invalid));
  const manifest = yield* Effect.fromResult(requireCoreApplicationSchemaSupport(canonical.manifest)).pipe(
    Effect.mapError(cause => new CoreApplicationProgramError({ reason: "unsupportedSelection", cause })));
  const hash = input.sha256;
  const manifestSha256 = yield* hashHex(hash, canonical.canonicalBytes);
  const schemaSha256 = yield* frameHash(hash, applicationSchemaPublicationFrameV1(manifest));
  const functionCatalogSha256 = yield* frameHash(hash, applicationFunctionCatalogPublicationFrameV1(manifest));
  const frame = { scopeId: `scope_${identity.scopeUuid}`, revisionId: `core_revision_${manifestSha256}`,
    candidateId: `core_candidate_${manifestSha256}`, analysisId: `core_analysis_${manifestSha256}`,
    sourceArtifactRootSha256: manifest.sourceArtifact.rootSha256, manifestSha256, schemaSha256, functionCatalogSha256 };
  const publicationSha256 = yield* frameHash(hash, applicationPublicationCommitmentFrameV1(frame));
  const activeHeadSha256 = identity.generation === 1 ? publicationSha256
    : yield* hashHex(hash, utf8.encode(`head:${identity.generation}:${publicationSha256}`));
  const definitions: CoreProgramDefinition[] = [];
  for (const fn of manifest.functions) {
    if (fn.kind !== "query" && fn.kind !== "mutation") continue;
    const target = yield* Effect.fromResult(canonicalizeApplicationRuntimeTargetV1({
      format: "flarex.application-runtime-target", version: 1, ...frame, publicationSha256,
      executionModulePath: manifest.sourceArtifact.executionModulePath,
      function: { ...fn, entrySha256: yield* frameHash(hash, applicationFunctionEntryPublicationFrameV1(fn)) },
    })).pipe(Effect.mapError(invalid));
    const runtimeTargetSha256 = yield* hashHex(hash, target.canonicalBytes);
    const executionAuthority = fn.kind === "mutation" ? yield* canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority", version: 1, runtimeTarget: target.target,
      runtimeTargetSha256, activationSequence: identity.generation.toString(), activeHeadSha256,
      schemaVersionId: `core_schema_${schemaSha256}`,
    }).pipe(Effect.mapError(invalid)) : undefined;
    const metadata = yield* Effect.fromResult(captureCoreObject({ format: "flarex.core-application-program", version: 1,
      validatorIdentityEncoding: 2, manifest: canonical.canonicalText, compatibilityDate: identity.compatibilityDate,
      scopeUuid: identity.scopeUuid, epochUuid: identity.epochUuid,
      ...(executionAuthority === undefined ? { kind: "query", runtimeTarget: JSON.stringify(applicationRuntimeTargetWireV1(target.target)) }
        : { kind: "mutation", executionAuthority: JSON.stringify(executionAuthority.authorityJson) }),
    }, true)).pipe(Effect.mapError(invalid));
    definitions.push(Object.freeze({ identity: Object.freeze({ functionPath: fn.path, schemaHash: schemaSha256,
      programHash: executionAuthority === undefined ? runtimeTargetSha256 : encodeBytesToLowercaseHex(executionAuthority.sha256) }),
      metadata: metadata.value }));
  }
  return Object.freeze(definitions);
});

/** Decode and verify the selected immutable program; no latest-head observation occurs here. */
export const readCoreApplicationProgram = Effect.fn("readCoreApplicationProgram")(function* (
  definition: CoreProgramDefinition, hash: Hash,
) {
  const captured = yield* Effect.fromResult(captureCoreObject(definition.metadata, true)).pipe(Effect.mapError(invalid));
  const metadata = yield* decodeCurrentMetadata(captured.value).pipe(Effect.mapError(invalid));
  const canonical = yield* Effect.fromResult(canonicalizeApplicationManifestWire(yield* parseJson(metadata.manifest))).pipe(Effect.mapError(invalid));
  const authority = metadata.kind === "mutation"
    ? yield* canonicalizeApplicationMutationExecutionAuthorityWireV1(yield* parseJson(metadata.executionAuthority)).pipe(Effect.mapError(invalid)) : undefined;
  const target = metadata.kind === "query"
    ? yield* Effect.fromResult(canonicalizeApplicationRuntimeTargetWireV1(yield* parseJson(metadata.runtimeTarget))).pipe(Effect.mapError(invalid))
    : yield* Effect.fromResult(canonicalizeApplicationRuntimeTargetV1(authority?.authority.runtimeTarget)).pipe(Effect.mapError(invalid));
  const manifest = yield* Effect.fromResult(requireCoreApplicationSchemaSupport(canonical.manifest)).pipe(
    Effect.mapError(cause => new CoreApplicationProgramError({ reason: "unsupportedSelection", cause })));
  const runtimeTarget = target.target;
  const fn = manifest.functions.find(candidate => candidate.path === definition.identity.functionPath);
  if (fn === undefined || fn.kind !== metadata.kind || runtimeTarget.function.kind !== metadata.kind)
    return yield* invalid();
  const manifestSha256 = yield* hashHex(hash, canonical.canonicalBytes);
  const schemaSha256 = yield* frameHash(hash, applicationSchemaPublicationFrameV1(manifest));
  const catalogSha256 = yield* frameHash(hash, applicationFunctionCatalogPublicationFrameV1(manifest));
  const entryFrame = (entry: ApplicationManifestV1["functions"][number]) => frameHash(hash, applicationFunctionEntryPublicationFrameV1(entry));
  const entrySha256 = yield* entryFrame(fn);
  const selectedEntrySha256 = yield* entryFrame({
    path: runtimeTarget.function.path, moduleName: runtimeTarget.function.moduleName,
    exportName: runtimeTarget.function.exportName, kind: runtimeTarget.function.kind,
    visibility: runtimeTarget.function.visibility, args: runtimeTarget.function.args,
    returns: runtimeTarget.function.returns, partition: runtimeTarget.function.partition,
  });
  const publicationSha256 = yield* frameHash(hash, applicationPublicationCommitmentFrameV1({
    scopeId: runtimeTarget.scopeId, revisionId: runtimeTarget.revisionId, candidateId: runtimeTarget.candidateId,
    analysisId: runtimeTarget.analysisId, sourceArtifactRootSha256: runtimeTarget.sourceArtifactRootSha256,
    manifestSha256: runtimeTarget.manifestSha256, schemaSha256: runtimeTarget.schemaSha256,
    functionCatalogSha256: runtimeTarget.functionCatalogSha256,
  }));
  const programHash = authority === undefined ? yield* hashHex(hash, target.canonicalBytes) : encodeBytesToLowercaseHex(authority.sha256);
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(runtimeTarget.scopeId)).pipe(Effect.mapError(invalid));
  if (runtimeTarget.function.path !== definition.identity.functionPath || definition.identity.programHash !== programHash
    || definition.identity.schemaHash !== schemaSha256 || runtimeTarget.schemaSha256 !== schemaSha256
    || runtimeTarget.manifestSha256 !== manifestSha256 || runtimeTarget.functionCatalogSha256 !== catalogSha256
    || runtimeTarget.function.entrySha256 !== entrySha256 || selectedEntrySha256 !== entrySha256
    || runtimeTarget.publicationSha256 !== publicationSha256 || scope.scopeUuid !== metadata.scopeUuid
    || runtimeTarget.sourceArtifactRootSha256 !== manifest.sourceArtifact.rootSha256
    || runtimeTarget.executionModulePath !== manifest.sourceArtifact.executionModulePath)
    return yield* invalid();
  const base = { definition, runtimeTarget, manifest, validatorIdentityEncoding: metadata.validatorIdentityEncoding, compatibilityDate: metadata.compatibilityDate,
    scopeUuid: metadata.scopeUuid, epochUuid: metadata.epochUuid };
  return authority === undefined ? Object.freeze({ ...base, kind: "query" as const })
    : Object.freeze({ ...base, kind: "mutation" as const, executionAuthority: authority });
});

export const readCoreApplicationTableBindings = Effect.fn("readCoreApplicationTableBindings")((
  transaction: CoreReadTransaction,
) => transaction.tableMappings);

export function validateCoreApplicationArguments(
  validator: ApplicationManifest["functions"][number]["args"], value: DocumentObject,
  bindings: readonly CoreApplicationTableBinding[],
) {
  const numbers = new Map(bindings.map(binding => [binding.logicalName, binding.tableId]));
  return validateValidatorValueV1(validator, value, { path: "$args", idPolicy: { mode: "tableAware", check: (name, id) => {
    const number = numbers.get(name);
    if (number === undefined) return "unavailable";
    return decodeDocumentId(id).pipe(Result.match({ onFailure: () => "invalid" as const,
      onSuccess: identity => identity.tableNumber === number ? "valid" as const : "invalid" as const }));
  } } }).pipe(Result.mapError(cause => new CoreApplicationProgramError({ reason: "argumentsInvalid", cause })));
}
