import { Effect } from "effect";
import { encodeCanonicalJson, isJsonObject, type Json } from "flarex-protocol/json";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import type { CoreNativeBinding, CoreNativeRootBindingMetadata } from "../../core/api";
import { inspectPrivateParticipantReadSelection, PrivateReadAccessError,
  type PrivateParticipantReadSelection, type PrivateReadPrincipal } from "../journal/privateReadAccess";
import { boundedRequestRootIdentity, type BoundedRequestLifetime } from "./boundedRequestLifetime";

/** Bind the existing private read selection to the actual Core-issued protected
 * contract and one current native child. The supplied native callback continues
 * to own framework visibility and executes under the same root lifetime. */
export const bindNativeParticipantReadSelection = Effect.fn("PrivateReadAccess.bindNative")(function* <Failure>(
  access: PrivateParticipantReadSelection,
  input: Readonly<{ root: CoreNativeRootBindingMetadata; binding: CoreNativeBinding; commandName: string; principal: PrivateReadPrincipal;
    lifetime: BoundedRequestLifetime<Failure>; invoke: (method: string, args: Json) => Effect.Effect<Json, Failure> }>,
  refuse: (failure: PrivateReadAccessError) => Failure,
) {
  const selected = inspectPrivateParticipantReadSelection(access);
  const lifetimeRoot = boundedRequestRootIdentity(input.lifetime);
  const participant = input.root.participants.find(candidate => candidate.binding === input.binding);
  const contract = input.root.contract?.targetRead;
  const invalid = () => refuse(new PrivateReadAccessError({ reason: "invalidAuthority" }));
  if (selected === undefined || lifetimeRoot === undefined || input.lifetime.isClosing() || participant === undefined
    || contract === undefined || !isJsonObject(contract) || encodeCanonicalJson(contract, issue => {
      throw new Error(`Core-issued native read contract invariant: ${issue.reason}`);
    }) !== selected.canonicalJson) return yield* Effect.fail(invalid());
  const selection = selected.selection;
  if (selection.principal.scopeId !== input.principal.scopeId || selection.principal.principalDigest !== input.principal.principalDigest
    || projectScopeIdUuidV1(selection.principal.scopeId).scopeUuid !== participant.definition.identity.scopeUuid
    || selection.sourceKey !== participant.definition.identity.sourceKey || selection.participant !== participant.definition.identity.sourceKey
    || selection.nativeProfileRevision !== participant.definition.identity.definitionHash
    || !participant.commands.some(command => command.name === input.commandName && command.mode === "read"))
    return yield* Effect.fail(invalid());
  const ids = selection.ids === "native" ? undefined : new Set(selection.ids);
  return Effect.fn("PrivateReadAccess.invokeNative")(function* (method: string, args: Json) {
    yield* input.lifetime.checkpoint(input.lifetime.context);
    if (boundedRequestRootIdentity(input.lifetime) !== lifetimeRoot || input.lifetime.isClosing() || method !== selection.method)
      return yield* Effect.fail(invalid());
    if (ids !== undefined && (!isJsonObject(args) || typeof args.id !== "string" || !ids.has(args.id)))
      return yield* Effect.fail(refuse(new PrivateReadAccessError({ reason: "unavailable" })));
    return yield* input.invoke(method, args);
  });
});
