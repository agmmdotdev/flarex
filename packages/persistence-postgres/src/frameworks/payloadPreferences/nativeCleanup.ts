import { Cause, Effect, Option } from "effect";
import { verifyApplicationWritePolicies } from "@flarex/analysis/internal/application-write-policy";
import type { CoreDatabase, CoreError, CoreNativeBinding, CoreNativeOperations, CoreNativePendingDelete,
  CoreNativeRootBinding } from "../../core/api";
import type { CoreSchemaBundle } from "../../core/schemaBundle";
import type { CmsRequestLifetime } from "../cmsTransaction/lifetime";
import { cmsError, cmsLimits, type CmsTransactionError } from "../cmsTransaction/model";
import { projectCoreCmsFailure } from "../cmsTransaction/nativeFailure";
import { makePayloadPreferenceCleanupRecorder } from "./cleanup";
import { makePayloadPreferenceNativeDefinition, payloadPreferenceCleanupCommand } from "./nativeSource";

declare const cleanupBrand: unique symbol;
/** Installed lifecycle proof, held only by trusted CMS construction. */
export interface PayloadPreferenceNativeCleanup { readonly [cleanupBrand]: true }
interface CleanupState {
  readonly database: CoreDatabase;
  readonly contentBinding: CoreNativeBinding;
  readonly preferencesBinding: CoreNativeBinding;
  readonly root: CoreNativeRootBinding;
  readonly tableName: string;
  readonly collections: readonly Readonly<{ tableName: string; collectionSlug: string }>[];
}
const cleanups = new WeakMap<object, CleanupState>();
const project = <A>(work: Effect.Effect<A, CoreError>): Effect.Effect<A, CmsTransactionError> => work.pipe(
  Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCmsFailure))));

/** Authentication requires the active schema and every enabled native index;
 * neither an epoch nor a structural token stands in for installed storage. */
export const makePayloadPreferenceNativeCleanup = Effect.fn("PayloadPreferences.makeNativeCleanup")(function* (input: Readonly<{
  database: CoreDatabase; bundle: CoreSchemaBundle; contentBinding: CoreNativeBinding; preferencesBinding: CoreNativeBinding;
}>) {
  const { database, bundle, contentBinding, preferencesBinding } = input;
  const content = yield* project(database.readNativeBinding(contentBinding));
  const preferences = yield* project(database.readNativeBinding(preferencesBinding));
  const source = content.definition.source;
  if (source.owner !== "payload" || source.definition.kind !== "documents") return yield* Effect.fail(cmsError("invalidAuthority"));
  const expected = yield* makePayloadPreferenceNativeDefinition(content.definition.identity).pipe(
    Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const table = expected.tables[0];
  if (table === undefined || preferences.definition.metadata !== expected.metadata || preferences.schemaId !== content.schemaId
    || preferences.authorityEpoch !== content.authorityEpoch
    || !preferences.commands.some(command => command.name === payloadPreferenceCleanupCommand && command.mode === "write"))
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const verified = yield* verifyApplicationWritePolicies(source.evidence, source.definition.tables.map(entry => entry.logicalName))
    .pipe(Effect.mapError(cause => cmsError("invalidAuthority", cause)));
  const collections = verified.policies.configuration.tables.map(entry => Object.freeze({
    tableName: entry.logicalTableName, collectionSlug: entry.collectionSlug,
  }));
  const limits = Object.freeze({ maxIdentities: cmsLimits.identities, maxDocumentBytes: cmsLimits.documentBytes });
  const root = yield* project(database.bindNativeRoot({ bundle,
    contract: { name: "payload.native-preference-cleanup", version: 1 },
    participants: [{ binding: contentBinding, commands: content.commands.map(command => command.name), limits },
      { binding: preferencesBinding, commands: [payloadPreferenceCleanupCommand], limits }],
    maxFinalUserDocuments: cmsLimits.identities }));
  yield* project(database.readNativeRootBinding(root));
  // SAFETY: the exact inert token is registered with its installed native root.
  const token = Object.freeze({}) as PayloadPreferenceNativeCleanup;
  cleanups.set(token, Object.freeze({ database, contentBinding, preferencesBinding, root,
    tableName: table.name, collections: Object.freeze(collections) }));
  return token;
});

/** No callback receives this state or either underlying binding. */
export const requirePayloadPreferenceNativeCleanup = Effect.fn("PayloadPreferences.requireNativeCleanup")(function* (
  token: PayloadPreferenceNativeCleanup, database: CoreDatabase, contentBinding: CoreNativeBinding,
) {
  const state = cleanups.get(token);
  if (state === undefined || state.database !== database || state.contentBinding !== contentBinding)
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const metadata = yield* project(database.readNativeRootBinding(state.root));
  return Object.freeze({ ...state, metadata });
});

/** The existing exact-selector recorder receives only Core-issued deletion
 * evidence. Internal preference CRUD stays inside this model owner. */
export function makeNativePayloadPreferenceCleanup(state: CleanupState, lifetime: CmsRequestLifetime,
  content: CoreNativeOperations, preferences: CoreNativeOperations) {
  const pending = new Map<string, Readonly<{ tableName: string; proof: CoreNativePendingDelete }>>();
  const requireOpen = requirePayloadPreferenceNativeCleanupForState(state);
  const recorder = makePayloadPreferenceCleanupRecorder(lifetime, { available: true,
    collections: state.collections.map(collection => collection.collectionSlug), requireOpen,
    requireDeletion: Effect.fn("PayloadPreferences.requireNativeDeletion")(function* (id: string) {
      for (const collection of state.collections) {
        const normalized = yield* project(content.normalizeId(collection.tableName, id));
        if (Option.isNone(normalized)) continue;
        const proof = yield* project(content.pendingDelete(collection.tableName, normalized.value));
        pending.set(normalized.value, Object.freeze({ tableName: collection.tableName, proof }));
        return Object.freeze({ documentId: normalized.value, collectionSlug: collection.collectionSlug });
      }
      return yield* Effect.fail(cmsError("invalidAuthority"));
    }),
  });
  const apply = Effect.fn("PayloadPreferences.applyNativeCleanup")(function* () {
    const intents = yield* recorder.close;
    let identities = 0;
    for (const intent of intents) {
      const deletion = pending.get(intent.documentId);
      if (deletion === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
      yield* project(content.assertPendingDelete(deletion.tableName, intent.documentId, deletion.proof));
      const selected = yield* project(preferences.find(state.tableName, { key: intent.key }));
      identities += selected.length;
      if (identities > cmsLimits.identities) return yield* Effect.fail(cmsError("limitExceeded"));
      for (const record of selected) {
        if (typeof record._id !== "string") return yield* Effect.fail(cmsError("storedCorruption"));
        yield* lifetime.fromResult(lifetime.charge(record._id.length * 4 + 128));
        yield* project(preferences.delete(record._id));
      }
    }
  });
  return Object.freeze({ cleanup: recorder.cleanup, apply });
}

const requirePayloadPreferenceNativeCleanupForState = Effect.fn("PayloadPreferences.requireNativeCleanupState")(function* (state: CleanupState) {
  yield* project(state.database.readNativeRootBinding(state.root));
});
