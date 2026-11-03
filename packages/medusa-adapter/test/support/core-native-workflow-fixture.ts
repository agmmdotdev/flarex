import { randomUUID } from "node:crypto";
import { Cause, Clock, Effect, Exit, Result, Scope, Semaphore } from "effect";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError, CommerceTransactionError, logicalCommerceBatchResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CoreDatabase, CoreDatabaseOptions, CoreError, CoreProgramDefinition } from "../../../persistence-postgres/src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../../persistence-postgres/src/core/contracts";
import { coreNativeRelationalRows, type CoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { openCoreDatabase } from "../../../persistence-postgres/src/core/database";
import { makeCoreApplicationOwner, type CoreApplicationOwner } from "../../../persistence-postgres/src/core/applicationOwner";
import { makeCoreSchemaBundle, type CoreSchemaBundle, type CoreSchemaSource } from "../../../persistence-postgres/src/core/schemaBundle";
import { coreNativeRelationalRow } from "../../../persistence-postgres/src/core/nativeRelationalQuery";
import { makePreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeHost";
import type { CommerceCommand, CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeNativeOwnerHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeOwnerHost";
import type { CommerceInitialization } from "../../../persistence-postgres/src/frameworks/commerceTransaction/initializationContract";
import { projectCoreCommerceFailure } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeFailure";
import { captureAtomicCommerceNativeHostProfile, type AtomicCommerceNativeHost, type AtomicCommerceNativeHostProfile } from "../../../persistence-postgres/src/frameworks/atomicCommerce/nativeHost";
import { makeAtomicCommerceNativeOwnerHost } from "../../../persistence-postgres/src/frameworks/atomicCommerce/nativeOwnerHost";
import { defineAtomicCommerceNativeSource, type AtomicCommerceNativeSource } from "../../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { makeCoreCommitEventStore } from "../../../persistence-postgres/src/commit/events/coreStore";
import { CommitEventError, eventError, type CommittedEvent } from "../../../persistence-postgres/src/commit/events/model";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";
import type { AtomicWorkflowExecution } from "../../src/workflow/host";

type WorkflowFailure = CoreError | CommerceTransactionError;
type EventStore = Effect.Success<ReturnType<typeof makeCoreCommitEventStore>>;
export interface CoreNativeWorkflowSource {
  readonly name: string;
  readonly definition: CoreNativeDefinition;
  readonly initializationStepId?: string;
  /** Real admitted commands used only by the source's trusted initializer host. */
  readonly initialCommands: readonly CommerceCommand[];
  readonly rows: readonly Readonly<{ table: string; row: JsonObject }>[];
}
export interface CoreNativeWorkflowFixtureOptions {
  readonly sources: readonly CoreNativeWorkflowSource[];
  readonly eventDefinition?: CoreNativeDefinition;
  readonly extraSources?: readonly CoreSchemaSource[];
  readonly programs?: readonly CoreProgramDefinition[];
  readonly physical?: CorePersistenceFixture;
  readonly wrapPersistence?: (persistence: CorePersistence) => CorePersistence;
  readonly identityAndAccessPolicy?: JsonObject;
  readonly maximumRequests?: number;
}
interface SourceSelection {
  readonly source: AtomicCommerceNativeSource;
  readonly definition: CoreNativeDefinition;
  readonly initialization: CommerceInitialization;
}
interface WorkflowGeneration {
  readonly database: CoreDatabase;
  readonly getHost: (profile: AtomicCommerceNativeHostProfile) => Effect.Effect<AtomicCommerceNativeHost, CommerceTransactionError>;
  readonly getReadHost: (profile: NativeReadProfile) => Effect.Effect<CommerceHost, CommerceTransactionError>;
  readonly events: Effect.Effect<EventStore, CoreError | CommitEventError> | undefined;
}
interface NativeReadProfile { readonly name: string; readonly commands: readonly CommerceCommand[] }
export interface CoreNativeWorkflowFixture {
  readonly physical: CorePersistenceFixture;
  readonly bundle: CoreSchemaBundle;
  readonly databaseOptions: CoreDatabaseOptions;
  readonly sources: readonly SourceSelection[];
  readonly eventDefinition: CoreNativeDefinition | undefined;
  readonly execution: AtomicWorkflowExecution;
  readonly source: (name: string) => AtomicCommerceNativeSource;
  readonly openReadHost: (sourceName: string, commands: readonly CommerceCommand[]) =>
    Effect.Effect<Pick<CommerceHost, "read" | "close">, CommerceTransactionError>;
  readonly useGeneration: CoreApplicationOwner<WorkflowGeneration, WorkflowFailure>["use"];
  readonly recover: CoreApplicationOwner<WorkflowGeneration, WorkflowFailure>["recover"];
  readonly run: <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly inventory: () => Promise<Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>>;
  readonly snapshot: () => Promise<CoreNativeWorkflowSnapshot>;
  readonly loseNextNativeRootAcknowledgement: () => CoreNativeAcknowledgementFault;
  readonly readRows: (sourceName?: string, ids?: readonly string[]) => Promise<readonly JsonObject[]>;
  readonly close: () => Promise<void>;
}
export interface CoreNativeAcknowledgementFault {
  readonly armed: boolean;
  readonly failures: number;
  readonly evidence: Readonly<{ timestamp: bigint; inventory: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>> }> | undefined;
}
export interface CoreNativeWorkflowSnapshot {
  readonly rows: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>["rows"];
  readonly revisions: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>["revisions"];
  readonly indexes: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>["indexes"];
  readonly events: readonly Readonly<{ familyId: string; ordinal: number; timestamp: bigint; envelope: CommittedEvent }>[];
  readonly deliveries: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>["rows"];
  readonly families: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>["rows"];
  readonly outcomes: Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>["outcomes"];
}
const projectFailure = (failure: WorkflowFailure) => failure instanceof CommerceTransactionError
  ? failure : projectCoreCommerceFailure(failure);
const commerce = <A, R>(work: Effect.Effect<A, WorkflowFailure, R>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, projectFailure))));

