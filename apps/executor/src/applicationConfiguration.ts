import { Data, Result, Schema } from "effect";
import { encodeEdgeActionHostPolicyV1 } from "flarex-protocol/internal/edge-action-host-policy-v1";
import { makeGrantRetentionPolicyV1Result } from "flarex-protocol/grant-retention-policy";
import { ScopeEpochUuidV1Schema, ScopeUuidV1Schema } from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema, TransactionGrantKeyIdV1Schema } from "flarex-protocol/transaction-grant";
import { ApplicationDurableObjectWorkloadSchema } from "./applicationWorkload";
import type { ApplicationDurableObjectConfiguration, ApplicationDurableObjectEnv } from "./applicationDO";
import type { ApplicationAnalysisHostRequest, ApplicationAnalysisHostResult } from
  "@flarex/source-analyzer-v2/internal/application-analysis-host";
import { PublicApplicationSourcePolicySchema, type makePublicApplicationSourceProducer } from
  "flarex-backend/internal/public-application-source";

const Positive = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value > 0
  ? undefined : "Expected a positive safe integer"));
const Nonnegative = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe integer"));
const Text = Schema.NonEmptyString.check(Schema.isMaxLength(512), Schema.makeFilter(value =>
  /[\u0000-\u001f]/.test(value) ? "Control characters are not admitted" : undefined));
const Digest = Schema.String.check(Schema.makeFilter(value => /^[0-9a-f]{64}$/.test(value)
  ? undefined : "Expected a lowercase SHA-256"));
const ProfileInput = Schema.Struct({
  kind: Schema.Literal("fresh_core_application"),
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeUuid: ScopeUuidV1Schema,
  epochUuid: ScopeEpochUuidV1Schema,
  canonicalName: Text,
  persistenceNamespace: Schema.String.check(Schema.makeFilter(value => /^[a-z_][a-z0-9_]{0,62}$/.test(value)
    ? undefined : "Expected an explicit PostgreSQL namespace")),
  instanceName: Text,
  compatibilityDate: Schema.String.check(Schema.makeFilter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? undefined : "Expected a compatibility date")),
  generation: Positive,
  analyzerIdentity: Digest,
  analyzerPolicyIdentity: Text,
  keyId: TransactionGrantKeyIdV1Schema,
  maximumAttempts: Positive,
  maximumRegistrationSteps: Positive,
  http: Schema.Struct({ maximumRequestBytes: Positive, maximumResponseBytes: Positive, maximumRegistrationRequestBytes: Positive }),
  sourceUpload: PublicApplicationSourcePolicySchema,
  grantRetentionPolicy: Schema.Struct({ maximumGrantLifetimeMilliseconds: Positive,
    maximumFutureIssuedAtSkewMilliseconds: Nonnegative, maximumLiveSnapshotRetentionMilliseconds: Positive }),
  hostPolicy: Schema.Unknown,
  workload: ApplicationDurableObjectWorkloadSchema,
});
const LegacyProfile = Schema.Struct({ kind: Schema.Literal("legacy_session"), deploymentId: TransactionGrantDeploymentIdV1Schema });
const Profiles = Schema.fromJsonString(Schema.Struct({ version: Schema.Literal(1),
  profiles: Schema.Array(ProfileInput).check(Schema.isMaxLength(256)),
  legacyProfiles: Schema.optionalKey(Schema.Array(LegacyProfile).check(Schema.isMaxLength(256))),
  maximumLegacyRequestBytes: Schema.optionalKey(Positive) }));
const Keys = Schema.fromJsonString(Schema.Struct({ version: Schema.Literal(1),
  keys: Schema.Array(Schema.Struct({ keyId: TransactionGrantKeyIdV1Schema,
    privateKeyPkcs8: Schema.NonEmptyString, publicKeySpki: Schema.NonEmptyString,
    queryCursorSecret: Schema.NonEmptyString,
    issuedAtInclusiveEpochMilliseconds: Nonnegative,
    issuedAtExclusiveEpochMilliseconds: Schema.optionalKey(Positive),
    verificationEndsAtExclusiveEpochMilliseconds: Schema.optionalKey(Positive),
  })).check(Schema.isMaxLength(256)) }));
