import { Effect, type Scope } from "effect";
import type { CmsCommand, CmsHost, CmsHostInput, CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { makePayloadComposition } from "./composition";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "./collections";

export type PayloadHostInput<Failure> = Omit<CmsHostInput<Failure>, "commands" | "expectedContentIdentity">;

export interface PayloadRuntime {
  readonly commands: Readonly<{
    create: CmsCommand; update: CmsCommand; delete: CmsCommand;
    find: CmsCommand; findByID: CmsCommand; count: CmsCommand;
  }>;
  readonly bind: <Failure>(input: PayloadHostInput<Failure>) => Effect.Effect<CmsHost, CmsTransactionError>;
}

/** Each checked configuration has its own scoped Payload instance and borrowed requests. */
export const makePayloadRuntime: (
  compiled: CompiledPayloadCollections,
) => Effect.Effect<PayloadRuntime, CmsTransactionError, Scope.Scope> =
  Effect.fn("PayloadAdapter.makeRuntime")(compiled => requireCompiledPayloadCollections(compiled).pipe(
    Effect.andThen(makePayloadComposition(compiled)), Effect.map(composition => composition.runtime)));
