import { createHash } from "node:crypto";
import { Cause, Clock, Effect, Exit, Scope, Schema, Semaphore } from "effect";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { compileProductLinksCoreDefinition } from "../../src/links/product-definition";
import { prepareLocalProductLinks } from "../../src/links/product-service";
import { compileVariantInventoryLinkDefinition, captureVariantInventoryLinkMetadata } from "../../src/composition/product-variant-inventory-schema";
import { compileVariantPricingLinkCoreDefinition, captureVariantPricingLinkMetadata } from "../../src/composition/product-variant-pricing-schema";
import { captureProductSalesChannelLinkMetadata } from "../../src/links/product-sales-channel-schema";
import { captureProductShippingProfileLinkMetadata } from "../../src/links/product-shipping-profile-schema";
import { prepareLinkService } from "../../src/links/service";
import { linkLogicalEventPolicy } from "../../src/links/events";
import { commerceCommandPreparation, commerceServiceCommands } from "../../src/module/commands";
import { commerceDecoder } from "../../src/value/decoder";
import { commerceError, isJsonObject, type Json, type JsonObject, logicalCommerceBatchResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand, type CommerceCommand, type CommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCoreRelationalNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import type { CoreNativeDefinition } from "../../../persistence-postgres/src/core/nativePolicy";
import type { CoreDatabase, CoreDatabaseOptions, CoreTransactionLimits, CoreError } from "../../../persistence-postgres/src/core/api";
import type { CorePersistence } from "../../../persistence-postgres/src/core/contracts";
import type { CoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import { makeCoreSchemaBundle } from "../../../persistence-postgres/src/core/schemaBundle";
import { openCoreDatabase } from "../../../persistence-postgres/src/core/database";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeHost";
import { makePreparedHostRuntime } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { defineAtomicCommerceParticipant } from "../../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { captureAtomicCommerceEvents, defineCommerceEventContract, prepareAtomicCommerceEvents, type AtomicCommerceEvents,
  type ParticipantEventSelection } from "../../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { compileCoreNativeEventDefinition } from "../../../persistence-postgres/src/commit/events/coreDefinition";
import { makeCoreCommitEventStore } from "../../../persistence-postgres/src/commit/events/coreStore";
import { CommitEventError, eventError } from "../../../persistence-postgres/src/commit/events/model";
import { makeCoreApplicationOwner, type CoreApplicationOwner } from "../../../persistence-postgres/src/core/applicationOwner";
import { makeNativeOwnerHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeOwnerHost";
import { projectCoreCommerceFailure } from "../../../persistence-postgres/src/frameworks/commerceTransaction/nativeFailure";
import { CommerceTransactionError } from "../../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { createCorePGliteFixture, createCorePostgresFixture, type CorePersistenceFixture } from "../../../persistence-postgres/test/core/fixture";
import { readCoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import type { CoreNativeFixtureInventory } from "../../../persistence-postgres/test/core/nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "../../../persistence-postgres/test/core/schemaFixture";
import { postgresUrl } from "../../../persistence-postgres/test/support/postgresHelpers";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Pair = Schema.Tuple([Id, Id, Schema.JsonObject]).pipe(Schema.mutable);
const decodeCreate = commerceDecoder(Schema.Struct({ pairs: Schema.Array(Pair).pipe(Schema.mutable).check(Schema.isMaxLength(256)),
  direct: Schema.optionalKey(Schema.Boolean) }), "invalidInput");
const decodeDismiss = commerceDecoder(Schema.Array(Schema.Tuple([Id, Id]).pipe(Schema.mutable)).pipe(Schema.mutable).check(Schema.isMaxLength(256)), "invalidInput");
const decodeSelector = commerceDecoder(Schema.JsonObject, "invalidInput");
export type CoreLinkFamily = "sales" | "shipping" | "inventory" | "pricing";
const families: readonly CoreLinkFamily[] = ["sales", "shipping", "inventory", "pricing"];
export interface CoreLinksFixtureOptions {
  readonly sharedPhysical?: CorePersistenceFixture;
  readonly instanceName?: string;
  readonly target?: Readonly<{ scopeUuid: string; epochUuid: string }>;
  readonly beforeCreateReturn?: (family: CoreLinkFamily) => Promise<void>;
  readonly transactionLimits?: Partial<CoreTransactionLimits>;
  readonly wrapPersistence?: (persistence: CorePersistence) => CorePersistence;
}
const defaultTarget = { scopeUuid: "67200000-0000-4000-8000-000000000001", epochUuid: "67200000-0000-4000-8000-000000000002" };
interface CoreLinkCommands {
  readonly prepared: Effect.Success<ReturnType<typeof prepareLinkService>>;
  readonly create: CommerceCommand; readonly dismiss: CommerceCommand; readonly restore: CommerceCommand;
  readonly list: CommerceCommand; readonly caught: CommerceCommand; readonly late: CommerceCommand;
}
export interface CoreLinksFixture {
  readonly physical: CorePersistenceFixture;
  readonly databaseOptions: CoreDatabaseOptions;
  readonly bundle: CoreSchemaBundle;
  readonly definitions: Readonly<Record<CoreLinkFamily, CoreNativeDefinition>>;
  readonly eventDefinition: CoreNativeDefinition;
  readonly productRuntime: Effect.Success<ReturnType<typeof prepareLocalProductLinks>>;
  readonly events: Effect.Success<ReturnType<typeof makeCoreCommitEventStore>>;
  readonly select: (family: CoreLinkFamily) => Readonly<{ command: CoreLinkCommands; host: CommerceHost }>;
  readonly run: <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Promise<A>;
  readonly close: () => Promise<void>;
  readonly inventory: () => Promise<CoreNativeFixtureInventory>;
  readonly data: () => Promise<Pick<CoreNativeFixtureInventory, "rows" | "revisions" | "indexes">>;
  readonly rows: (family: CoreLinkFamily, where?: Json) => Promise<readonly JsonObject[]>;
  readonly useGeneration: CoreApplicationOwner<CoreLinksGeneration, LinksBuildFailure>["use"];
  readonly recover: CoreApplicationOwner<CoreLinksGeneration, LinksBuildFailure>["recover"];
}
type LinksBuildFailure = CoreError | CommerceTransactionError;
type EventStore = Effect.Success<ReturnType<typeof makeCoreCommitEventStore>>;
export interface CoreLinksGeneration {
  readonly database: CoreDatabase;
  readonly getHost: (definition: CoreNativeDefinition) => Effect.Effect<CommerceHost, CommerceTransactionError>;
  readonly events: Effect.Effect<EventStore, CoreError | CommitEventError>;
}
const projectLinksFailure = (failure: LinksBuildFailure): CommerceTransactionError => failure instanceof CommerceTransactionError
  ? failure : projectCoreCommerceFailure(failure);
const commerceResult = <A, R>(work: Effect.Effect<A, LinksBuildFailure, R>) => work.pipe(Effect.catchCause(cause =>
  Effect.failCause(Cause.map(cause, projectLinksFailure))));

/** Only capture/projection and deliberate test fault boundaries live here.
 * The genuine Link router, service, repository and Core own every transition. */
export async function createCoreLinksFixture(driver: "pglite" | "postgres", options: CoreLinksFixtureOptions = {}): Promise<CoreLinksFixture> {
  const target = Object.freeze({ ...(options.target ?? defaultTarget) });
  const beforeCreateReturn = options.beforeCreateReturn, wrapPersistence = options.wrapPersistence;
  const transactionLimits = options.transactionLimits === undefined ? undefined : Object.freeze({ ...options.transactionLimits });
  let physical: CorePersistenceFixture;
  if (options.sharedPhysical !== undefined) {
    const shared = options.sharedPhysical;
    const instanceName = options.instanceName ?? "links-other-shop";
    const persistence = await shared.reopen(instanceName);
    physical = { ...shared, persistence, instanceName, reopen: (name = instanceName) => shared.reopen(name), close: async () => {} };
  } else if (driver === "pglite") physical = await createCorePGliteFixture(options.instanceName === undefined ? {} : { instanceName: options.instanceName });
  else {
    const provisioning = process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL;
    if (postgresUrl === null || provisioning === undefined) throw new Error("Core Links require ordinary and provisioning PostgreSQL endpoints");
    physical = await createCorePostgresFixture({ connectionString: postgresUrl, provisioningConnectionString: provisioning,
      ...(options.instanceName === undefined ? {} : { instanceName: options.instanceName }) });
  }
  const scope = await Effect.runPromise(Scope.make());
  const run = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) => Effect.runPromise(Scope.provide(scope)(work));
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    const scoped = await Promise.allSettled([Effect.runPromise(Scope.close(scope, Exit.void))]);
    const owned = await Promise.allSettled([physical.close()]);
    const failures = [...scoped, ...owned].flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length > 0) throw new AggregateError(failures, "Core Links fixture cleanup failed");
  };
  try {
    const selected = await run(Effect.gen(function* () {
      const product = yield* compileProductLinksCoreDefinition(target, { salesChannel: true, shippingProfile: true });
      const variants = yield* Effect.forEach([
        { key: "medusa.variant-inventory-link", compiled: compileVariantInventoryLinkDefinition() },
      ], item => Effect.gen(function* () {
        const native = yield* item.compiled;
        const source = yield* captureLogicalSchemaSource({ key: item.key, owner: "medusa", writeProfile: item.key,
          evidence: { provenance: native.provenance }, definition: { kind: "relational", schema: native.schema },
          bindings: native.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
            table: { namespace: "medusa", logicalName: `${native.schema.coordinate.lineageId}/${table.identity.tableId}` } })) });
        return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: native.provenance, commands: [] });
      }));
      const inventory = variants[0], pricing = yield* compileVariantPricingLinkCoreDefinition(target);
      if (inventory === undefined) return yield* Effect.die(new Error("Missing authentic Variant Link sources"));
      const definitions = { sales: product, shipping: product, inventory, pricing };
      const productRuntime = yield* prepareLocalProductLinks("product-updates");
      const services = { sales: yield* prepareLinkService(yield* captureProductSalesChannelLinkMetadata()),
        shipping: yield* prepareLinkService(yield* captureProductShippingProfileLinkMetadata()),
        inventory: yield* prepareLinkService(yield* captureVariantInventoryLinkMetadata()),
        pricing: yield* prepareLinkService(yield* captureVariantPricingLinkMetadata()) };
      const commandSets = families.map(family => {
        const prepared = services[family], factory = commerceServiceCommands(prepared.use);
        const [primary, foreign] = prepared.joiner.relationships ?? [];
        if (primary === undefined || foreign === undefined) throw new Error("Missing authentic Link endpoints");
        const prepare = commerceCommandPreparation(`CoreLinks.${family}`);
        const create = factory.write(`${family}LinkCreate`, prepare(decodeCreate), async ({ link, service, context }, input) => {
          const result = input.direct ? await service.create(input.pairs, undefined, undefined, context)
            : await link.create(input.pairs.map(([left, right, data]) => ({ [primary.serviceName]: { [primary.foreignKey]: left },
              [foreign.serviceName]: { [foreign.foreignKey]: right }, data })), context);
          await beforeCreateReturn?.(family); return result;
        });
        const dismiss = factory.write(`${family}LinkDismiss`, prepare(decodeDismiss), ({ link, context }, input) => link.dismiss(input.map(([left, right]) => ({
          [primary.serviceName]: { [primary.foreignKey]: left }, [foreign.serviceName]: { [foreign.foreignKey]: right },
        })), context));
        const restore = factory.write(`${family}LinkRestore`, prepare(decodeSelector), async ({ service, context }, input) => {
          await service.restore(input, {}, context); return null;
        });
        const list = factory.read(`${family}LinkList`, prepare(decodeSelector), ({ service, context }, input) =>
          service.listAndCount(input, { take: 256, withDeleted: true }, context));
        const caught = defineCommerceCommand(`${family}LinkCaughtFailure`, "write", Effect.fn(ctx => prepared.use(ctx, async ({ service, context }) => {
          await service.create("caught-left", "caught-right", { id: `${family}-caught` }, context);
          try { await service.create("caught-left", "conflicting-right", {}, context); } catch { /* Test caller catches the real native refusal. */ }
          return null;
        })));
        const late = defineCommerceCommand(`${family}LinkLateFailure`, "write", Effect.fn(function* (ctx, input) {
          yield* ctx.nested(create, input); return yield* ctx.refuse(commerceError("invalidInput"));
        }));
        return { family, prepared, create, dismiss, restore, list, caught, late };
      });
      const revision = createHash("sha256").update("native-core-stored-links").digest("hex");
      const contracts = commandSets.flatMap(({ prepared }) => {
        const endpoints = prepared.prepared.table.primaryKeys;
        const first = endpoints[0], second = endpoints[1];
        if (first === undefined || second === undefined) throw new Error("Incomplete native Link tuple");
        const policy = linkLogicalEventPolicy(prepared.prepared.table.name, prepared.serviceName, prepared.entityName, [first, second]);
        return ["attached", "detached"].map(action => defineCommerceEventContract({ name: `${prepared.entityName}.${action}`,
          revision, internal: true, decode: policy.capture }));
      });
      const eventPolicy: AtomicCommerceEvents = { producerRevision: revision, contracts,
        subscribers: [{ id: "native-core-stored-links", revision }], validate: events => events.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void };
      const byName = new Map(commandSets.flatMap(({ prepared }, index) => [
        [`${prepared.entityName}.attached`, contracts[index * 2]], [`${prepared.entityName}.detached`, contracts[index * 2 + 1]],
      ]));
      const eventSelection: ParticipantEventSelection = { contracts, select: (message: Json) => {
        const contract = isJsonObject(message) && typeof message.name === "string" ? byName.get(message.name) : undefined;
        return contract === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(contract);
      } };
      const preparedEvents = yield* prepareAtomicCommerceEvents(yield* Effect.fromResult(captureAtomicCommerceEvents(eventPolicy)));
      const eventDefinition = yield* compileCoreNativeEventDefinition({ ...target, policy: preparedEvents.identity });
      const bundle = yield* makeCoreSchemaBundle({ sources: [product, inventory, pricing, eventDefinition].map(definition => ({ kind: "native", definition })) });
      const databaseOptions = { schemaBundles: [bundle], schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
        now: Clock.currentTimeMillis.pipe(Effect.map(value => BigInt(Math.floor(value)) * 1_000_000n)),
        randomBytes: (length: 16 | 32) => Effect.sync(() => crypto.getRandomValues(new Uint8Array(length))), maxConcurrentSaves: 2,
        ...(transactionLimits === undefined ? {} : { transactionLimits }) };
      const persistence = wrapPersistence?.(physical.persistence) ?? physical.persistence;
      // Installation is a single initial lifecycle, outside every serving generation.
      yield* Effect.scoped(Effect.acquireUseRelease(openCoreDatabase(persistence, databaseOptions), database => Effect.gen(function* () {
        const proposal = yield* database.prepareSchema({ bundle });
        for (let step = 0; step < 512; step++) {
          const status = yield* database.schemaStatus(proposal);
          if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error(`Core Links schema ${status.state}: ${status.error}`));
          if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
            yield* database.activateSchema(proposal, { programs: [], bundle }); return;
          }
          yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
        }
        return yield* Effect.die(new Error("Core Links schema did not activate"));
      }), database => database.close()));
      const seed = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
        { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
      const profiles = new Map<CoreNativeDefinition, readonly CommerceCommand[]>();
      for (const definition of [product, inventory, pricing]) {
        const selectedCommands = commandSets.filter(command => definitions[command.family] === definition);
        profiles.set(definition, Object.freeze([...selectedCommands.flatMap(({ create, dismiss, restore, list, caught, late }) => [create, dismiss, restore, list, caught, late]),
          ...(definition === product ? productRuntime.commands : [])]));
      }
      const facadeRuntime = yield* makePreparedHostRuntime({ maximumHosts: 16, maximumPreparedBytes: 8 * 1024 * 1024 });
      const owner = yield* makeCoreApplicationOwner({ persistence, options: databaseOptions, maximumRequests: 32,
        prepare: database => Effect.gen(function* () {
          const generationScope = yield* Effect.scope;
          const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 16, maximumPreparedBytes: 8 * 1024 * 1024 })
            .pipe(Effect.mapError(cause => commerceError("resourceFailure", cause)));
          const eventBinding = yield* Effect.cached(database.bindNative({ definition: eventDefinition }));
          const events = yield* Effect.cached(eventBinding.pipe(Effect.flatMap(binding => makeCoreCommitEventStore({ database, binding }))));
          const cache = new Map<CoreNativeDefinition, Effect.Effect<CommerceHost, CommerceTransactionError>>();
          const preparation = yield* Semaphore.make(1);
          const getHost: CoreLinksGeneration["getHost"] = definition => preparation.withPermits(1)(Effect.gen(function* () {
            const existing = cache.get(definition);
            if (existing !== undefined) return existing;
            const commands = profiles.get(definition);
            if (commands === undefined) return yield* commerceError("invalidAuthority");
            const prepared = yield* Effect.cached(commerceResult(Effect.gen(function* () {
              const binding = yield* database.bindNative({ definition, commands: yield* Effect.fromResult(commerceNativeRegistrations(commands)) });
              return yield* Effect.acquireRelease(makeCommerceNativeHost({ database, binding, hostRuntime, commands,
                initialization: { stepId: `${definition.identity.sourceKey}-empty`, datasetSha256: seed.sha256Hex, expectedRowCount: 0 },
                identityAndAccessPolicy: { profile: "native-core-stored-links", source: definition.identity.sourceKey }, resources: logicalCommerceBatchResources,
                requestCallLimit: 512, requestCommandMs: 30_000, nativeLimits: { maxIdentities: 1024, maxDocumentBytes: 65_536 }, retryProvenNoncommit: true,
                events: { bundle, binding: yield* eventBinding, policy: eventPolicy, selection: eventSelection,
                  participant: defineAtomicCommerceParticipant(definition.identity.sourceKey) } }), host => host.close);
            }).pipe(Scope.provide(generationScope))));
            cache.set(definition, prepared); return prepared;
          })).pipe(Effect.flatten);
          return { database, getHost, events } satisfies CoreLinksGeneration;
        }) });
      const useGeneration: CoreLinksFixture["useGeneration"] = work => owner.recover.pipe(Effect.andThen(owner.use(work)));
      const hosts = new Map<CoreNativeDefinition, CommerceHost>();
      for (const definition of profiles.keys()) {
        const host = yield* Effect.acquireRelease(makeNativeOwnerHost({ owner, hostRuntime: facadeRuntime,
          select: generation => generation.getHost(definition), projectOwnerFailure: projectLinksFailure }), host => host.close);
        yield* host.initialize([]); hosts.set(definition, host);
      }
      const commands = Object.fromEntries(commandSets.map(command => [command.family, command]));
      const select = (family: CoreLinkFamily) => {
        const command = commands[family], host = hosts.get(definitions[family]);
        if (command === undefined || host === undefined) throw new Error("Missing admitted Core Link family");
        return { command, host };
      };
      const withEvents = <A>(work: (store: EventStore) => Effect.Effect<A, CommitEventError>) =>
        useGeneration(generation => generation.events.pipe(Effect.flatMap(work))).pipe(Effect.catchCause(cause =>
          Effect.failCause(Cause.map(cause, failure => failure instanceof CommitEventError ? failure : eventError("resourceFailure", failure)))));
      const events: EventStore = Object.freeze({ nextFamily: after => withEvents(store => store.nextFamily(after)),
        readFamily: id => withEvents(store => store.readFamily(id)), verifyFamily: id => withEvents(store => store.verifyFamily(id)),
        claimVerifiedBatch: (token, subscribers, maximum) => withEvents(store => store.claimVerifiedBatch(token, subscribers, maximum)),
        claimBatch: (id, subscribers, maximum) => withEvents(store => store.claimBatch(id, subscribers, maximum)),
        settle: (token, failure) => withEvents(store => store.settle(token, failure)) });
      return { databaseOptions, bundle, definitions, eventDefinition, productRuntime, events, select, useGeneration, recover: owner.recover };
    }));
    const businessTables = new Set(Object.values(selected.definitions).flatMap(definition => definition.tables.map(table => table.name)));
    const inventory = () => run(selected.useGeneration(generation => readCoreNativeFixtureInventory(generation.database, physical.persistence)));
    return { ...selected, physical, run, close, inventory,
      data: async () => { const captured = await inventory(); return { rows: captured.rows.filter(row => businessTables.has(row.table)),
        revisions: captured.revisions.filter(row => businessTables.has(row.table)), indexes: captured.indexes.filter(row => businessTables.has(row.table)) }; },
      rows: async (family: CoreLinkFamily, where: Json = {}) => {
        const { host, command } = selected.select(family);
        return Schema.decodeUnknownSync(Schema.Tuple([Schema.Array(Schema.JsonObject), Schema.Number]))(await run(host.read(command.list, where)))[0];
      },
    };
  } catch (cause) {
    try { await close(); } catch (cleanup) { throw new AggregateError([cause, cleanup], "Core Links fixture construction failed"); }
    throw cause;
  }
}
