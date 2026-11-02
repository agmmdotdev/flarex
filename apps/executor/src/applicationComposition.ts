import { canonicalizeApplicationManifest, canonicalizeApplicationManifestWire } from "@flarex/analysis/application-analysis";
import { CoreApplicationTransportError, makeCoreApplicationHttpHandler, readCoreApplicationJsonBody } from "@flarex/executor-http/internal/core-application";
import { compileCoreApplicationSchema } from "@flarex/persistence-postgres/internal/core-application-schema";
import { makeCoreApplicationPrograms } from
  "@flarex/persistence-postgres/internal/core-application-program";
import { CoreSchemaError, type CoreDatabase, type CoreError,
  type CoreApplicationCandidate as StoredCandidate, type CoreApplicationRegistrationMetadata } from "@flarex/persistence-postgres/internal/core";
import { makeCoreApplicationMutationInvocationPort, prepareApplicationMutationIdentityAccessPolicy } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { makeCoreApplicationQueryEvaluationRunner } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { bytesEqual, copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Cause, Clock, Data, Effect, Encoding, Option, Result, Schema } from "effect";
import { makeApplicationMutationGrantIssuer, ApplicationMutationGrantIssuerSourceError } from
  "flarex-backend/internal/application-mutation-grant-issuer";
import { captureDocumentObject, captureDocumentValueWithSize } from "flarex-protocol/document-value";
import { coreApplicationInvocationPath, coreApplicationProfilePath, coreApplicationDeploymentPath, coreApplicationPushStartPath,
  coreApplicationPushPath, decodeCoreApplicationStartRequest, decodeCoreApplicationFinishRequest, decodeCoreApplicationAbandonRequest,
  CoreApplicationProtocolError, encodeCoreApplicationCandidate, encodeCoreApplicationProfile,
  type CoreApplicationCoreProfile, type CoreApplicationCandidate,
  type CoreApplicationInvocationRequest, type CoreApplicationInvocationResult } from "flarex-protocol/internal/core-application";
import { DeploymentProtocolValidationError, PushSourcePackage } from "flarex-protocol/deployment";
import { PublicApplicationSourceError, publicApplicationSourcePackageMetadata } from "flarex-backend/internal/public-application-source";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { TransactionAuthorizationGrantIdV1Schema } from "flarex-protocol/transaction-session";
import { admitExecutorRequest } from "./requestLifecycle";
import { ExecutorApplicationConfigurationError, readExecutorApplicationKey, readExecutorApplicationProfiles,
  type ExecutorApplicationEnv, type ExecutorApplicationProfile } from "./applicationConfiguration";
import type { ApplicationDurableObjectInfrastructure } from "./applicationDO";

export class ExecutorApplicationCompositionError extends Data.TaggedError("ExecutorApplicationCompositionError")<{
  readonly reason: "configurationMismatch" | "keyUnavailable" | "hashUnavailable" | "sourceMismatch"
    | "analysisFailed" | "registrationIncomplete" | "profileNotReady" | "candidateNotFound" | "candidateConflict"
    | "candidateInvalid" | "unsupportedSource" | "sourceUploadUnavailable";
  readonly cause?: unknown;
}> {}
const refusal = (reason: ExecutorApplicationCompositionError["reason"], cause?: unknown) =>
  new ExecutorApplicationCompositionError({ reason, ...(cause === undefined ? {} : { cause }) });

export const executorApplicationSha256 = Effect.fn("ExecutorApplication.sha256")((bytes: Uint8Array) =>
  Effect.tryPromise({ try: async () => new Uint8Array(await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes))),
    catch: cause => refusal("hashUnavailable", cause) }));

