import { canonicalizeApplicationManifest } from "@flarex/analysis/application-analysis";
import { makeCoreApplicationHttpHandler, readCoreApplicationJsonBody } from "@flarex/executor-http/internal/core-application";
import { compileCoreApplicationSchema } from "@flarex/persistence-postgres/internal/core-application-schema";
import { makeCoreApplicationPrograms } from
  "@flarex/persistence-postgres/internal/core-application-program";
import type { CoreDatabase, CoreError } from "@flarex/persistence-postgres/internal/core";
import { makeCoreApplicationMutationInvocationPort, prepareApplicationMutationIdentityAccessPolicy } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { makeCoreApplicationQueryEvaluationRunner } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { bytesEqual, copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { Cause, Clock, Data, Effect, Encoding, Option, Result } from "effect";
import { makeApplicationMutationGrantIssuer, ApplicationMutationGrantIssuerSourceError } from
  "flarex-backend/internal/application-mutation-grant-issuer";
import { captureDocumentValueWithSize } from "flarex-protocol/document-value";
import { coreApplicationInvocationPath, coreApplicationProfilePath, coreApplicationRegistrationPath,
  decodeCoreApplicationRegistrationRequest, encodeCoreApplicationProfile, type CoreApplicationCoreProfile,
  type CoreApplicationInvocationRequest, type CoreApplicationInvocationResult } from "flarex-protocol/internal/core-application";
import { createQueryCursorBroker } from "flarex-protocol/query-cursor";
import { TransactionAuthorizationGrantIdV1Schema } from "flarex-protocol/transaction-session";
import { admitExecutorRequest } from "./requestLifecycle";
import { ExecutorApplicationConfigurationError, readExecutorApplicationKey, readExecutorApplicationProfiles,
  type ExecutorApplicationEnv, type ExecutorApplicationProfile } from "./applicationConfiguration";
import type { ApplicationDurableObjectInfrastructure } from "./applicationDO";

export class ExecutorApplicationCompositionError extends Data.TaggedError("ExecutorApplicationCompositionError")<{
  readonly reason: "configurationMismatch" | "keyUnavailable" | "hashUnavailable" | "sourceMismatch"
    | "analysisFailed" | "registrationIncomplete" | "profileNotReady";
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

export const prepareExecutorApplicationDefinition = Effect.fn("ExecutorApplication.prepareDefinition")(function* (
  env: Pick<ExecutorApplicationEnv, "APPLICATION_ANALYZER">, profile: ExecutorApplicationProfile,
  source: ApplicationDurableObjectInfrastructure["source"], sourceArtifactRootSha256: string,
) {
  if (sourceArtifactRootSha256 !== profile.sourceArtifactRootSha256) return yield* refusal("sourceMismatch");
  const analyzer = env.APPLICATION_ANALYZER;
  if (analyzer === undefined) return yield* new ExecutorApplicationConfigurationError({ reason: "missingAnalyzer" });
  const bundle = yield* source.read(sourceArtifactRootSha256);
  const analysis = yield* Effect.tryPromise({ try: () => analyzer.analyze({ format: "flarex.application-analysis-host-request",
    version: 1, sourceArtifactRootSha256, analyzerIdentity: profile.analyzerIdentity, analyzerPolicyIdentity: profile.analyzerPolicyIdentity }),
    catch: cause => refusal("analysisFailed", cause) });
  if (analysis.kind !== "analyzed" || analysis.format !== "flarex.application-analysis-host-result" || analysis.version !== 1
    || analysis.sourceArtifactRootSha256 !== sourceArtifactRootSha256 || analysis.analyzerIdentity !== profile.analyzerIdentity
    || analysis.analyzerPolicyIdentity !== profile.analyzerPolicyIdentity) return yield* refusal("analysisFailed");
  const canonical = yield* Effect.fromResult(canonicalizeApplicationManifest(analysis.manifest));
  const actualSource = yield* Effect.fromResult(canonicalizeApplicationManifest({ ...canonical.manifest, sourceArtifact: bundle.sourceArtifact }));
  if (canonical.manifest.sourceArtifact.rootSha256 !== sourceArtifactRootSha256
    || analysis.canonicalManifest !== canonical.canonicalText || !bytesEqual(canonical.canonicalBytes, actualSource.canonicalBytes))
    return yield* refusal("sourceMismatch");
  const schema = yield* Effect.fromResult(compileCoreApplicationSchema(canonical.manifest));
  const programs = yield* makeCoreApplicationPrograms({ manifest: canonical.manifest, scopeUuid: profile.scopeUuid,
    epochUuid: profile.epochUuid, compatibilityDate: profile.compatibilityDate, generation: profile.generation,
    sha256: executorApplicationSha256 });
  if (!programs.some(program => program.identity.functionPath === profile.anchorFunctionPath)) return yield* refusal("configurationMismatch");
  return Object.freeze({ schema, programs });
});

/** Discovery requires activated Core metadata; a configured route is not an installed profile. */
export const assertExecutorApplicationProfile = Effect.fn("ExecutorApplication.assertProfile")(function* (
  database: CoreDatabase, profile: ExecutorApplicationProfile,
): Effect.fn.Return<CoreApplicationCoreProfile, CoreError | ExecutorApplicationCompositionError> {
  const selected = yield* database.readApplicationRegistration();
  if (Option.isNone(selected)) return yield* refusal("profileNotReady");
  const registration = selected.value;
  if (registration.deploymentId !== profile.deploymentId || registration.scopeUuid !== profile.scopeUuid
    || registration.epochUuid !== profile.epochUuid || registration.sourceArtifactRootSha256 !== profile.sourceArtifactRootSha256
    || registration.sourcePackageHash !== profile.sourcePackageHash || registration.analyzerIdentity !== profile.analyzerIdentity
    || registration.analyzerPolicyIdentity !== profile.analyzerPolicyIdentity || registration.compatibilityDate !== profile.compatibilityDate
    || registration.generation !== profile.generation || !registration.programs.some(program => program.identity.functionPath === profile.anchorFunctionPath))
    return yield* refusal("profileNotReady");
  return Object.freeze({ format: "flarex.core-application.profile", version: 1, kind: "core",
    route: Object.freeze({ deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid }),
    sourceArtifactRootSha256: registration.sourceArtifactRootSha256, sourcePackageHash: registration.sourcePackageHash });
});

/** Explicit registration shares Core schema/build/activation; serving never installs on a miss. */
export const registerExecutorApplicationDefinition = Effect.fn("ExecutorApplication.register")(function* (
  database: CoreDatabase, env: ExecutorApplicationEnv, profile: ExecutorApplicationProfile,
  source: ApplicationDurableObjectInfrastructure["source"], sourceArtifactRootSha256: string,
) {
  const definition = yield* prepareExecutorApplicationDefinition(env, profile, source, sourceArtifactRootSha256);
  const applicationRegistration = { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid,
    epochUuid: profile.epochUuid, sourceArtifactRootSha256: profile.sourceArtifactRootSha256, sourcePackageHash: profile.sourcePackageHash,
    analyzerIdentity: profile.analyzerIdentity, analyzerPolicyIdentity: profile.analyzerPolicyIdentity,
    compatibilityDate: profile.compatibilityDate, generation: profile.generation, programs: definition.programs };
  const proposal = yield* database.prepareSchema({ schema: definition.schema, applicationRegistration });
  for (let step = 0; step < profile.maximumRegistrationSteps; step++) {
    const status = yield* database.schemaStatus(proposal);
    if (status.state === "failed" || status.state === "overwritten") return yield* refusal("registrationIncomplete");
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      const activation = yield* database.activateSchema(proposal, { programs: definition.programs, applicationRegistration });
      return Object.freeze({ disposition: status.state === "active" ? "already_registered" as const : "registered" as const,
        timestamp: activation.timestamp });
    }
    yield* database.advanceSchema(proposal, profile.workload.schemaScheduler.work);
  }
  return yield* refusal("registrationIncomplete");
});

export function executorApplicationFailureResponse(_cause: Cause.Cause<unknown>): Response {
  return Response.json({ format: "flarex.core-application.failure", version: 1,
    error: { code: "core_application_unavailable", message: "The configured application is not ready." } }, { status: 503 });
}

export const makeExecutorApplicationComposition = Effect.fn("ExecutorApplication.compose")(function* (
  env: ExecutorApplicationEnv, infrastructure: ApplicationDurableObjectInfrastructure,
) {
  const profiles = yield* Effect.fromResult(readExecutorApplicationProfiles(env));
  const profile = profiles.find(candidate => candidate.canonicalName === infrastructure.configuration.canonicalName
    && candidate.persistenceNamespace === infrastructure.configuration.persistenceNamespace && candidate.instanceName === infrastructure.configuration.instanceName);
  if (profile === undefined) return yield* refusal("configurationMismatch");
  const credentials = yield* makeExecutorApplicationCredentials(env, profile);
  const live = { ...credentials, coreDatabase: infrastructure.coreDatabase, admission: infrastructure.admission,
    deploymentId: profile.deploymentId, expectedProgramProfile: profile.expectedProgramProfile, maximumAttempts: profile.maximumAttempts,
    applicationRunner: { source: infrastructure.source, host: infrastructure.host, hostPolicy: profile.hostPolicy,
      hostPolicySha256: yield* executorApplicationSha256(profile.hostPolicyCanonicalBytes), sha256: executorApplicationSha256 },
    executionContextFactory: { make: () => Effect.sync(() => ({ executionId: crypto.randomUUID(),
      logScopeId: crypto.randomUUID(), randomSeed: crypto.getRandomValues(new Uint8Array(32)) })) },
  };
  const mutation = makeCoreApplicationMutationInvocationPort(live);
  const query = makeCoreApplicationQueryEvaluationRunner(live);
  const execute = Effect.fn("ExecutorApplication.invoke")(function* (input: CoreApplicationInvocationRequest) {
    if (input.sourceArtifactRootSha256 !== profile.sourceArtifactRootSha256) return yield* refusal("sourceMismatch");
    yield* assertExecutorApplicationProfile(infrastructure.coreDatabase, profile);
    if (input.kind === "query") {
      const captured = yield* Effect.fromResult(captureDocumentValueWithSize(input.args));
      const evaluation = yield* query(input.functionPath, input.args, captured.semanticSizeBytes, input.auth);
      return { kind: "query", value: evaluation.value, evaluation: evaluation.token } satisfies CoreApplicationInvocationResult;
    }
    const policy = yield* prepareApplicationMutationIdentityAccessPolicy(input.auth);
    const outcome = yield* mutation.invoke(input.functionPath, input.args, input.requestKey, policy);
    return { kind: "mutation", value: outcome.value, disposition: outcome.disposition,
      publishedTimestamp: outcome.timestamp } satisfies CoreApplicationInvocationResult;
  });
  const invoke = makeCoreApplicationHttpHandler({ route: { deploymentId: profile.deploymentId, scopeUuid: profile.scopeUuid, epochUuid: profile.epochUuid },
    authorize: (request: Request) => Effect.succeed(Result.isSuccess(admitExecutorRequest(request, env))), execute,
    maximumRequestBytes: profile.http.maximumRequestBytes,
    maximumResponseBytes: profile.http.maximumResponseBytes,
  });
  const dispatch = Effect.fn("ExecutorApplication.dispatch")(function* (request: Request) {
    const admitted = admitExecutorRequest(request, env);
    if (Result.isFailure(admitted)) return admitted.failure;
    const path = new URL(request.url).pathname;
    if (path === coreApplicationInvocationPath(profile.deploymentId)) {
      yield* infrastructure.assertFreshCoreApplicationDeployment(profile.deploymentId);
      return yield* invoke(request);
    }
    if (path === coreApplicationProfilePath(profile.deploymentId) && request.method === "GET") {
      yield* infrastructure.assertFreshCoreApplicationDeployment(profile.deploymentId);
      return Response.json(yield* Effect.fromResult(encodeCoreApplicationProfile(yield* assertExecutorApplicationProfile(infrastructure.coreDatabase, profile))));
    }
    if (path === coreApplicationRegistrationPath(profile.deploymentId) && request.method === "POST") {
      yield* infrastructure.assertFreshCoreApplicationDeployment(profile.deploymentId);
      const body = yield* readCoreApplicationJsonBody(request, profile.http.maximumRegistrationRequestBytes);
      const input = yield* Effect.fromResult(decodeCoreApplicationRegistrationRequest(body));
      const result = yield* infrastructure.admission.withPermit("mutation", registerExecutorApplicationDefinition(infrastructure.coreDatabase,
        env, profile, infrastructure.source, input.sourceArtifactRootSha256));
      return Response.json({ format: "flarex.core-application.registration-result", version: 1,
        requestKey: input.requestKey, ...result, timestamp: result.timestamp.toString() });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  });
  return Object.freeze({ ...live, dispatch });
});
