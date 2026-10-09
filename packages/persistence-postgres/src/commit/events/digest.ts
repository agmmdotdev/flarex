import { Effect, Encoding } from "effect";
import { makeLivePrivateSha256V1 } from "@flarex/analysis/internal/private-sha256-v1";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { eventError, commitEventLimits, type CommittedEvent } from "./model";
const hash = makeLivePrivateSha256V1({
  invalidBudget: () => eventError("invalidInput"), invalidBytes: () => eventError("invalidInput"), inputBytesExceeded: () => eventError("invalidInput"),
  unavailable: () => eventError("resourceFailure"), nativeRejected: cause => eventError("resourceFailure", cause),
  invalidDigestOutput: () => new Error("Invalid committed event digest"),
});
/** Ordered envelope digest includes contract, producer, payload, routing and
 * pinned subscribers. Bound the complete family before allocating its bytes. */
export const commitEventsDigest = Effect.fn("CommitEvents.digest")(function* (events: readonly CommittedEvent[],
  purpose: "publication" | "storedVerification" = "publication") {
  if (events.length > commitEventLimits.messages) return yield* Effect.fail(eventError("invalidInput"));
  // Older committed families could occupy the former 256-envelope budget.
  // Keep that read contract while bounding new publication more tightly.
  const maximumBytes = purpose === "storedVerification" && events.length <= 256
    ? 256 * commitEventLimits.bytes + 256 + 2 : commitEventLimits.totalBytes;
  const encoder = new TextEncoder();
  let bytes = 2;
  for (const [index, event] of events.entries()) {
    const encoded = encodeCanonicalJson(event, () => { throw new Error("Owned committed event lost JSON membership"); });
    bytes += encoder.encode(encoded).byteLength + (index === 0 ? 0 : 1);
    if (bytes > maximumBytes) return yield* Effect.fail(eventError("invalidInput"));
  }
  return Encoding.encodeHex(yield* hash(
    encoder.encode(encodeCanonicalJson(events, () => { throw new Error("Owned committed event lost JSON membership"); })),
    { maximumInputBytes: maximumBytes },
  ));
});
