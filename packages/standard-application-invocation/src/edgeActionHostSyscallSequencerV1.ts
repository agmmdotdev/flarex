import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Data } from "effect";

export type EdgeActionHostSyscallKindV1 = "callback" | "outbound";

export class EdgeActionHostSyscallSequencerV1Error extends Data.TaggedError(
  "EdgeActionHostSyscallSequencerV1Error",
)<{ readonly reason: "invalidLimit" | "resourceExceeded" }> {}

export interface EdgeActionHostSyscallSequencerV1 {
  readonly next: (kind: EdgeActionHostSyscallKindV1) => bigint;
  readonly current: () => bigint;
}

export function makeEdgeActionHostSyscallSequencerV1(
  maximumSyscalls: number,
): EdgeActionHostSyscallSequencerV1 {
  if (!isPositiveSafeInteger(maximumSyscalls)) {
    throw new EdgeActionHostSyscallSequencerV1Error({
      reason: "invalidLimit",
    });
  }
  let ordinal = 0n;
  const maximum = BigInt(maximumSyscalls);
  return Object.freeze({
    next: (_kind: EdgeActionHostSyscallKindV1) => {
      const next = ordinal + 1n;
      if (next > maximum) {
        throw new EdgeActionHostSyscallSequencerV1Error({
          reason: "resourceExceeded",
        });
      }
      ordinal = next;
      return next;
    },
    current: () => ordinal,
  });
}
