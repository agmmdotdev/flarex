import { DurableObject } from "cloudflare:workers";
import { CoreTransactionError, makeCoreApplicationOwner,
  type CoreApplicationOwner, type CoreApplicationMaintenance, type CoreApplicationGenerationPhase,
  type CoreDatabase, type CoreDatabaseOptions, type CoreError } from
  "@flarex/persistence-postgres/internal/core";
import { createCorePersistence, loadCorePersistenceTarget, makeCorePostgresDriver, type CorePostgresPool } from
  "@flarex/persistence-postgres/internal/core-persistence";
import { makeCoreApplicationLegacyAdmission } from
  "@flarex/persistence-postgres/internal/core-application-legacy-admission";
import { makeApplicationMutationSystemLayer, makeCoreApplicationAdmission,
  type CoreApplicationAdmission, type CoreApplicationAdmissionError, type ApplicationCoreMutationSystemLive,
  type ApplicationMutationSystem } from
  "@flarex/standard-application-invocation/internal/application-mutation-system";
import { makeApplicationQuerySystemLayer, type ApplicationQuerySystem } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { makeApplicationAnalysisR2SourceReader } from
  "flarex-backend/internal/application-analysis-source-reader";
import { makeApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";
import type { makePublicApplicationSourceProducer } from "flarex-backend/internal/public-application-source";
import { Cause, Clock, Data, Deferred, Effect, Exit, Layer, ManagedRuntime, Result, Semaphore, type Context, type Scope } from "effect";
import { Client, Pool, type ClientConfig, type PoolConfig } from "pg";

import { admitExecutorConfiguration, admitExecutorRequest, type ExecutorWorkerEnv } from "./requestLifecycle";
import { captureApplicationDurableObjectWorkload, type ApplicationDurableObjectWorkload } from "./applicationWorkload";
export type { ApplicationDurableObjectWorkload } from "./applicationWorkload";

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

export type ApplicationServices = ApplicationQuerySystem | ApplicationMutationSystem;
type ApplicationComposition = Omit<ApplicationCoreMutationSystemLive, "coreDatabase" | "admission">;
export interface ApplicationDurableObjectInfrastructure {
  readonly configuration: ApplicationDurableObjectConfiguration;
  readonly coreDatabase: CoreDatabase;
  readonly admission: CoreApplicationAdmission;
  readonly assertFreshCoreApplicationDeployment: ReturnType<typeof makeCoreApplicationLegacyAdmission>;
  readonly phase: CoreApplicationGenerationPhase;
  readonly source: ReturnType<typeof makeApplicationAnalysisR2SourceReader>;
  readonly host: ReturnType<typeof makeApplicationExecutionHost>;
  readonly sourceUpload?: ReturnType<typeof makePublicApplicationSourceProducer>["upload"];
}

export interface ApplicationPostgresPool extends CorePostgresPool {
  readonly assertFreshCoreApplicationDeployment: ReturnType<typeof makeCoreApplicationLegacyAdmission>;
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
    assertFreshCoreApplicationDeployment: makeCoreApplicationLegacyAdmission(pool),
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
  readonly configuration: (env: Env, objectId: DurableObjectId) => ApplicationDurableObjectConfiguration;
  readonly coreOptions: Omit<CoreDatabaseOptions, "indexCache" | "operationCacheMaxBytes" | "schemaWorker">;
  /** Explicit private workload settings; no Rust server cache allocation is inherited. */
  readonly workload: ApplicationDurableObjectWorkload | ((env: Env,
    configuration: ApplicationDurableObjectConfiguration) => ApplicationDurableObjectWorkload);
  readonly application: (env: Env, infrastructure: ApplicationDurableObjectInfrastructure) => Effect.Effect<
    ApplicationComposition & Readonly<{ dispatch?: ApplicationDurableObjectOptions<Env, Failure>["dispatch"] }>, Failure, Scope.Scope>;
  readonly dispatch: (request: Request) => Effect.Effect<Response, Failure, ApplicationServices>;
  /** Trusted HTTP projection after the generation has refused disclosure. */
  readonly failureResponse?: (cause: Cause.Cause<Failure | CoreError | CoreApplicationAdmissionError | ApplicationOwnerHostError>) => Response;
  /** Optional trusted transport construction, also used by the actual socket witness. */
  readonly createPool?: (connectionString: string) => ApplicationPostgresPool;
  /** Trusted immutable source upload capability bound to this canonical object's storage. */
  readonly sourceUpload?: (env: Env, context: DurableObjectState,
    configuration: ApplicationDurableObjectConfiguration) => NonNullable<ApplicationDurableObjectInfrastructure["sourceUpload"]>;
}

export type ApplicationDurableObjectClass<Env extends ApplicationDurableObjectEnv> =
  new (ctx: DurableObjectState, env: Env) => DurableObject<Env> & {
    fetch(request: Request): Promise<Response>;
    alarm(): Promise<void>;
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
  const createPool = options.createPool ?? ((connectionString: string) =>
    createApplicationPostgresPool({ connectionString, max: 4, statement_timeout: 30_000 }));
  type HostFailure = Failure | CoreError | CoreApplicationAdmissionError | ApplicationOwnerHostError;
  type PreparedApplication = Readonly<{ services: Context.Context<ApplicationServices>;
    dispatch: ApplicationDurableObjectOptions<Env, Failure>["dispatch"] }>;
  type HostedOwner = CoreApplicationOwner<PreparedApplication, HostFailure>;

  return class ApplicationDurableObject extends DurableObject<Env> {
    readonly #canonical: boolean;
    readonly #configuration: ApplicationDurableObjectConfiguration;
    readonly #workload: ApplicationDurableObjectWorkload;
    readonly #requests = new Map<Promise<Response>, AbortController>();
    #runtime: ManagedRuntime.ManagedRuntime<never, HostFailure> | undefined;
    #owner: HostedOwner | undefined;
    #failure: ApplicationOwnerHostError | undefined;
    #closing: Promise<void> | undefined;
    readonly #alarmStorageLock = Semaphore.makeUnsafe(1);
    #schemaGeneration = 0;
    readonly #coreReady = Deferred.makeUnsafe<CoreApplicationMaintenance<HostFailure>, HostFailure>();
    readonly #ownerReady = Deferred.makeUnsafe<HostedOwner, HostFailure>();
    #bootstrap: Readonly<{ controller: AbortController; result: Promise<Exit.Exit<void, unknown>> }> | undefined;
    #schemaAlarm: Readonly<{ controller: AbortController; result: Promise<Exit.Exit<void, unknown>> }> | undefined;

    constructor(ctx: DurableObjectState, env: Env) {
      super(ctx, env);
      this.#configuration = Object.freeze({ ...options.configuration(env, ctx.id) });
      this.#workload = captureApplicationDurableObjectWorkload(typeof options.workload === "function"
        ? options.workload(env, this.#configuration) : options.workload);
      this.#canonical = ctx.id.equals(this.#configuration.namespace.idFromName(this.#configuration.canonicalName));
    }

    #getRuntime(connectionString: string) {
      if (this.#runtime !== undefined) return this.#runtime;
      const configuration = this.#configuration;
      const workload = this.#workload;
      const coreOptions = Object.freeze({ ...options.coreOptions,
        indexCache: workload.indexCache, operationCacheMaxBytes: workload.operationCacheMaxBytes,
        schemaWorker: workload.schemaWorker,
        ...(options.coreOptions.transactionLimits === undefined ? {}
          : { transactionLimits: Object.freeze({ ...options.coreOptions.transactionLimits }) }) });
      const env = this.env;
      const owner = this;
      const acquire = Effect.gen(function* () {
        if (owner.#closing !== undefined) return yield* new ApplicationOwnerHostError({ reason: "closed" });
        // Only an admitted request or an existing internal alarm can reach boot.
        // A fresh unauthorized constructor schedules nothing and opens no pool.
        yield* owner.#notifySchemaWork();
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
        const databaseOwner = yield* makeCoreApplicationOwner<PreparedApplication, HostFailure, never>({ persistence, options: coreOptions,
          // The HTTP map retains its original cap. One independent bounded
          // schema alarm also borrows the app generation, including during boot.
          maximumRequests: workload.maxRequests + 1,
          onKernelReady: maintenance => Deferred.succeed(owner.#coreReady, maintenance).pipe(Effect.asVoid),
          prepare: Effect.fn("ApplicationDurableObject.prepare")(function* (coreDatabase, phase) {
            if (owner.#closing !== undefined) return yield* new ApplicationOwnerHostError({ reason: "closed" });
            const admission = yield* makeCoreApplicationAdmission(workload.admission);
            const hostedDatabase: CoreDatabase = Object.freeze({ ...coreDatabase,
              prepareSchema: (input: Parameters<CoreDatabase["prepareSchema"]>[0]) => owner.#withSchemaWake(coreDatabase.prepareSchema(input)),
              activateSchema: (proposal: Parameters<CoreDatabase["activateSchema"]>[0], publication: Parameters<CoreDatabase["activateSchema"]>[1]) => owner.#withSchemaWake(coreDatabase.activateSchema(proposal, publication)),
              prepareApplicationCandidate: (input: Parameters<CoreDatabase["prepareApplicationCandidate"]>[0]) =>
                owner.#withSchemaWake(coreDatabase.prepareApplicationCandidate(input)),
              activateApplicationCandidate: (candidateId: Parameters<CoreDatabase["activateApplicationCandidate"]>[0],
                publication: Parameters<CoreDatabase["activateApplicationCandidate"]>[1]) =>
                owner.#withSchemaWake(coreDatabase.activateApplicationCandidate(candidateId, publication)),
            });
            if (owner.#failure !== undefined) return yield* Effect.fail(owner.#failure);
            const application = yield* options.application(env, {
              configuration, coreDatabase: hostedDatabase, admission, phase,
              assertFreshCoreApplicationDeployment: pool.assertFreshCoreApplicationDeployment,
              source: makeApplicationAnalysisR2SourceReader(env.ARTIFACTS),
              host: makeApplicationExecutionHost(env.LOADER),
              ...(options.sourceUpload === undefined ? {} : { sourceUpload: options.sourceUpload(env, owner.ctx, configuration) }),
            });
            const live = { ...application, coreDatabase: hostedDatabase, admission };
            const services = yield* Layer.build(Layer.mergeAll(makeApplicationQuerySystemLayer(live), makeApplicationMutationSystemLayer(live)));
            return Object.freeze({ services, dispatch: application.dispatch ?? options.dispatch });
          }),
        });
        owner.#owner = databaseOwner;
        yield* Deferred.succeed(owner.#ownerReady, databaseOwner);
      }).pipe(Effect.onExit(exit => Exit.isFailure(exit)
        ? Deferred.failCause(owner.#coreReady, exit.cause).pipe(
          Effect.andThen(Deferred.failCause(owner.#ownerReady, exit.cause)), Effect.asVoid) : Effect.void));
      this.#runtime = ManagedRuntime.make(Layer.effectDiscard(acquire));
      const controller = new AbortController();
      const result = this.#runtime.runPromiseExit(Effect.void, { signal: controller.signal });
      // The retained bootstrap is independent of a single HTTP call. Native
      // promise rejection is observed immediately and still joined on close.
      void result.catch(() => undefined);
      this.#bootstrap = { controller, result };
      return this.#runtime;
    }

    // The storage alarm is a wake hint. All work discovery, progress and outcome
    // decisions remain in the fenced core owner and its durable PostgreSQL data.
    #alarmStorage<A>(operation: () => Promise<A>) {
      return Effect.uninterruptible(Effect.tryPromise({ try: operation,
        catch: cause => new CoreTransactionError({ reason: "unavailable",
          cause: new ApplicationOwnerHostError({ reason: "resourceUnavailable", cause }) }) }));
    }

    readonly #ensureAlarm = Effect.fn("ApplicationDurableObject.ensureAlarm")((delay: number): Effect.Effect<void, CoreError> => {
      const owner = this;
      return Effect.gen(function* () {
        const deadline = (yield* Clock.currentTimeMillis) + delay;
        if (!Number.isSafeInteger(deadline)) return yield* new CoreTransactionError({ reason: "invalidValue" });
        const previous = yield* owner.#alarmStorage(() => owner.ctx.storage.getAlarm());
        // Never postpone a pre-existing notification, including an alarm which
        // reconstructed the owner. Cloudflare consumes its hint before delivery.
        if (previous === null || previous > deadline)
          yield* owner.#alarmStorage(() => owner.ctx.storage.setAlarm(deadline));
      });
    });

    readonly #notifySchemaWork = Effect.fn("ApplicationDurableObject.notifySchemaWork")((): Effect.Effect<void, CoreError> =>
      Effect.suspend(() => {
        if (this.#closing !== undefined) return Effect.void;
        this.#schemaGeneration++;
        return this.#alarmStorageLock.withPermits(1)(Effect.suspend(() => this.#closing !== undefined
          ? Effect.void : this.#ensureAlarm(this.#workload.schemaScheduler.wakeDelayMilliseconds)));
      }));
    #withSchemaWake<A>(work: Effect.Effect<A, CoreError>): Effect.Effect<A, CoreError> {
      const owner = this;
      return Effect.uninterruptibleMask(restore => Effect.gen(function* () {
        yield* owner.#notifySchemaWork();
        const outcome = yield* Effect.exit(restore(work));
        // The first hint may run before publication. Always notify after the
        // actual owner settles, including interruption or a failed proposal.
        const wake = yield* Effect.exit(owner.#notifySchemaWork());
        if (Exit.isFailure(outcome)) return yield* Effect.failCause(Exit.isFailure(wake)
          ? Cause.combine(outcome.cause, wake.cause) : outcome.cause);
        if (Exit.isFailure(wake)) return yield* Effect.failCause(wake.cause);
        return outcome.value;
      }));
    }

    readonly #finishSchemaStep = Effect.fn("ApplicationDurableObject.finishSchemaStep")((
      generation: number, hasMore: boolean,
    ): Effect.Effect<void, CoreError> => this.#alarmStorageLock.withPermits(1)(Effect.suspend(() => {
      if (this.#closing !== undefined) return Effect.void;
      return hasMore || this.#schemaGeneration !== generation
        ? this.#ensureAlarm(hasMore ? this.#workload.schemaScheduler.continuationDelayMilliseconds
          : this.#workload.schemaScheduler.wakeDelayMilliseconds)
        : this.#alarmStorage(() => this.ctx.storage.deleteAlarm());
    })));
    #runSchemaAlarm(controller: AbortController): Promise<Exit.Exit<void, unknown>> {
      if (this.#closing !== undefined) return Promise.resolve(Exit.void);
      const admitted = admitExecutorConfiguration(this.env);
      if (Result.isFailure(admitted)) return Promise.resolve(Exit.fail(new ApplicationOwnerHostError({
        reason: "resourceUnavailable", cause: admitted.failure })));
      this.#getRuntime(admitted.success.connectionString);
      const owner = this;
      // Core workers do not require ApplicationServices. In particular they must
      // progress a schema while trusted application composition waits for it.
      return Effect.runPromiseExit(Effect.gen(function* () {
        const maintenance = yield* Deferred.await(owner.#coreReady);
        if (owner.#closing !== undefined) return;
        const generation = owner.#schemaGeneration;
        const progress = yield* maintenance.useDatabase(database => database.advanceSchemaWork(owner.#workload.schemaScheduler.work));
        yield* owner.#finishSchemaStep(generation, progress.hasMore);
      }), { signal: controller.signal });
    }
    override async alarm(): Promise<void> {
      if (!this.#canonical || this.#closing !== undefined || this.#failure !== undefined) return;
      let running = this.#schemaAlarm;
      if (running === undefined) {
        const controller = new AbortController();
        running = { controller, result: Promise.resolve().then(() => this.#runSchemaAlarm(controller)) };
        this.#schemaAlarm = running;
      }
      try {
        const exit = await running.result;
        // Controlled close joins and reports any non-interruption Cause itself;
        // it must not request a platform retry which could revive this instance.
        if (Exit.isFailure(exit) && this.#closing === undefined)
          await Effect.runPromise(Effect.failCause(exit.cause));
      } finally {
        if (this.#schemaAlarm === running) this.#schemaAlarm = undefined;
      }
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
      if (this.#requests.size >= this.#workload.maxRequests)
        return Response.json({ error: "application_owner_overloaded" }, { status: 503 });
      const runtime = this.#getRuntime(admission.success.connectionString);
      const controller = new AbortController();
      const ownerReady = this.#ownerReady;
      const dispatch = Effect.gen(function* () {
        const databaseOwner = yield* Deferred.await(ownerReady);
        yield* databaseOwner.recover;
        return yield* databaseOwner.use(prepared => Effect.provideContext(prepared.dispatch(request), prepared.services));
      });
      const projectFailure = options.failureResponse;
      const invocation = runtime.runPromise(projectFailure === undefined ? dispatch : dispatch.pipe(
        Effect.catchCause(cause => Effect.sync(() => projectFailure(cause)))), {
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
      if (this.#closing !== undefined) return this.#closing;
      const alarm = this.#schemaAlarm;
      const bootstrap = this.#bootstrap;
      return this.#closing = Promise.resolve().then(async () => {
        // Install the closed flag synchronously, then cancel and join every
        // admitted invocation and the actual bounded alarm operation.
        for (const controller of this.#requests.values()) controller.abort("application-owner-closing");
        alarm?.controller.abort("application-owner-closing");
        bootstrap?.controller.abort("application-owner-closing");
        // ManagedRuntime retains its build fiber independently of its callers.
        // Start disposal now so an interruptible factory cannot hold close.
        const runtime = this.#runtime;
        const dispose = Promise.allSettled(runtime === undefined ? [] : [runtime.dispose()]);
        const databaseOwner = this.#owner;
        const coreClose = await Promise.allSettled(databaseOwner === undefined ? [] : [Effect.runPromise(databaseOwner.close)]);
        await Promise.allSettled([...this.#requests.keys()]);
        const backgroundDrain = await Promise.allSettled([
          ...(alarm === undefined ? [] : [alarm.result]), ...(bootstrap === undefined ? [] : [bootstrap.result]),
        ]);
        const alarmFailure = backgroundDrain.flatMap(result => {
          if (result.status === "rejected") return [new ApplicationOwnerHostError({ reason: "resourceUnavailable", cause: result.reason })];
          const exit = result.value;
          return Exit.isFailure(exit) && exit.cause.reasons.some(reason => !Cause.isInterruptReason(reason))
            ? [new ApplicationOwnerHostError({ reason: "resourceUnavailable", cause: exit.cause })] : [];
        });
        // Serialized after every admitted hint write and the drained step, so a
        // concurrent completion cannot re-arm after this final delete.
        const hint = await Effect.runPromiseExit(this.#alarmStorageLock.withPermits(1)(
          this.#alarmStorage(() => this.ctx.storage.deleteAlarm())));
        const failures = [...coreClose, ...await dispose].flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (Exit.isFailure(hint)) failures.push(new ApplicationOwnerHostError({ reason: "resourceUnavailable", cause: hint.cause }));
        failures.push(...alarmFailure);
        if (failures.length > 0) throw new AggregateError(failures, "Application owner cleanup failed.");
      });
    }
  };
}
