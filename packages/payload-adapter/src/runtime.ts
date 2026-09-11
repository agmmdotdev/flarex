import { Effect, type Scope } from "effect";
import type { CmsCommand, CmsHost, CmsHostInput, CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { PayloadContentProfile } from "./contract";
import { makePayloadComposition } from "./composition";

export type PayloadHostInput<Failure> = Omit<CmsHostInput<Failure>, "commands" | "expectedContentIdentity">;

export interface PayloadRuntime {
  readonly commands: Readonly<{
    create: CmsCommand; update: CmsCommand; delete: CmsCommand;
    find: CmsCommand; findByID: CmsCommand; count: CmsCommand;
  }>;
  readonly bind: <Failure>(input: PayloadHostInput<Failure>) => Effect.Effect<CmsHost, CmsTransactionError>;
}

/** Each closed profile has its own scoped Payload instance and borrowed requests. */
export const makePayloadRuntime: (
  profile?: PayloadContentProfile,
) => Effect.Effect<PayloadRuntime, CmsTransactionError, Scope.Scope> =
  Effect.fn("PayloadAdapter.makeRuntime")((profile: PayloadContentProfile = "payload.scalar") =>
    makePayloadComposition(profile).pipe(Effect.map(composition => composition.runtime)));
