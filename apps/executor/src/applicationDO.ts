import { DurableObject } from "cloudflare:workers";
import { openCoreDatabase, type CoreDatabase, type CoreDatabaseOptions, type CoreError } from
  "@flarex/persistence-postgres/internal/core";
import { createCorePersistence, loadCorePersistenceTarget, makeCorePostgresDriver, type CorePostgresPool } from
  "@flarex/persistence-postgres/internal/core-persistence";
import { makeApplicationMutationSystemLayer, makeCoreApplicationAdmission, CoreApplicationAdmissionConfigurationSchema,
  type CoreApplicationAdmissionError, type ApplicationCoreMutationSystemLive,
  type ApplicationMutationSystem } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { makeApplicationQuerySystemLayer, type ApplicationQuerySystem } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { makeApplicationAnalysisR2SourceReader } from
  "flarex-backend/internal/application-analysis-source-reader";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import { Data, Effect, Layer, ManagedRuntime, Result, Schema, type Scope } from "effect";
import { Client, Pool, type ClientConfig, type PoolConfig } from "pg";

import { admitExecutorRequest, type ExecutorWorkerEnv } from "./requestLifecycle";

export interface ApplicationDurableObjectEnv extends ExecutorWorkerEnv {
  readonly LOADER: WorkerLoader;
  readonly ARTIFACTS: Parameters<typeof makeApplicationAnalysisR2SourceReader>[0];
}

export interface ApplicationDurableObjectConfiguration {
  readonly namespace: DurableObjectNamespace;
  readonly canonicalName: string;
  readonly persistenceNamespace: string;
  readonly instanceName: string;
}

type ApplicationServices = ApplicationQuerySystem | ApplicationMutationSystem;
type ApplicationComposition = Omit<ApplicationCoreMutationSystemLive, "coreDatabase" | "admission">;

const NonnegativeCount = Schema.Int.check(Schema.makeFilter(value => Number.isSafeInteger(value) && value >= 0
  ? undefined : "Expected a nonnegative safe count"));
const ApplicationWorkload = Schema.Struct({
  indexCache: Schema.Struct({ maxBytes: NonnegativeCount,
    verifyPercent: NonnegativeCount.check(Schema.isLessThanOrEqualTo(100)) }),
  operationCacheMaxBytes: NonnegativeCount,
  admission: CoreApplicationAdmissionConfigurationSchema,
  /** Retained HTTP requests during boot/dispatch, separate from function permits. */
  maxRequests: NonnegativeCount.check(Schema.isGreaterThan(0)),
});
export type ApplicationDurableObjectWorkload = typeof ApplicationWorkload.Type;

export interface ApplicationPostgresPool extends CorePostgresPool {
  readonly end: () => Promise<void>;
  readonly on: (event: "error", listener: (cause: Error) => void) => unknown;
  readonly removeListener: (event: "error", listener: (cause: Error) => void) => unknown;
}

/** pg.Pool.end removes clients before their socket shutdown Promises settle.
 * Retain those exact native close operations until the app resource is closed. */
export function createApplicationPostgresPool(configuration: PoolConfig): ApplicationPostgresPool {
  const clients = new Set<Client>();
  class ApplicationClient extends Client {
    #closing: Promise<void> | undefined;
    constructor(config?: ClientConfig) { super(config); clients.add(this); }
    override end(): Promise<void>;
    override end(callback: () => void): void;
    override end(callback?: () => void): Promise<void> | void {
      if (this.#closing === undefined) {
        this.#closing = super.end();
        // Successful idle retirement must not retain every historical client.
        // A rejected native close stays retained for the final full outcome.
        void this.#closing.then(() => { clients.delete(this); }, cause => {
          pool.emit("error", new Error("Application PostgreSQL client shutdown failed.", { cause }));
        });
      }
      const closing = this.#closing;
      if (callback === undefined) return closing;
      // pg's callback contract carries no error argument. The same rejected
      // Promise remains retained and is reported by the pool owner below.
      void closing.then(callback, callback);
    }
  }
  const pool = new Pool({ ...configuration, Client: ApplicationClient });
  let closing: Promise<void> | undefined;
  return Object.freeze({ connect: () => pool.connect(), on: pool.on.bind(pool), removeListener: pool.removeListener.bind(pool),
    end: () => closing ??= (async () => {
      const stopped = await Promise.allSettled([pool.end()]);
      const drained = await Promise.allSettled([...clients].map(client => client.end()));
      const failures = [...stopped, ...drained].flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length > 0) throw new AggregateError(failures, "Application PostgreSQL pool cleanup failed.");
    })(),
  });
}

