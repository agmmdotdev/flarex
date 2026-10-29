import { DurableObject } from "cloudflare:workers";
import {
  createPostgresClientApplicationQueryServing,
  type ApplicationQueryServingConfiguration,
} from "@flarex/persistence-postgres/internal/application-query-serving";
import {
  observePostgresClientLifetime,
  PostgresLocatedReadCommittedConnectionErrorV1,
} from "@flarex/persistence-postgres/internal/postgres-client-lifetime";
import { createApplicationQueryCacheHandoff } from
  "@flarex/persistence-postgres/internal/application-query-cache";
import {
  ApplicationQueryCompositionError,
  makeApplicationQuerySystemFactoryLayer,
  type ApplicationQueryExecutionContext,
  type ApplicationQuerySystem,
  type ApplicationQuerySystemLive,
} from "@flarex/standard-application-invocation/internal/application-query-system";
import {
  APPLICATION_RUNTIME_COMPATIBILITY_DATE,
  APPLICATION_RUNTIME_HOST_IDENTITY,
  makeApplicationRuntimeMaterializer,
} from "flarex-backend/artifact-runtime";
import { makeApplicationAnalysisR2SourceReader } from
  "flarex-backend/internal/application-analysis-source-reader";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import { Effect, ManagedRuntime, Result, type Scope } from "effect";
import { Client } from "pg";

import {
  admitExecutorRequest,
  createExecutorClientLifetime,
  type ExecutorWorkerEnv,
} from "./requestLifecycle";

export interface ApplicationQueryDurableObjectEnv extends ExecutorWorkerEnv {
  readonly LOADER: WorkerLoader;
  readonly ARTIFACTS: Parameters<typeof makeApplicationAnalysisR2SourceReader>[0];
}

export interface ApplicationQueryDurableObjectOptions<
  Env extends ApplicationQueryDurableObjectEnv,
  Failure,
> {
  /** Trusted local topology; never reconstructed from the request. */
  readonly serving: (
    env: Env,
  ) => Omit<ApplicationQueryServingConfiguration<unknown>, "cold">;
  readonly snapshotBudget: ApplicationQuerySystemLive["snapshotBudget"];
  readonly executionContextFactory: () => ApplicationQueryExecutionContext;
  /** Ordinary trusted code with locally authored references calls runQuery. */
  readonly dispatch: (
    request: Request,
  ) => Effect.Effect<Response, Failure, ApplicationQuerySystem>;
  readonly createClient?: (connectionString: string) => Client;
}

/** Keep the platform base's identity and protected host capabilities while
 * exposing only the required request method, not the private runtime. */
export type ApplicationQueryDurableObjectClass<
  Env extends ApplicationQueryDurableObjectEnv,
> = new (ctx: DurableObjectState, env: Env) => DurableObject<Env> & {
  fetch(request: Request): Promise<Response>;
};

/** Private, unrouted host composition. This class owns optional RAM only, not
 * the app's durable commit, retention, routing or fencing authority. */
export function makeApplicationQueryDurableObject<
  Env extends ApplicationQueryDurableObjectEnv,
  Failure,
>(
  options: ApplicationQueryDurableObjectOptions<Env, Failure>,
): ApplicationQueryDurableObjectClass<Env> {
  const serving = options.serving;
  const dispatch = options.dispatch;
  const snapshotBudget = Object.freeze({ ...options.snapshotBudget });
  const executionContextFactory = options.executionContextFactory;
  const createClient = options.createClient ??
    ((connectionString: string) => new Client({ connectionString }));

  return class ApplicationQueryDurableObject extends DurableObject<Env> {
    readonly #runtime: ManagedRuntime.ManagedRuntime<ApplicationQuerySystem, never>;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      const source = makeApplicationAnalysisR2SourceReader(env.ARTIFACTS);
      const host = makeApplicationExecutionHost(env.LOADER);
      const materializer = makeApplicationRuntimeMaterializer({ source, loader: env.LOADER });
      const selected = serving(env);
      const configuration = Object.freeze({
        ...selected,
        physicalLocator: Object.freeze({ ...selected.physicalLocator }),
      });
      const cacheHandoff = createApplicationQueryCacheHandoff();
      const acquire = Effect.fn("ApplicationQueryDO.acquireServing")(
        function* (): Effect.fn.Return<
          ApplicationQuerySystemLive,
          ApplicationQueryCompositionError,
          Scope.Scope
        > {
          const connectionString = env.HYPERDRIVE_CACHE_DISABLED?.connectionString;
          // fetch admission refuses missing configuration before running this Effect.
          if (connectionString === undefined) {
            return yield* new ApplicationQueryCompositionError({ reason: "requestResourceFailed" });
          }
          const resource = yield* Effect.acquireRelease(
            Effect.try({
              try: () => createClient(connectionString),
              catch: cause => new ApplicationQueryCompositionError({ reason: "requestResourceFailed", cause }),
            }).pipe(Effect.map(client => ({
              client,
              lifetime: createExecutorClientLifetime(client),
              observation: observePostgresClientLifetime(client),
            }))),
            current => Effect.tryPromise({
              try: () => current.observation.finish(current.lifetime.release),
              catch: cause => cause,
            }).pipe(Effect.orDie),
          );
          yield* Effect.tryPromise({
            try: () => resource.client.connect(),
            catch: cause => new ApplicationQueryCompositionError({ reason: "requestResourceFailed", cause }),
          });
          yield* Effect.try({
            try: resource.observation.check,
            catch: cause => {
              if (!(cause instanceof PostgresLocatedReadCommittedConnectionErrorV1)) throw cause;
              return new ApplicationQueryCompositionError({ reason: "requestResourceFailed", cause });
            },
          });
          const ports = yield* Effect.sync(() => createPostgresClientApplicationQueryServing(
            resource.client,
            {
              ...configuration,
              cold: {
                runtimeHostIdentity: APPLICATION_RUNTIME_HOST_IDENTITY,
                compatibilityDate: APPLICATION_RUNTIME_COMPATIBILITY_DATE,
                materialize: materializer.materialize,
              },
            },
            {
              quarantine: resource.lifetime.quarantine,
              connectionErrors: resource.observation.connectionErrors,
            },
          ));
          return {
            ...ports,
            snapshot: { ...ports.snapshot, cacheHandoff },
            snapshotBudget,
            source,
            host,
            executionContextFactory,
          };
        },
      )();
      this.#runtime = ManagedRuntime.make(makeApplicationQuerySystemFactoryLayer(acquire));
    }

    override async fetch(request: Request): Promise<Response> {
      const admission = admitExecutorRequest(request, this.env);
      if (Result.isFailure(admission)) return admission.failure;
      return this.#runtime.runPromise(dispatch(request), { signal: request.signal });
    }
  };
}
