import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema, Semaphore } from "effect";
import { assertExecutionArtifactRefMatchesMaterializedSourcePackage, cloneArtifactSourcePackage,
  executionArtifactRefForSourcePackage, SOURCE_MODULE_DIGEST_FORMAT_V1,
  type ArtifactSourcePackage, type MaterializedArtifactSourcePackage } from "flarex/artifacts";
import { PushSourceModule, PushSourcePackage, decodeCoreApplicationSourcePackageEffect,
  type DeploymentProtocolValidationError } from "flarex-protocol/deployment";
import type { DeploymentSqlStorage } from "../deployment/Store";
import { initializeSourceArtifactV2UploadStorage } from "../deployment/StorageSchema";
import { makeSourceArtifactV2AttemptStore, type SourceArtifactV2TransactionStorage } from "./AttemptStore";
import { makeApplicationAnalysisR2SourceReader, type ApplicationAnalysisSourceBundle,
  type ApplicationAnalysisSourceReadError } from "./ApplicationAnalysisReader";
import { SOURCE_ARTIFACT_V2_ROLE_EXECUTION, SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA } from "./Framing";
import { makeSourceArtifactV2R2Store, type SourceArtifactV2R2Bucket } from "./R2Store";
import { makeLiveSourceArtifactV2Sha256 } from "./Sha256";
import { makeSourceArtifactV2UploadCore, SourceArtifactV2AdmissionBudgetSchema, SourceArtifactV2ResourceBudgetSchema,
  type SourceArtifactV2AttemptCommandInput, type SourceArtifactV2UploadCore, type SourceArtifactV2UploadError } from "./UploadCore";

const Positive = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value > 0
  ? undefined : "Expected a positive safe integer"));
export const PublicApplicationSourcePolicySchema = Schema.Struct({
  ceilings: SourceArtifactV2ResourceBudgetSchema,
  admission: SourceArtifactV2AdmissionBudgetSchema,
  blockSizeBytes: Positive,
}).check(Schema.makeFilter(value => value.blockSizeBytes <= value.admission.blockBytes
  && value.blockSizeBytes <= value.ceilings.blockBytes ? undefined : "Block size exceeds upload admission"));
export type PublicApplicationSourcePolicy = typeof PublicApplicationSourcePolicySchema.Type;
const decodePolicy = Schema.decodeUnknownResult(PublicApplicationSourcePolicySchema, { onExcessProperty: "error" });
const Materialized = Schema.Struct({ ...PushSourcePackage.fields,
  modules: Schema.Array(Schema.Struct({ ...PushSourceModule.fields, source: Schema.String })) });
const decodeMaterialized = Schema.decodeUnknownResult(Materialized);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export class PublicApplicationSourceError extends Data.TaggedError("PublicApplicationSourceError")<{
  readonly reason: "invalidPolicy" | "invalidPackage" | "unsupportedAuth" | "integrityMismatch"
    | "limitExceeded" | "uploadMismatch";
  readonly cause?: unknown;
}> {}
const invalid = (reason: PublicApplicationSourceError["reason"], cause?: unknown) =>
  new PublicApplicationSourceError({ reason, ...(cause === undefined ? {} : { cause }) });

export function capturePublicApplicationSourcePolicy(input: unknown) {
  return decodePolicy(input).pipe(Result.mapError(cause => invalid("invalidPolicy", cause)),
    Result.map(value => Object.freeze({ ...value, ceilings: Object.freeze({ ...value.ceilings }),
      admission: Object.freeze({ ...value.admission }) })));
}

export interface PublicApplicationSource {
  readonly source: ApplicationAnalysisSourceBundle;
  readonly sourcePackage: MaterializedArtifactSourcePackage;
  readonly sourcePackageHash: string;
  readonly sourceArtifactRootSha256: string;
}
export type PublicApplicationSourceFailure = PublicApplicationSourceError | DeploymentProtocolValidationError
  | SourceArtifactV2UploadError | ApplicationAnalysisSourceReadError;

/** Only project an authenticated upload result. Framed module digests retain
 * source-map presence and bytes while the public metadata omits source bodies. */
export function publicApplicationSourcePackageMetadata(sourcePackage: MaterializedArtifactSourcePackage): ArtifactSourcePackage {
  return { ...cloneArtifactSourcePackage(sourcePackage), modules: sourcePackage.modules.map(module => ({
    path: module.path, environment: module.environment, sha256: module.sha256,
  })) };
}

