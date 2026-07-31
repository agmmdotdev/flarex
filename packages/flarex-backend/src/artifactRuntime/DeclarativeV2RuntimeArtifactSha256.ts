import {
  makeLivePrivateSha256V1,
  makePrivateSha256V1,
  type PrivateSha256V1ErrorPolicy,
  type PrivateSha256V1Foreign,
} from "@flarex/analysis/internal/private-sha256-v1";
import { Data, Effect } from "effect";

export class DeclarativeV2RuntimeArtifactSha256InputV1Error
  extends Data.TaggedError("DeclarativeV2RuntimeArtifactSha256InputV1Error")<{
    readonly reason: "invalidBudget" | "invalidBytes" | "inputBytesExceeded";
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export class DeclarativeV2RuntimeArtifactSha256ResourceV1Error
  extends Data.TaggedError(
    "DeclarativeV2RuntimeArtifactSha256ResourceV1Error",
  )<{
    readonly reason: "unavailable" | "nativeRejected";
  }> {}

export class DeclarativeV2RuntimeArtifactSha256InvariantV1Defect
  extends Data.TaggedError(
    "DeclarativeV2RuntimeArtifactSha256InvariantV1Defect",
  )<{
    readonly reason: "invalidPlatformIntrinsic" | "invalidDigestOutput";
    readonly observedByteLength?: number;
  }> {}

export type DeclarativeV2RuntimeArtifactSha256V1Error =
  | DeclarativeV2RuntimeArtifactSha256InputV1Error
  | DeclarativeV2RuntimeArtifactSha256ResourceV1Error;

export type DeclarativeV2RuntimeArtifactSha256V1 = (
  input: unknown,
  budget: unknown,
) => Effect.Effect<
  Uint8Array,
  DeclarativeV2RuntimeArtifactSha256V1Error
>;

const nativeCauses = new WeakMap<
  DeclarativeV2RuntimeArtifactSha256ResourceV1Error,
  DOMException
>();

export function declarativeV2RuntimeArtifactSha256NativeCauseV1(
  error: DeclarativeV2RuntimeArtifactSha256ResourceV1Error,
): DOMException | undefined {
  return nativeCauses.get(error);
}

export function makeDeclarativeV2RuntimeArtifactSha256V1(
  foreign: PrivateSha256V1Foreign,
): DeclarativeV2RuntimeArtifactSha256V1 {
  const sha256 = makePrivateSha256V1(foreign, errorPolicy);
  return Effect.fn("DeclarativeV2RuntimeArtifact.sha256V1")(
    (input: unknown, budget: unknown) => sha256(input, budget),
  );
}

export function makeLiveDeclarativeV2RuntimeArtifactSha256V1():
  DeclarativeV2RuntimeArtifactSha256V1 {
  const sha256 = makeLivePrivateSha256V1(errorPolicy);
  return Effect.fn("DeclarativeV2RuntimeArtifact.sha256V1")(
    (input: unknown, budget: unknown) => sha256(input, budget),
  );
}

const errorPolicy: PrivateSha256V1ErrorPolicy<
  DeclarativeV2RuntimeArtifactSha256V1Error
> = {
  invalidBudget: () =>
    new DeclarativeV2RuntimeArtifactSha256InputV1Error({
      reason: "invalidBudget",
    }),
  invalidBytes: () =>
    new DeclarativeV2RuntimeArtifactSha256InputV1Error({
      reason: "invalidBytes",
    }),
  inputBytesExceeded: (observed, maximum) =>
    new DeclarativeV2RuntimeArtifactSha256InputV1Error({
      reason: "inputBytesExceeded",
      observed,
      maximum,
    }),
  unavailable: () =>
    new DeclarativeV2RuntimeArtifactSha256ResourceV1Error({
      reason: "unavailable",
    }),
  nativeRejected: cause => {
    const error = new DeclarativeV2RuntimeArtifactSha256ResourceV1Error({
      reason: "nativeRejected",
    });
    nativeCauses.set(error, cause);
    return error;
  },
  invalidDigestOutput: observedByteLength =>
    new DeclarativeV2RuntimeArtifactSha256InvariantV1Defect({
      reason: "invalidDigestOutput",
      ...(observedByteLength === undefined ? {} : { observedByteLength }),
    }),
};