/** Operator key material remains stable through app-owner reconstruction. */
export const makeExecutorApplicationCredentials = Effect.fn("ExecutorApplication.credentials")(function* (
  env: Pick<ExecutorApplicationEnv, "FLAREX_APPLICATION_KEYS">, profile: ExecutorApplicationProfile,
) {
  const configured = yield* Effect.fromResult(readExecutorApplicationKey(env, profile.keyId));
  const decode = (text: string) => Effect.fromResult(Encoding.decodeBase64(text)).pipe(Effect.mapError(() => refusal("keyUnavailable")));
  const privateBytes = yield* decode(configured.privateKeyPkcs8);
  const publicBytes = yield* decode(configured.publicKeySpki);
  const cursorSecret = yield* decode(configured.queryCursorSecret);
  const privateKey = yield* Effect.tryPromise({
    try: () => crypto.subtle.importKey("pkcs8", copyBytesToArrayBuffer(privateBytes), "Ed25519", false, ["sign"]),
    catch: () => refusal("keyUnavailable"),
  });
  const publicKey = yield* Effect.tryPromise({
    try: () => crypto.subtle.importKey("spki", copyBytesToArrayBuffer(publicBytes), "Ed25519", false, ["verify"]),
    catch: () => refusal("keyUnavailable"),
  });
  const cursor = yield* Effect.fromResult(createQueryCursorBroker({ instanceName: profile.instanceName, deploymentSecret: cursorSecret }));
  const grantIssuer = yield* Effect.try({ try: () => makeApplicationMutationGrantIssuer({
    deploymentId: profile.deploymentId, grantRetentionPolicy: profile.grantRetentionPolicy,
    signer: { kid: profile.keyId, publicKey, issuedAtInclusiveEpochMilliseconds: configured.issuedAtInclusiveEpochMilliseconds,
      ...(configured.issuedAtExclusiveEpochMilliseconds === undefined ? {} : { issuedAtExclusiveEpochMilliseconds: configured.issuedAtExclusiveEpochMilliseconds }),
      ...(configured.verificationEndsAtExclusiveEpochMilliseconds === undefined ? {} : { verificationEndsAtExclusiveEpochMilliseconds: configured.verificationEndsAtExclusiveEpochMilliseconds }),
      sign: bytes => Effect.tryPromise({
        try: async () => new Uint8Array(await crypto.subtle.sign("Ed25519", privateKey, copyBytesToArrayBuffer(bytes))),
        catch: () => new ApplicationMutationGrantIssuerSourceError({ source: "signing" }),
      }),
    },
    runtime: { currentTimeMillis: Clock.currentTimeMillis,
      nextGrantId: Effect.sync(() => TransactionAuthorizationGrantIdV1Schema.make(`grant_${crypto.randomUUID()}`)) },
  }), catch: () => refusal("keyUnavailable") });
  return Object.freeze({ grantIssuer, queryCursor: Object.freeze({ scopeUuid: profile.scopeUuid, broker: cursor }) });
});

const CandidateEvidence = Schema.Struct({ format: Schema.Literal("flarex.application-candidate-evidence"),
  version: Schema.Literal(1), canonicalManifest: Schema.String, sourcePackage: PushSourcePackage });
const decodeCandidateEvidence = Schema.decodeUnknownResult(CandidateEvidence, { onExcessProperty: "error" });
const utf8 = new TextEncoder();

/** Genuine analysis enters only during source preparation, before schema settlement. */
export const prepareExecutorApplicationDefinition = Effect.fn("ExecutorApplication.prepareDefinition")(function* (
  env: Pick<ExecutorApplicationEnv, "APPLICATION_ANALYZER">, profile: ExecutorApplicationProfile,
  source: ApplicationDurableObjectInfrastructure["source"], sourceArtifactRootSha256: string,
) {
  const analyzer = env.APPLICATION_ANALYZER;
  if (analyzer === undefined) return yield* new ExecutorApplicationConfigurationError({ reason: "missingAnalyzer" });
  const bundle = yield* source.read(sourceArtifactRootSha256);
  const analysis = yield* Effect.tryPromise({ try: () => analyzer.analyze({ format: "flarex.application-analysis-host-request",
    version: 1, sourceArtifactRootSha256, analyzerIdentity: profile.analyzerIdentity, analyzerPolicyIdentity: profile.analyzerPolicyIdentity }),
    catch: cause => refusal("analysisFailed", cause) });
  if (analysis.kind !== "analyzed" || analysis.format !== "flarex.application-analysis-host-result" || analysis.version !== 1
    || analysis.sourceArtifactRootSha256 !== sourceArtifactRootSha256 || analysis.analyzerIdentity !== profile.analyzerIdentity
    || analysis.analyzerPolicyIdentity !== profile.analyzerPolicyIdentity) return yield* refusal("analysisFailed", analysis);
  const canonical = yield* Effect.fromResult(canonicalizeApplicationManifest(analysis.manifest));
  const actualSource = yield* Effect.fromResult(canonicalizeApplicationManifest({ ...canonical.manifest, sourceArtifact: bundle.sourceArtifact }));
  if (canonical.manifest.sourceArtifact.rootSha256 !== sourceArtifactRootSha256
    || analysis.canonicalManifest !== canonical.canonicalText || !bytesEqual(canonical.canonicalBytes, actualSource.canonicalBytes))
    return yield* refusal("sourceMismatch");
  return yield* compileExecutorApplicationDefinition(profile, canonical);
});

