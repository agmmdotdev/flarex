import type { Effect } from "effect";

// Reduced from the contextual generic stage in preparedHostRuntime.ts. This is
// a compiler input witness, never a replacement implementation of that owner.
type Stage = <A>(construction: Effect.Effect<A>) => () => A | undefined;

export const stage: Stage = construction => {
  let captured: { readonly value: Effect.Success<typeof construction> } | undefined;
  return () => captured?.value;
};