/** One real shared installation and app owner. This fixture only assembles and
 * observes production owners; it implements no workflow/constraint/receipt logic. */
export async function createCoreNativeWorkflowFixture(driver: "pglite" | "postgres",
  input: CoreNativeWorkflowFixtureOptions): Promise<CoreNativeWorkflowFixture> {
  const configured = Object.freeze(input.sources.map(source => Object.freeze({ ...source,
    initialCommands: Object.freeze([...source.initialCommands]), rows: Object.freeze([...source.rows]) })));
  if (configured.length === 0 || new Set(configured.map(source => source.name)).size !== configured.length)
    throw new Error("Expected distinct native fixture sources");
  const initializationRows = configured.map(source => {
    const only = source.definition.tables.length === 1 ? source.definition.tables[0] : undefined;
    if (only === undefined) return source.rows;
    if (source.rows.some(row => row.table !== (only.localName ?? only.name))) throw new Error("Unexpected single-source seed table");
    return source.rows.map(row => row.row);
  });
  let physical: CorePersistenceFixture;
  if (input.physical !== undefined) physical = input.physical;
  else if (driver === "pglite") physical = await createCorePGliteFixture();
  else {
    const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (postgresUrl === null || provisioning === undefined) throw new Error("Native workflows require ordinary and provisioning PostgreSQL endpoints");
    physical = await createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning });
  }
  const eventDefinition = input.eventDefinition;
  const programs = Object.freeze([...(input.programs ?? [])]);
  const scope = await Effect.runPromise(Scope.make());
  let observer: CoreDatabase | undefined;
  let acknowledgement: { armed: boolean; failures: number; evidence: CoreNativeAcknowledgementFault["evidence"] } | undefined;
  const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const scoped = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
    const resources = await Promise.allSettled([physical.close()]);
    const failures = [...scoped, ...resources].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length !== 0) throw new AggregateError(failures, "Native workflow fixture cleanup failed");
  };
  try {
    const prepared = await run(Effect.gen(function* () {
      const bundle = yield* makeCoreSchemaBundle({ sources: [
        ...configured.map(source => ({ kind: "native" as const, definition: source.definition })),
        ...(eventDefinition === undefined ? [] : [{ kind: "native" as const, definition: eventDefinition }]),
        ...(input.extraSources ?? []),
      ] });
      const databaseOptions: CoreDatabaseOptions = { schemaBundles: [bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
        randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2 };
      const basePersistence = input.wrapPersistence?.(physical.persistence) ?? physical.persistence;
      const persistence: CorePersistence = { ...basePersistence, write: (lease, batch) => basePersistence.write(lease, batch).pipe(Effect.andThen(Effect.gen(function* () {
        const fault = acknowledgement;
        if (fault === undefined || !fault.armed || observer === undefined || batch.documents.length === 0) return;
        const timestamp = batch.documents.reduce((latest, document) => document.ts > latest ? document.ts : latest, 0n);
        // Read only genuine durable evidence at the successful write timestamp.
        // A pending claim must not consume the final-outcome ACK fault.
        const inventory = yield* readCoreNativeFixtureInventory(observer, physical.persistence, timestamp)
          .pipe(Effect.mapError(cause => new CorePersistenceError({ reason: "unavailable", cause })));
        if (!inventory.outcomes.some(outcome => outcome.timestamp === timestamp && outcome.value.kind === "nativeRoot" && outcome.value.state === "committed")) return;
        fault.armed = false; fault.failures++; fault.evidence = { timestamp, inventory };
        return yield* new CorePersistenceError({ reason: "uncertainWrite", cause: "Lost the acknowledgement of the actual committed native workflow root" });
      }))) };
      const sources: SourceSelection[] = [];
      for (const [index, source] of configured.entries()) {
        const seedRows = initializationRows[index];
        if (seedRows === undefined) return yield* Effect.die(new Error("Missing captured source initialization rows"));
        const captured = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: seedRows }, 1_048_576,
          { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
        const token = yield* Effect.fromResult(defineAtomicCommerceNativeSource(source.name, source.definition));
        sources.push(Object.freeze({ source: token, definition: source.definition,
          initialization: Object.freeze({ stepId: source.initializationStepId ?? `${source.name}-initial`,
            datasetSha256: captured.sha256Hex, expectedRowCount: source.rows.length }) }));
      }
      // Fresh installation/seeding is deliberately outside generation recovery.
      yield* Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, databaseOptions), database => Effect.gen(function* () {
        const proposal = yield* database.prepareSchema({ bundle });
        let ready = false;
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Native workflow schema failed: " + status.error));
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
            yield* database.activateSchema(proposal, { programs, bundle }); ready = true; break;
          }
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        if (!ready) return yield* Effect.die(new Error("Native workflow schema exceeded fixture work allowance"));
        const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
        for (const [index, configuredSource] of configured.entries()) {
          const selection = sources[index];
          const seedRows = initializationRows[index];
          if (selection === undefined || seedRows === undefined) return yield* Effect.die(new Error("Missing native initializer source"));
          const binding = yield* database.bindNative({ definition: selection.definition,
            commands: yield* Effect.fromResult(commerceNativeRegistrations(configuredSource.initialCommands)) });
          yield* Effect.acquireUseRelease(makeCommerceNativeHost({ database, binding, hostRuntime,
            commands: configuredSource.initialCommands, initialization: selection.initialization,
            identityAndAccessPolicy: { profile: "native-workflow-initialization", source: configuredSource.name },
            resources: logicalCommerceBatchResources, nativeLimits: { maxIdentities: 2048, maxDocumentBytes: 65_536 } }),
          host => host.initialize(seedRows), host => host.close);
        }
      }), database => database.close()));
      const facadeRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      const owner = yield* makeCoreApplicationOwner({ persistence, options: databaseOptions, maximumRequests: input.maximumRequests ?? 32,
        prepare: database => Effect.gen(function* () {
          observer = database;
          const generationScope = yield* Effect.scope;
          const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 })
            .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
          const cache = new WeakMap<AtomicCommerceNativeHostProfile, Effect.Effect<AtomicCommerceNativeHost, CommerceTransactionError>>();
          const readCache = new WeakMap<NativeReadProfile, Effect.Effect<CommerceHost, CommerceTransactionError>>();
          const preparation = yield* Semaphore.make(1);
          const eventBinding = eventDefinition === undefined ? undefined : yield* Effect.cached(database.bindNative({ definition: eventDefinition }));
          const events = eventBinding === undefined ? undefined : yield* Effect.cached(eventBinding.pipe(Effect.flatMap(binding => makeCoreCommitEventStore({ database, binding }))));
          const getHost: WorkflowGeneration["getHost"] = profile => preparation.withPermits(1)(Effect.gen(function* () {
            const existing = cache.get(profile);
            if (existing !== undefined) return existing;
            const selected = yield* Effect.cached(commerce(Effect.gen(function* () {
              return yield* Effect.acquireRelease(profile.make({ database, hostRuntime }), host => host.close);
            }).pipe(Scope.provide(generationScope))));
            cache.set(profile, selected); return selected;
          })).pipe(Effect.flatten);
          const getReadHost: WorkflowGeneration["getReadHost"] = profile => preparation.withPermits(1)(Effect.gen(function* () {
            const existing = readCache.get(profile);
            if (existing !== undefined) return existing;
            const index = configured.findIndex(source => source.name === profile.name), selectedSource = sources[index];
            if (selectedSource === undefined) return yield* commerceError("invalidAuthority");
            const selected = yield* Effect.cached(commerce(Effect.gen(function* () {
              const binding = yield* database.bindNative({ definition: selectedSource.definition,
                commands: yield* Effect.fromResult(commerceNativeRegistrations(profile.commands, { readOnly: true })) });
              return yield* Effect.acquireRelease(makeCommerceNativeHost({ database, binding, hostRuntime,
                commands: profile.commands, initialization: selectedSource.initialization, readOnly: true,
                identityAndAccessPolicy: { profile: "native-workflow-observation", source: profile.name },
              }), host => host.close);
            }).pipe(Scope.provide(generationScope))));
            readCache.set(profile, selected); return selected;
          })).pipe(Effect.flatten);
          return { database, getHost, getReadHost, events } satisfies WorkflowGeneration;
        }) });
      const useGeneration: CoreNativeWorkflowFixture["useGeneration"] = work => owner.recover.pipe(Effect.andThen(owner.use(work)));
      const execution: AtomicWorkflowExecution = { identityAndAccessPolicy: input.identityAndAccessPolicy ?? { profile: "native-atomic-workflow-fixture" },
        prepare: Effect.fn("CoreNativeWorkflowFixture.prepare")(function* (composition) {
          const profile = captureAtomicCommerceNativeHostProfile({ ...composition, bundle, sources,
            ...(eventDefinition === undefined ? {} : { eventStorage: { definition: eventDefinition } }) });
          return yield* makeAtomicCommerceNativeOwnerHost({ owner, hostRuntime: facadeRuntime,
            select: generation => generation.getHost(profile), projectOwnerFailure: projectFailure }).pipe(Scope.provide(scope));
        }) };
      const openReadHost: CoreNativeWorkflowFixture["openReadHost"] = (name, commands) => {
        const profile = Object.freeze({ name, commands: Object.freeze([...commands]) });
        return Effect.fn("CoreNativeWorkflowFixture.openReadHost")(function* () {
          const selected = yield* makeNativeOwnerHost({ owner, hostRuntime: facadeRuntime,
            select: generation => generation.getReadHost(profile), projectOwnerFailure: projectFailure }).pipe(Scope.provide(scope));
          return Object.freeze({ read: selected.read, close: selected.close });
        })();
      };
      return { bundle, databaseOptions, sources: Object.freeze(sources), owner, useGeneration, execution, openReadHost };
    }));
    const inventory = () => run(prepared.useGeneration(generation => readCoreNativeFixtureInventory(generation.database, physical.persistence)));
    const businessDeclarations = new Map(configured.flatMap(source => source.definition.tables.map(table =>
      [table.name, coreNativeRelationalRows(source.definition, table.name)?.table] as const)));
    const businessTables = new Set(businessDeclarations.keys());
    const snapshot = async (): Promise<CoreNativeWorkflowSnapshot> => {
      const captured = await inventory();
      const familyTable = eventDefinition?.tables.find(table => table.privateEvent?.role === "family")?.name;
      const envelopeTable = eventDefinition?.tables.find(table => table.privateEvent?.role === "envelope")?.name;
      const deliveryTable = eventDefinition?.tables.find(table => table.privateEvent?.role === "delivery")?.name;
      const familyIds = captured.rows.filter(row => row.table === familyTable).map(row => {
        if (typeof row.value.id !== "string") throw new Error("Missing actual Core event family identity");
        return row.value.id;
      }).toSorted();
      const events = await run(prepared.useGeneration(generation => Effect.gen(function* () {
        if (generation.events === undefined) return [];
        const store = yield* generation.events;
        const output: CoreNativeWorkflowSnapshot["events"][number][] = [];
        // Verify only families present in the captured Core snapshot. Their
        // immutable bodies remain event-owner checked; concurrent later families
        // cannot be mixed into this business/publication observation.
        for (const id of familyIds) {
          const family = yield* store.readFamily(id);
          for (const [ordinal, envelope] of family.events.entries()) {
            const stored = captured.rows.find(row => row.table === envelopeTable && row.value.family_id === id && row.value.ordinal === ordinal);
            if (stored === undefined) return yield* Effect.die(new Error("Missing event envelope from the captured Core snapshot"));
            output.push({ familyId: family.id, ordinal, timestamp: stored.timestamp, envelope });
          }
        }
        return output;
      })).pipe(Effect.catchCause(cause => Effect.failCause(Cause.map(cause, failure =>
        failure instanceof CommitEventError ? failure : eventError("resourceFailure", failure))))));
      return { rows: captured.rows.filter(row => businessTables.has(row.table)),
        revisions: captured.revisions.filter(row => businessTables.has(row.table)), indexes: captured.indexes.filter(row => businessTables.has(row.table)),
        events: events.toSorted((left, right) => left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : left.ordinal - right.ordinal),
        families: captured.rows.filter(row => row.table === familyTable).toSorted((left, right) => left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0),
        deliveries: captured.rows.filter(row => row.table === deliveryTable).toSorted((left, right) => left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1
          : Number(left.value.ordinal) - Number(right.value.ordinal) || String(left.value.subscriber_id).localeCompare(String(right.value.subscriber_id))),
        outcomes: captured.outcomes.filter(outcome => outcome.value.state === "committed") };
    };
    return { ...prepared, physical, eventDefinition, run, inventory, snapshot, recover: prepared.owner.recover,
      loseNextNativeRootAcknowledgement: () => {
        if (acknowledgement?.armed === true) throw new Error("A native root acknowledgement fault is already armed");
        acknowledgement = { armed: true, failures: 0, evidence: undefined };
        return acknowledgement;
      },
      source: name => {
        const selected = configured.findIndex(source => source.name === name), source = prepared.sources[selected];
        if (source === undefined) throw new Error("Unknown native fixture source: " + name);
        return source.source;
      },
      readRows: async (sourceName, ids) => {
        const selectedSource = sourceName === undefined ? undefined : configured.find(source => source.name === sourceName);
        if (sourceName !== undefined && selectedSource === undefined) throw new Error("Unknown native fixture source: " + sourceName);
        const selectedTables = selectedSource === undefined ? businessTables : new Set(selectedSource.definition.tables.map(table => table.name));
        const rows = (await inventory()).rows.filter(row => selectedTables.has(row.table));
        return rows.map(entry => {
          const declaration = businessDeclarations.get(entry.table);
          const fields = declaration?.keys.find(key => key.kind === "primary")?.columns;
          const field = fields?.length === 1 ? fields[0]?.columnId : undefined;
          if (ids !== undefined && field === undefined) throw new Error("Native fixture ID selection requires a declared scalar row key");
          const row = structuredClone(Result.getOrThrow(coreNativeRelationalRow(entry.value)));
          const key = field === undefined ? entry.value._id : row[field];
          if (ids !== undefined && typeof key !== "string") throw new Error("Native fixture ID selection requires a stored text row key");
          return { row, key };
        }).filter(entry => ids === undefined || typeof entry.key === "string" && ids.includes(entry.key))
          .toSorted((left, right) => String(left.key).localeCompare(String(right.key))).map(entry => entry.row);
      }, close };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Native workflow fixture construction failed"); }
    throw cause;
  }
}

/** Share only the owned physical fixture; each consumer gets a separate instance. */
export async function shareCoreNativeWorkflowPhysical(physical: CorePersistenceFixture): Promise<CorePersistenceFixture> {
  const instanceName = `native-workflow-${randomUUID()}`;
  return Object.freeze({ ...physical, instanceName, persistence: await physical.reopen(instanceName), close: async () => {} });
}