const compileExecutorApplicationDefinition = Effect.fn("ExecutorApplication.compileDefinition")(function* (
  profile: ExecutorApplicationProfile, canonical: Result.Result.Success<ReturnType<typeof canonicalizeApplicationManifest>>,
) {
  const schema = yield* Effect.fromResult(compileCoreApplicationSchema(canonical.manifest));
  const programs = yield* makeCoreApplicationPrograms({ manifest: canonical.manifest, scopeUuid: profile.scopeUuid,
    epochUuid: profile.epochUuid, compatibilityDate: profile.compatibilityDate, generation: profile.generation,
    sha256: executorApplicationSha256 });
  return Object.freeze({ schema, programs, canonical });
});

function matchesConfiguredRegistration(registration: CoreApplicationRegistrationMetadata, profile: ExecutorApplicationProfile) {
  return registration.deploymentId === profile.deploymentId && registration.scopeUuid === profile.scopeUuid
    && registration.epochUuid === profile.epochUuid && registration.analyzerIdentity === profile.analyzerIdentity
    && registration.analyzerPolicyIdentity === profile.analyzerPolicyIdentity && registration.compatibilityDate === profile.compatibilityDate
    && registration.generation === profile.generation;
}

/** Discovery borrows authenticated active identity; operator inventory has no uploaded source pins. */
export const assertExecutorApplicationProfile = Effect.fn("ExecutorApplication.assertProfile")(function* (
  database: Pick<CoreDatabase, "readActiveApplicationCandidate">, profile: ExecutorApplicationProfile,
): Effect.fn.Return<CoreApplicationCoreProfile, CoreError | ExecutorApplicationCompositionError> {
  const selected = yield* database.readActiveApplicationCandidate();
  if (Option.isNone(selected) || !matchesConfiguredRegistration(selected.value.registration, profile))
    return yield* refusal("profileNotReady");
  return Object.freeze({ format: "flarex.core-application.profile", version: 1, kind: "core",
    route: Object.freeze({ deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid }),
    sourceArtifactRootSha256: selected.value.registration.sourceArtifactRootSha256,
    sourcePackageHash: selected.value.registration.sourcePackageHash });
});

const readExecutorApplicationCandidate = Effect.fn("ExecutorApplication.readCandidate")(function* (
  database: Pick<CoreDatabase, "readApplicationCandidate">, profile: ExecutorApplicationProfile, candidateId: string,
) {
  const selected = yield* database.readApplicationCandidate(candidateId);
  if (Option.isNone(selected)) return null;
  const candidate = selected.value;
  if (!matchesConfiguredRegistration(candidate.registration, profile)) return yield* refusal("candidateInvalid");
  return candidate;
});

const candidateEvidence = Effect.fn("ExecutorApplication.candidateEvidence")(function* (candidate: StoredCandidate) {
  return yield* Effect.fromResult(decodeCandidateEvidence(candidate.metadata)).pipe(Effect.mapError(cause => refusal("candidateInvalid", cause)));
});

const candidateToWire = Effect.fn("ExecutorApplication.candidateProjection")(function* (
  profile: ExecutorApplicationProfile, candidate: StoredCandidate,
) {
  const evidence = yield* candidateEvidence(candidate);
  return yield* Effect.fromResult(encodeCoreApplicationCandidate({ format: "flarex.core-application.candidate", version: 1,
    route: { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid },
    pushId: candidate.id, state: candidate.abandoned ? "abandoned" : candidate.state === "overwritten" ? "superseded" : candidate.state,
    sourceArtifactRootSha256: candidate.registration.sourceArtifactRootSha256, sourcePackageHash: candidate.registration.sourcePackageHash,
    canonicalManifest: evidence.canonicalManifest, sourcePackage: evidence.sourcePackage,
    createdAt: candidate.creationTime, updatedAt: candidate.updatedAt, indexesReady: candidate.indexesReady,
    ...(candidate.error === undefined ? {} : { error: candidate.error }) }));
});

