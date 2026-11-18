import {
  makeLivePrivateSha256V1,
  makePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
  type PrivateSha256V1Foreign,
} from "@flarex/analysis/internal/private-sha256-v1";
import { Data, Effect } from "effect";

export interface DeclarativeV2Sha256BudgetV1 {
  readonly maximumInputBytes: number;
}

export class DeclarativeV2Sha256InputV1Error extends Data.TaggedError(
  "DeclarativeV2Sha256InputV1Error",
)<{
  readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export class DeclarativeV2Sha256ResourceV1Error extends Data.TaggedError(
  "DeclarativeV2Sha256ResourceV1Error",
)<{
  readonly reason: "unavailable" | "nativeRejected";
}> {}

export class DeclarativeV2Sha256InvariantV1Defect extends Data.TaggedError(
  "DeclarativeV2Sha256InvariantV1Defect",
)<{
  readonly observedByteLength: number | undefined;
}> {}

export type DeclarativeV2Sha256V1Error =
  | DeclarativeV2Sha256InputV1Error
  | DeclarativeV2Sha256ResourceV1Error;

export type DeclarativeV2Sha256V1 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<Uint8Array, DeclarativeV2Sha256V1Error, never>;

const nativeCauseByResourceError = new WeakMap<
  DeclarativeV2Sha256ResourceV1Error,
  DOMException
>();

export function declarativeV2Sha256NativeCauseV1(
  error: DeclarativeV2Sha256ResourceV1Error,
): DOMException | undefined {
  return nativeCauseByResourceError.get(error);
}

export function makeDeclarativeV2Sha256V1(
  foreign: PrivateSha256V1Foreign,
): DeclarativeV2Sha256V1 {
  return adaptDeclarativeV2Sha256V1(
    makePrivateSha256V1(foreign, declarativeV2Sha256ErrorPolicyV1),
  );
}

export function makeLiveDeclarativeV2Sha256V1(): DeclarativeV2Sha256V1 {
  return adaptDeclarativeV2Sha256V1(
    makeLivePrivateSha256V1(declarativeV2Sha256ErrorPolicyV1),
  );
}

function adaptDeclarativeV2Sha256V1(
  sha256: DeclarativeV2Sha256V1,
): DeclarativeV2Sha256V1 {
  return Effect.fn("DeclarativeV2.sha256")((input: unknown, budget: unknown) =>
    sha256(input, budget)
  );
}

const declarativeV2Sha256ErrorPolicyV1: PrivateSha256V1ErrorPolicy<
  DeclarativeV2Sha256V1Error
> = {
  invalidBudget: () =>
    new DeclarativeV2Sha256InputV1Error({ reason: "invalidBudget" }),
  invalidBytes: () =>
    new DeclarativeV2Sha256InputV1Error({ reason: "invalidBytes" }),
  inputBytesExceeded: (observed, maximum) =>
    new DeclarativeV2Sha256InputV1Error({
      reason: "inputBytesExceeded",
      observed,
      maximum,
    }),
  unavailable: () =>
    new DeclarativeV2Sha256ResourceV1Error({ reason: "unavailable" }),
  nativeRejected: (cause) => {
    const error = new DeclarativeV2Sha256ResourceV1Error({
      reason: "nativeRejected",
    });
    nativeCauseByResourceError.set(error, cause);
    return error;
  },
  invalidDigestOutput: (observedByteLength) =>
    new DeclarativeV2Sha256InvariantV1Defect({ observedByteLength }),
};
