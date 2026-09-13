import { Effect } from "effect";
import { cmsError, registerPayloadContentProfiles } from "@flarex/persistence-postgres/internal/cms-adapter";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "./collections";

/** Binding verification for one compiler-owned configuration; no storage authority. */
export const makePayloadContentProfiles = Effect.fn("PayloadAdapter.makeContentProfiles")(function* (compiled: CompiledPayloadCollections) {
  yield* requireCompiledPayloadCollections(compiled);
  return yield* registerPayloadContentProfiles([{ relationCount: compiled.configuration.profile === "payload.scalar" ? 0 : 1, identity: compiled.contentIdentity }]).pipe(
    Effect.mapError(cause => cmsError("unsupportedProfile", cause)));
});