/** Start finalizes and analyzes immutable source, then prepares an independent deployment attempt. */
export const startExecutorApplicationPush = Effect.fn("ExecutorApplication.startPush")(function* (
  database: Pick<CoreDatabase, "prepareApplicationCandidate" | "readApplicationCandidate">,
  env: ExecutorApplicationEnv, profile: ExecutorApplicationProfile,
  infrastructure: Pick<ApplicationDurableObjectInfrastructure, "source" | "sourceUpload">, sourcePackage: PushSourcePackage,
) {
  const upload = infrastructure.sourceUpload;
  if (upload === undefined) return yield* refusal("sourceUploadUnavailable");
  const uploaded = yield* upload(sourcePackage);
  const definition = yield* prepareExecutorApplicationDefinition(env, profile, infrastructure.source, uploaded.sourceArtifactRootSha256);
  if (definition.canonical.manifest.functions.some(fn => fn.kind !== "query" && fn.kind !== "mutation"))
    return yield* refusal("unsupportedSource");
  const metadata = yield* Effect.fromResult(captureDocumentObject({ format: "flarex.application-candidate-evidence", version: 1,
    canonicalManifest: definition.canonical.canonicalText, sourcePackage: publicApplicationSourcePackageMetadata(uploaded.sourcePackage) }));
  const candidateId = yield* database.prepareApplicationCandidate({ schema: definition.schema, registration: {
    deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid,
    sourceArtifactRootSha256: uploaded.sourceArtifactRootSha256, sourcePackageHash: uploaded.sourcePackageHash,
    analyzerIdentity: profile.analyzerIdentity, analyzerPolicyIdentity: profile.analyzerPolicyIdentity,
    compatibilityDate: profile.compatibilityDate, generation: profile.generation, programs: definition.programs, candidateMetadata: metadata,
  } });
  const prepared = yield* readExecutorApplicationCandidate(database, profile, candidateId);
  return prepared === null ? yield* refusal("candidateNotFound") : yield* candidateToWire(profile, prepared);
});

/** Cold finish reconstructs from the exact persisted analysis, never a second analysis authority. */
export const finishExecutorApplicationPush = Effect.fn("ExecutorApplication.finishPush")(function* (
  database: Pick<CoreDatabase, "readApplicationCandidate" | "schemaStatus" | "advanceSchema" | "activateApplicationCandidate">,
  profile: ExecutorApplicationProfile, candidateId: string, activate = true,
) {
  const candidate = yield* readExecutorApplicationCandidate(database, profile, candidateId);
  if (candidate === null) return yield* refusal("candidateNotFound");
  if (candidate.activatedAt !== undefined) return yield* candidateToWire(profile, candidate);
  if (candidate.abandoned || candidate.state === "failed" || candidate.state === "overwritten") return yield* refusal("candidateConflict");
  if (!activate) return yield* candidateToWire(profile, candidate);
  const evidence = yield* candidateEvidence(candidate);
  const json = yield* Effect.try({ try: (): unknown => JSON.parse(evidence.canonicalManifest), catch: cause => refusal("candidateInvalid", cause) });
  const canonical = yield* Effect.fromResult(canonicalizeApplicationManifestWire(json));
  if (canonical.canonicalText !== evidence.canonicalManifest || canonical.manifest.sourceArtifact.rootSha256 !== candidate.registration.sourceArtifactRootSha256)
    return yield* refusal("candidateInvalid");
  const definition = yield* compileExecutorApplicationDefinition(profile, canonical);
  for (let step = 0; step < profile.maximumRegistrationSteps; step++) {
    const status = yield* database.schemaStatus(candidate.schemaProposal);
    if (status.state === "failed" || status.state === "overwritten"
      || (status.state === "validated" || status.state === "active") && status.indexesReady) {
      // A parallel finish may have activated this attempt before a later source
      // superseded its schema. Core resolves its durable activation first.
      return yield* candidateToWire(profile,
        yield* database.activateApplicationCandidate(candidateId, { programs: definition.programs }).pipe(
          Effect.catchTag("CoreSchemaError", (error): Effect.Effect<never, CoreSchemaError | ExecutorApplicationCompositionError> =>
            Effect.fail(error.reason === "schemaFailed" || error.reason === "schemaOverwritten" ? refusal("candidateConflict", error) : error))));
    }
    yield* database.advanceSchema(candidate.schemaProposal, profile.workload.schemaScheduler.work);
  }
  return yield* refusal("registrationIncomplete");
});

