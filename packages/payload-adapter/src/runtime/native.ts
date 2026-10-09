import { BasePayload, type CollectionConfig } from "payload";
import { Effect, Exit, Scope } from "effect";
import { cmsError, type CmsHost, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadDatabaseAdapter } from "../adapter";
import { makePayloadOperations, type PayloadOperationInstrumentation } from "../operations";
import { makePayloadInputs } from "../inputs";
import { buildPayloadConfiguration } from "../configuration";
import type { CompiledPayloadCollections } from "../collections";
import { makePayloadCollectionRuntime } from "../collectionRuntime";

type RuntimeConfiguration = Pick<CompiledPayloadCollections, "configuration" | "contentIdentity" | "createNativeCollections">;

/** Source-private test seam. Neither ordinary runtime arguments nor package exports expose it. */
interface PayloadNativeInstrumentation extends PayloadOperationInstrumentation {
  readonly hooks: NonNullable<CollectionConfig["hooks"]>;
  readonly access?: NonNullable<CollectionConfig["access"]>;
}

/** Multiple profiles coexist; Scope owns each instance, not a singleton Context. */
export const makePayloadNative = Effect.fn("PayloadAdapter.makeNative")(function* (
  compiled: RuntimeConfiguration, instrumentation?: PayloadNativeInstrumentation,
) {
  const profile = compiled.configuration.profile;
  const parentScope = yield* Effect.scope;
  const scope = yield* Scope.fork(parentScope, "sequential");
  const collections = compiled.configuration.tables.map(makePayloadCollectionRuntime);
  const bridge = makePayloadDatabaseAdapter(profile, collections);
  const inputs = makePayloadInputs(profile, collections);
  let live = true;
  const native = compiled.createNativeCollections();
  if (instrumentation !== undefined) for (const collection of native) {
    collection.hooks = instrumentation.hooks;
    if (instrumentation.access !== undefined) collection.access = instrumentation.access;
  }
  const config = yield* buildPayloadConfiguration(native, bridge);
  const slugs = config.collections.map(collection => collection.slug).toSorted();
  const expected = [...collections.map(collection => collection.collectionSlug), "payload-migrations", "payload-preferences", "users"].toSorted();
  if (slugs.join() !== expected.join() || config.globals.length !== 0 ||
    config.collections.some(collection => collection.lockDocuments !== false)) {
    return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized internal inventory"));
  }
  // Acquire before init so partially initialized instances also receive cleanup.
  const payload = yield* Scope.provide(scope)(Effect.acquireRelease(Effect.sync(() => new BasePayload()), instance =>
    Effect.sync(() => { live = false; }).pipe(Effect.andThen(Effect.tryPromise({
      try: () => instance.destroy(), catch: cause => cmsError("resourceFailure", cause),
    })), Effect.orDie)));
  yield* Effect.tryPromise({ try: () => payload.init({ config, disableOnInit: true }), catch: cause => cmsError("unsupportedProfile", cause) });
  const makeCommands = (observations?: PayloadOperationInstrumentation) =>
    makePayloadOperations(payload, bridge, profile, inputs, () => live, observations);
  const commands = makeCommands(instrumentation);
  // The native parent and the outer attempt both own this child. Closing
  // either owner drains borrowed CMS contexts before destroying the native.
  const makeAttemptOwnership = Effect.fn("PayloadAdapter.makeAttemptOwnership")(function* () {
    if (!live) return yield* Effect.fail(cmsError("closed"));
    const attemptScope = yield* Effect.scope;
    // Scope.close itself does not join an in-progress close. Both owners must
    // await the same complete drain before the native resource can release.
    const retained = yield* Scope.fork(scope, "sequential");
    const child = yield* Scope.make("sequential");
    const drain = yield* Effect.cached(Scope.close(child, Exit.void).pipe(Effect.uninterruptible));
    yield* Scope.addFinalizer(retained, drain);
    const close = Effect.gen(function* () {
      const drained = yield* Effect.exit(drain);
      const retired = yield* Effect.exit(Scope.close(retained, Exit.void));
      // This private ownership Scope contains only the same cached drain and
      // Scope.fork's link removal. Retiring it can replay that drain failure;
      // preserve its original full outcome once after unlinking ownership.
      return yield* (Exit.isFailure(drained) ? drained : retired);
    }).pipe(Effect.uninterruptible);
    yield* Scope.addFinalizer(attemptScope, close);
    return { scope: child, close };
  }, Effect.uninterruptible);
  // Both bindings retain a host in this native instance's exact lifetime.
  const retainHost = Effect.fn("PayloadAdapter.retainHost")(function* <Host extends Pick<CmsHost, "close">>(
    acquire: Effect.Effect<Host, CmsTransactionError>,
  ): Effect.fn.Return<Host, CmsTransactionError> {
    if (!live) return yield* Effect.fail(cmsError("closed"));
    const host = yield* Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const acquired = yield* restore(acquire);
      yield* Scope.addFinalizer(scope, acquired.close);
      return acquired;
    }));
    if (!live) return yield* Effect.fail(cmsError("closed"));
    return host;
  });
  return { commands, makeCommands, makeAttemptOwnership, payload, scope, isLive: () => live, retainHost, contentIdentity: compiled.contentIdentity };
});

export type PayloadNative = Effect.Success<ReturnType<typeof makePayloadNative>>;
