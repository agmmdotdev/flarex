import { BasePayload, type CollectionConfig } from "payload";
import { Effect } from "effect";
import { cmsError, makeCmsHost, type CmsHost, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadDatabaseAdapter } from "./adapter";
import { type PayloadContentProfile } from "./contract";
import { makePayloadOperations } from "./operations";
import { payloadContentIdentity, payloadPostsCollection } from "./profile";
import type { PayloadHostInput, PayloadRuntime } from "./runtime";
import { buildPayloadConfiguration } from "./configuration";

/** Source-private test seam. Neither ordinary runtime arguments nor package exports expose it. */
interface ConformanceHooks {
  readonly hooks: NonNullable<CollectionConfig["hooks"]>;
  readonly onExecute: () => void;
  readonly onCollection: (collection: string) => void;
}

/** Multiple profiles coexist; Scope owns each instance, not a singleton Context. */
export const makePayloadComposition = Effect.fn("PayloadAdapter.compose")(function* (
  profile: PayloadContentProfile, conformance?: ConformanceHooks,
) {
  const bridge = makePayloadDatabaseAdapter(profile, conformance?.onCollection);
  let live = true;
  const posts = payloadPostsCollection(profile);
  if (conformance !== undefined) posts.hooks = conformance.hooks;
  const config = yield* buildPayloadConfiguration([posts], bridge);
  const slugs = config.collections.map(collection => collection.slug).toSorted();
  if (slugs.join() !== "payload-migrations,payload-preferences,posts,users" || config.globals.length !== 0 ||
    config.collections.some(collection => collection.lockDocuments !== false)) {
    return yield* Effect.fail(cmsError("unsupportedProfile", "sanitized internal inventory"));
  }
  // Acquire before init so partially initialized instances also receive cleanup.
  const payload = yield* Effect.acquireRelease(Effect.sync(() => new BasePayload()), instance =>
    Effect.sync(() => { live = false; }).pipe(Effect.andThen(Effect.tryPromise({
      try: () => instance.destroy(), catch: cause => cmsError("resourceFailure", cause),
    })), Effect.orDie));
  yield* Effect.tryPromise({ try: () => payload.init({ config, disableOnInit: true }), catch: cause => cmsError("unsupportedProfile", cause) });
  const commands = makePayloadOperations(payload, bridge, profile, () => live, conformance?.onExecute);
  const bind = Effect.fn("PayloadAdapter.bind")(function* <Failure>(input: PayloadHostInput<Failure>): Effect.fn.Return<CmsHost, CmsTransactionError> {
    if (!live) return yield* Effect.fail(cmsError("closed"));
    const host = yield* makeCmsHost({ ...input, commands: Object.values(commands), expectedContentIdentity: payloadContentIdentity(profile) });
    return {
      newRequestKey: host.newRequestKey,
      run: (key, command, args) => Effect.suspend(() => live ? host.run(key, command, args) : Effect.fail(cmsError("closed"))),
      read: (command, args) => Effect.suspend(() => live ? host.read(command, args) : Effect.fail(cmsError("closed"))),
    };
  });
  return { runtime: { commands, bind } satisfies PayloadRuntime, payload };
});