const abandonExecutorApplicationPush = Effect.fn("ExecutorApplication.abandonPush")(function* (
  database: CoreDatabase, profile: ExecutorApplicationProfile, candidateId: string,
) {
  const candidate = yield* readExecutorApplicationCandidate(database, profile, candidateId);
  if (candidate === null) return yield* refusal("candidateNotFound");
  return yield* candidateToWire(profile, yield* database.abandonApplicationCandidate(candidateId));
});

export function executorApplicationFailureResponse(cause: Cause.Cause<unknown>): Response {
  const reason = cause.reasons.length === 1 ? cause.reasons[0] : undefined;
  const error = reason !== undefined && Cause.isFailReason(reason) ? reason.error : undefined;
  const status = error instanceof ExecutorApplicationCompositionError
    ? error.reason === "candidateNotFound" ? 404 : error.reason === "candidateConflict" ? 409 : error.reason === "unsupportedSource" ? 400 : 503
    : error instanceof PublicApplicationSourceError ? error.reason === "limitExceeded" ? 413 : 400
      : error instanceof DeploymentProtocolValidationError
        || error instanceof CoreApplicationProtocolError && error.reason === "invalidRequest" ? 400
      : error instanceof CoreApplicationTransportError && (error.reason === "bodyTooLarge" || error.reason === "invalidRequest")
        ? error.reason === "bodyTooLarge" ? 413 : 400
        : error instanceof CoreSchemaError && error.reason === "schemaNotFound" ? 404 : 503;
  return Response.json({ format: "flarex.core-application.failure", version: 1,
    error: { code: "core_application_unavailable", message: "The configured application operation could not complete." } }, { status });
}

const boundedJsonResponse = Effect.fn("ExecutorApplication.jsonResponse")(function* (
  value: CoreApplicationCoreProfile | CoreApplicationCandidate | null, maximumBytes: number,
) {
  const body = JSON.stringify(value);
  if (utf8.encode(body).byteLength > maximumBytes) return yield* new CoreApplicationTransportError({ reason: "responseTooLarge" });
  return new Response(body, { headers: { "content-type": "application/json" } });
});