const decodeProfiles = Schema.decodeUnknownResult(Profiles, { onExcessProperty: "error" });
const decodeKeys = Schema.decodeUnknownResult(Keys, { onExcessProperty: "error" });

export class ExecutorApplicationConfigurationError extends Data.TaggedError("ExecutorApplicationConfigurationError")<{
  readonly reason: "invalidProfiles" | "duplicateProfile" | "invalidKeys" | "missingKey" | "unsupportedDeployment"
    | "unknownObject" | "missingNamespace" | "missingAnalyzer";
}> {}

export interface ExecutorApplicationEnv extends ApplicationDurableObjectEnv {
  readonly ARTIFACTS: ApplicationDurableObjectEnv["ARTIFACTS"] & Parameters<typeof makePublicApplicationSourceProducer>[0]["artifacts"];
  readonly APPLICATIONS?: DurableObjectNamespace;
  readonly APPLICATION_ANALYZER?: Readonly<{
    analyze: (request: ApplicationAnalysisHostRequest) => Promise<ApplicationAnalysisHostResult>;
  }>;
  readonly FLAREX_APPLICATION_PROFILES?: string;
  readonly FLAREX_APPLICATION_KEYS?: string;
}

const policyBudget = Object.freeze({ maximumOrigins: 1_024, maximumOriginBytes: 8_192, maximumCanonicalBytes: 1_048_576 });
const invalidProfiles = () => new ExecutorApplicationConfigurationError({ reason: "invalidProfiles" });

/** Trusted operator configuration is the route inventory, not proof that a profile is installed. */
export function readExecutorApplicationRegistry(env: Pick<ExecutorApplicationEnv, "FLAREX_APPLICATION_PROFILES">) {
  return Result.gen(function* () {
    const configured = yield* decodeProfiles(env.FLAREX_APPLICATION_PROFILES).pipe(Result.mapError(invalidProfiles));
    const identities = new Set<string>();
    const profiles = [];
    for (const input of configured.profiles) {
      const policy = yield* encodeEdgeActionHostPolicyV1(input.hostPolicy, policyBudget).pipe(Result.mapError(invalidProfiles));
      const grantRetentionPolicy = yield* makeGrantRetentionPolicyV1Result(input.grantRetentionPolicy).pipe(Result.mapError(invalidProfiles));
      for (const key of [`deployment:${input.deploymentId}`, `scope:${input.scopeUuid}`, `object:${input.canonicalName}`,
        `instance:${input.persistenceNamespace}:${input.instanceName}`]) {
        if (identities.has(key)) return yield* Result.fail(new ExecutorApplicationConfigurationError({ reason: "duplicateProfile" }));
        identities.add(key);
      }
      profiles.push(Object.freeze({ ...input, hostPolicy: policy.frame, hostPolicyCanonicalBytes: policy.canonicalBytes,
        grantRetentionPolicy }));
    }
    const legacyProfiles = [];
    for (const input of configured.legacyProfiles ?? []) {
      const key = `deployment:${input.deploymentId}`;
      if (identities.has(key)) return yield* Result.fail(new ExecutorApplicationConfigurationError({ reason: "duplicateProfile" }));
      identities.add(key);
      legacyProfiles.push(Object.freeze({ ...input }));
    }
    if (legacyProfiles.length > 0 && configured.maximumLegacyRequestBytes === undefined)
      return yield* Result.fail(invalidProfiles());
    return Object.freeze({ profiles: Object.freeze(profiles), legacyProfiles: Object.freeze(legacyProfiles),
      maximumLegacyRequestBytes: configured.maximumLegacyRequestBytes });
  });
}
export function readExecutorApplicationProfiles(env: Pick<ExecutorApplicationEnv, "FLAREX_APPLICATION_PROFILES">) {
  return readExecutorApplicationRegistry(env).pipe(Result.map(registry => registry.profiles));
}
export type ExecutorApplicationProfile = Result.Result.Success<ReturnType<typeof readExecutorApplicationProfiles>>[number];
export type ExecutorLegacyApplicationProfile = typeof LegacyProfile.Type;

