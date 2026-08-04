import {
  makeLivePrivateSha256V1,
  makePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
  type PrivateSha256V1Foreign,
} from "@flarex/analysis/internal/private-sha256-v1";
import { Effect } from "effect";

import {
  StandardApplicationTaskSha256InputV1Error,
  StandardApplicationTaskSha256InvariantV1Defect,
  StandardApplicationTaskSha256ResourceV1Error,
  type StandardApplicationTaskSha256V1Error,
} from "./Errors.js";

export type StandardApplicationTaskSha256V1 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, StandardApplicationTaskSha256V1Error>;

const nativeCauses = new WeakMap<
  StandardApplicationTaskSha256ResourceV1Error,
  DOMException
>();

export function standardApplicationTaskSha256NativeCauseV1(
  error: StandardApplicationTaskSha256ResourceV1Error,
): DOMException | undefined {
  return nativeCauses.get(error);
}

export function makeStandardApplicationTaskSha256V1(
  foreign: PrivateSha256V1Foreign,
): StandardApplicationTaskSha256V1 {
  return adapt(makePrivateSha256V1(foreign, policy));
}

export function makeLiveStandardApplicationTaskSha256V1():
  StandardApplicationTaskSha256V1 {
  return adapt(makeLivePrivateSha256V1(policy));
}

function adapt(
  sha256: StandardApplicationTaskSha256V1,
): StandardApplicationTaskSha256V1 {
  return Effect.fn("StandardApplicationTask.sha256V1")(
    (input: unknown, budget: unknown) => sha256(input, budget),
  );
}

const policy: PrivateSha256V1ErrorPolicy<
  StandardApplicationTaskSha256V1Error
> = {
  invalidBudget: () =>
    new StandardApplicationTaskSha256InputV1Error({
      reason: "invalidBudget",
    }),
  invalidBytes: () =>
    new StandardApplicationTaskSha256InputV1Error({
      reason: "invalidBytes",
    }),
  inputBytesExceeded: (observed, maximum) =>
    new StandardApplicationTaskSha256InputV1Error({
      reason: "inputBytesExceeded",
      observed,
      maximum,
    }),
  unavailable: () =>
    new StandardApplicationTaskSha256ResourceV1Error({
      reason: "unavailable",
    }),
  nativeRejected: (cause) => {
    const error = new StandardApplicationTaskSha256ResourceV1Error({
      reason: "nativeRejected",
    });
    nativeCauses.set(error, cause);
    return error;
  },
  invalidDigestOutput: (observedByteLength) =>
    new StandardApplicationTaskSha256InvariantV1Defect({
      observedByteLength,
    }),
};
