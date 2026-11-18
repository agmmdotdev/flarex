import { Effect, Schema, type Scope } from "effect";
import type { Json } from "flarex-protocol/json";
import type { CoreError, CoreNativeBinding, CoreNativeRootBindingMetadata,
  CoreNativeRootOperation } from "@flarex/persistence-postgres/internal/core";
import type { PrivateReadPrincipal } from "@flarex/persistence-postgres/internal/session-journal";
import type { CmsRequestLifetime } from "@flarex/persistence-postgres/internal/cms-execution";
import { cmsError, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadNativeReferenceRead, type PayloadNativeInstrumentation } from "@flarex/payload-adapter/internal/runtime";
import type { CompiledPayloadCollections } from "@flarex/payload-adapter/internal/collections";

const decodeRead = Schema.decodeUnknownEffect(Schema.Struct({ collection: Schema.NonEmptyString, id: Schema.NonEmptyString }),
  { onExcessProperty: "error" });
interface NativeSourceReadInput {
  readonly operation: CoreNativeRootOperation; readonly root: CoreNativeRootBindingMetadata;
  readonly binding: CoreNativeBinding; readonly lifetime: CmsRequestLifetime; readonly transactionId: string;
  readonly principal: PrivateReadPrincipal; readonly collection: string;
  /** Backend-selected IDs belong in the outer root's captured policy contract.
   * Save/retention/enumeration grants cannot supply this separate selection. */
  readonly ids: readonly string[];
}
interface NativeSourceReadConsumer { readonly read: (args: Json) => Effect.Effect<Json, CmsTransactionError> }

/** A confined explicit source read over the existing root. The genuine Payload
 * access closure owns disclosure; no target read or broad find is installed. */
export const makePrivatePayloadNativeReferenceReadConsumer: (compiled: CompiledPayloadCollections, input: NativeSourceReadInput, instrumentation?: PayloadNativeInstrumentation) =>
  Effect.Effect<NativeSourceReadConsumer, CoreError | CmsTransactionError, Scope.Scope> =
  Effect.fn("PrivatePayloadReferenceReadConsumer.makeNative")(function* (compiled, input, instrumentation) {
    const participant = input.root.participants.find(candidate => candidate.binding === input.binding);
    if (participant === undefined) return yield* cmsError("invalidAuthority");
    const native = yield* makePayloadNativeReferenceRead(compiled, { operations: yield* input.operation.native(input.binding),
      native: participant, lifetime: input.lifetime, transactionId: input.transactionId, principal: input.principal,
      collection: input.collection, ids: input.ids }, instrumentation);
    const read = Effect.fn("PrivatePayloadReferenceReadConsumer.read")(function* (args: Json) {
      const selected = yield* decodeRead(args).pipe(Effect.mapError(cause => cmsError("invalidInput", cause)));
      if (selected.collection !== input.collection) return yield* cmsError("invalidAuthority");
      return yield* native.read(selected.id);
    }, Effect.catchCause(cause => Effect.fromResult(input.lifetime.recordFailure(input.lifetime.context, cause)).pipe(
      Effect.flatMap(recorded => Effect.failCause(recorded)))));
    return Object.freeze({ read });
  });
