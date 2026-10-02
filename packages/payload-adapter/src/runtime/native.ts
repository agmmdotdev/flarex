import { BasePayload, type CollectionConfig } from "payload";
import { Effect, Scope } from "effect";
import { cmsError, type CmsHost, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadDatabaseAdapter } from "../adapter";
import { makePayloadOperations } from "../operations";
import { buildPayloadConfiguration } from "../configuration";
import type { CompiledPayloadCollections } from "../collections";
import { makePayloadCollectionRuntime } from "../collectionRuntime";

type RuntimeConfiguration = Pick<CompiledPayloadCollections, "configuration" | "contentIdentity" | "createNativeCollections">;

/** Source-private test seam. Neither ordinary runtime arguments nor package exports expose it. */
interface PayloadNativeInstrumentation {
  readonly hooks: NonNullable<CollectionConfig["hooks"]>;
  readonly onExecute: () => void;
  readonly onCollection: (collection: string) => void;
  readonly access?: NonNullable<CollectionConfig["access"]>;
  readonly requestContext?: Readonly<Record<string, unknown>>;
}

/** Multiple profiles coexist; Scope owns each instance, not a singleton Context. */
export const makePayloadNative = Effect.fn("PayloadAdapter.makeNative")(function* (
  compiled: RuntimeConfiguration, instrumentation?: PayloadNativeInstrumentation,
) {
  const profile = compiled.configuration.profile;
  const scope = yield* Effect.scope;
  const collections = compiled.configuration.tables.map(makePayloadCollectionRuntime);
  const bridge = makePayloadDatabaseAdapter(profile, collections, instrumentation?.onCollection);
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
  const payload = yield* Effect.acquireRelease(Effect.sync(() => new BasePayload()), instance =>
    Effect.sync(() => { live = false; }).pipe(Effect.andThen(Effect.tryPromise({
      try: () => instance.destroy(), catch: cause => cmsError("resourceFailure", cause),
    })), Effect.orDie));
  yield* Effect.tryPromise({ try: () => payload.init({ config, disableOnInit: true }), catch: cause => cmsError("unsupportedProfile", cause) });
  const commands = makePayloadOperations(payload, bridge, profile, collections, () => live,
    instrumentation?.onExecute, instrumentation?.requestContext);
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
  return { commands, payload, isLive: () => live, retainHost, contentIdentity: compiled.contentIdentity };
});

export type PayloadNative = Effect.Success<ReturnType<typeof makePayloadNative>>;
