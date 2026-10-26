import { createHash, randomUUID } from "node:crypto";
import { Cause, Clock, Effect, Exit, Schema } from "effect";
import { ProductModuleService, ProductCategoryService } from "@medusajs/product/services";
import { Product, ProductVariant, ProductTag, ProductCollection, ProductImage, ProductType, ProductOption, ProductOptionValue, ProductVariantProductImage } from "@medusajs/product/models";
import { buildModuleResourceEventName, CommonEvents, MedusaError, Modules } from "@medusajs/framework/utils/portable";
import type { Context, DAL, IEventBusModuleService, ModulePersistenceAdapter, ModulePersistenceMutationService } from "@medusajs/framework/types";
import { createDrizzleEventSubscriber, registerDrizzleEventSubscriber, dispatchDrizzleMutationEvent } from "@medusajs/drizzle/mutation-events";
import { prepareCommerceInternalService } from "../../../packages/medusa-adapter/src/module/persistence.ts";
import { captureCommerceInput } from "../../../packages/medusa-adapter/src/value/input.ts";
import { encodeCanonicalJson } from "../../../packages/flarex-protocol/src/json.ts";
import { CoreError, NativeCompletionFailure, NativeFailure, NativeOperationFailure } from "./errors.ts";
import { createRoot } from "./root.ts";
import type { BorrowedFrameworkRoot } from "./group-root.ts";
import type { Storage } from "./storage.ts";
import { prepareProductDefinition, type ProductDefinition } from "./medusa-definition.ts";
import { runCallback, supervise } from "./callback.ts";

const Find = Schema.Struct({ where: Schema.Struct({ id: Schema.Union([Schema.String, Schema.Array(Schema.String).check(Schema.isMaxLength(256))]) }),
  options: Schema.Struct({ populate: Schema.Array(Schema.Literals(["options", "options.values", "tags"])),
    limit: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 256 }))),
    orderBy: Schema.optionalKey(Schema.Struct({ id: Schema.Literal("ASC") })) }) });
const Replacement = Schema.Struct({ relations: Schema.Array(Schema.Literals(["options", "variants", "images", "tags", "categories"])) });
const UpdateRows = Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })).check(Schema.isLengthBetween(1, 256));
const updatedEvent = buildModuleResourceEventName({ prefix: Modules.PRODUCT, objectName: "product", action: CommonEvents.UPDATED });
const Message = Schema.Struct({ name: Schema.Literal(updatedEvent), data: Schema.Struct({ id: Schema.String }),
  metadata: Schema.Struct({ source: Schema.Literal("product"), object: Schema.Literal("product"), action: Schema.Literal("updated") }) });