export const makeExecutorApplicationComposition = Effect.fn("ExecutorApplication.compose")(function* (
  env: ExecutorApplicationEnv, infrastructure: ApplicationDurableObjectInfrastructure,
) {
  const profiles = yield* Effect.fromResult(readExecutorApplicationProfiles(env));
  const profile = profiles.find(candidate => candidate.canonicalName === infrastructure.configuration.canonicalName
    && candidate.persistenceNamespace === infrastructure.configuration.persistenceNamespace && candidate.instanceName === infrastructure.configuration.instanceName);
  if (profile === undefined) return yield* refusal("configurationMismatch");
  const credentials = yield* makeExecutorApplicationCredentials(env, profile);
  const live = { ...credentials, coreDatabase: infrastructure.coreDatabase, admission: infrastructure.admission,
    deploymentId: profile.deploymentId, maximumAttempts: profile.maximumAttempts,
    applicationRunner: { source: infrastructure.source, host: infrastructure.host, hostPolicy: profile.hostPolicy,
      hostPolicySha256: yield* executorApplicationSha256(profile.hostPolicyCanonicalBytes), sha256: executorApplicationSha256 },
    executionContextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(),
      logScopeId: crypto.randomUUID(), randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) },
  };
  const execute = Effect.fn("ExecutorApplication.invoke")(function* (input: CoreApplicationInvocationRequest) {
    const active = yield* assertExecutorApplicationProfile(infrastructure.coreDatabase, profile);
    const invocation = { ...live, expectedProgramProfile: { scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid,
      sourceArtifactRootSha256: input.sourceArtifactRootSha256, sourcePackageHash: input.sourcePackageHash } };
    if (input.kind !== "query") {
      const policy = yield* prepareApplicationMutationIdentityAccessPolicy(input.auth);
      const port = makeCoreApplicationMutationInvocationPort(invocation);
      const selected = input.kind === "infer"
        ? yield* port.infer(input.functionPath, input.args, input.requestKey, policy)
        : { kind: "mutation" as const, outcome: yield* port.invoke(input.functionPath, input.args, input.requestKey, policy) };
      if (selected.kind === "mutation") {
        const outcome = selected.outcome;
        return { kind: "mutation", value: outcome.value, disposition: outcome.disposition,
          publishedTimestamp: outcome.timestamp } satisfies CoreApplicationInvocationResult;
      }
    }
    if (input.sourceArtifactRootSha256 !== active.sourceArtifactRootSha256 || input.sourcePackageHash !== active.sourcePackageHash)
      return yield* refusal("sourceMismatch");
    const captured = yield* Effect.fromResult(captureDocumentValueWithSize(input.args));
    const evaluation = yield* makeCoreApplicationQueryEvaluationRunner(invocation)(input.functionPath, input.args, captured.semanticSizeBytes, input.auth);
    return { kind: "query", value: evaluation.value, evaluation: evaluation.token } satisfies CoreApplicationInvocationResult;
  });
  const invoke = makeCoreApplicationHttpHandler({ route: { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid },
    authorize: (request: Request) => Effect.succeed(Result.isSuccess(admitExecutorRequest(request, env))), execute,
    maximumRequestBytes: profile.http.maximumRequestBytes, maximumResponseBytes: profile.http.maximumResponseBytes,
  });
  const dispatch = Effect.fn("ExecutorApplication.dispatch")(function* (request: Request) {
    const admitted = admitExecutorRequest(request, env);
    if (Result.isFailure(admitted)) return admitted.failure;
    const path = new URL(request.url).pathname;
    yield* infrastructure.assertFreshCoreApplicationDeployment(profile.deploymentId);
    if (path === coreApplicationInvocationPath(profile.deploymentId)) return yield* invoke(request);
    if (path === coreApplicationProfilePath(profile.deploymentId) && request.method === "GET") {
      const encoded = yield* Effect.fromResult(encodeCoreApplicationProfile(
        yield* assertExecutorApplicationProfile(infrastructure.coreDatabase, profile)));
      if (encoded.kind !== "core") return yield* refusal("configurationMismatch");
      return yield* boundedJsonResponse(encoded, profile.http.maximumResponseBytes);
    }
    if (path === coreApplicationDeploymentPath(profile.deploymentId) && request.method === "GET") {
      const selected = yield* infrastructure.coreDatabase.readActiveApplicationCandidate();
      if (Option.isSome(selected) && !matchesConfiguredRegistration(selected.value.registration, profile))
        return yield* refusal("candidateInvalid");
      return yield* boundedJsonResponse(Option.isNone(selected) ? null
        : yield* candidateToWire(profile, selected.value), profile.http.maximumResponseBytes);
    }
    if (path === coreApplicationPushStartPath(profile.deploymentId) && request.method === "POST") {
      const input = yield* Effect.fromResult(decodeCoreApplicationStartRequest(
        yield* readCoreApplicationJsonBody(request, profile.http.maximumRegistrationRequestBytes)));
      const result = yield* infrastructure.admission.withPermit("mutation", startExecutorApplicationPush(infrastructure.coreDatabase,
        env, profile, infrastructure, input.sourcePackage));
      return yield* boundedJsonResponse(result, profile.http.maximumResponseBytes);
    }
    const prefix = `${coreApplicationPushPath(profile.deploymentId, "")}`;
    if (path.startsWith(prefix)) {
      const match = /^([^/]+)(?:\/(finish|abandon))?$/.exec(path.slice(prefix.length));
      if (match !== null) {
        const id = yield* Effect.try({ try: () => decodeURIComponent(match[1] ?? ""), catch: cause => refusal("candidateNotFound", cause) });
        const action = match[2];
        if (action === undefined && request.method === "GET") {
          const candidate = yield* readExecutorApplicationCandidate(infrastructure.coreDatabase, profile, id);
          return yield* boundedJsonResponse(candidate === null ? null : yield* candidateToWire(profile, candidate), profile.http.maximumResponseBytes);
        }
        if (request.method === "POST" && (action === "finish" || action === "abandon")) {
          const body = yield* readCoreApplicationJsonBody(request, profile.http.maximumRegistrationRequestBytes);
          const result = yield* infrastructure.admission.withPermit("mutation", action === "finish"
            ? Effect.fromResult(decodeCoreApplicationFinishRequest(body)).pipe(Effect.flatMap(input =>
              finishExecutorApplicationPush(infrastructure.coreDatabase, profile, id, input.activate)))
            : Effect.fromResult(decodeCoreApplicationAbandonRequest(body)).pipe(Effect.flatMap(() =>
              abandonExecutorApplicationPush(infrastructure.coreDatabase, profile, id))));
          return yield* boundedJsonResponse(result, profile.http.maximumResponseBytes);
        }
      }
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return Object.freeze({ ...live, dispatch });
});
