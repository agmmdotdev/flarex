import { Effect, Encoding } from "effect";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { eventError, commitEventLimits, type CommittedEvent } from "./model";
const hash = makeLivePrivateSha256V1({
  invalidBudget: () => eventError("invalidInput"), invalidBytes: () => eventError("invalidInput"), inputBytesExceeded: () => eventError("invalidInput"),
  unavailable: () => eventError("resourceFailure"), nativeRejected: cause => eventError("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid committed event digest"),
});
/** Ordered envelope digest includes contract, producer, payload, routing and pinned subscribers. */
export const commitEventsDigest = Effect.fn("CommitEvents.digest")((events: readonly CommittedEvent[]) => hash(
  new TextEncoder().encode(encodeCanonicalJson(events, () => { throw new Error("Owned committed event lost JSON membership"); })),
  { maximumInputBytes: commitEventLimits.messages * commitEventLimits.bytes + commitEventLimits.messages + 2 },
).pipe(Effect.map(Encoding.encodeHex)));
