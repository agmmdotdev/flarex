import { Clock, Effect, Result } from "effect";
import { makeApplicationDurableObject, type ApplicationDurableObjectOptions } from "./applicationDO";
import { executorApplicationObjectConfiguration, readExecutorApplicationProfiles,
  ExecutorApplicationConfigurationError, type ExecutorApplicationEnv } from "./applicationConfiguration";
import { executorApplicationFailureResponse, makeExecutorApplicationComposition } from "./applicationComposition";
import { makePublicApplicationSourceProducer } from "flarex-backend/internal/public-application-source";

type Composition = Effect.Success<ReturnType<typeof makeExecutorApplicationComposition>>;
type Failure = Effect.Error<ReturnType<typeof makeExecutorApplicationComposition>> |
  Effect.Error<ReturnType<Composition["dispatch"]>>;

/** One production composition shared by deployment and actual-host observation. */
export function makeExecutorApplicationOptions(): ApplicationDurableObjectOptions<ExecutorApplicationEnv, Failure> {
  return {
    configuration: executorApplicationObjectConfiguration,
    workload: (env, configuration) => {
      const profiles = Result.getOrThrow(readExecutorApplicationProfiles(env));
      const profile = profiles.find(candidate => candidate.canonicalName === configuration.canonicalName);
      if (profile === undefined) throw new ExecutorApplicationConfigurationError({ reason: "unknownObject" });
      return profile.workload;
    },
    coreOptions: { now: Clock.currentTimeMillis.pipe(Effect.map(milliseconds => BigInt(Math.floor(milliseconds)) * 1_000_000n)),
      randomBytes: length => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))) },
    application: makeExecutorApplicationComposition,
    sourceUpload: (env, context, configuration) => {
      const profile = Result.getOrThrow(readExecutorApplicationProfiles(env))
        .find(candidate => candidate.canonicalName === configuration.canonicalName);
      if (profile === undefined) throw new ExecutorApplicationConfigurationError({ reason: "unknownObject" });
      return makePublicApplicationSourceProducer({ deploymentId: profile.deploymentId,
        storage: context.storage, sql: context.storage.sql, artifacts: env.ARTIFACTS, policy: profile.sourceUpload }).upload;
    },
    dispatch: () => Effect.succeed(Response.json({ error: "application_not_configured" }, { status: 503 })),
    failureResponse: executorApplicationFailureResponse,
  };
}

/** Actual deployment export; all per-app numerical policy comes from validated operator configuration. */
export const FlarexApplication = makeApplicationDurableObject(makeExecutorApplicationOptions());