export function resolveExecutorApplicationProfile(env: Pick<ExecutorApplicationEnv, "FLAREX_APPLICATION_PROFILES">,
  deploymentId: string): Result.Result<ExecutorApplicationProfile, ExecutorApplicationConfigurationError> {
  return readExecutorApplicationProfiles(env).pipe(Result.flatMap(profiles => {
    const profile = profiles.find(candidate => candidate.deploymentId === deploymentId);
    return profile === undefined ? Result.fail(new ExecutorApplicationConfigurationError({ reason: "unsupportedDeployment" }))
      : Result.succeed(profile);
  }));
}

/** Absence never restores the session engine; only an explicit operator entry admits it. */
export function resolveExecutorLegacyApplicationProfile(env: Pick<ExecutorApplicationEnv, "FLAREX_APPLICATION_PROFILES">,
  deploymentId: string): Result.Result<ExecutorLegacyApplicationProfile, ExecutorApplicationConfigurationError> {
  return readExecutorApplicationRegistry(env).pipe(Result.flatMap(registry => {
    const profile = registry.legacyProfiles.find(candidate => candidate.deploymentId === deploymentId);
    return profile === undefined ? Result.fail(new ExecutorApplicationConfigurationError({ reason: "unsupportedDeployment" }))
      : Result.succeed(profile);
  }));
}

export function readExecutorApplicationKey(env: Pick<ExecutorApplicationEnv, "FLAREX_APPLICATION_KEYS">, keyId: string) {
  return Result.gen(function* () {
    const configured = yield* decodeKeys(env.FLAREX_APPLICATION_KEYS).pipe(
      Result.mapError(() => new ExecutorApplicationConfigurationError({ reason: "invalidKeys" })));
    if (new Set(configured.keys.map(key => key.keyId)).size !== configured.keys.length)
      return yield* Result.fail(new ExecutorApplicationConfigurationError({ reason: "invalidKeys" }));
    const selected = configured.keys.find(key => key.keyId === keyId);
    return selected === undefined ? yield* Result.fail(new ExecutorApplicationConfigurationError({ reason: "missingKey" }))
      : Object.freeze({ ...selected });
  });
}

export function executorApplicationObjectConfiguration(env: ExecutorApplicationEnv,
  objectId: DurableObjectId): ApplicationDurableObjectConfiguration {
  const namespace = env.APPLICATIONS;
  if (namespace === undefined) throw new ExecutorApplicationConfigurationError({ reason: "missingNamespace" });
  const profiles = Result.getOrThrow(readExecutorApplicationProfiles(env));
  const profile = profiles.find(candidate => objectId.equals(namespace.idFromName(candidate.canonicalName)));
  if (profile === undefined) throw new ExecutorApplicationConfigurationError({ reason: "unknownObject" });
  Result.getOrThrow(readExecutorApplicationKey(env, profile.keyId));
  return Object.freeze({ namespace, canonicalName: profile.canonicalName,
    persistenceNamespace: profile.persistenceNamespace, instanceName: profile.instanceName });
}

export function resolveExecutorApplicationObject(env: ExecutorApplicationEnv, deploymentId: string) {
  return resolveExecutorApplicationProfile(env, deploymentId).pipe(Result.flatMap(profile => {
    const namespace = env.APPLICATIONS;
    return namespace === undefined ? Result.fail(new ExecutorApplicationConfigurationError({ reason: "missingNamespace" }))
      : Result.succeed(namespace.get(namespace.idFromName(profile.canonicalName)));
  }));
}