const capture = (value: unknown) => Effect.fromResult(captureCommerceInput(value)).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) => capture(value).pipe(
  Effect.flatMap(input => Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" })), Effect.mapError(cause => new CoreError({ reason: "unsupported", cause })));
const prepareServices = () => ({
  product: prepareCommerceInternalService(Product), variant: prepareCommerceInternalService(ProductVariant), tag: prepareCommerceInternalService(ProductTag),
  collection: prepareCommerceInternalService(ProductCollection), image: prepareCommerceInternalService(ProductImage), type: prepareCommerceInternalService(ProductType),
  option: prepareCommerceInternalService(ProductOption), value: prepareCommerceInternalService(ProductOptionValue), assignment: prepareCommerceInternalService(ProductVariantProductImage),
});
const nativeCause = (cause: unknown): Cause.Cause<CoreError | NativeFailure> => cause instanceof NativeOperationFailure ? cause.cause
  : cause instanceof MedusaError ? Cause.fail(new NativeFailure({ cause })) : Cause.die(cause);

/** Bind native services once per command, then reuse them across their own DAL
 * calls. The manager is an opaque lifetime identity with no database methods. */
const bindProduct = (prepared: ProductDefinition, services: ReturnType<typeof prepareServices>, root: BorrowedFrameworkRoot, signal: AbortSignal) => {
  const manager = Object.freeze({}); let live = true; const pending = new Set<Promise<unknown>>();
  const run = <A>(work: Effect.Effect<A, CoreError>): Promise<A> => {
    const promise = Effect.runPromiseExit(Effect.gen(function* () {
      if (!live || signal.aborted) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      return yield* work;
    })).then(async exit => {
      if (Exit.isSuccess(exit)) return exit.value;
      await Effect.runPromise(root.poisonCause(exit.cause)); throw new NativeOperationFailure({ cause: exit.cause });
    });
    pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise;
  };
  const refuse = (): never => {
    const error = new CoreError({ reason: "unsupported" }); Effect.runSync(root.poison(error)); throw new NativeOperationFailure({ cause: Cause.fail(error) });
  };
  const contextCheck = (context?: Context) => !live || signal.aborted ? Effect.fail(new CoreError({ reason: "closed" }))
    : context === undefined || (context.transactionManager ?? context.manager) !== manager ? Effect.fail(new CoreError({ reason: "denied" })) : Effect.void;
  const repository: DAL.RepositoryService = {
    // SAFETY: Medusa's generic manager is opaque in the portable path. Its only
    // admitted value is this issued identity; no raw database capability exists.
    getFreshManager: <Manager>() => manager as Manager,
    // SAFETY: the same issued opaque manager, never a driver or transaction.
    getActiveManager: <Manager>() => manager as Manager,
    // SAFETY: native transaction callbacks borrow that same lifetime identity.
    transaction: <Manager>(task: (value: Manager) => Promise<unknown>) => task(manager as Manager),
    // SAFETY: native DAL erases Output. Capture validates the complete native
    // scalar/projection before restoring its declared framework result type.
    serialize: <Output extends object | object[]>(value: unknown) => run(Effect.gen(function* () {
      const input = yield* capture(value);
      const decoded = yield* Schema.decodeUnknownEffect(Schema.Union([Schema.JsonObject, Schema.Array(Schema.JsonObject)]))(input).pipe(Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
      // SAFETY: native erases this output generic; the closed projection above
      // is the actual JSON value produced by the admitted repository methods.
      return structuredClone(decoded) as Output;
    })),
    find: (value: unknown, context) => run(Effect.gen(function* () {
      yield* contextCheck(context); const query = yield* decode(Find, value); const ids = typeof query.where.id === "string" ? [query.where.id] : [...query.where.id];
      const rows = [];
      for (const id of [...new Set(ids)].toSorted()) {
        const document = yield* root.get(id); if (document === null) continue;
        const row = yield* prepared.toNative(document);
        rows.push({ ...row, ...(query.options.populate.includes("options") || query.options.populate.includes("options.values") ? { options: [] } : {}),
          ...(query.options.populate.includes("tags") ? { tags: [] } : {}) });
      }
      return query.options.limit === undefined ? rows : rows.slice(0, query.options.limit);
    })),
    upsertWithReplace: (value: unknown, options: unknown, context) => run(Effect.gen(function* () {
      yield* contextCheck(context); yield* decode(Replacement, options); const rows = yield* decode(UpdateRows, value); const entities = [];
      for (const input of rows) {
        const before = yield* root.get(input.id); if (before === null) return yield* Effect.fail(new CoreError({ reason: "invalid" }));
        const body = yield* root.replace({ ...before, title: input.title, updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString() });
        const native = yield* prepared.toNative(body);
        // The native scalar-update result retains the relations loaded by
        // updateProducts_ (options/tags) and its nullable to-one references.
        // Replacement capability does not request every replaceable relation.
        entities.push({ ...native, options: [], tags: [], collection: null, type: null });
      }
      return { entities, performedActions: { created: {}, updated: { Product: rows.map(row => ({ id: row.id })) }, deleted: {} } };
    })),
    findAndCount: refuse, create: refuse, update: refuse, upsert: refuse, delete: refuse, softDelete: refuse, restore: refuse,
  };
  const otherRepository: DAL.RepositoryService = { ...repository, find: refuse, upsertWithReplace: refuse };
  const persistence: ModulePersistenceAdapter = {
    name: "experimental-product", prepareModels: refuse, createConnectionLoader: refuse, createBaseRepository: refuse, createRepository: refuse,
    createEventSubscriber: createDrizzleEventSubscriber, registerEventSubscriber: registerDrizzleEventSubscriber,
    dispatchMutationEvent: (event, args, context, subscriber) => {
      // Required synchronous native adapter edge. This checks only the issued
      // lifetime identity; it cannot acquire a database or start a transaction.
      const checked = Effect.runSyncExit(contextCheck(context));
      if (Exit.isFailure(checked)) { Effect.runSync(root.poisonCause(checked.cause)); throw new NativeOperationFailure({ cause: checked.cause }); }
      return dispatchDrizzleMutationEvent(event, args, context, subscriber);
    },
  };
  const bus: IEventBusModuleService = { emit: (messages, options) => run(Effect.gen(function* () {
    yield* decode(Schema.Struct({ internal: Schema.Literal(true) }), options);
    const events = yield* decode(Schema.Array(Message), messages);
    for (const event of events) yield* root.event({ event: event.name, document: event.data.id, body: event });
  })), subscribe: refuse, unsubscribe: refuse, releaseGroupedEvents: refuse, clearGroupedEvents: refuse };
  const categoryRepository: DAL.TreeRepositoryService = { ...repository, find: refuse, findAndCount: refuse, create: refuse, delete: refuse };
  let mutations: ModulePersistenceMutationService | undefined;
  const category = new ProductCategoryService({ productCategoryRepository: categoryRepository, modulePersistenceAdapter: persistence,
    productModuleService: { interceptEntityMutationEvents: (...args) => { if (mutations === undefined) refuse(); mutations?.interceptEntityMutationEvents(...args); } } });
  const service = new ProductModuleService({ baseRepository: repository,
    // SAFETY: the actual native service explicitly tests for deepUpdate and uses
    // portable internal-service upsertWithReplace when this ORM method is absent.
    productRepository: repository as ConstructorParameters<typeof ProductModuleService>[0]["productRepository"],
    productService: services.product(repository, persistence), productVariantService: services.variant(otherRepository, persistence),
    productTagService: services.tag(otherRepository, persistence), productCategoryService: category,
    productCollectionService: services.collection(otherRepository, persistence), productImageService: services.image(otherRepository, persistence),
    productImageProductService: services.image(otherRepository, persistence), productTypeService: services.type(otherRepository, persistence),
    productOptionService: services.option(otherRepository, persistence), productOptionValueService: services.value(otherRepository, persistence),
    productVariantProductImageService: services.assignment(otherRepository, persistence), [Modules.EVENT_BUS]: bus,
  }, { scope: "internal" });
  if (!("interceptEntityMutationEvents" in service) || typeof service.interceptEntityMutationEvents !== "function") throw new Error("Missing native mutation service");
  const intercept = service.interceptEntityMutationEvents.bind(service);
  mutations = { interceptEntityMutationEvents: (...args) => intercept(...args) };
  return { service, context: { manager, transactionManager: manager }, run,
    close: async () => { live = false; const unfinished = [...pending]; const outcomes = await Promise.allSettled(unfinished);
      const errors = outcomes.flatMap(outcome => outcome.status === "rejected" ? [outcome.reason] : []);
      if (errors.length !== 0) throw new NativeOperationFailure({ cause: errors.reduce<Cause.Cause<CoreError>>((cause, error) => Cause.combine(cause,
        error instanceof NativeOperationFailure ? error.cause : Cause.die(error)), Cause.fail(new CoreError({ reason: "unsupported" }))) });
      if (unfinished.length !== 0) { const error = new CoreError({ reason: "unsupported" }); await Effect.runPromise(root.poison(error)); throw new NativeOperationFailure({ cause: Cause.fail(error) }); }
    } };
};

export const createProductHost = Effect.fn("ExperimentProduct.host")(function* (storage: Storage, scope: string) {
  const prepared = yield* prepareProductDefinition(); const services = prepareServices(); const owner = yield* Effect.scope;
  let live = true; yield* Effect.addFinalizer(() => Effect.sync(() => { live = false; }));
  const invoke = Effect.fn("ExperimentProduct.invoke")(function* (root: BorrowedFrameworkRoot, id: string,
    data: Effect.Success<ReturnType<ProductDefinition["validateUpdate"]>>) {
    if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const value = yield* runCallback(async signal => {
      const bound = bindProduct(prepared, services, root, signal);
      const result = await Promise.resolve().then(() => bound.service.updateProducts(id, structuredClone(data), bound.context))
        .then(Exit.succeed, cause => Exit.failCause(nativeCause(cause)));
      const cleanup = await bound.close().then(() => Exit.void, cause => Exit.failCause(nativeCause(cause)));
      if (Exit.isFailure(result)) throw new NativeCompletionFailure({ cause: Exit.isFailure(cleanup) ? Cause.combine(result.cause, cleanup.cause) : result.cause });
      if (Exit.isFailure(cleanup)) throw new NativeCompletionFailure({ cause: cleanup.cause });
      return result.value;
    }, cause => cause instanceof NativeCompletionFailure ? cause : new NativeCompletionFailure({ cause: Cause.die(cause) }))
      .pipe(Effect.catchTag("NativeCompletionFailure", error => Effect.failCause(error.cause)));
    return yield* prepared.decodeResult(value);
  });
  const prepareUpdate = Effect.fn("ExperimentProduct.prepareUpdate")(function* (id: string, input: unknown) {
    if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const data = yield* prepared.validateUpdate(input);
    const digest = createHash("sha256").update(encodeCanonicalJson({ operation: "product.update", definition: prepared.definition.version, id, data }, () => { throw new Error("Invalid command JSON"); })).digest("hex");
    return { digest, run: (root: BorrowedFrameworkRoot) => supervise(owner, invoke(root, id, data)) };
  });
  const update = Effect.fn("ExperimentProduct.update")(function* (request: string, id: string, input: unknown) {
    const invocation = yield* prepareUpdate(id, input); const digest = invocation.digest;
    const command = yield* storage.open(scope, request, digest, prepared.definition, randomUUID());
    if (command.status === "committed") return yield* prepared.decodeResult(command.result).pipe(Effect.mapError(cause => new CoreError({ reason: "storage", cause })));
    const root = yield* createRoot(prepared.definition, storage, command); let accepting = false;
    return yield* Effect.gen(function* () {
      const result = yield* invocation.run(root); const candidate = yield* root.freeze(); accepting = true;
      const committed = yield* storage.settle(command, candidate.changes, candidate.dependencies, result, candidate.events, candidate.predicates).pipe(Effect.catchTag("CoreError", error => {
        if (error.reason !== "storage" || error.phase !== undefined && error.phase !== "commit") { accepting = false; return Effect.fail(error); }
        return storage.resolve(scope, request, digest).pipe(Effect.catchTag("CoreError", recovery => Effect.fail(new CoreError({ reason: "uncertain", cause: { original: error, recovery } }))));
      }));
      return yield* prepared.decodeResult(committed).pipe(Effect.mapError(cause => new CoreError({ reason: "storage", cause })));
    }).pipe(Effect.ensuring(Effect.gen(function* () { yield* root.close; if (!accepting) yield* storage.abort(command); }).pipe(Effect.orDie)));
  });
  return { prepared, update: (request: string, id: string, input: unknown) => supervise(owner, update(request, id, input)),
    prepareUpdate };
});