export class ApplicationOwnerHostError extends Data.TaggedError("ApplicationOwnerHostError")<{
  readonly reason: "closed" | "resourceUnavailable";
  readonly cause?: unknown;
}> {}

export interface ApplicationDurableObjectOptions<Env extends ApplicationDurableObjectEnv, Failure> {
  /** Trusted topology and canonical routing identity; never derived from a request. */
  readonly configuration: (env: Env) => ApplicationDurableObjectConfiguration;
  readonly coreOptions: Omit<CoreDatabaseOptions, "indexCache" | "operationCacheMaxBytes">;
  /** Explicit private workload settings; no Rust server cache allocation is inherited. */
  readonly workload: ApplicationDurableObjectWorkload;
  readonly application: (env: Env, infrastructure: Readonly<{
    /** Trusted composition may install/publish only through this retained owner. */
    coreDatabase: CoreDatabase;
    source: ReturnType<typeof makeApplicationAnalysisR2SourceReader>;
    host: ReturnType<typeof makeApplicationExecutionHost>;
  }>) => Effect.Effect<ApplicationComposition, Failure, Scope.Scope>;
  readonly dispatch: (request: Request) => Effect.Effect<Response, Failure, ApplicationServices>;
  /** Optional trusted transport construction, also used by the actual socket witness. */
  readonly createPool?: (connectionString: string) => ApplicationPostgresPool;
}

export type ApplicationDurableObjectClass<Env extends ApplicationDurableObjectEnv> =
  new (ctx: DurableObjectState, env: Env) => DurableObject<Env> & {
    fetch(request: Request): Promise<Response>;
    /** Controlled maintenance/test barrier; managed eviction has no shutdown hook. */
    close(): Promise<void>;
  };

/** All fresh callers use this exact named identity. No unique-ID routing is admitted. */
export function resolveApplicationDurableObject(configuration: Pick<
  ApplicationDurableObjectConfiguration, "namespace" | "canonicalName"
>): DurableObjectStub {
  return configuration.namespace.get(configuration.namespace.idFromName(configuration.canonicalName));
}

/** One canonical app owns one scoped database, committer and PostgreSQL pool.
 * PostgreSQL fencing and correlated outcomes remain the durable authorities. */
