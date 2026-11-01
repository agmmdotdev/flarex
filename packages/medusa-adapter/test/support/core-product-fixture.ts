import { createHash } from "node:crypto";
import { Cause, Clock, Effect, Exit, Scope, Semaphore } from "effect";
import { CommonEvents, Modules } from "@medusajs/framework/utils/portable";
import type { CoreDatabase, CoreDatabaseOptions, CoreNativeBinding, CoreProgramDefinition, CoreError, CoreNativeLimits } from "../../../persistence-postgres/src/core/api";
import type { CoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import { openCoreDatabase } from "../../../persistence-postgres/src/core/database";
import type { CorePersistence } from "../../../persistence-postgres/src/core/contracts";
import { makeCoreSchemaBundle, type CoreSchemaBundle, type CoreSchemaSource, type CoreNativeBindingSelection } from "../../../persistence-postgres/src/core/schemaBundle";
import type { PreparedLogicalSchemaCandidate } from "@flarex/analysis/internal/logical-schema-candidate";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";
import { makePreparedHostRuntime, type PreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeHost";
import { getCommerceCommand, type CommerceCommand, type CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { commerceError, isJsonObject, logicalCommerceBatchResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceEvents, defineCommerceDerivedIdEventContract, defineCommerceEventContract,
  prepareAtomicCommerceEvents, type AtomicCommerceEvents, type ParticipantEventSelection } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { compileCoreNativeEventDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { makeCoreCommitEventStore } from "../../../persistence-postgres/src/commit/events/coreStore";
import { compileProductCoreDefinition } from "../../src/modules/product/schema";
import { makeLocalProductCommands } from "../../src/modules/product/service";
import type { CommerceInitialization } from "../../../persistence-postgres/src/frameworks/commerceTransaction/initializationContract";
import type { CommerceResources } from "../../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { CommerceTransactionError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";

import { makeCoreApplicationOwner, type CoreApplicationOwner } from "../../../persistence-postgres/src/core/applicationOwner";
import { makeNativeOwnerHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeOwnerHost";
import { projectCoreCommerceFailure } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeFailure";
import { eventError, CommitEventError } from "../../../persistence-postgres/src/commit/events/model";

export interface CoreProductReadHostOptions {
  readonly commands?: readonly CommerceCommand[];
  readonly resources?: CommerceResources;
  readonly nativeLimits?: CoreNativeLimits;
  readonly initialization?: CommerceInitialization;
}
export interface CoreProductHostOptions extends CoreProductReadHostOptions {
  readonly readOnly?: true;
  readonly identityAndAccessPolicy?: Parameters<typeof makeCommerceNativeHost>[0]["identityAndAccessPolicy"];
  readonly retryProvenNoncommit?: true;
}
interface CoreProductHostProfile {
  readonly commands: readonly CommerceCommand[];
  readonly resources: CommerceResources;
  readonly nativeLimits: CoreNativeLimits;
  readonly initialization: CommerceInitialization;
  readonly identityAndAccessPolicy: Parameters<typeof makeCommerceNativeHost>[0]["identityAndAccessPolicy"];
  readonly readOnly?: true;
  readonly retryProvenNoncommit?: true;
}
type ProductBuildFailure = CoreError | CommerceTransactionError;
type EventStore = Effect.Success<ReturnType<typeof makeCoreCommitEventStore>>;
export interface CoreProductGeneration<Extension = undefined> {
  readonly database: CoreDatabase;
  readonly hostRuntime: PreparedHostRuntime;
  readonly extension: Extension | undefined;
  readonly getHost: (profile: CoreProductHostProfile) => Effect.Effect<CommerceHost, CommerceTransactionError>;
  readonly events: Effect.Effect<EventStore, CoreError | CommitEventError>;
}
export interface CoreProductFixture<Extension = undefined> {
  readonly databaseOptions: CoreDatabaseOptions;
  readonly physical: CorePersistenceFixture;
  readonly definition: CoreNativeDefinition;
  readonly eventDefinition: CoreNativeDefinition;
  readonly bundle: CoreSchemaBundle;
  readonly bindingSelectionBundles: readonly CoreSchemaBundle[];
  readonly runtime: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
  readonly commands: readonly CommerceCommand[];
  readonly host: CommerceHost;
  readonly initialization: CommerceInitialization;
  readonly events: EventStore;
  readonly eventPolicy: AtomicCommerceEvents;
  readonly eventSelection: ParticipantEventSelection;
  readonly useGeneration: CoreApplicationOwner<CoreProductGeneration<Extension>, ProductBuildFailure>["use"];
  readonly recover: CoreApplicationOwner<CoreProductGeneration<Extension>, ProductBuildFailure>["recover"];
  readonly openHost: (options?: CoreProductHostOptions) => Effect.Effect<CommerceHost, CommerceTransactionError, Scope.Scope>;
  readonly openReadHost: (options?: CoreProductReadHostOptions) => Effect.Effect<Pick<CommerceHost, "read" | "close">,
    CommerceTransactionError, Scope.Scope>;
  readonly run: <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly inventory: () => Promise<Effect.Success<ReturnType<typeof readCoreNativeFixtureInventory>>>;
  readonly close: () => Promise<void>;
}
export const coreProductFixtureTarget = Object.freeze({ scopeUuid: "66000000-0000-4000-8000-000000000001",
  epochUuid: "66000000-0000-4000-8000-000000000002" });
export interface CoreProductFixtureOptions<Extension = undefined> {
  readonly physical?: CorePersistenceFixture;
  readonly target?: Readonly<{ scopeUuid: string; epochUuid: string }>;
  readonly sources?: readonly CoreSchemaSource[];
  readonly candidate?: PreparedLogicalSchemaCandidate;
  readonly programs?: readonly CoreProgramDefinition[];
  readonly bindingSelectionTargets?: readonly (readonly CoreNativeBindingSelection[])[];
  readonly wrapPersistence?: (persistence: CorePersistence) => CorePersistence;
  /** Builds only generation-local lazy factories, never installation or selection restoration. */
  readonly prepareGeneration?: (database: CoreDatabase) => Effect.Effect<Extension, ProductBuildFailure, Scope.Scope>;
}
const projectProductFailure = (failure: ProductBuildFailure) => failure instanceof CommerceTransactionError
  ? failure : projectCoreCommerceFailure(failure);
const commerceResult = <A, R>(work: Effect.Effect<A, ProductBuildFailure, R>) => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectProductFailure))));

/** Initial installation is separate from the portable owner's reconstruction.
 * Stable facades borrow fresh lazy services from its one composite generation. */
export async function createCoreProductFixture<Extension = undefined>(driver: "pglite" | "postgres",
  options: CoreProductFixtureOptions<Extension> = {}): Promise<CoreProductFixture<Extension>> {
  const suppliedPhysical = options.physical, wrapPersistence = options.wrapPersistence, prepareExtension = options.prepareGeneration;
  const selectedTarget = options.target ?? coreProductFixtureTarget;
  const target = Object.freeze({ scopeUuid: selectedTarget.scopeUuid, epochUuid: selectedTarget.epochUuid });
  const sources = Object.freeze((options.sources ?? []).map(source => Object.freeze({ ...source })));
  const candidate = options.candidate;
  const programs = Object.freeze([...(options.programs ?? [])]);
  const bindingSelectionTargets = Object.freeze((options.bindingSelectionTargets ?? [])
    .map(target => Object.freeze(target.map(selection => Object.freeze({ ...selection })))));
  let physical: CorePersistenceFixture;
  if (suppliedPhysical !== undefined) physical = suppliedPhysical;
  else if (driver === "pglite") physical = await createCorePGliteFixture();
  else {
    const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (postgresUrl === null || provisioning === undefined) throw new Error("Native Product needs ordinary and provisioning PostgreSQL endpoints");
    physical = await createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning });
  }
  const scope = await Effect.runPromise(Scope.make());
  const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    const scoped = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
    const resources = await Promise.allSettled([physical.close()]);
    const failures = [...scoped, ...resources].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length !== 0) throw new AggregateError(failures, "Native Product fixture cleanup failed");
  };
  try {
    const selected = await run(Effect.gen(function* () {
      const runtime = yield* makeLocalProductCommands();
      const commands = Object.freeze(Object.values(runtime.commands));
      const definition = yield* compileProductCoreDefinition(target);
      const metadata = runtime.metadata;
      const revision = createHash("sha256").update("native-product-logical-suite").digest("hex");
      const names = [...new Set(metadata.entities.flatMap(entity => [entity.createdEvent, entity.updatedEvent, entity.deletedEvent, entity.restoredEvent]))];
      const contracts = yield* Effect.forEach(names, name => name === metadata.product.updatedEvent
        ? Effect.fromResult(defineCommerceDerivedIdEventContract({ name, revision, internal: true,
          metadata: { source: Modules.PRODUCT, object: metadata.product.eventObject, action: CommonEvents.UPDATED } }))
        : Effect.succeed(defineCommerceEventContract({ name, revision, internal: true, decode: runtime.logicalPolicy.capture })));
      const derivedContract = contracts[names.indexOf(metadata.product.updatedEvent)];
      const productTable = definition.tables.find(table => table.localName === "product");
      if (derivedContract === undefined || productTable === undefined)
        return yield* Effect.die(new Error("Missing authentic Product derived-event source or contract"));
      const byName = new Map(names.map((name, index) => [name, contracts[index]]));
      const eventPolicy: AtomicCommerceEvents = { producerRevision: revision, contracts, derivedIdValidation: "capturedOnly",
        subscribers: [{ id: "native-product-logical-suite", revision }], validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void };
      const eventSelection: ParticipantEventSelection = { contracts, select: message => {
        const contract = isJsonObject(message) && typeof message.name === "string" ? byName.get(message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
      } };
      const preparedEvents = yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(captureAtomicCommerceEvents(eventPolicy)));
      const eventDefinition = yield* compileCoreNativeEventDefinition({ ...target, policy: preparedEvents.identity });
      const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }, { kind: "native", definition: eventDefinition }, ...sources],
        ...(candidate === undefined ? {} : { candidate }) });
      const bindingSelectionBundles = Object.freeze(yield* Effect.forEach(bindingSelectionTargets, nativeBindings =>
        makeCoreSchemaBundle({ sources: bundle.sources, nativeBindings, ...(candidate === undefined ? {} : { candidate }) })));
      const databaseOptions: CoreDatabaseOptions = { schemaBundles: [bundle, ...bindingSelectionBundles], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
        randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2 };
      const persistence = wrapPersistence?.(physical.persistence) ?? physical.persistence;
      // This is installation of a fresh owned test instance, not recovery.
      yield* Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, databaseOptions), database => Effect.gen(function* () {
        const proposal = yield* database.prepareSchema({ bundle });
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Native Product schema failed: " + status.error));
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
            yield* database.activateSchema(proposal, { programs, bundle }); return;
          }
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        return yield* Effect.die(new Error("Native Product schema exceeded its fixture work allowance"));
      }), database => database.close()));
      const seed = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
        { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
      const initialization = Object.freeze({ stepId: "product-empty", datasetSha256: seed.sha256Hex, expectedRowCount: 0 });
      const resources = Object.freeze({ ...logicalCommerceBatchResources, eventMessages: 2048 });
      const facadeRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 });
      const owner = yield* makeCoreApplicationOwner({ persistence, options: databaseOptions, maximumRequests: 32,
        prepare: database => Effect.gen(function* () {
          const generationScope = yield* Effect.scope;
          const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 32, maximumPreparedBytes: 8 * 1024 * 1024 })
            .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
          const extension = prepareExtension === undefined ? undefined : yield* prepareExtension(database);
          const eventBinding = yield* Effect.cached(database.bindNative({ definition: eventDefinition }));
          const events = yield* Effect.cached(eventBinding.pipe(Effect.flatMap(binding => makeCoreCommitEventStore({ database, binding }))));
          // A failed or revoked profile stays failed for its issued selection.
          // openHost/openReadHost create a fresh profile and recheck current authority.
          const profiles = new WeakMap<CoreProductHostProfile, Effect.Effect<CommerceHost, CommerceTransactionError>>();
          // Only cache installation is serialized; actual profile preparation
          // and request execution retain their existing owners and limits.
          const preparation = yield* Semaphore.make(1);
          const getHost = (profile: CoreProductHostProfile) => preparation.withPermits(1)(Effect.gen(function* () {
            const existing = profiles.get(profile);
            if (existing !== undefined) return existing;
            const prepared = yield* Effect.cached(commerceResult(Effect.gen(function* () {
              const binding = yield* database.bindNative({ definition,
                commands: yield* Effect.fromResult(commerceNativeRegistrations(profile.commands, profile.readOnly === true ? { readOnly: true } : undefined)),
                ...(profile.readOnly === true ? { protectedMetadata: true } : {}) });
              // This is a new admitted profile. Its event child must carry the
              // same current schema selection as the newly issued Product binding.
              const selectedEvents = profile.readOnly === true ? undefined : { bundle,
                binding: yield* database.bindNative({ definition: eventDefinition }),
                policy: eventPolicy, selection: eventSelection, derivedIdEvent: { contract: derivedContract, sourceTable: productTable.name },
                participant: defineAtomicCommerceParticipant("product") };
              return yield* Effect.acquireRelease(makeCommerceNativeHost({ database, binding, hostRuntime, commands: profile.commands,
                initialization: profile.initialization, identityAndAccessPolicy: profile.identityAndAccessPolicy,
                resources: profile.resources, requestCallLimit: 2048, requestCommandMs: 30_000, nativeLimits: profile.nativeLimits,
                ...(profile.readOnly === true ? { readOnly: true } : {}),
                ...(profile.retryProvenNoncommit === undefined ? {} : { retryProvenNoncommit: profile.retryProvenNoncommit }),
                ...(selectedEvents === undefined ? {} : { events: selectedEvents }) }), host => host.close);
            }).pipe(Scope.provide(generationScope))));
            profiles.set(profile, prepared);
            return prepared;
          })).pipe(Effect.flatten);
          return { database, hostRuntime, extension, getHost, events } satisfies CoreProductGeneration<Extension>;
        }) });
      const useGeneration: CoreProductFixture<Extension>["useGeneration"] = work => owner.recover.pipe(Effect.andThen(owner.use(work)));
      const profile = (input: CoreProductHostOptions = {}): CoreProductHostProfile => Object.freeze({
        commands: Object.freeze([...(input.commands ?? commands)]), resources: Object.freeze({ ...(input.resources ?? resources) }),
        nativeLimits: Object.freeze({ ...(input.nativeLimits ?? { maxIdentities: 2048, maxDocumentBytes: 65_536 }) }),
        initialization: Object.freeze({ ...(input.initialization ?? initialization) }),
        identityAndAccessPolicy: input.identityAndAccessPolicy ?? { profile: input.readOnly === true ? "native-product-managed-read" : "native-product-authored-checks" },
        ...(input.readOnly === true ? { readOnly: true } : {}),
        ...(input.retryProvenNoncommit === undefined ? {} : { retryProvenNoncommit: input.retryProvenNoncommit }),
      });
      const stableHost = (selected: CoreProductHostProfile) => makeNativeOwnerHost({ owner, hostRuntime: facadeRuntime,
        select: generation => generation.getHost(selected), projectOwnerFailure: projectProductFailure });
      const host = yield* stableHost(profile({ identityAndAccessPolicy: { profile: "native-product-logical-suite" }, retryProvenNoncommit: true }));
      yield* host.initialize([]);
      const openHost = Effect.fn("CoreProductFixture.openHost")(function* (input: CoreProductHostOptions = {}) {
        const selected = profile(input);
        yield* commerceResult(useGeneration(generation => generation.getHost(selected).pipe(Effect.asVoid)));
        return yield* stableHost(selected);
      });
      const openReadHost = Effect.fn("CoreProductFixture.openReadHost")(function* (input: CoreProductReadHostOptions = {}) {
        const selectedCommands = input.commands ?? commands.filter(command => getCommerceCommand(command)?.mode === "read");
        const selected = yield* openHost({ ...input, commands: selectedCommands, readOnly: true });
        return Object.freeze({ read: selected.read, close: selected.close });
      });
      const withEvents = <A>(work: (store: EventStore) => Effect.Effect<A, CommitEventError>) =>
        useGeneration(generation => generation.events.pipe(Effect.flatMap(work))).pipe(Effect.catchCause(cause =>
          Effect.failCause(Cause.map(cause, failure => failure instanceof CommitEventError ? failure : eventError("resourceFailure", failure)))));
      const events: EventStore = Object.freeze({ nextFamily: after => withEvents(store => store.nextFamily(after)),
        readFamily: id => withEvents(store => store.readFamily(id)), verifyFamily: id => withEvents(store => store.verifyFamily(id)),
        claimVerifiedBatch: (token, subscribers, maximum) => withEvents(store => store.claimVerifiedBatch(token, subscribers, maximum)),
        claimBatch: (id, subscribers, maximum) => withEvents(store => store.claimBatch(id, subscribers, maximum)),
        settle: (token, failure) => withEvents(store => store.settle(token, failure)) });
      return { databaseOptions, definition, eventDefinition, bundle, bindingSelectionBundles, runtime, commands,
        host, initialization, events, eventPolicy, eventSelection, openHost, openReadHost, useGeneration, recover: owner.recover };
    }));
    return { ...selected, physical, run,
      inventory: () => run(selected.useGeneration(generation => readCoreNativeFixtureInventory(generation.database, physical.persistence))), close };
  } catch (cause) {
    try { await close(); }
    catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Native Product fixture construction failed"); }
    throw cause;
  }
}