type UploadStep = Readonly<{ id: string; kind: "beginModule" | "appendBlock" | "closeModule" | "finalize";
  run: (core: SourceArtifactV2UploadCore, command: SourceArtifactV2AttemptCommandInput) =>
    ReturnType<SourceArtifactV2UploadCore["finalize"]> }>;

function moduleRoles(sourcePackage: MaterializedArtifactSourcePackage, path: string): number {
  return (path === sourcePackage.execution ? SOURCE_ARTIFACT_V2_ROLE_EXECUTION : 0)
    | (path === sourcePackage.schema ? SOURCE_ARTIFACT_V2_ROLE_SCHEMA : 0)
    | (sourcePackage.functions.includes(path) ? SOURCE_ARTIFACT_V2_ROLE_FUNCTION : 0);
}

/** A trusted host capability over existing attempt/R2 owners, never an app installer. */
export function makePublicApplicationSourceProducer(options: Readonly<{
  deploymentId: string;
  storage: SourceArtifactV2TransactionStorage;
  sql: DeploymentSqlStorage;
  artifacts: SourceArtifactV2R2Bucket;
  policy: PublicApplicationSourcePolicy;
}>) {
  const capturedPolicy = capturePublicApplicationSourcePolicy(options.policy);
  const sha256 = makeLiveSourceArtifactV2Sha256();
  const attempts = makeSourceArtifactV2AttemptStore(options.storage, options.sql);
  const core = makeSourceArtifactV2UploadCore({ deploymentId: options.deploymentId, attempts,
    objects: makeSourceArtifactV2R2Store(options.artifacts, sha256), sha256 });
  const sourceReader = makeApplicationAnalysisR2SourceReader(options.artifacts, { sourceMaps: "read" });
  // One canonical DO owns this producer. The finite input sequence shares the
  // existing per-command fence owner; no retry or durable progress is duplicated.
  const gate = Semaphore.makeUnsafe(1);
  const upload = Effect.fn("PublicApplicationSource.upload")(function* (
    input: PushSourcePackage,
  ): Effect.fn.Return<PublicApplicationSource, PublicApplicationSourceFailure> {
    const policy = yield* Effect.fromResult(capturedPolicy);
    const decoded = yield* decodeCoreApplicationSourcePackageEffect(input);
    const materialized = yield* Effect.fromResult(decodeMaterialized(decoded).pipe(
      Result.mapError(cause => invalid("invalidPackage", cause))));
    if (materialized.sourceModuleDigestFormat !== SOURCE_MODULE_DIGEST_FORMAT_V1)
      return yield* invalid("invalidPackage");
    if (materialized.authConfigModule !== undefined) return yield* invalid("unsupportedAuth");
    const sourcePackage: MaterializedArtifactSourcePackage = cloneArtifactSourcePackage({
      modules: materialized.modules.map(module => ({ path: module.path, environment: module.environment,
        sha256: module.sha256, source: module.source,
        ...(module.sourceMap === undefined ? {} : { sourceMap: module.sourceMap }) })),
      functions: [...materialized.functions], execution: materialized.execution,
      sourceModuleDigestFormat: SOURCE_MODULE_DIGEST_FORMAT_V1,
      ...(materialized.schema === undefined ? {} : { schema: materialized.schema }),
      ...(materialized.authConfig === undefined ? {} : { authConfig: materialized.authConfig }),
    });
    const paths = new Set(sourcePackage.modules.map(module => module.path));
    if (paths.size !== sourcePackage.modules.length || new Set(sourcePackage.functions).size !== sourcePackage.functions.length
      || !paths.has(sourcePackage.execution) || sourcePackage.schema !== undefined && !paths.has(sourcePackage.schema)
      || sourcePackage.functions.some(path => !paths.has(path))) return yield* invalid("invalidPackage");
    const ref = yield* Effect.tryPromise({ try: () => executionArtifactRefForSourcePackage(sourcePackage),
      catch: cause => invalid("integrityMismatch", cause) });
    yield* Effect.tryPromise({ try: () => assertExecutionArtifactRefMatchesMaterializedSourcePackage(ref, sourcePackage),
      catch: cause => invalid("integrityMismatch", cause) });
    const identity = encoder.encode(`flarex.public-application-source.v1\0${options.deploymentId}\0${ref.sourcePackageHash}`);
    const digest = yield* sha256(identity, { maximumInputBytes: identity.byteLength });
    // A deterministic UUID is a selector, not a source digest or application identity.
    const hex = encodeBytesToLowercaseHex(digest);
    const uploadId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const beginId = `${ref.sourcePackageHash}:begin`;
    const steps: UploadStep[] = [];
    const appendStep = (step: UploadStep): Result.Result<void, PublicApplicationSourceError> => {
      // Include the begin-upload command before retaining another plan step.
      if (steps.length + 2 > policy.ceilings.calls) return Result.fail(invalid("limitExceeded"));
      steps.push(step);
      return Result.succeed(undefined);
    };
    for (const [ordinal, module] of [...sourcePackage.modules].sort((a, b) => compareUtf16Strings(a.path, b.path)).entries()) {
      const roles = moduleRoles(sourcePackage, module.path);
      const prefix = `${ref.sourcePackageHash}:${ordinal}`;
      yield* Effect.fromResult(appendStep({ id: `${prefix}:begin`, kind: "beginModule", run: (owner, command) => owner.beginModule({
        ...command, path: module.path, roles, environment: module.environment }) }));
      for (const [kind, text] of [["source", module.source], ["sourceMap", module.sourceMap]] as const) {
        if (text === undefined) continue;
        const bytes = encoder.encode(text);
        // V1 frames require nonempty streams; an empty map must not silently
        // become an absent map with a different authenticated package identity.
        if (decoder.decode(bytes) !== text || bytes.byteLength === 0)
          return yield* invalid("invalidPackage");
        for (let offset = 0, blockIndex = 0; offset < bytes.byteLength; offset += policy.blockSizeBytes, blockIndex++) {
          const block = bytes.slice(offset, offset + policy.blockSizeBytes);
          const index = blockIndex;
          yield* Effect.fromResult(appendStep({ id: `${prefix}:${kind}:${index}`, kind: "appendBlock", run: (owner, command) => owner.appendBlock({
            ...command, kind, blockIndex: index, bytes: block }) }));
        }
      }
      yield* Effect.fromResult(appendStep({ id: `${prefix}:close`, kind: "closeModule", run: (owner, command) => owner.closeModule(command) }));
    }
    yield* Effect.fromResult(appendStep({ id: `${ref.sourcePackageHash}:finalize`, kind: "finalize", run: (owner, command) => owner.finalize(command) }));
    yield* Effect.sync(() => initializeSourceArtifactV2UploadStorage(options.sql));
    let progress = yield* core.inspect(uploadId);
    if (progress === null || progress.pendingCommand?.kind === "beginUpload") {
      yield* core.beginUpload({ uploadId, commandId: beginId, ceilings: policy.ceilings, admission: policy.admission });
      progress = yield* core.inspect(uploadId);
    }
    if (progress === null) return yield* invalid("uploadMismatch");
    if (progress.receipt.state === "abandoned") return yield* invalid("uploadMismatch");
    const pendingCommand = progress.pendingCommand;
    const completedCommandId = progress.completedCommandId;
    let position = pendingCommand === null
      ? completedCommandId === beginId ? 0 : steps.findIndex(step => step.id === completedCommandId) + 1
      : steps.findIndex(step => step.id === pendingCommand.commandId && step.kind === pendingCommand.kind);
    if (position < 0 || position === 0 && progress.completedCommandId !== beginId && progress.pendingCommand === null)
      return yield* invalid("uploadMismatch");
    for (; progress.receipt.state !== "finalized" && position < steps.length; position++) {
      const step = steps[position];
      if (step === undefined) return yield* invalid("uploadMismatch");
      yield* step.run(core, { uploadId, generation: progress.receipt.generation,
        expectedFence: progress.pendingCommand?.expectedFence ?? progress.receipt.mutationFence,
        commandId: step.id, admission: policy.admission });
      const observed = yield* core.inspect(uploadId);
      if (observed === null) return yield* invalid("uploadMismatch");
      progress = observed;
    }
    const root = progress.receipt.completedRootDigest;
    if (progress.receipt.state !== "finalized" || root === null) return yield* invalid("uploadMismatch");
    const source = yield* sourceReader.read(root);
    if (source.sourceArtifact.executionModulePath !== sourcePackage.execution
      || source.sourceArtifact.schemaModulePath !== (sourcePackage.schema ?? null)
      || source.modules.length !== sourcePackage.modules.length || source.modules.some(module => {
      const expected = sourcePackage.modules.find(item => item.path === module.path);
      return expected === undefined || expected.source !== module.source || expected.sourceMap !== module.sourceMap
        || module.roles !== moduleRoles(sourcePackage, module.path);
    })) return yield* invalid("integrityMismatch");
    return Object.freeze({ source, sourcePackage, sourcePackageHash: ref.sourcePackageHash, sourceArtifactRootSha256: root });
  });
  return Object.freeze({ upload: (input: PushSourcePackage) => gate.withPermit(upload(input)) });
}