export function makeApplicationDurableObject<Env extends ApplicationDurableObjectEnv, Failure>(
  options: ApplicationDurableObjectOptions<Env, Failure>,
): ApplicationDurableObjectClass<Env> {
  // Trusted synchronous composition boundary. The authoritative admission schema
  // is shared with its scoped factory; invalid settings allocate no pool.
  const decoded = Schema.decodeUnknownSync(ApplicationWorkload)(options.workload);
  const workload = Object.freeze({ ...decoded,
    indexCache: Object.freeze({ ...decoded.indexCache }),
    admission: Object.freeze({ ...decoded.admission,
      query: Object.freeze({ ...decoded.admission.query }), mutation: Object.freeze({ ...decoded.admission.mutation }) }),
  });
  const coreOptions = Object.freeze({ ...options.coreOptions,
    indexCache: workload.indexCache, operationCacheMaxBytes: workload.operationCacheMaxBytes,
    ...(options.coreOptions.transactionLimits === undefined ? {}
      : { transactionLimits: Object.freeze({ ...options.coreOptions.transactionLimits }) }) });
  const createPool = options.createPool ?? ((connectionString: string) =>
    createApplicationPostgresPool({ connectionString, max: 4, statement_timeout: 30_000 }));

  return class ApplicationDurableObject extends DurableObject<Env> {
    readonly #canonical: boolean;
    readonly #configuration: ApplicationDurableObjectConfiguration;
    readonly #requests = new Map<Promise<Response>, AbortController>();
    #runtime: ManagedRuntime.ManagedRuntime<ApplicationServices, Failure | CoreError | CoreApplicationAdmissionError | ApplicationOwnerHostError> | undefined;
    #database: CoreDatabase | undefined;
    #failure: ApplicationOwnerHostError | undefined;
    #closing: Promise<void> | undefined;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      this.#configuration = Object.freeze({ ...options.configuration(env) });
      this.#canonical = ctx.id.equals(this.#configuration.namespace.idFromName(this.#configuration.canonicalName));
    }

    #getRuntime(connectionString: string) {
      if (this.#runtime !== undefined) return this.#runtime;
      const configuration = this.#configuration;
      const env = this.env;
      const owner = this;
      const acquire = Effect.gen(function* () {
        const onPoolError = (cause: Error) => {
          owner.#failure ??= new ApplicationOwnerHostError({ reason: "resourceUnavailable", cause });
          // A pool event is a real foreign lifecycle edge. Its retained failure
          // refuses disclosure; controlled close owns cancellation and drain.
          owner.ctx.waitUntil(owner.close());
        };
        const pool = yield* Effect.acquireRelease(Effect.try({ try: () => createPool(connectionString),
          catch: cause => new ApplicationOwnerHostError({ reason: "resourceUnavailable", cause }) }),
        pool => Effect.tryPromise({ try: () => pool.end(), catch: cause => cause }).pipe(Effect.orDie,
          Effect.ensuring(Effect.sync(() => { pool.removeListener("error", onPoolError); }))));
        yield* Effect.sync(() => { pool.on("error", onPoolError); });
        const driver = makeCorePostgresDriver(pool);
        const target = yield* loadCorePersistenceTarget(driver, configuration.persistenceNamespace);
        const persistence = yield* createCorePersistence(target, configuration.instanceName);
        const admission = yield* makeCoreApplicationAdmission(workload.admission);
        // Opening includes the PostgreSQL fence and complete bootstrap. Layer
        // construction cannot disclose an invocation before this succeeds.
        const coreDatabase = yield* openCoreDatabase(persistence, coreOptions);
        owner.#database = coreDatabase;
        if (owner.#failure !== undefined) return yield* Effect.fail(owner.#failure);
        const application = yield* options.application(env, {
          coreDatabase,
          source: makeApplicationAnalysisR2SourceReader(env.ARTIFACTS),
          host: makeApplicationExecutionHost(env.LOADER),
        });
        const live = { ...application, coreDatabase, admission };
        return Layer.mergeAll(makeApplicationQuerySystemLayer(live), makeApplicationMutationSystemLayer(live));
      });
      this.#runtime = ManagedRuntime.make(Layer.unwrap(acquire));
      return this.#runtime;
    }

    override async fetch(request: Request): Promise<Response> {
      const admission = admitExecutorRequest(request, this.env);
      if (Result.isFailure(admission)) return admission.failure;
      // A wrong named or unique identity must allocate no PostgreSQL resource.
      if (!this.#canonical) return Response.json({ error: "noncanonical_application_owner" }, { status: 421 });
      if (this.#failure !== undefined) throw this.#failure;
      if (this.#closing !== undefined) return Response.json({ error: "application_owner_closed" }, { status: 503 });
      // Bound retained requests before runtime bootstrap. This is a host map
      // reservation, not a second query/mutation execution permit.
      if (this.#requests.size >= workload.maxRequests)
        return Response.json({ error: "application_owner_overloaded" }, { status: 503 });
      const runtime = this.#getRuntime(admission.success.connectionString);
      const controller = new AbortController();
      const invocation = runtime.runPromise(options.dispatch(request), {
        signal: AbortSignal.any([request.signal, controller.signal]),
      });
      this.#requests.set(invocation, controller);
      try {
        const response = await invocation;
        if (this.#failure !== undefined) throw this.#failure;
        if (this.#closing !== undefined) return Response.json({ error: "application_owner_closed" }, { status: 503 });
        return response;
      } finally {
        this.#requests.delete(invocation);
      }
    }

    close(): Promise<void> {
      return this.#closing ??= Promise.resolve().then(async () => {
        // The flag is installed synchronously before another request can enter.
        // Each admitted invocation owns its Worker/callback drain; dispose then
        // closes CoreDatabase before the pool by reverse scope acquisition.
        for (const controller of this.#requests.values()) controller.abort("application-owner-closing");
        const database = this.#database;
        const coreClose = await Promise.allSettled(database === undefined ? [] : [Effect.runPromise(database.close())]);
        await Promise.allSettled([...this.#requests.keys()]);
        const runtime = this.#runtime;
        const dispose = await Promise.allSettled(runtime === undefined ? [] : [runtime.dispose()]);
        const failures = [...coreClose, ...dispose].flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length > 0) throw new AggregateError(failures, "Application owner cleanup failed.");
      });
    }
  };
}
